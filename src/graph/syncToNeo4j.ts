import neo4j from 'neo4j-driver-lite'
import type { Lead } from '../types'
import { STATUS_LABEL } from '../types'

// Seed the Aura graph from the app as leads are discovered / updated. MERGE by
// stable keys so re-syncing the same lead is idempotent. Same projection as
// buildGraph.ts / load_graph.py:
//   Lead              -> Venue     (venue:<id>)
//   email|phone       -> Contact   (contact:<id>)   WORKS_AT venue
//   source            -> Source    (name)           Contact VERIFIED_BY source
//   status            -> Sequence  (seq:<status>)   Contact ENROLLED_IN, Sequence TARGETS venue
//
// This is a WRITE path using the VITE_NEO4J_* creds (browser). Fine for a local
// Aura Free demo; for production route it through local-api-server.mjs instead.

const URI = import.meta.env.VITE_NEO4J_URI as string | undefined
const USER = import.meta.env.VITE_NEO4J_USERNAME as string | undefined
const PASS = import.meta.env.VITE_NEO4J_PASSWORD as string | undefined

export function graphSyncEnabled(): boolean {
  return Boolean(URI && USER && PASS)
}

interface Row {
  venueId: string; name: string; category: string; district: string
  seqId: string; seqName: string; status: string
  reachable: boolean; contactId: string; verified: boolean; role: string
  source: string | null; srcVerified: boolean
}

function toRow(l: Lead): Row {
  const reachable = Boolean(l.email || l.phone)
  const verified = Boolean(l.email)
  return {
    venueId: `venue:${l.id}`, name: l.name, category: l.category || '', district: l.city || '',
    seqId: `seq:${l.status}`, seqName: STATUS_LABEL[l.status], status: l.status,
    reachable, contactId: `contact:${l.id}`, verified, role: l.category || 'contact',
    source: l.source || null, srcVerified: verified && Boolean(l.source),
  }
}

// One venue+sequence per lead, plus TARGETS.
const Q_VENUES = `
UNWIND $rows AS r
MERGE (v:Venue {venue_id: r.venueId})
  SET v.name = r.name, v.category = r.category, v.district = r.district
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
  if (!graphSyncEnabled()) throw new Error('Neo4j env not configured')
  if (leads.length === 0) return { synced: 0 }
  const rows = leads.map(toRow)
  const driver = neo4j.driver(URI!, neo4j.auth.basic(USER!, PASS!))
  const session = driver.session({ database: 'neo4j' })
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
