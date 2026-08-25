import neo4j from 'neo4j-driver-lite'
import type { Lead } from '../types'
import { STATUS_LABEL } from '../types'
import { loadSettings } from '../settings'

// Seed the Aura graph from the app as leads are discovered / updated. MERGE by
// stable keys so re-syncing the same lead is idempotent. Same projection as
// buildGraph.ts / load_graph.py:
//   Lead              -> Venue     (venue:<id>)
//   email|phone       -> Contact   (contact:<id>)   WORKS_AT venue
//   source            -> Source    (name)           Contact VERIFIED_BY source
//   status            -> Sequence  (seq:<status>)   Contact ENROLLED_IN, Sequence TARGETS venue
//
// This is a WRITE path using Settings-stored creds (see neo4jSource.ts's same
// pattern) -- it used to read VITE_NEO4J_* directly, which meant this always
// threw "Neo4j env not configured" in a packaged Tauri build (.env.production
// is deliberately blank) even with real credentials saved in Settings. Fine
// for a local Aura Free demo; for production it needs to run behind a server
// the creds never leave.

function creds() {
  const s = loadSettings()
  return {
    uri: s.neo4jUri || undefined,
    user: s.neo4jUsername || undefined,
    pass: s.neo4jPassword || undefined,
    db: s.neo4jDatabase || 'neo4j',
  }
}

export function graphSyncEnabled(): boolean {
  const { uri, user, pass } = creds()
  return Boolean(uri && user && pass)
}

interface Row {
  venueId: string; name: string; category: string; district: string
  seqId: string; seqName: string; status: string
  reachable: boolean; contactId: string; verified: boolean; role: string
  source: string | null; srcVerified: boolean
  // full-fidelity backup fields
  email: string | null; phone: string | null; website: string | null
  updatedAt: string; leadJson: string
  // vertical filter chip + App Store card fields (mirrors buildGraph.ts's local projection)
  verticalId: string; apps: string; lastShipped: string
}

function toRow(l: Lead): Row {
  const reachable = Boolean(l.email || l.phone)
  const verified = Boolean(l.email)
  return {
    venueId: `venue:${l.id}`, name: l.name, category: l.category || '', district: l.city || '',
    seqId: `seq:${l.status}`, seqName: STATUS_LABEL[l.status], status: l.status,
    reachable, contactId: `contact:${l.id}`, verified, role: l.category || 'contact',
    source: l.source || null, srcVerified: verified && Boolean(l.source),
    email: l.email || null, phone: l.phone || null, website: l.website || null,
    updatedAt: l.updated_at || '', leadJson: JSON.stringify(l),
    verticalId: l.vertical_id || '', apps: l.custom_fields?.apps || '', lastShipped: l.custom_fields?.last_shipped || '',
  }
}

// One venue+sequence per lead, plus TARGETS. The Venue node now also carries the
// FULL lead (lead_json) plus queryable fields, so Aura is a complete backup —
// nothing is lost the way it was when only name/category/district were stored.
//
// A lead pulled in via reconcileFromNeo4j.ts (Load-from-Aura, e.g. Trades
// seeded by scripts/load_graph.py or LinkedIn companies -- neither ever had a
// venue_id property) gets a local id like "neo4j:<elementId>", so its venueId
// here is "venue:neo4j:<elementId>". That never matches the original node's
// (nonexistent) venue_id, so a plain MERGE keyed on venue_id would silently
// mint a brand-new duplicate Venue every sync instead of erroring -- this bit
// us for real once already. Fix: before the real MERGE, for exactly that
// "venue:neo4j:" case, find the original node by name+vertical (same
// case-insensitive convention linkedinImport.ts already uses) and stamp
// venue_id onto THAT node first if it doesn't have one yet. The MERGE right
// after then finds and reuses it instead of creating a second node. Once
// stamped, every later sync of the same lead hits the fast MERGE path
// directly, no re-lookup needed.
const Q_VENUES = `
UNWIND $rows AS r
WITH r, r.venueId STARTS WITH 'venue:neo4j:' AS fromAuraReconcile
OPTIONAL MATCH (existingV:Venue)
  WHERE fromAuraReconcile AND existingV.venue_id IS NULL
    AND toLower(existingV.name) = toLower(r.name)
    AND (existingV.vertical_id IS NULL OR existingV.vertical_id = '' OR existingV.vertical_id = r.verticalId)
FOREACH (_ IN CASE WHEN existingV IS NOT NULL THEN [1] ELSE [] END | SET existingV.venue_id = r.venueId)
WITH r
MERGE (v:Venue {venue_id: r.venueId})
  SET v.name = r.name, v.category = r.category, v.district = r.district,
      v.email = r.email, v.phone = r.phone, v.website = r.website,
      v.status = r.status, v.updated_at = r.updatedAt, v.lead_json = r.leadJson,
      v.vertical_id = r.verticalId, v.apps = r.apps, v.last_shipped = r.lastShipped
MERGE (s:Sequence {sequence_id: r.seqId})
  SET s.name = r.seqName, s.status = r.status
MERGE (s)-[:TARGETS]->(v)`

// Contacts for reachable leads, wired to their venue + sequence.
const Q_CONTACTS = `
UNWIND [r IN $rows WHERE r.reachable] AS r
MERGE (c:Contact {contact_id: r.contactId})
  SET c.role = r.role, c.verified = r.verified
WITH c, r
MATCH (v:Venue {venue_id: r.venueId})
MATCH (s:Sequence {sequence_id: r.seqId})
MERGE (c)-[:WORKS_AT]->(v)
MERGE (c)-[:ENROLLED_IN]->(s)`

// Sources for verified contacts.
const Q_SOURCES = `
UNWIND [r IN $rows WHERE r.srcVerified] AS r
MERGE (src:Source {name: r.source})
WITH src, r
MATCH (c:Contact {contact_id: r.contactId})
MERGE (c)-[:VERIFIED_BY]->(src)`

export async function syncLeadsToNeo4j(leads: Lead[]): Promise<{ synced: number }> {
  if (!graphSyncEnabled()) throw new Error('Neo4j not configured — add your Aura connection in Settings')
  if (leads.length === 0) return { synced: 0 }
  const rows = leads.map(toRow)
  const { uri, user, pass, db } = creds()
  const driver = neo4j.driver(uri!, neo4j.auth.basic(user!, pass!))
  const session = driver.session({ database: db })
  try {
    await session.executeWrite(async tx => {
      await tx.run(Q_VENUES, { rows })
      await tx.run(Q_CONTACTS, { rows })
      await tx.run(Q_SOURCES, { rows })
    })
    return { synced: leads.length }
  } finally {
    await session.close()
    await driver.close()
  }
}
