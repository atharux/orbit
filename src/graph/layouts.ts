// Fixed layouts for the graph canvas — Bloom-style alternatives to the
// default force simulation. Each one is a pure function from the graph to a
// flat (z = 0) position per node id; GraphOverlay pins nodes to these with
// fx/fy/fz and tweens them there, so no second graph library is needed.
import type { GraphLink, GraphNode, NodeKind } from './types'

export type LayoutMode = 'force3d' | 'force2d' | 'circular' | 'tiers'

export const LAYOUTS: { mode: LayoutMode; label: string; hint: string }[] = [
  { mode: 'force3d', label: 'Force 3D', hint: 'Free-floating 3D simulation (default)' },
  { mode: 'force2d', label: 'Force 2D', hint: 'Same simulation, flattened onto a plane, viewed head-on' },
  { mode: 'circular', label: 'Circular', hint: 'One ring, nodes grouped by type, so cross-group edges read at a glance' },
  { mode: 'tiers', label: 'Hierarchical', hint: 'One column per type: Source ← Contact → Company ← Sequence' },
]

// A layout is "flat" when it lives on the z = 0 plane and is viewed head-on.
export const isFlat = (mode: LayoutMode) => mode !== 'force3d'
// Force layouts run the simulation; the rest pin every node.
export const isPinned = (mode: LayoutMode) => mode === 'circular' || mode === 'tiers'

export type Positions = Map<string, { x: number; y: number }>

// Once 3d-force-graph has digested the data, link ends are node objects, not ids.
const endId = (e: unknown) => (typeof e === 'object' && e !== null ? (e as { id: string }).id : (e as string))

// Ring order: companies first, then the people at them, then where the people
// were verified, then the sequences working them — the same reading order as
// the legend. Hydra follows as its own arc: where → what → proof.
const RING_ORDER: NodeKind[] = [
  'venue', 'contact', 'source', 'sequence',
  'employer', 'role', 'project', 'skill', 'achievement', 'artifact', 'education',
]

// Arc length per node on the ring. Labels are horizontal sprites, so nodes at
// the top/bottom of the ring sit side by side — this has to fit a typical label.
const RING_SPACING = 34
// Empty slots left between kind groups so each colour reads as its own arc.
const GROUP_GAP_SLOTS = 2

export function circularLayout(nodes: GraphNode[]): Positions {
  const groups = RING_ORDER
    .map(kind => nodes.filter(n => n.kind === kind).sort((a, b) => a.label.localeCompare(b.label)))
    .filter(g => g.length > 0)
  const gaps = groups.length > 1 ? groups.length * GROUP_GAP_SLOTS : 0
  const slots = nodes.length + gaps
  const radius = Math.max(120, (slots * RING_SPACING) / (2 * Math.PI))
  const out: Positions = new Map()
  let slot = 0
  for (const g of groups) {
    for (const n of g) {
      // Start at 12 o'clock, run clockwise.
      const a = Math.PI / 2 - (slot / slots) * 2 * Math.PI
      out.set(n.id, { x: radius * Math.cos(a), y: radius * Math.sin(a) })
      slot++
    }
    if (groups.length > 1) slot += GROUP_GAP_SLOTS
  }
  return out
}

// Column order follows the real edge directions: VERIFIED_BY points
// Contact→Source (left), WORKS_AT Contact→Company, TARGETS Sequence→Company
// (right). COLLEAGUE_OF stays inside the Contact column.
// Hydra (placed after Orbit when both load) reads as a career trail:
// Employer ← Role → Project → Skill → Artifact, with Achievement between the
// role/project it came from and the skill it demonstrates. Education only
// points at artifacts, so it sits beside the employers. RELATED_TO stays
// inside the Skill column.
const TIER_ORDER: NodeKind[] = [
  'source', 'contact', 'venue', 'sequence',
  'education', 'employer', 'role', 'achievement', 'project', 'skill', 'artifact',
]
// Each dataset's "spine" column is ranked alphabetically; every other column
// is ordered by where its neighbours sit, working outward from the nearest spine.
const ANCHORS = new Set<NodeKind>(['venue', 'role'])
const ROW_GAP = 22
const MAX_ROWS = 40 // taller columns wrap into sub-columns instead of running off-screen
const SUBCOL_GAP = 90
const TIER_GAP = 220

export function tiersLayout(nodes: GraphNode[], links: GraphLink[]): Positions {
  // Neighbour lists, so each column can be ordered by where its neighbours sit
  // (one barycentre pass anchored on the Company column) — cuts edge crossings
  // without a full Sugiyama layout.
  const nbrs = new Map<string, string[]>()
  for (const l of links) {
    const s = endId(l.source), t = endId(l.target)
    if (!nbrs.has(s)) nbrs.set(s, [])
    if (!nbrs.has(t)) nbrs.set(t, [])
    nbrs.get(s)!.push(t)
    nbrs.get(t)!.push(s)
  }
  const rank = new Map<string, number>()
  const byKind = (kind: NodeKind) => nodes.filter(n => n.kind === kind)
  const orderBy = (col: GraphNode[]) => {
    const score = (n: GraphNode) => {
      const r = (nbrs.get(n.id) ?? []).map(id => rank.get(id)).filter((v): v is number => v !== undefined)
      return r.length ? r.reduce((a, b) => a + b, 0) / r.length : Number.POSITIVE_INFINITY
    }
    const sorted = [...col].sort((a, b) => score(a) - score(b) || a.label.localeCompare(b.label))
    sorted.forEach((n, i) => rank.set(n.id, i / Math.max(1, sorted.length - 1)))
    return sorted
  }

  const columns = new Map<NodeKind, GraphNode[]>()
  const anchorIdx = TIER_ORDER.map((k, i) => (ANCHORS.has(k) ? i : -1)).filter(i => i >= 0)
  const distToAnchor = (i: number) => Math.min(...anchorIdx.map(a => Math.abs(a - i)))
  const sweep = TIER_ORDER.map((k, i) => ({ k, i })).sort((a, b) => distToAnchor(a.i) - distToAnchor(b.i))
  for (const { k } of sweep) {
    if (ANCHORS.has(k)) {
      const col = [...byKind(k)].sort((a, b) => a.label.localeCompare(b.label))
      col.forEach((n, i) => rank.set(n.id, i / Math.max(1, col.length - 1)))
      columns.set(k, col)
    } else {
      columns.set(k, orderBy(byKind(k)))
    }
  }

  // Lay columns out left to right, wrapping tall ones, then centre the whole
  // block on the origin so zoomToFit and the head-on camera line up.
  const out: Positions = new Map()
  let x = 0
  for (const kind of TIER_ORDER) {
    const col = columns.get(kind)!
    if (col.length === 0) continue
    const subCols = Math.ceil(col.length / MAX_ROWS)
    const rows = Math.ceil(col.length / subCols)
    col.forEach((n, i) => {
      const sc = Math.floor(i / rows)
      const row = i % rows
      const inThisSub = Math.min(rows, col.length - sc * rows)
      out.set(n.id, { x: x + sc * SUBCOL_GAP, y: ((inThisSub - 1) / 2 - row) * ROW_GAP })
    })
    x += (subCols - 1) * SUBCOL_GAP + TIER_GAP
  }
  const width = x - TIER_GAP
  for (const p of out.values()) p.x -= width / 2
  return out
}

export function computeLayout(mode: LayoutMode, nodes: GraphNode[], links: GraphLink[]): Positions | null {
  if (mode === 'circular') return circularLayout(nodes)
  if (mode === 'tiers') return tiersLayout(nodes, links)
  return null
}
