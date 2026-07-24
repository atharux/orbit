import type { Sequence, Enrollment, EnrollmentState, SequenceStep } from './types'

// Local-first sequence store. Mirrors the leads storage pattern: localStorage is
// the source of truth in the browser. Kept separate from leads so the execution
// engine (manual now, Cloudflare-cron later) can read/write it independently.

const LS_KEY = 'orbit:sequences:v1'

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function loadSequences(): Sequence[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as Sequence[]) : []
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
