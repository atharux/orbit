import type { StepChannel } from './types'

// Ready-made cadences so a newcomer never faces a blank canvas. Each is a proven
// outreach shape; "Draft with AI" remains for bespoke ones. Steps carry no ids —
// the panel assigns them when instantiating.

export interface TemplateStep {
  day_offset: number
  channel: StepChannel
  subject: string
}

export interface SequenceTemplate {
  id: string
  name: string
  tagline: string // one-line "what it's for"
  steps: TemplateStep[]
}

export const SEQUENCE_TEMPLATES: SequenceTemplate[] = [
  {
    id: 'classic-5',
    name: 'Classic 5-touch email',
    tagline: 'The dependable email-only cadence. Great default.',
    steps: [
      { day_offset: 0, channel: 'email', subject: 'Quick question' },
      { day_offset: 3, channel: 'email', subject: 'Following up — one idea' },
      { day_offset: 7, channel: 'email', subject: 'Case study: a similar company' },
      { day_offset: 12, channel: 'email', subject: 'Should I close your file?' },
      { day_offset: 20, channel: 'email', subject: 'Last note' },
    ],
  },
  {
    id: 'multichannel',
    name: 'Multi-channel',
    tagline: 'Email + LinkedIn + a call. Higher touch, higher reply.',
    steps: [
      { day_offset: 0, channel: 'email', subject: 'Intro' },
      { day_offset: 2, channel: 'linkedin', subject: 'Connect + short note' },
      { day_offset: 5, channel: 'email', subject: 'Follow-up + a resource' },
      { day_offset: 9, channel: 'call', subject: 'Call: book a slot' },
      { day_offset: 14, channel: 'email', subject: 'Last touch' },
    ],
  },
  {
    id: 'founder-3',
    name: 'Founder-led 3-touch',
    tagline: 'Short, personal, from you. Best for warm-ish lists.',
    steps: [
      { day_offset: 0, channel: 'email', subject: 'Personal note from the founder' },
      { day_offset: 4, channel: 'email', subject: 'Quick nudge' },
      { day_offset: 9, channel: 'call', subject: 'Founder call' },
    ],
  },
  {
    id: 'trades-local',
    name: 'Local trades outreach',
    tagline: 'Call-first, for local businesses (electricians, plumbers…).',
    steps: [
      { day_offset: 0, channel: 'call', subject: 'Cold call: introduce the service' },
      { day_offset: 1, channel: 'email', subject: 'Recap + pricing' },
      { day_offset: 5, channel: 'email', subject: 'Follow-up' },
      { day_offset: 10, channel: 'task', subject: 'Drop by / postcard' },
    ],
  },
]
