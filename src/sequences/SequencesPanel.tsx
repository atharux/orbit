import { useMemo, useState } from 'react'
import type { Lead } from '../types'
import type { Sequence, SequenceStep, EnrollmentState, StepChannel } from './types'
import {
  STEP_CHANNELS, CHANNEL_LABEL, ENROLLMENT_STATES, ENROLLMENT_STATE_LABEL, ENROLLMENT_STATE_COLOR,
} from './types'
import {
  loadSequences, saveSequences, newSequence, newStep,
  enrollLeads, unenrollLead, setEnrollmentState,
} from './store'
import { generateJSON } from '../services/orClient'
import { SEQUENCE_TEMPLATES, type SequenceTemplate } from './templates'

// ── The Cadence Spine ───────────────────────────────────────────────────────
// A horizontal day-timeline: steps are stations, enrolled companies are tokens
// that slide along the spine as they advance (CSS transition on `left`). Click a
// station to edit it; run a company from the state board and watch its token
// travel. Manual execution now; the same model feeds a Cloudflare cron later.

const CHANNEL_ICON: Record<StepChannel, string> = { email: '✉', call: '☎', linkedin: 'in', task: '✓' }
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`

export function SequencesPanel({ leads, onClose, openRouterApiKey, openRouterModel }: {
  leads: Lead[]
  onClose: () => void
  openRouterApiKey?: string
  openRouterModel?: string
}) {
  const [sequences, setSequences] = useState<Sequence[]>(loadSequences)
  const [selectedId, setSelectedId] = useState<string | null>(() => loadSequences()[0]?.id ?? null)
  const [editingStepId, setEditingStepId] = useState<string | null>(null)
  const [enrollOpen, setEnrollOpen] = useState(false)
  const [enrollSearch, setEnrollSearch] = useState('')
  const [nlPrompt, setNlPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState('')
  const [picker, setPicker] = useState(false)
  const [coached, setCoached] = useState(() => localStorage.getItem('orbit:seq:coached') === '1')

  const leadById = useMemo(() => new Map(leads.map(l => [l.id, l])), [leads])
  const selected = sequences.find(s => s.id === selectedId) ?? null
  const editingStep = selected?.steps.find(s => s.id === editingStepId) ?? null

  function commit(next: Sequence[]) { setSequences(next); saveSequences(next) }
  function touch(seq: Sequence, patch: Partial<Sequence>): Sequence { return { ...seq, ...patch, updated_at: new Date().toISOString() } }
  function updateSeq(u: Sequence) { commit(sequences.map(s => (s.id === u.id ? u : s))) }

  function createSeq() {
    const s = newSequence(`Sequence ${sequences.length + 1}`)
    commit([...sequences, s]); setSelectedId(s.id); setEditingStepId(null)
  }
  function deleteSeq(id: string) {
    const next = sequences.filter(s => s.id !== id)
    commit(next); if (selectedId === id) setSelectedId(next[0]?.id ?? null)
  }

  // steps
  function addStep() {
    if (!selected) return
    const lastDay = selected.steps.length ? selected.steps[selected.steps.length - 1].day_offset : -3
    const step = newStep(lastDay + 3)
    updateSeq(touch(selected, { steps: [...selected.steps, step] }))
    setEditingStepId(step.id)
  }
  function updateStep(id: string, patch: Partial<SequenceStep>) {
    if (!selected) return
    updateSeq(touch(selected, { steps: selected.steps.map(s => (s.id === id ? { ...s, ...patch } : s)) }))
  }
  function removeStep(id: string) {
    if (!selected) return
    updateSeq(touch(selected, { steps: selected.steps.filter(s => s.id !== id) }))
    if (editingStepId === id) setEditingStepId(null)
  }
  function moveStep(i: number, dir: -1 | 1) {
    if (!selected) return
    const steps = [...selected.steps]; const j = i + dir
    if (j < 0 || j >= steps.length) return
    ;[steps[i], steps[j]] = [steps[j], steps[i]]
    updateSeq(touch(selected, { steps }))
  }

  // AI: draft a whole cadence from a sentence
  async function generateSteps() {
    if (!selected || !nlPrompt.trim() || !openRouterApiKey) return
    setGenerating(true); setGenError('')
    try {
      const prompt = `Design a B2B cold-outreach sequence as a JSON array of steps.
Intent: "${nlPrompt.trim()}"
Each element: {"day_offset": <integer days after enrollment, first is 0>, "channel": "email"|"call"|"linkedin"|"task", "subject": "<short subject line or call/task goal>"}
Rules: 3-6 steps, strictly increasing day_offset starting at 0, realistic cadence. Return ONLY the JSON array.`
      const arr = await generateJSON({ prompt, apiKey: openRouterApiKey, model: openRouterModel, appTitle: 'Orbit' })
      const steps: SequenceStep[] = arr.slice(0, 8).map((x: any) => ({
        id: uid('step'),
        day_offset: Number.isFinite(Number(x?.day_offset)) ? Number(x.day_offset) : 0,
        channel: (STEP_CHANNELS as string[]).includes(x?.channel) ? x.channel : 'email',
        subject: String(x?.subject ?? '').slice(0, 140),
        body: '',
      }))
      if (!steps.length) throw new Error('No steps returned')
      updateSeq(touch(selected, { steps })); setNlPrompt(''); setEditingStepId(null)
    } catch (e: any) {
      setGenError(String(e?.message ?? e))
    } finally { setGenerating(false) }
  }

  // enrollment + manual execution
  function doEnroll(id: string) { if (selected) updateSeq(enrollLeads(selected, [id])) }
  function runNextStep(leadId: string) {
    if (!selected) return
    const enr = selected.enrollments.find(e => e.lead_id === leadId)
    if (!enr) return
    const step = selected.steps[enr.current_step]
    const lead = leadById.get(leadId)
    if (step?.channel === 'email' && lead?.email) {
      const p = new URLSearchParams()
      if (step.subject) p.set('subject', step.subject)
      if (step.body) p.set('body', step.body)
      window.open(`mailto:${lead.email}?${p.toString()}`)
    }
    const nextStep = enr.current_step + 1
    const finished = nextStep >= selected.steps.length
    updateSeq(touch(selected, {
      enrollments: selected.enrollments.map(e => e.lead_id === leadId
        ? { ...e, current_step: finished ? e.current_step : nextStep, state: finished ? 'done' : e.state }
        : e),
    }))
  }

  const s = styles

  function createFromTemplate(tpl: SequenceTemplate) {
    const seq = newSequence(tpl.name)
    const withSteps = { ...seq, steps: tpl.steps.map(st => ({ id: uid('step'), day_offset: st.day_offset, channel: st.channel, subject: st.subject, body: '' })) }
    commit([...sequences, withSteps])
    setSelectedId(withSteps.id); setEditingStepId(null); setPicker(false)
  }
  function createBlank() { createSeq(); setPicker(false) }
  function dismissCoach() { localStorage.setItem('orbit:seq:coached', '1'); setCoached(true) }

  const renderGallery = (onClose?: () => void) => (
    <div style={s.gallery}>
      <div style={s.galleryHead}>
        <div>
          <div style={s.galleryTitle}>Start a sequence</div>
          <div style={s.gallerySub}>Pick a ready-made cadence, or start blank — you can edit every step after.</div>
        </div>
        {onClose && <button style={s.closeBtn} onClick={onClose}>✕</button>}
      </div>
      <div style={s.galleryGrid}>
        <button style={s.tplBlank} onClick={createBlank}>
          <div style={s.tplName}>+ Blank sequence</div>
          <div style={s.tplTag}>Build your own from scratch, or draft it with AI.</div>
        </button>
        {SEQUENCE_TEMPLATES.map(t => (
          <button key={t.id} style={s.tplCard} onClick={() => createFromTemplate(t)}>
            <div style={s.tplName}>{t.name}</div>
            <div style={s.tplTag}>{t.tagline}</div>
            <div style={s.tplSteps}>
              {t.steps.map((st, i) => <span key={i} style={s.tplChip}>{CHANNEL_ICON[st.channel]} d{st.day_offset}</span>)}
            </div>
          </button>
        ))}
      </div>
    </div>
  )

  const N = selected?.steps.length ?? 0
  const stationX = (i: number) => (N <= 1 ? 50 : 8 + (i / (N - 1)) * 84)

  // active tokens grouped by their current step (for vertical stacking)
  const activeEnr = selected?.enrollments.filter(e => e.state === 'active') ?? []
  const groupIndex = new Map<string, number>() // lead_id -> index within its station group
  {
    const perStep = new Map<number, number>()
    for (const e of activeEnr) {
      const k = Math.min(e.current_step, Math.max(N - 1, 0))
      const idx = perStep.get(k) ?? 0
      groupIndex.set(e.lead_id, idx)
      perStep.set(k, idx + 1)
    }
  }

  const enrolledIds = new Set(selected?.enrollments.map(e => e.lead_id) ?? [])
  const enrollCandidates = leads
    .filter(l => !enrolledIds.has(l.id))
    .filter(l => !enrollSearch || `${l.name} ${l.city} ${l.category}`.toLowerCase().includes(enrollSearch.toLowerCase()))
    .slice(0, 200)

  const canGenerate = Boolean(openRouterApiKey)

  return (
    <div style={s.overlay}>
      <div style={s.header}>
        <div style={s.title}><span style={s.dot} /> SEQUENCES <span style={s.subtitle}>cadence spine · outreach automator</span></div>
        <div style={{ flex: 1 }} />
        <span style={s.infraNote}>manual run — autonomous mode next (Cloudflare cron)</span>
        <button style={s.closeBtn} onClick={onClose}>Close ✕</button>
      </div>

      {/* Sequence tabs */}
      <div style={s.tabs}>
        {sequences.map(seq => (
          <button key={seq.id} style={{ ...s.tab, ...(seq.id === selectedId ? s.tabActive : null) }} onClick={() => { setSelectedId(seq.id); setEditingStepId(null) }}>
            {seq.name}
            <span style={s.tabCount}>{seq.enrollments.length}</span>
          </button>
        ))}
        <button style={s.newTab} onClick={() => setPicker(true)}>+ New</button>
      </div>

      {!selected && <div style={s.canvas}>{renderGallery()}</div>}

      {selected && (
        <div style={s.canvas}>
          {/* First-run coaching — dismissible, learn while doing */}
          {!coached && (
            <div style={s.coach}>
              <span style={s.coachStep}><b style={s.coachNum}>①</b> Steps are your cadence — the spine below</span>
              <span style={s.coachStep}><b style={s.coachNum}>②</b> Enroll companies → they appear as tokens</span>
              <span style={s.coachStep}><b style={s.coachNum}>③</b> Hit Run to send a step & advance its token</span>
              <button style={s.coachX} onClick={dismissCoach}>Got it ✕</button>
            </div>
          )}
          {/* Sequence toolbar: name + AI generate */}
          <div style={s.seqBar}>
            <input style={s.nameInput} value={selected.name} onChange={e => updateSeq(touch(selected, { name: e.target.value }))} />
            <div style={s.nlWrap}>
              <input
                style={s.nlInput}
                placeholder={canGenerate ? 'Describe a cadence — e.g. "5-touch email + call for electricians"' : 'Add an OpenRouter key in Settings to draft with AI'}
                value={nlPrompt}
                disabled={!canGenerate || generating}
                onChange={e => setNlPrompt(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') generateSteps() }}
              />
              <button style={s.nlBtn} onClick={generateSteps} disabled={!canGenerate || generating || !nlPrompt.trim()}>
                {generating ? 'drafting…' : '✦ Draft'}
              </button>
            </div>
            <button style={s.deleteBtn} onClick={() => deleteSeq(selected.id)}>Delete</button>
          </div>
          {genError && <div style={s.err}>{genError}</div>}

          {/* THE SPINE */}
          <div style={s.spineWrap}>
            {N === 0 && <div style={s.spineEmpty}>No steps yet — add the first touch, or draft a cadence with AI.</div>}
            {N > 0 && (
              <div style={s.spine}>
                {/* connecting rail */}
                <div style={{ ...s.rail, left: `${stationX(0)}%`, right: `${100 - stationX(N - 1)}%` }} />
                {/* stations */}
                {selected.steps.map((step, i) => {
                  const active = editingStepId === step.id
                  return (
                    <button
                      key={step.id}
                      style={{ ...s.station, left: `${stationX(i)}%`, ...(active ? s.stationActive : null) }}
                      onClick={() => setEditingStepId(active ? null : step.id)}
                    >
                      <div style={s.stationDay}>Day {step.day_offset}</div>
                      <div style={{ ...s.stationNode, ...(active ? s.stationNodeActive : null) }}>{CHANNEL_ICON[step.channel]}</div>
                      <div style={s.stationSubject}>{step.subject || CHANNEL_LABEL[step.channel]}</div>
                    </button>
                  )
                })}
                {/* traveling tokens (active enrollments) */}
                {activeEnr.map(e => {
                  const stepIdx = Math.min(e.current_step, N - 1)
                  const stack = groupIndex.get(e.lead_id) ?? 0
                  const lead = leadById.get(e.lead_id)
                  return (
                    <div
                      key={e.lead_id}
                      style={{ ...s.token, left: `${stationX(stepIdx)}%`, bottom: 10 + stack * 15 }}
                      title={`${lead?.name ?? e.lead_id} — step ${stepIdx + 1}/${N}`}
                    />
                  )
                })}
              </div>
            )}
            <button style={s.addStation} onClick={addStep}>+ step</button>
          </div>

          {/* Step editor (on station click) */}
          {editingStep && (
            <div style={s.editor}>
              <div style={s.editorHead}>
                EDIT STEP
                <div style={{ flex: 1 }} />
                {(() => { const i = selected.steps.findIndex(x => x.id === editingStep.id); return (
                  <>
                    <button style={s.miniBtn} onClick={() => moveStep(i, -1)} disabled={i === 0}>◀ earlier</button>
                    <button style={s.miniBtn} onClick={() => moveStep(i, 1)} disabled={i === N - 1}>later ▶</button>
                    <button style={s.removeBtn} onClick={() => removeStep(editingStep.id)}>Remove step</button>
                  </>
                ) })()}
              </div>
              <div style={s.editorRow}>
                <label style={s.field}><span style={s.fieldLbl}>Day offset</span>
                  <input style={s.fieldInput} type="number" value={editingStep.day_offset} onChange={e => updateStep(editingStep.id, { day_offset: Number(e.target.value) })} />
                </label>
                <label style={s.field}><span style={s.fieldLbl}>Channel</span>
                  <select style={s.fieldInput} value={editingStep.channel} onChange={e => updateStep(editingStep.id, { channel: e.target.value as StepChannel })}>
                    {STEP_CHANNELS.map(c => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
                  </select>
                </label>
                <label style={{ ...s.field, flex: 1 }}><span style={s.fieldLbl}>Subject / goal</span>
                  <input style={s.fieldInput} value={editingStep.subject ?? ''} onChange={e => updateStep(editingStep.id, { subject: e.target.value })} />
                </label>
              </div>
              <label style={s.field}><span style={s.fieldLbl}>Body / notes</span>
                <textarea style={{ ...s.fieldInput, minHeight: 60, resize: 'vertical' }} value={editingStep.body ?? ''} onChange={e => updateStep(editingStep.id, { body: e.target.value })} />
              </label>
            </div>
          )}

          {/* State board */}
          <div style={s.boardHead}>
            STATE BOARD
            <button style={s.enrollBtn} onClick={() => setEnrollOpen(v => !v)}>{enrollOpen ? 'Done' : '+ Enroll companies'}</button>
          </div>

          {enrollOpen && (
            <div style={s.enrollPicker}>
              <input style={s.enrollSearch} autoFocus placeholder="Search companies to enroll…" value={enrollSearch} onChange={e => setEnrollSearch(e.target.value)} />
              <div style={s.enrollList}>
                {enrollCandidates.length === 0 && <div style={s.empty}>No matching companies.</div>}
                {enrollCandidates.map(l => (
                  <button key={l.id} style={s.enrollCandidate} onClick={() => doEnroll(l.id)}>
                    <span style={s.enrollAdd}>+</span><span style={s.candName}>{l.name}</span>
                    <span style={s.candMeta}>{l.category}{l.city ? ` · ${l.city}` : ''}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={s.board}>
            {ENROLLMENT_STATES.map(st => {
              const members = selected.enrollments.filter(e => e.state === st)
              return (
                <div key={st} style={s.column}>
                  <div style={s.colHead}>
                    <span style={{ ...s.colDot, background: ENROLLMENT_STATE_COLOR[st] }} />
                    {ENROLLMENT_STATE_LABEL[st]} <span style={s.colCount}>{members.length}</span>
                  </div>
                  {members.map(e => {
                    const lead = leadById.get(e.lead_id)
                    const step = selected.steps[e.current_step]
                    return (
                      <div key={e.lead_id} style={s.card}>
                        <div style={s.cardName}>{lead?.name ?? e.lead_id}</div>
                        <div style={s.cardProg}>{N ? `step ${Math.min(e.current_step + 1, N)}/${N}${step ? ` · ${CHANNEL_LABEL[step.channel]}` : ''}` : 'no steps'}</div>
                        <div style={s.cardActions}>
                          {e.state === 'active' && N > 0 && (
                            <button style={s.runBtn} onClick={() => runNextStep(e.lead_id)} title="Execute next step & advance">Run ▶</button>
                          )}
                          <select
                            style={{ ...s.stateSelect, color: ENROLLMENT_STATE_COLOR[e.state], borderColor: ENROLLMENT_STATE_COLOR[e.state] + '66' }}
                            value={e.state}
                            onChange={ev => updateSeq(setEnrollmentState(selected, e.lead_id, ev.target.value as EnrollmentState))}
                          >
                            {ENROLLMENT_STATES.map(x => <option key={x} value={x}>{ENROLLMENT_STATE_LABEL[x]}</option>)}
                          </select>
                          <button style={s.removeX} onClick={() => updateSeq(unenrollLead(selected, e.lead_id))}>✕</button>
                        </div>
                      </div>
                    )
                  })}
                  {members.length === 0 && <div style={s.colEmpty}>—</div>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Template picker (from "+ New") */}
      {picker && (
        <div style={s.pickerOverlay} onClick={() => setPicker(false)}>
          <div style={s.pickerModal} onClick={ev => ev.stopPropagation()}>
            {renderGallery(() => setPicker(false))}
          </div>
        </div>
      )}
    </div>
  )
}

type CSS = Record<string, React.CSSProperties>
const mono = "'DM Mono', monospace"
const BG = '#0a0a0a', PANEL = '#0d1117', LINE = '#1f2937', TEXT = '#e5e7eb', MUTE = '#64748b', CYAN = '#22d3ee'
const styles: CSS = {
  overlay: { position: 'fixed', inset: 0, zIndex: 1000, background: BG, color: TEXT, fontFamily: mono, display: 'flex', flexDirection: 'column' },
  header: { display: 'flex', alignItems: 'center', gap: 14, padding: '0 20px', height: 52, borderBottom: `1px solid ${LINE}`, flexShrink: 0 },
  title: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, letterSpacing: '.14em', fontWeight: 600 },
  dot: { width: 8, height: 8, borderRadius: '50%', background: '#34d399' },
  subtitle: { fontSize: 10, color: MUTE, letterSpacing: '.1em', marginLeft: 4 },
  infraNote: { fontSize: 10, color: MUTE },
  closeBtn: { fontFamily: mono, fontSize: 11, color: TEXT, background: '#111826', border: `1px solid ${LINE}`, borderRadius: 4, padding: '6px 12px', cursor: 'pointer' },
  tabs: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px', borderBottom: `1px solid ${LINE}`, overflowX: 'auto', flexShrink: 0 },
  tab: { display: 'flex', alignItems: 'center', gap: 7, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 6, padding: '7px 12px', color: '#cbd5e1', cursor: 'pointer', fontFamily: mono, fontSize: 12, whiteSpace: 'nowrap' },
  tabActive: { borderColor: CYAN, color: TEXT, background: '#0f1620' },
  tabCount: { fontSize: 9, color: MUTE, background: '#0a0a0a', borderRadius: 8, padding: '1px 6px' },
  newTab: { background: 'transparent', border: `1px dashed #334155`, color: '#94a3b8', borderRadius: 6, padding: '7px 12px', cursor: 'pointer', fontFamily: mono, fontSize: 11 },
  emptyBig: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTE, fontSize: 13 },
  canvas: { flex: 1, overflowY: 'auto', padding: 20, minHeight: 0 },
  coach: { display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', background: '#0f1620', border: `1px solid ${CYAN}33`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#cbd5e1' },
  coachNum: { color: CYAN, marginRight: 5 },
  coachStep: { display: 'inline-flex', alignItems: 'center' },
  coachX: { marginLeft: 'auto', background: '#111826', border: `1px solid ${LINE}`, color: '#94a3b8', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontFamily: mono, fontSize: 10.5 },
  gallery: { maxWidth: 860, margin: '0 auto' },
  galleryHead: { display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 },
  galleryTitle: { fontSize: 18, fontWeight: 600 },
  gallerySub: { fontSize: 12, color: MUTE, marginTop: 4 },
  galleryGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 },
  tplBlank: { textAlign: 'left', background: '#0d1117', border: `1px dashed #334155`, borderRadius: 10, padding: 16, cursor: 'pointer', fontFamily: mono, color: TEXT, minHeight: 96 },
  tplCard: { textAlign: 'left', background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, cursor: 'pointer', fontFamily: mono, color: TEXT, display: 'flex', flexDirection: 'column', gap: 8 },
  tplName: { fontSize: 14, fontWeight: 600 },
  tplTag: { fontSize: 11, color: MUTE, lineHeight: 1.45 },
  tplSteps: { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 'auto' },
  tplChip: { fontSize: 9.5, color: '#94a3b8', background: '#0a0a0a', border: `1px solid ${LINE}`, borderRadius: 10, padding: '2px 7px' },
  pickerOverlay: { position: 'absolute', inset: 0, background: 'rgba(5,6,10,0.72)', zIndex: 5, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 20px', overflowY: 'auto' },
  pickerModal: { background: BG, border: `1px solid ${LINE}`, borderRadius: 12, padding: 24, width: '100%', maxWidth: 900, boxShadow: '0 20px 60px #000a' },
  seqBar: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 },
  nameInput: { width: 220, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 6, padding: '9px 12px', color: TEXT, fontFamily: mono, fontSize: 15, fontWeight: 600, outline: 'none' },
  nlWrap: { flex: 1, display: 'flex', gap: 6 },
  nlInput: { flex: 1, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 6, padding: '9px 12px', color: TEXT, fontFamily: mono, fontSize: 12, outline: 'none' },
  nlBtn: { background: '#111826', border: `1px solid ${CYAN}55`, color: CYAN, borderRadius: 6, padding: '9px 14px', cursor: 'pointer', fontFamily: mono, fontSize: 12, whiteSpace: 'nowrap' },
  deleteBtn: { background: 'transparent', border: '1px solid #7f1d1d', color: '#ef4444', borderRadius: 6, padding: '9px 12px', cursor: 'pointer', fontFamily: mono, fontSize: 11 },
  err: { background: '#3b1d0e', border: '1px solid #f97316', color: '#fdba74', fontSize: 11, padding: '7px 11px', borderRadius: 4, marginBottom: 10 },
  spineWrap: { position: 'relative', border: `1px solid ${LINE}`, borderRadius: 10, background: 'radial-gradient(120% 140% at 50% 0%, #0f1620 0%, #0a0a0a 70%)', padding: '26px 12px 20px', marginBottom: 14 },
  spineEmpty: { color: MUTE, fontSize: 12, textAlign: 'center', padding: '30px 0' },
  spine: { position: 'relative', height: 150 },
  rail: { position: 'absolute', top: 34, height: 2, background: `linear-gradient(90deg, ${CYAN}00, ${CYAN}66, ${CYAN}00)` },
  station: { position: 'absolute', top: 0, transform: 'translateX(-50%)', width: 128, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: mono, color: TEXT, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 },
  stationActive: {},
  stationDay: { fontSize: 9, letterSpacing: '.1em', color: MUTE },
  stationNode: { width: 30, height: 30, borderRadius: '50%', background: '#111826', border: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#cbd5e1' },
  stationNodeActive: { borderColor: CYAN, color: CYAN, boxShadow: `0 0 10px ${CYAN}66` },
  stationSubject: { fontSize: 10, color: '#cbd5e1', textAlign: 'center', lineHeight: 1.3, maxWidth: 124, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' },
  token: { position: 'absolute', width: 9, height: 9, borderRadius: '50%', background: CYAN, boxShadow: `0 0 6px ${CYAN}`, transform: 'translateX(-50%)', transition: 'left .8s cubic-bezier(.65,0,.35,1)' },
  addStation: { position: 'absolute', right: 12, bottom: 10, background: '#111826', border: `1px dashed #334155`, color: '#94a3b8', borderRadius: 4, padding: '5px 10px', cursor: 'pointer', fontFamily: mono, fontSize: 10.5 },
  editor: { border: `1px solid ${CYAN}44`, borderRadius: 10, background: PANEL, padding: 14, marginBottom: 16 },
  editorHead: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, letterSpacing: '.14em', color: '#94a3b8', marginBottom: 12 },
  miniBtn: { background: '#111826', border: `1px solid ${LINE}`, color: '#94a3b8', borderRadius: 4, padding: '4px 9px', cursor: 'pointer', fontFamily: mono, fontSize: 10 },
  removeBtn: { background: 'transparent', border: '1px solid #7f1d1d', color: '#ef4444', borderRadius: 4, padding: '4px 9px', cursor: 'pointer', fontFamily: mono, fontSize: 10 },
  editorRow: { display: 'flex', gap: 10, marginBottom: 10 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  fieldLbl: { fontSize: 9, letterSpacing: '.08em', color: MUTE, textTransform: 'uppercase' },
  fieldInput: { background: '#0a0a0a', border: `1px solid ${LINE}`, borderRadius: 4, padding: '7px 9px', color: TEXT, fontFamily: mono, fontSize: 12, outline: 'none' },
  boardHead: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 10, letterSpacing: '.14em', color: '#94a3b8', marginBottom: 10 },
  enrollBtn: { marginLeft: 'auto', background: '#111826', border: '1px solid #34d39955', color: '#34d399', borderRadius: 4, padding: '5px 10px', cursor: 'pointer', fontFamily: mono, fontSize: 10.5 },
  enrollPicker: { border: `1px solid ${LINE}`, borderRadius: 8, padding: 10, marginBottom: 14, background: PANEL },
  enrollSearch: { width: '100%', background: '#0a0a0a', border: `1px solid ${LINE}`, borderRadius: 4, color: TEXT, fontFamily: mono, fontSize: 12, padding: '8px 10px', outline: 'none', boxSizing: 'border-box' },
  enrollList: { marginTop: 8, maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 },
  enrollCandidate: { display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', background: 'transparent', border: 'none', color: TEXT, cursor: 'pointer', fontFamily: mono, fontSize: 12, padding: '5px 4px', borderRadius: 3 },
  enrollAdd: { color: '#34d399', fontWeight: 700 },
  candName: { fontWeight: 600 },
  candMeta: { color: MUTE, fontSize: 10, marginLeft: 'auto' },
  empty: { color: MUTE, fontSize: 12, padding: '8px 2px' },
  board: { display: 'flex', gap: 10, alignItems: 'flex-start', overflowX: 'auto', paddingBottom: 8 },
  column: { minWidth: 190, flex: 1, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 8, padding: 10 },
  colHead: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 10.5, letterSpacing: '.08em', color: '#cbd5e1', marginBottom: 8 },
  colDot: { width: 8, height: 8, borderRadius: '50%' },
  colCount: { marginLeft: 'auto', color: MUTE, fontSize: 10 },
  colEmpty: { color: '#334155', fontSize: 11, textAlign: 'center', padding: '6px 0' },
  card: { background: '#0a0a0a', border: `1px solid ${LINE}`, borderRadius: 6, padding: '8px 10px', marginBottom: 6 },
  cardName: { fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cardProg: { fontSize: 9.5, color: MUTE, marginTop: 2 },
  cardActions: { display: 'flex', alignItems: 'center', gap: 5, marginTop: 8 },
  runBtn: { background: '#111826', border: `1px solid ${CYAN}55`, color: CYAN, borderRadius: 4, padding: '4px 9px', cursor: 'pointer', fontFamily: mono, fontSize: 10.5 },
  stateSelect: { flex: 1, background: PANEL, border: '1px solid', borderRadius: 4, fontFamily: mono, fontSize: 10, padding: '4px 5px', cursor: 'pointer', outline: 'none' },
  removeX: { background: 'transparent', border: 'none', color: MUTE, cursor: 'pointer', fontSize: 12, padding: '2px 4px' },
}
