// Orbit graph model — mirrors the Neo4j schema in VOD-NEO4J-BUILD-PLAN.md §3.
// Nodes: Venue, Contact, Source, Sequence
// Edges: WORKS_AT (Contact→Venue), VERIFIED_BY (Contact→Source),
//        ENROLLED_IN (Contact→Sequence), TARGETS (Sequence→Venue)

export type NodeKind = 'venue' | 'contact' | 'source' | 'sequence'

export interface GraphNode {
  id: string
  kind: NodeKind
  label: string
  // free-form extras surfaced in the hover card
  sub?: string
  verified?: boolean
  district?: string
  website?: string // venues only — used by the "no website" preset
}

export type LinkKind = 'WORKS_AT' | 'VERIFIED_BY' | 'ENROLLED_IN' | 'TARGETS'

export interface GraphLink {
  source: string
  target: string
  kind: LinkKind
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
  // provenance shown in the HUD so the room always knows what they're looking at
  origin: 'live' | 'leads' | 'sample'
  note?: string
}

// One color per node kind — dark-space palette, tuned for bloom glow.
export const KIND_COLOR: Record<NodeKind, string> = {
  venue: '#22d3ee', // teal
  contact: '#a78bfa', // purple
  source: '#f97316', // orange
  sequence: '#34d399', // green
}

// NOTE: the internal kind key stays 'venue' (and the Neo4j label stays :Venue) so
// the loader and live Aura data keep working — but the DISPLAY noun is "Company",
// because this dataset is trades companies, not nightlife venues.
export const KIND_LABEL: Record<NodeKind, string> = {
  venue: 'Company',
  contact: 'Contact',
  source: 'Source',
  sequence: 'Sequence',
}
