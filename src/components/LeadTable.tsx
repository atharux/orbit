import { useState, useEffect } from 'react'
import type { Lead, Vertical, OutreachStatus } from '../types'
import { STATUS_LABEL, STATUS_COLOR } from '../types'

type SortKey = 'name' | 'city' | 'category' | 'status' | 'updated_at'

interface Props {
  leads: Lead[]
  vertical: Vertical
  selectedId: string | null
  selectedIds: Set<string>
  onSelect: (lead: Lead) => void
  onSelectionChange: (ids: Set<string>) => void
  onStatusChange: (id: string, status: OutreachStatus) => void
}

export function LeadTable({ leads, vertical, selectedId, selectedIds, onSelect, onSelectionChange, onStatusChange }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('updated_at')
  const [sortAsc, setSortAsc] = useState(false)

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(v => !v)
    else { setSortKey(key); setSortAsc(true) }
  }

  // Scroll selected row into view when changed via keyboard
  useEffect(() => {
    if (!selectedId) return
    const row = document.querySelector<HTMLElement>(`tr[data-id="${selectedId}"]`)
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId])

  const allChecked = leads.length > 0 && leads.every(l => selectedIds.has(l.id))
  const someChecked = !allChecked && leads.some(l => selectedIds.has(l.id))

  function toggleAll() {
    if (allChecked) {
      const next = new Set(selectedIds)
      leads.forEach(l => next.delete(l.id))
      onSelectionChange(next)
    } else {
      const next = new Set(selectedIds)
      leads.forEach(l => next.add(l.id))
      onSelectionChange(next)
    }
  }

  function toggleOne(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onSelectionChange(next)
  }

  const sorted = [...leads].sort((a, b) => {
    const av = a[sortKey] ?? ''
    const bv = b[sortKey] ?? ''
    return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
  })

  function Th({ col, label }: { col: SortKey; label: string }) {
    return (
      <th
        className={sortKey === col ? 'sorted' : ''}
        onClick={() => toggleSort(col)}
      >
        {label}{sortKey === col ? (sortAsc ? ' ↑' : ' ↓') : ''}
      </th>
    )
  }

  if (leads.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">—</div>
        <div className="empty-title">No leads yet</div>
        <div className="empty-sub">
          Use the Discover button to find businesses, or import from CSV.
        </div>
      </div>
    )
  }

  return (
    <div className="leads-table-wrap">
      <table className="leads-table">
        <thead>
          <tr>
            <th className="cb-cell" onClick={e => e.stopPropagation()}>
              <input
                type="checkbox"
                className="cb"
                checked={allChecked}
                ref={el => { if (el) el.indeterminate = someChecked }}
                onChange={toggleAll}
              />
            </th>
            <Th col="name" label="Name" />
            <Th col="category" label="Category" />
            {vertical.id === 'food' && <th>Cuisine</th>}
            <Th col="city" label="City" />
            <Th col="status" label="Status" />
            <th>Email</th>
            <th>Website</th>
            <Th col="updated_at" label="Updated" />
          </tr>
        </thead>
        <tbody>
          {sorted.map(lead => (
            <tr
              key={lead.id}
              data-id={lead.id}
              className={[
                selectedId === lead.id ? 'selected' : '',
                selectedIds.has(lead.id) ? 'bulk-checked' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => onSelect(lead)}
            >
              <td className="cb-cell" onClick={e => toggleOne(lead.id, e)}>
                <input
                  type="checkbox"
                  className="cb"
                  checked={selectedIds.has(lead.id)}
                  onChange={() => {}}
                />
              </td>
              <td>
                <div className="lead-name">{lead.name}</div>
              </td>
              <td>
                <span className="category-badge">{lead.category}</span>
              </td>
              {vertical.id === 'food' && (
                <td>
                  <span className="lead-city">{lead.food_type ?? '—'}</span>
                </td>
              )}
              <td>
                <span className="lead-city">{lead.city}</span>
              </td>
              <td>
                <StatusSelect
                  value={lead.status}
                  onChange={s => {
                    onStatusChange(lead.id, s)
                  }}
                  onClick={e => e.stopPropagation()}
                />
              </td>
              <td>
                {lead.email ? (
                  <a
                    className="contact-link"
                    href={`mailto:${lead.email}`}
                    onClick={e => e.stopPropagation()}
                    title={lead.email}
                  >
                    {lead.email}
                  </a>
                ) : (
                  <span className="text-faint mono" style={{ fontSize: 11 }}>—</span>
                )}
              </td>
              <td>
                {lead.website ? (
                  <a
                    className="contact-link"
                    href={lead.website}
                    target="_blank"
                    rel="noreferrer"
                    onClick={e => e.stopPropagation()}
                    title={lead.website}
                  >
                    {lead.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                  </a>
                ) : (
                  <span className="text-faint mono" style={{ fontSize: 11 }}>—</span>
                )}
              </td>
              <td>
                <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>
                  {new Date(lead.updated_at).toLocaleDateString()}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StatusSelect({
  value,
  onChange,
  onClick,
}: {
  value: OutreachStatus
  onChange: (s: OutreachStatus) => void
  onClick: (e: React.MouseEvent) => void
}) {
  const color = STATUS_COLOR[value]
  return (
    <span
      className="status-pill"
      style={{ background: `${color}18`, color }}
      onClick={onClick}
    >
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
      <select
        value={value}
        style={{ background: 'none', border: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer', padding: 0 }}
        onChange={e => onChange(e.target.value as OutreachStatus)}
        onClick={onClick}
      >
        {(Object.entries(STATUS_LABEL) as [OutreachStatus, string][]).map(([k, label]) => (
          <option key={k} value={k}>{label}</option>
        ))}
      </select>
    </span>
  )
}
