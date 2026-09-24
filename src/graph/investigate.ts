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
  via: 'mcp' | 'driver' | 'refused'
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
  | { action: 'conclude'; finding: string; confidence: Finding['confidence']; evidence_ids: string[] }

const MIN_QUERIES = 2 // a conclusion needs its result checked at least once
const MAX_ROWS_SHOWN = 20
const MAX_STR = 80
// elementId format on Neo4j 5: "<db>:<uuid>:<n>"
const ELEMENT_ID_RE = /^\d+:[0-9a-f-]{36}:\d+$/i

function systemPrompt(maxSteps: number): string {
  return `You are investigating a Neo4j graph to answer a question. Work like an analyst:
form a hypothesis, test it with ONE read-only Cypher query, look at the result, then
refine, test an alternative explanation, or conclude. Don't conclude from a single query
unless its result is decisive; do check the obvious alternative before you do.

${GRAPH_SCHEMA}

Reply with exactly ONE JSON object and nothing else — no prose, no markdown fences:
{"action":"query","hypothesis":"what you expect to see and why","cypher":"MATCH ..."}
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

async function runQuery(cypher: string, via: 'mcp' | 'driver'): Promise<{ rows: Record<string, any>[]; nodeIds: string[] }> {
  if (via === 'mcp') {
    const out = await callMcpTool('read_neo4j_cypher', { query: cypher })
    if (!Array.isArray(out)) throw new Error(typeof out === 'string' ? out : 'MCP returned no rows')
    const ids = new Set<string>()
    collectIds(out, ids)
    return { rows: out, nodeIds: [...ids] }
  }
  const { rows, nodeIds } = await runProbe(cypher)
  const ids = new Set(nodeIds) // returned Node values…
  collectIds(rows, ids) // …plus explicit elementId(n) AS id columns
  return { rows, nodeIds: [...ids] }
}

export async function investigate(
  question: string,
  opts: {
    apiKey: string
    model?: string
    maxSteps?: number
    onStep?: (step: InvestigationStep) => void
    signal?: AbortSignal
  },
): Promise<Investigation> {
  const maxSteps = opts.maxSteps ?? 6
  const messages: AIMessage[] = [
    { role: 'system', content: systemPrompt(maxSteps) },
    { role: 'user', content: `Question: ${question}` },
  ]
  const steps: InvestigationStep[] = []
  const seen = new Set<string>()
  let model = opts.model
  let pushedBack = false
  const done = (stoppedBecause: Investigation['stoppedBecause'], finding: Finding | null, error?: string): Investigation =>
    ({ question, steps, finding, stoppedBecause, error })

  try {
    for (let turn = 0; turn <= maxSteps; turn++) {
      if (opts.signal?.aborted) return done('cancelled', null)
      const { value, model: used } = await generateParsed(
        { apiKey: opts.apiKey, model, messages, appTitle: 'Orbit', temperature: 0.2 },
        parseTurn,
      )
      model = used // stick with a model that is answering in-protocol
      messages.push({ role: 'assistant', content: JSON.stringify(value) })

      // One query is an answer, not an investigation. The first time the model
      // tries to conclude off a single result, send it back to check the
      // result another way — a different definition, a sanity count, the
      // alternative explanation. (Only once, and only while queries remain.)
      if (value.action === 'conclude' && steps.length < MIN_QUERIES && !pushedBack && turn < maxSteps) {
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
      if (turn === maxSteps) break // out of queries and still not concluding

      const step: InvestigationStep = {
        n: steps.length + 1, hypothesis: value.hypothesis, cypher: value.cypher,
        via: 'driver', rows: 0, preview: '', nodeIds: [], model: used,
      }
      if (WRITE_RE.test(value.cypher)) {
        step.via = 'refused'
        step.error = 'Refused: not a read-only query.'
        step.preview = step.error
      } else {
        try {
          step.via = await pickRoute()
          const r = await runQuery(value.cypher, step.via)
          step.rows = r.rows.length
          step.nodeIds = r.nodeIds
          step.preview = renderRows(r.rows)
          r.nodeIds.forEach(id => seen.add(id))
        } catch (e: any) {
          step.error = String(e?.message ?? e).split('\n')[0].slice(0, 300)
          step.preview = `Query failed: ${step.error}`
        }
      }
      steps.push(step)
      opts.onStep?.(step)

      const left = maxSteps - steps.length
      messages.push({
        role: 'user',
        content: `Result of query ${step.n}${step.via === 'mcp' ? ' (via MCP read_neo4j_cypher)' : ''}:\n${step.preview}\n\n` +
          (left > 0 ? `${left} quer${left === 1 ? 'y' : 'ies'} left.` : 'No queries left — reply with a conclude object now.'),
      })
    }
    return done('step-cap', null)
  } catch (e: any) {
    return done('error', null, String(e?.message ?? e))
  }
}
