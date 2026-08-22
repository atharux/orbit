// Stage 1 instrumentation (orbit-self-improvement-spec.md) — records what each
// ask engine returned, nothing more. No scoring, no aggregation, no outcome
// signal: none of that exists yet, so this stays pure logging.
//
// Key deliberately does NOT start with 'orbit:' or 'pocket-leads' — those
// prefixes are swept into the whole-database backup/restore system
// (see DB_PREFIXES in ../backup/fileBackup.ts) and this is ephemeral
// instrumentation, not domain data that belongs in a backup file.

const LS_KEY = 'orbit-log:ask-history'
const MAX_ENTRIES = 500

export type AskEngine = 'preset' | 'live' | 'local' | 'path' | 'cypher'

export type AskOutcome = 'positive' | 'negative'

export interface AskLogEntry {
  query_id: string
  timestamp: string
  engine: AskEngine
  question: string
  node_ids: string[]
  cypher?: string
  outcome?: AskOutcome
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function readLog(): AskLogEntry[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]')
  } catch {
    return []
  }
}

// Best-effort: a full/unavailable localStorage must never break the ask flow.
// Returns the generated query_id so a caller can attach an outcome later via logOutcome.
export function logAsk(entry: { engine: AskEngine; question: string; nodeIds: string[]; cypher?: string }): string {
  const record: AskLogEntry = {
    query_id: newId(),
    timestamp: new Date().toISOString(),
    engine: entry.engine,
    question: entry.question,
    node_ids: entry.nodeIds,
    ...(entry.cypher ? { cypher: entry.cypher } : {}),
  }
  try {
    let log = readLog()
    log.push(record)
    if (log.length > MAX_ENTRIES) log = log.slice(log.length - MAX_ENTRIES)
    localStorage.setItem(LS_KEY, JSON.stringify(log))
  } catch {
    // storage full, disabled, or corrupt — logging is best-effort only
  }
  return record.query_id
}

// Attaches a thumbs up/down to a previously logged entry. No-op if the entry
// was already evicted by the 500-entry cap — outcome logging is best-effort,
// same as logAsk.
export function logOutcome(queryId: string, outcome: AskOutcome): void {
  try {
    const log = readLog()
    const entry = log.find(e => e.query_id === queryId)
    if (!entry) return
    entry.outcome = outcome
    localStorage.setItem(LS_KEY, JSON.stringify(log))
  } catch {
    // best-effort only
  }
}
