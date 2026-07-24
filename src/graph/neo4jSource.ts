import neo4j from 'neo4j-driver-lite'
import type { GraphData, GraphNode, GraphLink, NodeKind, LinkKind } from './types'

// Live read from Neo4j Aura. Enabled automatically when the three VITE_NEO4J_*
// vars are present in .env. Read-only (executeRead) — matches the build plan's
// "demo agent stays read-only" guardrail.
//
// NOTE: putting Aura creds in VITE_ vars ships them in the browser bundle. Fine
// for a hackathon with a throwaway read-only user; for anything public, move
// this query behind local-api-server.mjs instead. See GRAPHRAG.md.

const URI = import.meta.env.VITE_NEO4J_URI as string | undefined
const USER = import.meta.env.VITE_NEO4J_USERNAME as string | undefined
const PASS = import.meta.env.VITE_NEO4J_PASSWORD as string | undefined
// Aura's database is usually "neo4j", but some instances name it after the
// instance id — take it from env when provided.
const DB = (import.meta.env.VITE_NEO4J_DATABASE as string | undefined) || 'neo4j'

export function isLiveConfigured(): boolean {
  return Boolean(URI && USER && PASS)
}

// Host portion of the bolt URI, e.g. "bfc973e5.databases.neo4j.io".
function auraHost(): string {
  return /\/\/([^/:?#]+)/.exec(URI ?? '')?.[1] ?? ''
}

// Aura connection metadata for the HUD — proves "this is a real instance".
// name comes from an optional VITE_NEO4J_INSTANCE_NAME; id/host/db are derived.
export function liveInstanceInfo(): {
  host: string; instanceId: string; database: string; user: string; name?: string
} | null {
  if (!isLiveConfigured()) return null
  const host = auraHost()
  return {
    host,
    instanceId: host.split('.')[0], // Aura's instance id is the first host label
    database: DB,
    user: USER!,
    name: (import.meta.env.VITE_NEO4J_INSTANCE_NAME as string | undefined) || undefined,
  }
}

// Deep-link into Neo4j Browser, pre-connected to this Aura instance with an
// optional query loaded in the editor. Password is never included — Browser
// prompts for it. Great "open the real database" demo button.
export function browserDeepLink(cypher?: string): string | null {
  if (!isLiveConfigured()) return null
  const params = new URLSearchParams({ connectURL: `neo4j+s://${USER}@${auraHost()}` })
  if (cypher) { params.set('cmd', 'edit'); params.set('arg', cypher) }
  return `https://browser.neo4j.io/?${params.toString()}`
}

const LABEL_TO_KIND: Record<string, NodeKind> = {
  Venue: 'venue', Contact: 'contact', Source: 'source', Sequence: 'sequence',
}

function nodeToGraphNode(n: any): GraphNode | null {
  const label = (n.labels as string[]).find(l => l in LABEL_TO_KIND)
  if (!label) return null
  const kind = LABEL_TO_KIND[label]
  const p = n.properties ?? {}
  return {
    id: n.elementId,
    kind,
    label: p.name ?? p.role ?? p.venue_id ?? p.contact_id ?? kind,
    // Contacts: prefer the person's title/role as the sub-line (their position).
    // The company they work at comes from the WORKS_AT edge, shown in the card.
    sub: p.category ?? p.title ?? p.role ?? p.status ?? undefined,
    verified: typeof p.verified === 'boolean' ? p.verified : undefined,
    district: p.district ?? undefined,
    website: p.website ?? undefined, // now synced full-fidelity — powers the "no website" preset live
  }
}

// Run an arbitrary READ query (used by the free-text "ask the graph" panel).
// executeRead rejects any write — the LLM-generated Cypher can only read.
// Returns a human summary + the elementIds of any Node values in the result,
// so the caller can light those nodes up in the 3D scene.
export async function runReadCypher(
  cypher: string,
): Promise<{ summary: string; nodeIds: string[]; rows: number }> {
  if (!isLiveConfigured()) throw new Error('Neo4j env not configured')
  const driver = neo4j.driver(URI!, neo4j.auth.basic(USER!, PASS!))
  try {
    const result = await driver.executeQuery(cypher, {}, { database: DB, routing: 'READ' as any })
    const nodeIds = new Set<string>()
    for (const rec of result.records) {
      for (const key of rec.keys) {
        const v: any = rec.get(key)
        // A returned Node has .labels + .elementId; collect it for highlighting.
        if (v && typeof v === 'object' && Array.isArray(v.labels) && v.elementId) nodeIds.add(v.elementId)
        // A returned list of nodes
        if (Array.isArray(v)) for (const item of v) if (item?.elementId && Array.isArray(item?.labels)) nodeIds.add(item.elementId)
      }
    }
    const rows = result.records.length
    return { summary: `${rows} row${rows === 1 ? '' : 's'} returned`, nodeIds: [...nodeIds], rows }
  } finally {
    await driver.close()
  }
}

export async function fetchLiveGraph(): Promise<GraphData> {
  if (!isLiveConfigured()) throw new Error('Neo4j env not configured')
  const driver = neo4j.driver(URI!, neo4j.auth.basic(USER!, PASS!))
  try {
    const nodes = new Map<string, GraphNode>()
    const links: GraphLink[] = []
    const linkSeen = new Set<string>()

    const result = await driver.executeQuery(
      `MATCH (n)
       WHERE n:Venue OR n:Contact OR n:Source OR n:Sequence
       OPTIONAL MATCH (n)-[r]->(m)
       WHERE m:Venue OR m:Contact OR m:Source OR m:Sequence
       RETURN n, type(r) AS rel, m`,
      {},
      { database: DB, routing: 'READ' as any },
    )

    for (const rec of result.records) {
      const n = nodeToGraphNode(rec.get('n'))
      if (n) nodes.set(n.id, n)
      const mRaw = rec.get('m')
      const rel = rec.get('rel') as LinkKind | null
      if (mRaw && rel) {
        const m = nodeToGraphNode(mRaw)
        if (m) {
          nodes.set(m.id, m)
          const key = `${rel}:${n?.id}->${m.id}`
          if (n && !linkSeen.has(key)) {
            linkSeen.add(key)
            links.push({ source: n.id, target: m.id, kind: rel })
          }
        }
      }
    }

    return {
      nodes: [...nodes.values()],
      links,
      origin: 'live',
      note: `Neo4j Aura · ${nodes.size} nodes`,
    }
  } finally {
    await driver.close()
  }
}
