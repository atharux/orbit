import { useEffect, useState } from 'react'
import {
  backupSupported, backupFolderName, lastBackupAt,
  pickBackupFolder, backupNow, readLatestBackup, restoreDb, forgetBackupFolder,
} from './fileBackup'

// Backup control panel. Pick a folder on ANY drive (internal or USB); Orbit
// autosaves the whole database there and treats it as the source of truth.

export function BackupModal({ onClose, onRestored }: { onClose: () => void; onRestored: () => void }) {
  const supported = backupSupported()
  const [folder, setFolder] = useState<string | null>(backupFolderName())
  const [last, setLast] = useState<string | null>(lastBackupAt())
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => { setFolder(backupFolderName()); setLast(lastBackupAt()) }, [])

  async function choose() {
    setErr(''); setMsg(''); setBusy('picking')
    try {
      const name = await pickBackupFolder()
      setFolder(name)
      const res = await backupNow()
      setLast(res.savedAt)
      setMsg(`Backup folder set to "${name}". Saved ${res.rows} leads.`)
    } catch (e: any) {
      if (e?.name !== 'AbortError') setErr(String(e?.message ?? e))
    } finally { setBusy('') }
  }

  async function saveNow() {
    setErr(''); setMsg(''); setBusy('saving')
    try {
      const res = await backupNow()
      setLast(res.savedAt)
      setMsg(`Backed up ${res.rows} leads at ${new Date(res.savedAt).toLocaleTimeString()}.`)
    } catch (e: any) { setErr(String(e?.message ?? e)) } finally { setBusy('') }
  }

  async function restore() {
    setErr(''); setMsg(''); setBusy('restoring')
    try {
      const data = await readLatestBackup()
      if (!data) { setErr('No backup file found in that folder yet.'); return }
      const n = (() => { try { return JSON.parse(data['pocket-leads:v1'] ?? '[]').length } catch { return 0 } })()
      restoreDb(data)
      setMsg(`Restored ${n} leads from backup. Reloading…`)
      setTimeout(onRestored, 800)
    } catch (e: any) { setErr(String(e?.message ?? e)) } finally { setBusy('') }
  }

  async function forget() {
    await forgetBackupFolder(); setFolder(null); setMsg('Backup folder disconnected (your file is untouched).')
  }

  const s = styles
  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.head}>
          <div style={s.title}>⛁ Backup <span style={s.sub}>your database, on a drive you control</span></div>
          <div style={{ flex: 1 }} />
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={s.body}>
          {!supported && (
            <div style={s.warn}>
              This browser doesn't support folder backup (needs Chrome/Edge). Use <b>Export JSON</b> in the header as a manual backup instead.
            </div>
          )}

          {supported && (
            <>
              <div style={s.status}>
                <div style={s.statusRow}>
                  <span style={s.statusKey}>Backup folder</span>
                  <span style={s.statusVal}>{folder ? `📁 ${folder}` : <span style={s.dim}>not set</span>}</span>
                </div>
                <div style={s.statusRow}>
                  <span style={s.statusKey}>Last backup</span>
                  <span style={s.statusVal}>{last ? new Date(last).toLocaleString() : <span style={s.dim}>never</span>}</span>
                </div>
              </div>

              <p style={s.explain}>
                Pick a folder on <b>any drive</b> — your Mac, a USB, or an external HD. Orbit saves the
                <b> whole database</b> there (all leads &amp; sequences) on every change, keeps the last 10 snapshots,
                and treats that file as the <b>source of truth</b>: open Orbit anywhere pointed at it and it
                reconciles to the same state. USB drives just need to be plugged in when saving.
              </p>

              <div style={s.actions}>
                <button style={s.primary} onClick={choose} disabled={!!busy}>
                  {folder ? 'Change folder' : 'Choose backup folder'}
                </button>
                <button style={s.btn} onClick={saveNow} disabled={!!busy || !folder}>
                  {busy === 'saving' ? 'Saving…' : 'Back up now'}
                </button>
                <button style={s.btn} onClick={restore} disabled={!!busy || !folder}>
                  {busy === 'restoring' ? 'Restoring…' : 'Restore from folder'}
                </button>
                {folder && <button style={s.ghost} onClick={forget} disabled={!!busy}>Disconnect</button>}
              </div>

              {msg && <div style={s.ok}>{msg}</div>}
              {err && <div style={s.err}>{err}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

type CSS = Record<string, React.CSSProperties>
const mono = "'DM Mono', monospace"
const LINE = '#1f2937', TEXT = '#e5e7eb', MUTE = '#64748b', CYAN = '#22d3ee', GREEN = '#34d399'
const styles: CSS = {
  overlay: { position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(5,6,10,0.75)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 20px', fontFamily: mono, overflowY: 'auto' },
  modal: { background: '#0a0a0a', border: `1px solid ${LINE}`, borderRadius: 12, width: '100%', maxWidth: 560, color: TEXT, boxShadow: '0 24px 70px #000a' },
  head: { display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: `1px solid ${LINE}` },
  title: { fontSize: 15, fontWeight: 600 },
  sub: { fontSize: 10.5, color: MUTE, marginLeft: 8 },
  closeBtn: { background: '#111826', border: `1px solid ${LINE}`, color: TEXT, borderRadius: 4, padding: '5px 10px', cursor: 'pointer', fontFamily: mono, fontSize: 12 },
  body: { padding: 20 },
  warn: { background: '#3b1d0e', border: '1px solid #f97316', color: '#fdba74', fontSize: 12, padding: '10px 12px', borderRadius: 6, lineHeight: 1.5 },
  status: { background: '#0d1117', border: `1px solid ${LINE}`, borderRadius: 8, padding: '12px 14px', marginBottom: 14 },
  statusRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 12.5 },
  statusKey: { color: MUTE }, statusVal: { color: TEXT }, dim: { color: '#475569' },
  explain: { fontSize: 12, color: '#94a3b8', lineHeight: 1.6, margin: '0 0 16px' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  primary: { background: CYAN, border: 'none', color: '#04222b', borderRadius: 6, padding: '9px 16px', cursor: 'pointer', fontFamily: mono, fontSize: 12, fontWeight: 600 },
  btn: { background: '#111826', border: `1px solid ${LINE}`, color: TEXT, borderRadius: 6, padding: '9px 14px', cursor: 'pointer', fontFamily: mono, fontSize: 12 },
  ghost: { background: 'transparent', border: `1px solid ${LINE}`, color: MUTE, borderRadius: 6, padding: '9px 12px', cursor: 'pointer', fontFamily: mono, fontSize: 11 },
  ok: { marginTop: 14, background: '#06281f', border: `1px solid ${GREEN}55`, color: GREEN, fontSize: 12, padding: '9px 12px', borderRadius: 6 },
  err: { marginTop: 14, background: '#3b1d0e', border: '1px solid #f97316', color: '#fdba74', fontSize: 12, padding: '9px 12px', borderRadius: 6 },
}
