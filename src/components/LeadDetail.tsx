import { useState, useEffect } from 'react'
import type { Lead, Vertical, OutreachStatus } from '../types'
import { STATUSES, STATUS_LABEL, STATUS_COLOR } from '../types'

// Normalize a stored website into an openable URL (leads often omit the scheme).
function hrefFor(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

interface Props {
  lead: Lead
  vertical: Vertical
  editTrigger?: number
  onUpdate: (lead: Lead) => void
  onDelete: (id: string) => void
  onClose: () => void
}

export function LeadDetail({ lead, vertical, editTrigger, onUpdate, onDelete, onClose }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Lead>(lead)

  useEffect(() => {
    setDraft(lead)
    setEditing(false)
  }, [lead.id])

  useEffect(() => {
    if (editTrigger) setEditing(true)
  }, [editTrigger])

  useEffect(() => {
    if (!editing) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); cancel() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [editing]) // eslint-disable-line react-hooks/exhaustive-deps

  function field(key: keyof Lead, label: string, type: 'text' | 'url' | 'email' | 'tel' = 'text') {
    const value = (draft[key] ?? '') as string
    return (
      <div className="detail-field">
        <div className="field-label">{label}</div>
        {editing ? (
          <input
            className="field-input"
            type={type}
            value={value}
            onChange={e => setDraft(prev => ({ ...prev, [key]: e.target.value || undefined }))}
          />
        ) : (
          <div className="detail-value">
            {value
              ? (type === 'url' || type === 'email'
                ? <a href={type === 'email' ? `mailto:${value}` : hrefFor(value)} target="_blank" rel="noreferrer">{value}</a>
                : value)
              : <span className="text-faint mono" style={{ fontSize: 11 }}>—</span>
            }
          </div>
        )}
      </div>
    )
  }

  function save() {
    onUpdate({ ...draft, updated_at: new Date().toISOString() })
    setEditing(false)
  }

  function cancel() {
    setDraft(lead)
    setEditing(false)
  }

  const statusColor = STATUS_COLOR[lead.status]

  return (
    <div className="detail-panel">
      {/* Header */}
      <div className="panel-header">
        <div style={{ flex: 1 }}>
          <div className="panel-title" style={{ fontSize: 14 }}>{lead.name}</div>
          <div className="panel-sub">{vertical.icon} {vertical.name} · {lead.city}</div>
        </div>
        <button className="panel-close" onClick={onClose}>×</button>
      </div>

      {/* Status */}
      <div className="detail-section">
        <div className="field-label">Status</div>
        <select
          className="status-select"
          value={draft.status}
          onChange={e => {
            const updated = { ...draft, status: e.target.value as OutreachStatus, updated_at: new Date().toISOString() }
            setDraft(updated)
            onUpdate(updated)
          }}
          style={{ color: statusColor }}
        >
          {STATUSES.map(s => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {STATUSES.map(s => (
            <button
              key={s}
              style={{
                padding: '3px 8px',
                borderRadius: 10,
                border: '1px solid',
                fontSize: 10,
                fontFamily: 'var(--mono)',
                cursor: 'pointer',
                background: draft.status === s ? `${STATUS_COLOR[s]}18` : 'transparent',
                borderColor: draft.status === s ? STATUS_COLOR[s] : 'var(--border)',
                color: draft.status === s ? STATUS_COLOR[s] : 'var(--faint)',
                transition: 'all .1s',
              }}
              onClick={() => {
                const updated = { ...draft, status: s, updated_at: new Date().toISOString() }
                setDraft(updated)
                onUpdate(updated)
              }}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Contact info */}
      <div className="detail-section" style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {field('website', 'Website', 'url')}
        {field('email', 'Email', 'email')}
        {field('phone', 'Phone', 'tel')}
        {field('instagram', 'Instagram')}
        {field('address', 'Address')}
        {field('category', 'Category')}
        {vertical.id === 'food' && field('food_type', 'Cuisine / Type')}

        <div className="detail-field">
          <div className="field-label">Notes</div>
          {editing ? (
            <textarea
              className="textarea-field"
              value={draft.notes ?? ''}
              onChange={e => setDraft(prev => ({ ...prev, notes: e.target.value || undefined }))}
              rows={4}
            />
          ) : (
            <div className="detail-value" style={{ whiteSpace: 'pre-wrap' }}>
              {draft.notes || <span className="text-faint mono" style={{ fontSize: 11 }}>—</span>}
            </div>
          )}
        </div>

        <div className="detail-field">
          <div className="field-label">Last contacted</div>
          {editing ? (
            <input
              className="field-input"
              type="date"
              value={draft.last_contacted ?? ''}
              onChange={e => setDraft(prev => ({ ...prev, last_contacted: e.target.value || undefined }))}
            />
          ) : (
            <div className="detail-value">
              {draft.last_contacted
                ? new Date(draft.last_contacted).toLocaleDateString()
                : <span className="text-faint mono" style={{ fontSize: 11 }}>—</span>
              }
            </div>
          )}
        </div>

        <div className="detail-field">
          <div className="field-label">Source</div>
          <div className="detail-value mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
            {lead.source ?? '—'}
          </div>
        </div>

        <div className="detail-field">
          <div className="field-label">Added</div>
          <div className="detail-value mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
            {new Date(lead.created_at).toLocaleString()}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="panel-footer">
        <button
          className="btn btn-danger btn-ghost"
          onClick={() => {
            if (confirm(`Delete "${lead.name}"?`)) onDelete(lead.id)
          }}
        >
          Delete
        </button>
        <div style={{ flex: 1 }} />
        {editing ? (
          <>
            <button className="btn" onClick={cancel}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={save}
            >
              Save
            </button>
          </>
        ) : (
          <button className="btn" onClick={() => setEditing(true)}>Edit</button>
        )}
      </div>
    </div>
  )
}
