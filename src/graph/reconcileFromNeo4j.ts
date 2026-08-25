// Pulls real data from live Neo4j back into local Lead storage, for a single
// vertical. This is the missing reverse direction: syncToNeo4j.ts only ever
// pushes local leads -> Aura, so a Venue seeded any other way -- scripts/
// load_graph.py, or linkedinImport.ts -- exists in the graph but was never a
// local Lead, and the Leads dashboard (which reads local storage only, see
// storage.ts) shows it as "no leads yet" even though the graph view shows
// hundreds of nodes.
//
// Two reconstruction paths per Venue:
//   1. High fidelity: syncToNeo4j.ts's Q_VENUES writes the FULL original Lead
//      as v.lead_json on every push -- if that's present, parse and restore
//      it exactly, no data loss.
//   2. Best effort: no lead_json (LinkedIn companies, or anything seeded
//      directly into Neo4j) -- reconstruct a Lead from the queryable Venue
//      fields that exist. Never overwrites a status/notes/tags a user has
//      already set locally on a lead that's already been reconciled once.

import type { Lead, OutreachStatus, Vertical } from '../types'
import { STATUSES } from '../types'
import { runReadRows } from './neo4jSource'

function coerceStatus(s: unknown): OutreachStatus {
  return typeof s === 'string' && (STATUSES as readonly string[]).includes(s) ? (s as OutreachStatus) : 'new'
}

export interface ReconcileSummary {
  created: number
  updated: number
  total: number
}

export async function reconcileLeadsFromNeo4j(
  vertical: Vertical,
  existingLeads: Lead[],
): Promise<{ leads: Lead[]; summary: ReconcileSummary }> {
  // scripts/load_graph.py never set vertical_id on the Venue nodes it seeded
  // (confirmed: every vertical_id-less Venue in the live graph is a Trades
  // category -- electrician/plumber/carpenter/etc, nothing else). A bare
  // "vertical_id IS NULL" wildcard would therefore be correct for Trades but
  // WRONG for any other vertical -- it would silently pull all 76 of those
  // Trades businesses into whatever other empty vertical someone reconciles
  // next. Scope the null-vertical_id fallback to only match Venues whose
  // category is actually one of this vertical's own known categories (same
  // "craft:x" / "amenity:x" -> "x" stripping verticals.ts's own consumers use).
  const bareCategories = vertical.osmCategories.map(c => c.includes(':') ? c.split(':')[1] : c)
  const rows = await runReadRows(
    `MATCH (v:Venue)
     WHERE v.vertical_id = $vid
        OR (v.vertical_id IS NULL AND v.category IN $categories)
     RETURN v`,
    { vid: vertical.id, categories: bareCategories },
  )
  const verticalId = vertical.id

  const byId = new Map(existingLeads.map(l => [l.id, l]))
  let created = 0
  let updated = 0
  const now = new Date().toISOString()

  for (const row of rows) {
    const node = row.v
    const props: Record<string, any> = node?.properties ?? {}
    const elementId: string = node?.elementId ?? ''

    if (typeof props.lead_json === 'string') {
      try {
        const restored = JSON.parse(props.lead_json) as Lead
        if (restored?.id) {
          if (byId.has(restored.id)) updated++; else created++
          byId.set(restored.id, restored)
          continue
        }
      } catch {
        // fall through to best-effort reconstruction below
      }
    }

    const id: string = props.venue_id || `neo4j:${elementId}`
    const existing = byId.get(id)
    const lead: Lead = {
      id,
      vertical_id: verticalId,
      name: props.name ?? 'Unnamed',
      category: props.category ?? '',
      city: props.district ?? '',
      website: props.website || undefined,
      email: props.email || undefined,
      phone: props.phone || undefined,
      // Never clobber a status/notes/tags the user already set on a
      // previously-reconciled lead -- only Neo4j-only fields get refreshed.
      status: existing?.status ?? coerceStatus(props.status),
      tags: existing?.tags ?? [],
      source: existing?.source ?? (typeof props.source === 'string' ? props.source : 'neo4j'),
      notes: existing?.notes,
      custom_fields: existing?.custom_fields,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    }
    if (existing) updated++; else created++
    byId.set(id, lead)
  }

  return { leads: [...byId.values()], summary: { created, updated, total: rows.length } }
}
