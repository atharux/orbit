// Insight cards: a finding from the investigation loop (investigate.ts), kept
// as a standing, written statement rather than a question — and re-derived
// when the graph's data changes, so it never quietly goes out of date.
//
// Staleness is a fingerprint of the data: computed in Aura with APOC over
// every property of Orbit's nodes and relationships (neo4jSource
// fetchDataStamp), or — if that call fails — over the loaded graph here. When
// it differs from the one a card was written against, the card is stale; the
// overlay re-runs stale cards when it opens (a few per open, to bound
// OpenRouter use) and the rest can be refreshed by hand. Kept in
// localStorage, like every other Orbit list.
import type { GraphData } from './types'
import { investigate, type Investigation } from './investigate'

export interface InsightTrailStep {
  hypothesis: string
  cypher: string
  via: 'mcp' | 'driver' | 'refused'
  rows: number
  error?: string
}

export interface Insight {
  id: string
  question: string // what was investigated — the card leads with the claim, not this
  claim: string
  confidence: 'low' | 'medium' | 'high'
  nodeIds: string[]
  trail: InsightTrailStep[]
  model: string
  writtenAt: string // ISO
  stamp: string // data fingerprint the claim was derived from
  previousClaim?: string // the claim before the last refresh, if it changed
  lastError?: string // last refresh attempt failed (the claim above is the older one)
  failedStamp?: string // data the last failed refresh ran against — not auto-retried until the data changes again
}

const LS_KEY = 'orbit.insights.v1'

export function loadInsights(): Insight[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function saveInsights(list: Insight[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list))
  } catch (err) {
    console.warn('insights: localStorage write failed', err)
  }
}

// Fallback fingerprint when the server-side one can't be computed: FNV-1a over
// a canonical dump of every field the loaded graph carries — order-independent
// (sorted), so the same data loaded twice gives the same stamp. Coarser than
// the APOC one: it can't see properties the canvas doesn't load.
export function dataStamp(g: GraphData): string {
  const endId = (e: unknown) => (typeof e === 'object' && e !== null ? (e as { id: string }).id : String(e))
  const parts = [
    ...g.nodes.map(n => `n|${n.id}|${n.kind}|${n.label}|${n.verified ?? ''}|${n.sub ?? ''}|${n.district ?? ''}|${n.website ?? ''}|${n.verticalId ?? ''}|${(n.apps ?? []).join(',')}|${n.lastShipped ?? ''}|${n.linkedinUrl ?? ''}`),
    ...g.links.map(l => `l|${endId(l.source)}|${l.kind}|${endId(l.target)}`),
  ].sort()
  let h = 0x811c9dc5
  for (const p of parts) {
    for (let i = 0; i < p.length; i++) {
      h ^= p.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    h ^= 0x0a
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `local:${g.nodes.length}n-${g.links.length}e-${h.toString(16)}`
}

export function isStale(card: Insight, stamp: string): boolean {
  return card.stamp !== stamp
}

// Stale cards worth refreshing on their own: not already failed against this
// exact data (a card that can't conclude would otherwise burn ~8 calls on
// every open), oldest-confirmed first so nothing starves at the list's end.
export function autoRefreshQueue(cards: Insight[], stamp: string, max: number): string[] {
  return cards
    .filter(c => isStale(c, stamp) && c.failedStamp !== stamp)
    .sort((a, b) => a.writtenAt.localeCompare(b.writtenAt))
    .slice(0, max)
    .map(c => c.id)
}

function trailOf(inv: Investigation): InsightTrailStep[] {
  return inv.steps.map(s => ({ hypothesis: s.hypothesis, cypher: s.cypher, via: s.via, rows: s.rows, error: s.error }))
}

// A concluded investigation → a new card. Returns null when there's nothing
// to pin (no finding).
export function insightFrom(inv: Investigation, stamp: string): Insight | null {
  if (!inv.finding) return null
  return {
    id: `ins-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    question: inv.question,
    claim: inv.finding.claim,
    confidence: inv.finding.confidence,
    nodeIds: inv.finding.nodeIds,
    trail: trailOf(inv),
    model: inv.steps[inv.steps.length - 1]?.model ?? '',
    writtenAt: new Date().toISOString(),
    stamp,
  }
}

// Re-derive a card against the current data. On failure the old claim stays
// and the error is recorded — a card never silently turns blank.
export async function refreshInsight(
  card: Insight,
  stamp: string,
  opts: { apiKey: string; model?: string; signal?: AbortSignal },
): Promise<Insight> {
  // A refresh re-checks the standing claim rather than re-investigating from
  // scratch — otherwise every refresh rewrites the card in new words even when
  // nothing changed, and "earlier" stops meaning anything.
  const inv = await investigate(card.question, { apiKey: opts.apiKey, model: opts.model, signal: opts.signal, recheck: card.claim })
  if (!inv.finding) {
    const why = inv.stoppedBecause === 'cancelled' ? 'cancelled'
      : inv.stoppedBecause === 'step-cap' ? 'no conclusion within the query budget'
      : inv.error ?? 'failed'
    return { ...card, lastError: why, failedStamp: stamp }
  }
  // Unchanged only if the model restated the claim itself (the re-check
  // prompt asks for it verbatim; trailing commentary is tolerated). Any other
  // wording counts as a change and keeps the old claim visible as "earlier" —
  // a false "changed" is harmless, a false "unchanged" hides a new fact.
  const unchanged = sameClaim(card.claim, inv.finding.claim)
  return {
    ...card,
    claim: unchanged ? card.claim : inv.finding.claim,
    confidence: inv.finding.confidence,
    nodeIds: inv.finding.nodeIds.length ? inv.finding.nodeIds : card.nodeIds,
    failedStamp: undefined,
    trail: trailOf(inv),
    model: inv.steps[inv.steps.length - 1]?.model ?? card.model,
    writtenAt: new Date().toISOString(),
    stamp,
    previousClaim: unchanged ? card.previousClaim : card.claim,
    lastError: undefined,
  }
}

// Same claim = the new text is the old text (after normalising quotes,
// case and whitespace), optionally followed by commentary.
function sameClaim(before: string, after: string): boolean {
  const norm = (t: string) => t.toLowerCase().replace(/[“”"'‘’]/g, '').replace(/\s+/g, ' ').trim()
  const a = norm(before), b = norm(after)
  return b === a || b.startsWith(a)
}
