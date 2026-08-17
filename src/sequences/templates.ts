import type { StepChannel } from './types'

// Ready-made cadences so a newcomer never faces a blank canvas. Each is a proven
// outreach shape; "Draft with AI" remains for bespoke ones. Steps carry no ids —
// the panel assigns them when instantiating.

export interface TemplateStep {
  day_offset: number
  channel: StepChannel
  subject: string
  body?: string // default draft/notes — editable per step, so you know what you're actually sending before you send it
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
      {
        day_offset: 0, channel: 'email', subject: 'Quick question',
        body: `Hi [Name],

Quick one — is [Company] still looking for [what you help with]? I work with a few businesses like yours on this and thought I'd check before reaching out further.

If it's not a priority right now, no worries — just let me know and I'll leave it there.

[Your name]`,
      },
      {
        day_offset: 3, channel: 'email', subject: 'Following up — one idea',
        body: `Hi [Name],

Following up on my note from a few days ago. One idea that's worked well for businesses like [Company]: [one specific idea or result].

Worth a quick look? Happy to send more detail either way.

[Your name]`,
      },
      {
        day_offset: 7, channel: 'email', subject: 'Case study: a similar company',
        body: `Hi [Name],

Thought this might be useful — [similar company] was in a similar spot and [one-sentence outcome]. Happy to walk you through what we did if it's relevant to [Company].

[Your name]`,
      },
      {
        day_offset: 12, channel: 'email', subject: 'Should I close your file?',
        body: `Hi [Name],

I don't want to keep filling your inbox if the timing's off. Should I close this out, or is it worth one more conversation?

Either answer's fine — just let me know.

[Your name]`,
      },
      {
        day_offset: 20, channel: 'email', subject: 'Last note',
        body: `Hi [Name],

Last note from me — I'll stop here unless I hear back. If anything changes on your end, my door's open.

Good luck with [Company].

[Your name]`,
      },
    ],
  },
  {
    id: 'multichannel',
    name: 'Multi-channel',
    tagline: 'Email + LinkedIn + a call. Higher touch, higher reply.',
    steps: [
      {
        day_offset: 0, channel: 'email', subject: 'Intro',
        body: `Hi [Name],

I help businesses like [Company] with [what you do] — reaching out because [reason / trigger]. Worth a quick chat?

[Your name]`,
      },
      {
        day_offset: 2, channel: 'linkedin', subject: 'Connect + short note',
        body: `Hi [Name] — following up on an email I sent about [what you do]. Thought I'd connect here too in case it's easier to reach you this way.`,
      },
      {
        day_offset: 5, channel: 'email', subject: 'Follow-up + a resource',
        body: `Hi [Name],

Sharing something that might help either way: [resource / link]. If [Company] is exploring [problem area], happy to talk through it.

[Your name]`,
      },
      {
        day_offset: 9, channel: 'call', subject: 'Call: book a slot',
        body: `Goal: get 15 minutes on the calendar. Reference the email/LinkedIn note already sent. If no answer, leave a short voicemail and follow up by email the same day.`,
      },
      {
        day_offset: 14, channel: 'email', subject: 'Last touch',
        body: `Hi [Name],

Last note from me on this — if the timing's better later on, just say the word and I'll check back then.

[Your name]`,
      },
    ],
  },
  {
    id: 'founder-3',
    name: 'Founder-led 3-touch',
    tagline: 'Short, personal, from you. Best for warm-ish lists.',
    steps: [
      {
        day_offset: 0, channel: 'email', subject: 'Personal note from the founder',
        body: `Hi [Name],

I'm [Your name], founder of [Your company]. Reaching out personally because [reason — something specific about Company]. No pitch here, just wanted to say hello and see if it's worth a conversation.

[Your name]`,
      },
      {
        day_offset: 4, channel: 'email', subject: 'Quick nudge',
        body: `Hi [Name],

Just floating back to the top of your inbox — still keen to connect if the timing works. No pressure either way.

[Your name]`,
      },
      {
        day_offset: 9, channel: 'call', subject: 'Founder call',
        body: `Goal: a short, informal call — no deck, no pitch. Ask about [Company]'s current priorities and see if there's a real fit before proposing anything.`,
      },
    ],
  },
  {
    id: 'trades-local',
    name: 'Local trades outreach',
    tagline: 'Call-first, for local businesses (electricians, plumbers…).',
    steps: [
      {
        day_offset: 0, channel: 'call', subject: 'Cold call: introduce the service',
        body: `Goal: introduce [Your company] and what you do in one sentence. Ask if they're currently looking for [service]. If yes, confirm the best email for a recap. Keep it under 2 minutes.`,
      },
      {
        day_offset: 1, channel: 'email', subject: 'Recap + pricing',
        body: `Hi [Name],

Good speaking just now. As promised — here's a quick recap of what we discussed, plus pricing: [pricing / details].

Let me know if you have questions.

[Your name]`,
      },
      {
        day_offset: 5, channel: 'email', subject: 'Follow-up',
        body: `Hi [Name],

Checking in on the recap I sent — any questions before you decide? Happy to jump on a quick call if that's easier.

[Your name]`,
      },
      {
        day_offset: 10, channel: 'task', subject: 'Drop by / postcard',
        body: `If no reply by day 10: drop a printed postcard or flyer at [Company]'s address, or stop by in person if it's on your route. Reference the earlier call/email.`,
      },
    ],
  },
]
