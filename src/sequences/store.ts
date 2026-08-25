import type { Sequence, Enrollment, EnrollmentState, SequenceStep } from './types'
import { SEQUENCE_TEMPLATES } from './templates'

// Local-first sequence store. Mirrors the leads storage pattern: localStorage is
// the source of truth in the browser. Kept separate from leads so the execution
// engine (manual now, Cloudflare-cron later) can read/write it independently.

const LS_KEY = 'orbit:sequences:v1'

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

// subject → default body, pooled from every template so steps created before
// default bodies existed (or renamed to match a template's wording) pick one up.
const DEFAULT_BODY_BY_SUBJECT = new Map<string, string>()
for (const tpl of SEQUENCE_TEMPLATES) {
  for (const st of tpl.steps) {
    if (st.body && !DEFAULT_BODY_BY_SUBJECT.has(st.subject.toLowerCase())) {
      DEFAULT_BODY_BY_SUBJECT.set(st.subject.toLowerCase(), st.body)
    }
  }
}

// One-time backfill: steps saved before default bodies existed have subject
// text but an empty body. Fill in the matching template's default so existing
// sequences (and their live enrollments) gain copy without losing progress.
function backfillDefaultBodies(seqs: Sequence[]): { seqs: Sequence[]; changed: boolean } {
  let changed = false
  const next = seqs.map(seq => {
    let seqChanged = false
    const steps = seq.steps.map(step => {
      if (step.body) return step
      const fallback = step.subject && DEFAULT_BODY_BY_SUBJECT.get(step.subject.toLowerCase())
      if (!fallback) return step
      seqChanged = true
      return { ...step, body: fallback }
    })
    if (!seqChanged) return seq
    changed = true
    return { ...seq, steps }
  })
  return { seqs: changed ? next : seqs, changed }
}

export function loadSequences(): Sequence[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Sequence[]
    const { seqs, changed } = backfillDefaultBodies(parsed)
    if (changed) saveSequences(seqs)
    return seqs
  } catch {
    return []
  }
}

export function saveSequences(seqs: Sequence[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(seqs))
  } catch (err) {
    console.warn('sequences: localStorage write failed', err)
  }
}

export function newSequence(name: string): Sequence {
  const now = new Date().toISOString()
  return { id: uid('seq'), name: name.trim() || 'Untitled sequence', steps: [], enrollments: [], created_at: now, updated_at: now }
}

export function newStep(dayOffset = 0): SequenceStep {
  return { id: uid('step'), day_offset: dayOffset, channel: 'email', subject: '', body: '' }
}

export function newEnrollment(leadId: string): Enrollment {
  return { lead_id: leadId, enrolled_at: new Date().toISOString(), current_step: 0, state: 'active' }
}

// Immutable helpers — return a new sequence with updated_at bumped.
function touch(seq: Sequence, patch: Partial<Sequence>): Sequence {
  return { ...seq, ...patch, updated_at: new Date().toISOString() }
}

export function enrollLeads(seq: Sequence, leadIds: string[]): Sequence {
  const existing = new Set(seq.enrollments.map(e => e.lead_id))
  const added = leadIds.filter(id => !existing.has(id)).map(newEnrollment)
  return added.length ? touch(seq, { enrollments: [...seq.enrollments, ...added] }) : seq
}

export function unenrollLead(seq: Sequence, leadId: string): Sequence {
  return touch(seq, { enrollments: seq.enrollments.filter(e => e.lead_id !== leadId) })
}

export function setEnrollmentState(seq: Sequence, leadId: string, state: EnrollmentState): Sequence {
  return touch(seq, {
    enrollments: seq.enrollments.map(e => (e.lead_id === leadId ? { ...e, state } : e)),
  })
}
