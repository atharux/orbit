import { useState } from 'react'
import { type AppSettings, FREE_MODELS } from '../settings'

interface Props {
  initial: AppSettings
  onSave: (s: AppSettings) => void
  onClose: () => void
}

export function SettingsModal({ initial, onSave, onClose }: Props) {
  const [s, setS] = useState<AppSettings>(initial)
  const [showKey, setShowKey] = useState(false)

  const isCustomModel = !FREE_MODELS.find(m => m.id === s.openRouterModel)

  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setS(prev => ({ ...prev, [key]: value }))
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">Settings</span>
          <button className="panel-close" onClick={onClose}>x</button>
        </div>

        <div className="modal-body">
          {/* OpenRouter key */}
          <div>
            <div className="field-label">OpenRouter API key <span className="text-faint" style={{ textTransform: 'none', letterSpacing: 0 }}>— enables AI enrichment</span></div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="field-input"
                type={showKey ? 'text' : 'password'}
                placeholder="sk-or-..."
                value={s.openRouterApiKey}
                onChange={e => set('openRouterApiKey', e.target.value)}
                style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 12 }}
              />
              <button
                className="btn btn-ghost"
                style={{ height: 36, padding: '0 10px', fontSize: 11, flexShrink: 0 }}
                onClick={() => setShowKey(v => !v)}
              >
                {showKey ? 'hide' : 'show'}
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--mono)', marginTop: 5 }}>
              Get a free key at openrouter.ai — only used locally, never leaves your machine
            </div>
          </div>

          {/* Model */}
          <div>
            <div className="field-label">Model</div>
            <select
              className="field-input"
              value={isCustomModel ? '__custom__' : s.openRouterModel}
              onChange={e => {
                if (e.target.value !== '__custom__') set('openRouterModel', e.target.value)
              }}
              style={{ cursor: 'pointer' }}
            >
              {FREE_MODELS.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
              <option value="__custom__">Custom model ID...</option>
            </select>
            {isCustomModel && (
              <input
                className="field-input"
                style={{ marginTop: 6, fontFamily: 'var(--mono)', fontSize: 12 }}
                placeholder="e.g. anthropic/claude-3-haiku"
                value={s.openRouterModel}
                onChange={e => set('openRouterModel', e.target.value)}
              />
            )}
          </div>

          {/* Scraper URL override */}
          <div>
            <div className="field-label">Scraper worker URL <span className="text-faint" style={{ textTransform: 'none', letterSpacing: 0 }}>— leave blank to use production</span></div>
            <input
              className="field-input"
              placeholder="https://venue-scraper.athar-hafiz.workers.dev"
              value={s.scraperUrl}
              onChange={e => set('scraperUrl', e.target.value)}
              style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
            />
          </div>

          {/* Automation */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={s.autoEnrich} onChange={e => set('autoEnrich', e.target.checked)} />
              <span className="field-label" style={{ margin: 0 }}>Auto-enrich new leads</span>
            </label>
            <div className="text-faint" style={{ fontSize: 11, marginTop: 4, textTransform: 'none', letterSpacing: 0 }}>
              Fills blank email/phone/website automatically when leads are discovered or imported.
            </div>
          </div>

          {/* Status */}
          <div style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
            <div className="field-label" style={{ marginBottom: 6 }}>Current config</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>key: {s.openRouterApiKey ? `${s.openRouterApiKey.slice(0, 8)}...` : 'not set'}</span>
              <span>model: {s.openRouterModel || 'auto'}</span>
              <span>worker: {s.scraperUrl || 'venue-scraper.athar-hafiz.workers.dev'}</span>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => { onSave(s); onClose() }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
