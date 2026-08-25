import { useState } from 'react'

// A second "exhibit" page alongside About — the hackathon pitch slide and the
// Cypher tutorial, both already-designed self-contained HTML pages (built as
// Claude Artifacts) rather than hand-built React, since re-authoring either
// as React components wasn't worth the time this served no purpose beyond
// what an iframe already does cleanly. Served from public/pitch/ (same
// origin as the app) and loaded via a plain iframe -- same-origin means no
// X-Frame-Options/CORS concerns the way embedding the external claude.ai
// artifact URLs directly would have.

export type PitchTab = 'pitch' | 'cypher'
type Tab = PitchTab

const TABS: { id: Tab; label: string; src: string; title: string }[] = [
  { id: 'pitch', label: 'Pitch', src: '/pitch/pitch.html', title: 'Orbit pitch slide' },
  { id: 'cypher', label: 'Cypher Tutorial', src: '/pitch/cypher-tutorial.html', title: 'Cypher, By Your Own Graph' },
]

export function PitchOverlay({ onClose, initialTab = 'pitch' }: { onClose: () => void; initialTab?: PitchTab }) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const active = TABS.find(t => t.id === tab)!

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <div style={styles.brand}>
          <span style={styles.dot} />
          <span style={styles.brandName}>ORBIT</span>
        </div>
        <div style={styles.tabs}>
          {TABS.map(t => (
            <button
              key={t.id}
              style={{ ...styles.tabBtn, ...(t.id === tab ? styles.tabBtnActive : {}) }}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button className="panel-close" onClick={onClose} title="Close" style={styles.closeBtn}>×</button>
      </div>
      <iframe key={active.id} src={active.src} title={active.title} style={styles.frame} />
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: 'fixed', inset: 0, zIndex: 60,
    display: 'flex', flexDirection: 'column',
    background: '#05060a',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 16,
    padding: '10px 16px',
    borderBottom: '1px solid #1c212b',
    background: '#0c0e14',
  },
  brand: { display: 'flex', alignItems: 'center', gap: 8, marginRight: 8 },
  dot: {
    width: 7, height: 7, borderRadius: '50%', background: '#22d3ee',
    boxShadow: '0 0 8px #22d3ee',
  },
  brandName: {
    fontFamily: "'DM Mono', 'Space Mono', ui-monospace, monospace",
    fontSize: 12, letterSpacing: '.14em', color: '#e5e7eb', fontWeight: 500,
  },
  tabs: { display: 'flex', gap: 6, flex: 1 },
  tabBtn: {
    fontFamily: "'DM Mono', 'Space Mono', ui-monospace, monospace",
    fontSize: 11, letterSpacing: '.04em',
    padding: '6px 12px', borderRadius: 4,
    border: '1px solid #1c212b', background: 'transparent', color: '#94a3b8',
    cursor: 'pointer',
  },
  tabBtnActive: {
    color: '#e5e7eb', borderColor: '#22d3ee55', background: '#22d3ee14',
  },
  closeBtn: { color: '#94a3b8' },
  frame: { flex: 1, width: '100%', border: 'none' },
}
