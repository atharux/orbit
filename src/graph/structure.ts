// Structural signal: who bridges otherwise-separate groups (betweenness
// centrality) and what groups exist (Louvain communities) — computed in the
// app with graphology over the loaded graph. Neo4j GDS on this Aura tier only
// runs in paid Graph Analytics sessions, so this is in-app by decision.
//
// Scope: people and companies only. Sequences and Sources are workflow
// bookkeeping — one sequence targets every company, one source tags every
// imported contact — so left in, they'd be "the bridge" of everything and say
// nothing. Measured on the live graph: with them in, the top two "bridges"
// were exactly those two hubs.
//
// The report says only what the data supports. A node is a bridge only if it
// has real betweenness AND its neighbours sit in at least two communities;
// with none, the report says so and why, instead of ranking zeros.
import Graph from 'graphology'
import betweenness from 'graphology-metrics/centrality/betweenness'
import louvain from 'graphology-communities-louvain'
import type { GraphData, GraphNode, NodeKind } from './types'

const IN_SCOPE: NodeKind[] = ['venue', 'contact']
const MAX_BRIDGES = 10
const MAX_COMMUNITIES = 8

export interface Bridge {
  id: string
  label: string
  kind: NodeKind
  betweenness: number // normalised 0..1
  degree: number
  communitiesTouched: number
}

export interface Community {
  id: number
  size: number
  kinds: Partial<Record<NodeKind, number>>
  members: string[] // highest-degree labels first
  memberIds: string[]
}

export interface StructureReport {
  scope: string
  nodes: number
  edges: number
  isolatedIds: string[]
  clusters: number // connected components
  largestClusterIds: string[]
  communities: Community[] // size ≥ 2, largest first (capped)
  communityCount: number // size ≥ 2
  modularity: number
  bridges: Bridge[]
  whyNoBridges?: string
}

// Seeded PRNG (mulberry32) so Louvain gives the same communities every open.
function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function analyzeStructure(data: GraphData): StructureReport {
  const g = new Graph({ type: 'undirected', multi: false })
  const byId = new Map<string, GraphNode>()
  for (const n of data.nodes) if (IN_SCOPE.includes(n.kind)) { g.addNode(n.id); byId.set(n.id, n) }
  const endId = (e: unknown) => (typeof e === 'object' && e !== null ? (e as { id: string }).id : String(e))
  for (const l of data.links) {
    const a = endId(l.source), b = endId(l.target)
    if (a !== b && g.hasNode(a) && g.hasNode(b) && !g.hasEdge(a, b)) g.addEdge(a, b)
  }

  // connected components (iterative DFS)
  const seen = new Set<string>()
  const comps: string[][] = []
  g.forEachNode(start => {
    if (seen.has(start)) return
    const comp: string[] = []
    const stack = [start]
    seen.add(start)
    while (stack.length) {
      const n = stack.pop()!
      comp.push(n)
      g.forEachNeighbor(n, m => { if (!seen.has(m)) { seen.add(m); stack.push(m) } })
    }
    comps.push(comp)
  })
  comps.sort((a, b) => b.length - a.length)
  const isolatedIds = g.filterNodes(n => g.degree(n) === 0)

  const lv = g.size > 0 ? louvain.detailed(g, { rng: seeded(42) }) : null
  const communityOf = (id: string) => lv?.communities[id] ?? -1
  const bw = g.size > 0 ? betweenness(g, { normalized: true }) : {}

  const groups = new Map<number, string[]>()
  g.forEachNode(id => {
    if (g.degree(id) === 0) return
    const c = communityOf(id)
    groups.set(c, [...(groups.get(c) ?? []), id])
  })
  const communitiesAll: Community[] = [...groups.entries()]
    .filter(([, ids]) => ids.length >= 2)
    .map(([id, ids]) => {
      const kinds: Partial<Record<NodeKind, number>> = {}
      ids.forEach(x => { const k = byId.get(x)!.kind; kinds[k] = (kinds[k] ?? 0) + 1 })
      const sorted = [...ids].sort((a, b) => g.degree(b) - g.degree(a))
      return { id, size: ids.length, kinds, members: sorted.slice(0, 4).map(x => byId.get(x)!.label), memberIds: ids }
    })
    .sort((a, b) => b.size - a.size)

  const bridges: Bridge[] = Object.entries(bw)
    .filter(([, v]) => v > 0)
    .map(([id, v]) => ({
      id,
      label: byId.get(id)!.label,
      kind: byId.get(id)!.kind,
      betweenness: v,
      degree: g.degree(id),
      communitiesTouched: new Set(g.neighbors(id).map(communityOf)).size,
    }))
    .filter(b => b.communitiesTouched >= 2)
    .sort((a, b) => b.betweenness - a.betweenness)
    .slice(0, MAX_BRIDGES)

  const multiAffiliated = data.nodes.filter(n => n.kind === 'contact' && g.hasNode(n.id))
    .filter(n => g.neighbors(n.id).filter(m => byId.get(m)?.kind === 'venue').length > 1).length

  return {
    scope: 'people and companies (works-at, colleague-of); sequences and sources excluded',
    nodes: g.order,
    edges: g.size,
    isolatedIds,
    clusters: comps.filter(c => c.length >= 2).length, // unconnected nodes are reported separately, not as clusters of one
    largestClusterIds: comps[0] ?? [],
    communities: communitiesAll.slice(0, MAX_COMMUNITIES),
    communityCount: communitiesAll.length,
    modularity: lv?.modularity ?? 0,
    bridges,
    whyNoBridges: bridges.length ? undefined
      : multiAffiliated === 0
        ? 'no node connects two groups: no contact is linked to more than one company, so every cluster is a single company and its people'
        : `no node connects two groups: ${multiAffiliated} contact${multiAffiliated === 1 ? ' links' : 's link'} several companies, but those companies fall in the same community, so no one connects separate groups`,
  }
}

// The report as the investigation loop (and the panel) reads it.
export function renderStructure(r: StructureReport): string {
  const lines = [
    `Scope: ${r.scope}.`,
    `${r.nodes} nodes, ${r.edges} links; ${r.clusters} separate clusters (largest has ${r.largestClusterIds.length} nodes); ${r.isolatedIds.length} nodes with no links at all.`,
    `Communities (Louvain, size ≥ 2): ${r.communityCount}; modularity ${r.modularity.toFixed(2)}.`,
  ]
  if (r.communities.length) {
    lines.push('Largest communities: ' + r.communities
      .map(c => `${c.size} nodes [${Object.entries(c.kinds).map(([k, v]) => `${v} ${k}`).join(', ')}]: ${c.members.join(', ')}`)
      .join(' | '))
  }
  lines.push(r.bridges.length
    ? 'Bridges (betweenness, communities their neighbours span): ' + r.bridges
      .map(b => `${b.label} (${b.kind}) ${b.betweenness.toFixed(3)}, spans ${b.communitiesTouched}, ${b.degree} links`).join('; ')
    : `Bridges: none — ${r.whyNoBridges}.`)
  return lines.join('\n')
}
