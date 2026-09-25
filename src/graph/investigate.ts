// Agentic reasoning loop over the live graph. Instead of NL -> one Cypher ->
// answer (askLive), the model works like an analyst: states a hypothesis, runs
// ONE read-only query to test it, reads the result, then refines, tests an
// alternative, or concludes. Every query goes through MCP read_neo4j_cypher
// when the local server is up (mcp/start.sh, --read-only), else the direct
// driver in a read-mode transaction — and each step records which.
//
// JSON-in-text protocol, not native tool calling: Orbit runs on free
// OpenRouter models by default and their tool-call support is uneven. One
// JSON object per turn, parsed inside the model-retry loop (generateParsed).
import { generateParsed, parseJsonObject, type AIMessage } from '../services/orClient'
import { callMcpTool, isMcpAvailable } from './mcpClient'
import { runProbe } from './neo4jSource'
import { GRAPH_SCHEMA, WRITE_RE } from './ask'

export interface InvestigationStep {
  n: number
  hypothesis: string
  cypher: string
  via: 'mcp' | 'driver' | 'refused' | 'in-app'
  rows: number
  preview: string // what the model was shown
  nodeIds: string[]
  error?: string
  model: string
}

export interface Finding {
  claim: string
  confidence: 'low' | 'medium' | 'high'
  nodeIds: string[] // evidence — only ids that actually appeared in a result
}

export interface Investigation {
  question: string
  steps: InvestigationStep[]
  finding: Finding | null
  stoppedBecause: 'concluded' | 'step-cap' | 'cancelled' | 'error'
  error?: string
}

type Turn =
  | { action: 'query'; hypothesis: string; cypher: string }
  | { action: 'structure'; hypothesis: string }
  | { action: 'conclude'; finding: string; confidence: Finding['confidence']; evidence_ids: string[] }

const MIN_QUERIES = 2 // a conclusion needs its result checked at least once
const MAX_ROWS_SHOWN = 20 // rows the model sees
const MAX_ROWS_KEPT = 100 // rows kept at all (ids, evidence), whatever the query returned
const MAX_STR = 80
// elementId format on Neo4j 5: "<db>:<uuid>:<n>"
const ELEMENT_ID_RE = /^\d+:[0-9a-f-]{36}:\d+$/i

function systemPrompt(maxSteps: number, hasStructure: boolean): string {
  const structure = hasStructure
    ? `\nor, to see the graph's structure (graph algorithms run in the app — clusters, communities, and which people/companies bridge separate groups; counts as one query):
{"action":"structure","hypothesis":"what you expect the structure to show"}`
    : ''
  return `You are investigating a Neo4j graph to answer a question. Work like an analyst:
form a hypothesis, test it with ONE read-only Cypher query, look at the result, then
refine, test an alternative explanation, or conclude. Don't conclude from a single query
unless its result is decisive; do check the obvious alternative before you do.

${GRAPH_SCHEMA}

Reply with exactly ONE JSON object and nothing else — no prose, no markdown fences:
{"action":"query","hypothesis":"what you expect to see and why","cypher":"MATCH ..."}${structure}
or, when you can answer:
{"action":"conclude","finding":"1-2 sentences stating what is true, with the numbers you saw","confidence":"low|medium|high","evidence_ids":["<id>", ...]}

Rules:
- READ ONLY. Never CREATE/MERGE/SET/DELETE/REMOVE/DETACH/CALL {}/LOAD.
- Always LIMIT to at most 25 rows.
- When a query returns entities, include elementId(n) AS id so they can be cited.
- evidence_ids may only contain ids you saw in a result. Leave it empty if none.
- A query error is information: read it, fix the query, and continue.
- You have at most ${maxSteps} queries. When told you have none left, conclude.
- State only what the results showed. If they were inconclusive, say so and use confidence "low".`
}

function parseTurn(raw: string): Turn {
  const o = parseJsonObject(raw)
  if (o.action === 'query') {
    if (typeof o.cypher !== 'string' || !o.cypher.trim()) throw new Error('query turn without cypher')
    return { action: 'query', hypothesis: String(o.hypothesis ?? '').trim(), cypher: o.cypher.trim() }
  }
  if (o.action === 'structure') return { action: 'structure', hypothesis: String(o.hypothesis ?? '').trim() }
  if (o.action === 'conclude') {
    if (typeof o.finding !== 'string' || !o.finding.trim()) throw new Error('conclude turn without finding')
    const confidence = ['low', 'medium', 'high'].includes(o.confidence) ? o.confidence : 'low'
    const evidence_ids = Array.isArray(o.evidence_ids) ? o.evidence_ids.map(String) : []
    return { action: 'conclude', finding: o.finding.trim(), confidence, evidence_ids }
  }
  throw new Error(`unknown action "${o.action}"`)
}

// Compact, bounded rendering of result rows for the next prompt.
function clip(v: any): any {
  if (typeof v === 'string') return v.length > MAX_STR ? `${v.slice(0, MAX_STR - 1)}…` : v
  if (Array.isArray(v)) return v.slice(0, 10).map(clip)
  if (v && typeof v === 'object') { const o: Record<string, any> = {}; for (const [k, x] of Object.entries(v)) o[k] = clip(x); return o }
  return v
}
function renderRows(rows: Record<string, any>[]): string {
  if (!rows.length) return '0 rows.'
  const shown = rows.slice(0, MAX_ROWS_SHOWN).map(r => JSON.stringify(clip(r)))
  const more = rows.length > MAX_ROWS_SHOWN ? `\n(+${rows.length - MAX_ROWS_SHOWN} more rows not shown)` : ''
  return `${rows.length} row${rows.length === 1 ? '' : 's'}:\n${shown.join('\n')}${more}`
}

// Any elementId-looking string anywhere in the rows counts as seen (MCP
// returns plain JSON, so ids arrive as the `id` columns the prompt asks for).
function collectIds(v: any, into: Set<string>) {
  if (typeof v === 'string' && ELEMENT_ID_RE.test(v)) into.add(v)
  else if (Array.isArray(v)) v.forEach(x => collectIds(x, into))
  else if (v && typeof v === 'object') Object.values(v).forEach(x => collectIds(x, into))
}

// The route is picked before running, so a failed query is still labelled
// with the path it actually took.
async function pickRoute(): Promise<'mcp' | 'driver'> {
  return (await isMcpAvailable()) ? 'mcp' : 'driver'
}

async function runQuery(cypher: string, via: 'mcp' | 'driver'): Promise<Record<string, any>[]> {
  if (via === 'mcp') {
    const out = await callMcpTool('read_neo4j_cypher', { query: cypher })
    if (!Array.isArray(out)) throw new Error(typeof out === 'string' ? out : 'MCP returned no rows')
    return out
  }
  return runProbe(cypher) // Node values arrive with their elementId as `id`
}

export async function investigate(
  question: string,
  opts: {
    apiKey: string
    model?: string
    maxSteps?: number
    onStep?: (step: InvestigationStep) => void
    signal?: AbortSignal
    /** A standing claim to re-check (insight refresh) rather than start from scratch. */
    recheck?: string
    /** In-app structural analysis the model may call as one step (structure.ts). */
    structure?: () => { text: string; nodeIds: string[] }
  },
): Promise<Investigation> {
  const maxSteps = opts.maxSteps ?? 6
  const signal = opts.signal
  const recheck = opts.recheck
    ? `\n\nA standing insight currently says: "${opts.recheck}"\nRe-check that claim against the current data. If its numbers still hold, conclude with the original claim word for word — no commentary about it being unchanged. If anything changed, state the new numbers and say what changed.`
    : ''
  const messages: AIMessage[] = [
    { role: 'system', content: systemPrompt(maxSteps, Boolean(opts.structure)) },
    { role: 'user', content: `Question: ${question}${recheck}` },
  ]
  const steps: InvestigationStep[] = []
  const seen = new Set<string>()
  let model = opts.model
  let pushedBack = false
  const done = (stoppedBecause: Investigation['stoppedBecause'], finding: Finding | null, error?: string): Investigation =>
    ({ question, steps, finding, stoppedBecause, error })

  try {
    // The budget is queries, not model turns: the one-time pushback below
    // costs a turn but no query, and the model is always owed a final
    // conclude turn once its queries run out. maxSteps + 2 turns covers both.
    for (let turn = 0; turn < maxSteps + 2; turn++) {
      if (signal?.aborted) return done('cancelled', null)
      const { value, model: used } = await generateParsed(
        { apiKey: opts.apiKey, model, messages, appTitle: 'Orbit', temperature: 0.2, signal },
        parseTurn,
      )
      if (signal?.aborted) return done('cancelled', null)
      model = used // stick with a model that is answering in-protocol
      messages.push({ role: 'assistant', content: JSON.stringify(value) })

      // One query is an answer, not an investigation. The first time the model
      // tries to conclude off a single result, send it back to check the
      // result another way — a different definition, a sanity count, the
      // alternative explanation. (Only once, and only while queries remain.)
      if (value.action === 'conclude' && steps.length < MIN_QUERIES && !pushedBack && steps.length < maxSteps) {
        pushedBack = true
        messages.push({
          role: 'user',
          content: `Not yet — you've run ${steps.length} quer${steps.length === 1 ? 'y' : 'ies'}. Before concluding, run one query that checks this result a different way (an independent count, a different definition of the key term, or the most likely alternative explanation). Reply with a query object.`,
        })
        continue
      }

      if (value.action === 'conclude') {
        return done('concluded', {
          claim: value.finding,
          confidence: value.confidence,
          nodeIds: value.evidence_ids.filter(id => seen.has(id)), // never cite what wasn't observed
        })
      }
      if (steps.length >= maxSteps) break // told it had no queries left, and it still didn't conclude

      const step: InvestigationStep = {
        n: steps.length + 1, hypothesis: value.hypothesis,
        cypher: value.action === 'query' ? value.cypher : '(graph algorithms in the app: connected clusters, Louvain communities, betweenness centrality)',
        via: 'driver', rows: 0, preview: '', nodeIds: [], model: used,
      }
      if (value.action === 'structure') {
        step.via = 'in-app'
        if (!opts.structure) {
          step.error = 'Structure analysis is not available here.'
          step.preview = step.error
        } else {
          const r = opts.structure()
          step.preview = r.text
          step.nodeIds = r.nodeIds.slice(0, MAX_ROWS_KEPT)
          step.nodeIds.forEach(id => seen.add(id))
        }
      } else if (WRITE_RE.test(value.cypher)) {
        step.via = 'refused'
        step.error = 'Refused: not a read-only query.'
        step.preview = step.error
      } else {
        try {
          step.via = await pickRoute()
          const all = await runQuery(value.cypher, step.via)
          if (signal?.aborted) return done('cancelled', null)
          // The prompt asks for LIMIT 25; this enforces a ceiling regardless,
          // so an unbounded query can't flood the canvas or the citable ids.
          const rows = all.slice(0, MAX_ROWS_KEPT)
          const ids = new Set<string>()
          collectIds(rows, ids)
          step.rows = all.length
          step.nodeIds = [...ids]
          step.preview = renderRows(rows) + (all.length > MAX_ROWS_KEPT ? `\n(query returned ${all.length} rows; only the first ${MAX_ROWS_KEPT} were kept — add a LIMIT)` : '')
          ids.forEach(id => seen.add(id))
        } catch (e: any) {
          if (signal?.aborted) return done('cancelled', null)
          step.error = String(e?.message ?? e).split('\n')[0].slice(0, 300)
          step.preview = `Query failed: ${step.error}`
        }
      }
      steps.push(step)
      opts.onStep?.(step)

      const left = maxSteps - steps.length
      messages.push({
        role: 'user',
        content: `Result of ${step.via === 'in-app' ? 'structure analysis' : 'query'} ${step.n}${step.via === 'mcp' ? ' (via MCP read_neo4j_cypher)' : ''}:\n${step.preview}\n\n` +
          (left > 0 ? `${left} quer${left === 1 ? 'y' : 'ies'} left.` : 'No queries left — reply with a conclude object now.'),
      })
    }
    return done('step-cap', null)
  } catch (e: any) {
    if (signal?.aborted) return done('cancelled', null)
    return done('error', null, String(e?.message ?? e))
  }
}
