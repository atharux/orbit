import type { Vertical, Lead } from '../types'

interface Props {
  verticals: Vertical[]
  activeId: string
  leads: Lead[]
  onSelect: (id: string) => void
  onAdd: () => void
  onEdit: (v: Vertical) => void
}

export function VerticalPicker({ verticals, activeId, leads, onSelect, onAdd, onEdit }: Props) {
  const countFor = (id: string) => leads.filter(l => l.vertical_id === id).length

  return (
    <div className="vertical-bar">
      {verticals.map(v => {
        const count = countFor(v.id)
        const active = v.id === activeId
        return (
          <button
            key={v.id}
            className={`vertical-pill${active ? ' active' : ''}`}
            style={{ '--spot': v.color, '--spot-dim': `${v.color}18` } as React.CSSProperties}
            onClick={() => onSelect(v.id)}
            onContextMenu={e => { e.preventDefault(); onEdit(v) }}
            title={v.isCustom ? 'Right-click to edit' : undefined}
          >
            <span className="pill-icon">{v.icon}</span>
            {v.name}
            {count > 0 && <span className="pill-count">{count}</span>}
          </button>
        )
      })}
      <button className="add-vertical-btn" onClick={onAdd} title="Add custom vertical">
        + vertical
      </button>
    </div>
  )
}
