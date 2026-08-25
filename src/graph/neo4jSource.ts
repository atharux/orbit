import neo4j from 'neo4j-driver-lite'
import type { GraphData, GraphNode, GraphLink, NodeKind, LinkKind } from './types'
import { loadSettings } from '../settings'

// Live read from Neo4j Aura. Credentials come from Settings (localStorage,
// per-device, defaulting from VITE_NEO4J_* when that env var is present --
// i.e. always on local `npm run dev`), NOT from a value baked into the build.
// Read-only (executeRead) — matches the build plan's "demo agent stays
// read-only" guardrail.
//
// NOTE: this used to read VITE_NEO4J_* directly, which bakes creds into
// whatever bundle Vite produces. That's fine for `npm run dev` (the bundle
// never leaves your machine) but not for a packaged/distributed Tauri build,
// which .env.production is deliberately kept blank to prevent (see
// linkedinImport.ts's schema-decision comment) -- reading through Settings
// instead means a packaged build ships with zero credentials, and each
// install's user pastes their own, kept on-device only. For anything public
// beyond a single trusted device, this still needs to move server-side. See
// GRAPHRAG.md.

function creds() {
  const s = loadSettings()
  return {
    uri: s.neo4jUri || undefined,
    user: s.neo4jUsername || undefined,
    pass: s.neo4jPassword || undefined,
    db: s.neo4jDatabase || 'neo4j',
    name: s.neo4jInstanceName || undefined,
  }
}

export function isLiveConfigured(): boolean {
  const { uri, user, pass } = creds()
  return Boolean(uri && user && pass)
}

// Host portion of the bolt URI, e.g. "bfc973e5.databases.neo4j.io".
function auraHost(uri: string): string {
  return /\/\/([^/:?#]+)/.exec(uri)?.[1] ?? ''
}

// Aura connection metadata for the HUD — proves "this is a real instance".
// name comes from the optional instance-name setting; id/host/db are derived.
export function liveInstanceInfo(): {
  host: string; instanceId: string; database: string; user: string; name?: string
} | null {
  const { uri, user, db, name } = creds()
  if (!isLiveConfigured()) return null
  const host = auraHost(uri!)
  return {
    host,
    instanceId: host.split('.')[0], // Aura's instance id is the first host label
    database: db,
    user: user!,
    name,
  }
}

// Deep-link into Neo4j Browser, pre-connected to this Aura instance with an
// optional query loaded in the editor. Password is never included — Browser
// prompts for it. Great "open the real database" demo button.
export function browserDeepLink(cypher?: string): string | null {
  const { uri, user } = creds()
  if (!isLiveConfigured()) return null
  const params = new URLSearchParams({ connectURL: `neo4j+s://${user}@${auraHost(uri!)}` })
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
    verticalId: p.vertical_id || undefined,
    apps: p.apps ? p.apps.split(' · ') : undefined,
    lastShipped: p.last_shipped || undefined,
    linkedinUrl: p.linkedin_url || undefined,
  }
}

// Run an arbitrary READ query and return plain, JSON-serializable rows --
// unlike runReadCypher below (built for the ask panel's "highlight these
// nodes" use case, which only returns a summary + elementIds), this is for
// callers that need the actual values, e.g. smartPresets.ts profiling a
// vertical's shape before asking an LLM to propose questions about it.
export async function runReadRows(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, any>[]> {
  if (!isLiveConfigured()) throw new Error('Neo4j not configured — add your Aura connection in Settings')
  const { uri, user, pass, db } = creds()
  const driver = neo4j.driver(uri!, neo4j.auth.basic(user!, pass!))
  try {
    const result = await driver.executeQuery(cypher, params, { database: db, routing: 'READ' as any })
    return result.records.map(rec => {
      const row: Record<string, any> = {}
      for (const key of rec.keys) {
        const v: any = rec.get(key)
        // Neo4j Integer -> plain number (safe well under 2^53 for our counts).
        row[key as string] = v && typeof v === 'object' && typeof v.toNumber === 'function' ? v.toNumber() : v
      }
      return row
    })
  } finally {
    await driver.close()
  }
}

// Renders a query's actual scalar values into a short readable line, instead
// of just a row count -- e.g. an aggregate query grouping/counting something
// (exactly the shape smartPresets.ts's generated questions tend to produce)
// reads as "Senior Software Engineer (6), Founder (5), Designer (3)", not
// just "10 rows returned". Skips Node/Relationship/array values (those get
// highlighted in the 3D scene instead, via nodeIds) -- only plain
// scalars (the count/label columns an aggregate actually returns) print.
function summarizeRows(records: { keys: readonly PropertyKey[]; get(key: any): any }[]): string | null {
  const lines: string[] = []
  for (const rec of records.slice(0, 8)) {
    const parts: string[] = []
    for (const key of rec.keys) {
      let v: any = rec.get(key)
      if (v && typeof v === 'object' && typeof v.toNumber === 'function') v = v.toNumber() // Neo4j Integer -> plain number
      if (v === null || v === undefined || typeof v === 'object') continue // Node/Relationship/array
      parts.push(String(v))
    }
    if (parts.length) lines.push(parts.join(' — '))
  }
  return lines.length ? lines.join('; ') : null
}

// Run an arbitrary READ query (used by the free-text "ask the graph" panel).
// executeRead rejects any write — the LLM-generated Cypher can only read.
// Returns a human summary + the elementIds of any Node values in the result,
// so the caller can light those nodes up in the 3D scene.
export async function runReadCypher(
  cypher: string,
): Promise<{ summary: string; nodeIds: string[]; rows: number }> {
  if (!isLiveConfigured()) throw new Error('Neo4j not configured — add your Aura connection in Settings')
  const { uri, user, pass, db } = creds()
  const driver = neo4j.driver(uri!, neo4j.auth.basic(user!, pass!))
  try {
    const result = await driver.executeQuery(cypher, {}, { database: db, routing: 'READ' as any })
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
    const rowLabel = `${rows} row${rows === 1 ? '' : 's'} returned`
    const preview = rows > 0 ? summarizeRows(result.records) : null
    const truncated = preview && rows > 8 ? ` (+${rows - 8} more)` : ''
    return { summary: preview ? `${rowLabel}: ${preview}${truncated}` : rowLabel, nodeIds: [...nodeIds], rows }
  } finally {
    await driver.close()
  }
}

export async function fetchLiveGraph(): Promise<GraphData> {
  if (!isLiveConfigured()) throw new Error('Neo4j not configured — add your Aura connection in Settings')
  const { uri, user, pass, db } = creds()
  const driver = neo4j.driver(uri!, neo4j.auth.basic(user!, pass!))
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
      { database: db, routing: 'READ' as any },
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
