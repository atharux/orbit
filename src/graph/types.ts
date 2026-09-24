// Orbit graph model — mirrors the Neo4j schema in VOD-NEO4J-BUILD-PLAN.md §3.
// Nodes: Venue, Contact, Source, Sequence
// Edges: WORKS_AT (Contact→Venue), VERIFIED_BY (Contact→Source),
//        ENROLLED_IN (Contact→Sequence), TARGETS (Sequence→Venue),
//        COLLEAGUE_OF (Contact→Contact, LinkedIn vertical only — two imported
//        connections sharing a WORKS_AT company, see linkedinImport.ts)
//
// Hydra's Modus evidence graph (job-tracker/MODUS.md) lives in the same Aura
// instance under the :Modus label. It's read-only here — Orbit never writes
// it — and only loaded when the graph's data scope includes Hydra.
// Nodes: Company (shown as "Employer", so it can't be confused with Orbit's
//        Venue-backed "Company"), Role, Project, Skill, Achievement, Artifact,
//        Education — each carries a `verified` flag + source.

export type OrbitKind = 'venue' | 'contact' | 'source' | 'sequence'
export type HydraKind = 'employer' | 'role' | 'project' | 'skill' | 'achievement' | 'artifact' | 'education'
export type NodeKind = OrbitKind | HydraKind

export const ORBIT_KINDS: OrbitKind[] = ['venue', 'contact', 'source', 'sequence']
export const HYDRA_KINDS: HydraKind[] = ['employer', 'role', 'project', 'skill', 'achievement', 'artifact', 'education']

// Which dataset(s) the live graph loads. Hydra is only reachable live — it
// exists nowhere but Aura.
export type GraphScope = 'orbit' | 'hydra' | 'both'

export interface GraphNode {
  id: string
  kind: NodeKind
  label: string
  // free-form extras surfaced in the hover card
  sub?: string
  verified?: boolean
  district?: string
  website?: string // venues only — used by the "no website" preset
  verticalId?: string // venue/contact only — the lead's vertical, drives the vertical filter chips
  apps?: string[] // App Store publishers — titles they have shipped
  lastShipped?: string // App Store publishers — date of their most recent release
  linkedinUrl?: string // contacts only — set by linkedinImport.ts, opens the real profile
  sourceUrl?: string // Hydra only — the evidence behind a verified claim, or the artifact itself
}

export type OrbitLinkKind = 'WORKS_AT' | 'VERIFIED_BY' | 'ENROLLED_IN' | 'TARGETS' | 'COLLEAGUE_OF'
export type HydraLinkKind =
  | 'AT' | 'INVOLVED' | 'APPLIED_SKILL' | 'USED_SKILL' | 'ACHIEVED_IN'
  | 'ACHIEVED_VIA' | 'DEMONSTRATES' | 'EVIDENCED_BY' | 'RELATED_TO'
export type LinkKind = OrbitLinkKind | HydraLinkKind

export const ORBIT_LINKS: OrbitLinkKind[] = ['WORKS_AT', 'VERIFIED_BY', 'ENROLLED_IN', 'TARGETS', 'COLLEAGUE_OF']
export const HYDRA_LINKS: HydraLinkKind[] = [
  'AT', 'INVOLVED', 'APPLIED_SKILL', 'USED_SKILL', 'ACHIEVED_IN', 'ACHIEVED_VIA', 'DEMONSTRATES', 'EVIDENCED_BY', 'RELATED_TO',
]
export const isHydraKind = (k: NodeKind): k is HydraKind => (HYDRA_KINDS as NodeKind[]).includes(k)

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
  // Hydra — a separate family so "Both" never reads as one dataset.
  employer: '#94a3b8', // slate
  role: '#f472b6', // pink
  project: '#60a5fa', // blue
  skill: '#facc15', // yellow
  achievement: '#a3e635', // lime
  artifact: '#e7e5e4', // stone
  education: '#818cf8', // indigo
}

// NOTE: the internal kind key stays 'venue' (and the Neo4j label stays :Venue) so
// the loader and live Aura data keep working — but the DISPLAY noun is "Company",
// because this dataset is trades companies, not nightlife venues.
export const KIND_LABEL: Record<NodeKind, string> = {
  venue: 'Company',
  contact: 'Contact',
  source: 'Source',
  sequence: 'Sequence',
  employer: 'Employer',
  role: 'Role',
  project: 'Project',
  skill: 'Skill',
  achievement: 'Achievement',
  artifact: 'Artifact',
  education: 'Education',
}
