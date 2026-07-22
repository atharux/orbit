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

export function isLiveConfigured(): boolean {
  return Boolean(URI && USER && PASS)
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
    sub: p.category ?? p.role ?? p.status ?? undefined,
    verified: typeof p.verified === 'boolean' ? p.verified : undefined,
    district: p.district ?? undefined,
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
      { database: 'neo4j', routing: 'READ' as any },
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
