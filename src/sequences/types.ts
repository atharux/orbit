// Outreach sequences — the campaign layer on top of leads/companies.
// A Sequence is a named, ordered set of steps (cadence). Companies (leads) are
// enrolled into it and move through the steps; each enrollment carries a state.
// Local-first: persisted to localStorage (see store.ts), independent of the
// leads store so it can be wired to the graph's ENROLLED_IN / TARGETS edges.

export type StepChannel = 'email' | 'call' | 'linkedin' | 'task'

export const STEP_CHANNELS: StepChannel[] = ['email', 'call', 'linkedin', 'task']

export const CHANNEL_LABEL: Record<StepChannel, string> = {
  email: 'Email',
  call: 'Call',
  linkedin: 'LinkedIn',
  task: 'Task',
}

export interface SequenceStep {
  id: string
  day_offset: number // days after enrollment this step fires
  channel: StepChannel
  subject?: string // email subject / call goal / task title
  body?: string // optional notes or draft
}

export type EnrollmentState = 'active' | 'replied' | 'bounced' | 'done' | 'paused'

export const ENROLLMENT_STATES: EnrollmentState[] = ['active', 'replied', 'bounced', 'done', 'paused']

export const ENROLLMENT_STATE_LABEL: Record<EnrollmentState, string> = {
  active: 'Active',
  replied: 'Replied',
  bounced: 'Bounced',
  done: 'Done',
  paused: 'Paused',
}

export const ENROLLMENT_STATE_COLOR: Record<EnrollmentState, string> = {
  active: '#22d3ee',
  replied: '#34d399',
  bounced: '#EF4444',
  done: '#8b5cf6',
  paused: '#9CA3AF',
}

export interface Enrollment {
  lead_id: string
  enrolled_at: string
  current_step: number // index into the sequence's steps
  state: EnrollmentState
}

export interface Sequence {
  id: string
  name: string
  steps: SequenceStep[]
  enrollments: Enrollment[]
  created_at: string
  updated_at: string
}
