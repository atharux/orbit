import { useMemo, useState } from 'react'
import type { Lead } from '../types'
import { parseCsv, type ParsedCsv } from './parseCsv'
import {
  IMPORT_FIELDS, FIELD_LABEL, REQUIRED_FIELDS, guessMapping, stageRows, stagedToLead,
  type Mapping, type RowStatus,
} from './staging'

// CSV import with a staging step: parse → map columns → review (new/duplicate/
// invalid) → commit only the clean, new rows. Nothing touches the live store
// until "Import" is pressed.

const STATUS_COLOR: Record<RowStatus, string> = {
  new: '#34d399', duplicate: '#f59e0b', 'dupe-in-file': '#f59e0b', invalid: '#ef4444',
}
const STATUS_LABEL: Record<RowStatus, string> = {
  new: 'New', duplicate: 'Duplicate', 'dupe-in-file': 'Repeat in file', invalid: 'Invalid',
}

export function ImportModal({ existingLeads, verticalId, verticalName, onImport, onClose }: {
  existingLeads: Lead[]
  verticalId: string
  verticalName: string
  onImport: (leads: Lead[]) => void
  onClose: () => void
}) {
  const [raw, setRaw] = useState('')
  const [parsed, setParsed] = useState<ParsedCsv | null>(null)
  const [mapping, setMapping] = useState<Mapping | null>(null)
  const [parseError, setParseError] = useState('')

  function doParse(text: string) {
    setParseError('')
    try {
      const p = parseCsv(text)
      if (!p.headers.length || !p.rows.length) { setParseError('No rows found. Paste a CSV with a header row and at least one data row.'); return }
      setParsed(p); setMapping(guessMapping(p.headers))
    } catch (e: any) {
      setParseError(String(e?.message ?? e))
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    f.text().then(t => { setRaw(t); doParse(t) })
  }

  const staged = useMemo(
    () => (parsed && mapping ? stageRows(parsed.rows, mapping, existingLeads) : []),
    [parsed, mapping, existingLeads],
  )
  const counts = useMemo(() => ({
    new: staged.filter(r => r.status === 'new').length,
    duplicate: staged.filter(r => r.status === 'duplicate' || r.status === 'dupe-in-file').length,
    invalid: staged.filter(r => r.status === 'invalid').length,
  }), [staged])

  const nameUnmapped = mapping ? REQUIRED_FIELDS.some(f => mapping[f] < 0) : false

  function commit() {
    const clean = staged.filter(r => r.status === 'new').map(r => stagedToLead(r, verticalId))
    if (clean.length) onImport(clean)
    onClose()
  }

  function reset() { setParsed(null); setMapping(null); setRaw('') }

  const s = styles
  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.head}>
          <div style={s.title}>Import CSV <span style={s.sub}>staged — nothing saved until you commit</span></div>
          <div style={{ flex: 1 }} />
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        {!parsed && (
          <div style={s.input}>
            <div style={s.inputRow}>
              <label style={s.fileBtn}>
                Choose CSV file…
                <input type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: 'none' }} />
              </label>
              <span style={s.or}>or paste below</span>
            </div>
            <textarea
              style={s.textarea}
              placeholder="name,city,email&#10;MD Elektro,Berlin,md@example.de"
              value={raw}
              onChange={e => setRaw(e.target.value)}
            />
            {parseError && <div style={s.err}>{parseError}</div>}
            <button style={s.primaryBtn} onClick={() => doParse(raw)} disabled={!raw.trim()}>Parse</button>
          </div>
        )}

        {parsed && mapping && (
          <>
            <div style={s.section}>
              <div style={s.sectionHead}>MAP COLUMNS → into "{verticalName}"</div>
              <div style={s.mapGrid}>
                {IMPORT_FIELDS.map(f => {
                  const required = REQUIRED_FIELDS.includes(f)
                  const missing = required && mapping[f] < 0
                  return (
                    <label key={f} style={s.mapRow}>
                      <span style={{ ...s.mapLbl, color: missing ? '#ef4444' : '#94a3b8' }}>
                        {FIELD_LABEL[f]}{required ? ' *' : ''}
                      </span>
                      <select
                        style={{ ...s.mapSelect, borderColor: missing ? '#ef4444' : '#1f2937' }}
                        value={mapping[f]}
                        onChange={e => setMapping({ ...mapping, [f]: Number(e.target.value) })}
                      >
                        <option value={-1}>— none —</option>
                        {parsed.headers.map((h, i) => <option key={i} value={i}>{h || `col ${i + 1}`}</option>)}
                      </select>
                    </label>
                  )
                })}
              </div>
            </div>

            <div style={s.summary}>
              <span style={{ color: STATUS_COLOR.new }}>● {counts.new} new</span>
              <span style={{ color: STATUS_COLOR.duplicate }}>● {counts.duplicate} duplicate</span>
              <span style={{ color: STATUS_COLOR.invalid }}>● {counts.invalid} invalid</span>
              <span style={s.summaryNote}>duplicates &amp; invalid rows are skipped</span>
            </div>

            <div style={s.tableWrap}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Status</th><th style={s.th}>Name</th><th style={s.th}>City</th>
                    <th style={s.th}>Email</th><th style={s.th}>Category</th>
                  </tr>
                </thead>
                <tbody>
                  {staged.slice(0, 200).map(r => (
                    <tr key={r.index} style={{ opacity: r.status === 'new' ? 1 : 0.5 }}>
                      <td style={s.td}><span style={{ ...s.badge, color: STATUS_COLOR[r.status], borderColor: STATUS_COLOR[r.status] + '66' }}>{STATUS_LABEL[r.status]}</span></td>
                      <td style={s.td}>{r.values.name ?? <span style={s.dim}>—</span>}</td>
                      <td style={s.td}>{r.values.city ?? <span style={s.dim}>—</span>}</td>
                      <td style={s.td}>{r.values.email ?? <span style={s.dim}>—</span>}</td>
                      <td style={s.td}>{r.values.category ?? <span style={s.dim}>—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {staged.length > 200 && <div style={s.more}>+ {staged.length - 200} more rows (all will be imported if new)</div>}
            </div>

            <div style={s.footer}>
              <button style={s.ghostBtn} onClick={reset}>← Choose another file</button>
              <div style={{ flex: 1 }} />
              {nameUnmapped && <span style={s.warn}>Map the Name column to continue</span>}
              <button style={s.primaryBtn} onClick={commit} disabled={counts.new === 0 || nameUnmapped}>
                Import {counts.new} new lead{counts.new === 1 ? '' : 's'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

type CSS = Record<string, React.CSSProperties>
const mono = "'DM Mono', monospace"
const PANEL = '#0d1117', LINE = '#1f2937', TEXT = '#e5e7eb', MUTE = '#64748b', CYAN = '#22d3ee'
const styles: CSS = {
  overlay: { position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(5,6,10,0.75)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '48px 20px', overflowY: 'auto', fontFamily: mono },
  modal: { background: '#0a0a0a', border: `1px solid ${LINE}`, borderRadius: 12, width: '100%', maxWidth: 860, color: TEXT, boxShadow: '0 24px 70px #000a' },
  head: { display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: `1px solid ${LINE}` },
  title: { fontSize: 15, fontWeight: 600, letterSpacing: '.02em' },
  sub: { fontSize: 10.5, color: MUTE, marginLeft: 8, letterSpacing: '.04em' },
  closeBtn: { background: '#111826', border: `1px solid ${LINE}`, color: TEXT, borderRadius: 4, padding: '5px 10px', cursor: 'pointer', fontFamily: mono, fontSize: 12 },
  input: { padding: 20, display: 'flex', flexDirection: 'column', gap: 12 },
  inputRow: { display: 'flex', alignItems: 'center', gap: 12 },
  fileBtn: { background: '#111826', border: `1px solid ${CYAN}55`, color: CYAN, borderRadius: 6, padding: '9px 14px', cursor: 'pointer', fontSize: 12 },
  or: { color: MUTE, fontSize: 12 },
  textarea: { width: '100%', minHeight: 160, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, fontFamily: mono, fontSize: 12, padding: 12, outline: 'none', boxSizing: 'border-box', resize: 'vertical' },
  err: { background: '#3b1d0e', border: '1px solid #f97316', color: '#fdba74', fontSize: 11, padding: '7px 11px', borderRadius: 4 },
  primaryBtn: { alignSelf: 'flex-end', background: CYAN, border: 'none', color: '#04222b', borderRadius: 6, padding: '9px 18px', cursor: 'pointer', fontFamily: mono, fontSize: 12, fontWeight: 600 },
  section: { padding: '16px 20px', borderBottom: `1px solid ${LINE}` },
  sectionHead: { fontSize: 10, letterSpacing: '.14em', color: '#94a3b8', marginBottom: 12 },
  mapGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 8 },
  mapRow: { display: 'flex', alignItems: 'center', gap: 8 },
  mapLbl: { fontSize: 11, width: 74, flexShrink: 0 },
  mapSelect: { flex: 1, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 4, color: TEXT, fontFamily: mono, fontSize: 11, padding: '6px 7px', outline: 'none', cursor: 'pointer' },
  summary: { display: 'flex', alignItems: 'center', gap: 16, padding: '12px 20px', fontSize: 12, borderBottom: `1px solid ${LINE}` },
  summaryNote: { marginLeft: 'auto', color: MUTE, fontSize: 10.5 },
  tableWrap: { maxHeight: 320, overflowY: 'auto', padding: '0 20px' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 11.5 },
  th: { textAlign: 'left', color: MUTE, fontWeight: 400, fontSize: 9.5, letterSpacing: '.08em', textTransform: 'uppercase', padding: '8px 8px', position: 'sticky', top: 0, background: '#0a0a0a', borderBottom: `1px solid ${LINE}` },
  td: { padding: '6px 8px', borderBottom: '1px solid #141a24', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 },
  badge: { border: '1px solid', borderRadius: 10, padding: '1px 8px', fontSize: 9.5 },
  dim: { color: '#334155' },
  more: { color: MUTE, fontSize: 11, padding: '8px 0' },
  footer: { display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderTop: `1px solid ${LINE}` },
  ghostBtn: { background: 'transparent', border: `1px solid ${LINE}`, color: '#94a3b8', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', fontFamily: mono, fontSize: 11 },
  warn: { color: '#fdba74', fontSize: 11 },
}
