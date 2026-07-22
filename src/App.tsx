import { useEffect, useState, useMemo, lazy, Suspense } from 'react'
import type { Lead, Vertical, OutreachStatus } from './types'
import { STATUSES, STATUS_LABEL, STATUS_COLOR } from './types'
import { listLeads, saveLead, removeLead, replaceLeads, exportCsv, exportJson, dedupeLeads } from './storage'
import { loadAllVerticals, addCustomVertical, removeCustomVertical, updateVertical } from './verticals'
import { pingScraperHealth, setScraperUrlOverride } from './scraper'
import { loadSettings, saveSettings, type AppSettings } from './settings'
import { VerticalPicker } from './components/VerticalPicker'
import { LeadTable } from './components/LeadTable'
import { ScraperPanel } from './components/ScraperPanel'
import { LeadDetail } from './components/LeadDetail'
import { AddVerticalModal } from './components/AddVerticalModal'
import { SettingsModal } from './components/SettingsModal'

// Heavy (Three.js) — only pulled in when the graph view is opened.
const GraphOverlay = lazy(() => import('./graph/GraphOverlay').then(m => ({ default: m.GraphOverlay })))

export function App() {
  const [verticals, setVerticals] = useState<Vertical[]>(loadAllVerticals)
  const [activeVerticalId, setActiveVerticalId] = useState<string>(verticals[0]?.id ?? 'nightlife')
  const [leads, setLeads] = useState<Lead[]>([])
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [scraperOpen, setScraperOpen] = useState(false)
  const [showAddVertical, setShowAddVertical] = useState(false)
  const [editingVertical, setEditingVertical] = useState<Vertical | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [graphOpen, setGraphOpen] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<OutreachStatus | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [scraperStatus, setScraperStatus] = useState<'checking' | 'connected' | 'unavailable'>('checking')
  const [loading, setLoading] = useState(true)
  const [editTrigger, setEditTrigger] = useState(0)

  const activeVertical = verticals.find(v => v.id === activeVerticalId) ?? verticals[0]!

  useEffect(() => {
    listLeads().then(loaded => { setLeads(loaded); setLoading(false) })
  }, [])

  useEffect(() => {
    if (settings.scraperUrl) setScraperUrlOverride(settings.scraperUrl)
    pingScraperHealth().then(h => setScraperStatus(h.status === 'connected' ? 'connected' : 'unavailable'))
  }, [settings.scraperUrl])

  useEffect(() => {
    setCategoryFilter(null)
    setStatusFilter(null)
    setSearch('')
    setSelectedIds(new Set())
  }, [activeVerticalId])

  useEffect(() => {
    if (selectedLead) {
      const updated = leads.find(l => l.id === selectedLead.id)
      if (updated) setSelectedLead(updated)
      else setSelectedLead(null)
    }
  }, [leads]) // eslint-disable-line react-hooks/exhaustive-deps

  const verticalLeads = useMemo(
    () => leads.filter(l => l.vertical_id === activeVerticalId),
    [leads, activeVerticalId],
  )

  const categories = useMemo(
    () => [...new Set(verticalLeads.map(l => l.category))].sort(),
    [verticalLeads],
  )

  const filteredLeads = useMemo(() => {
    let l = verticalLeads
    if (categoryFilter) l = l.filter(lead => lead.category === categoryFilter)
    if (statusFilter) l = l.filter(lead => lead.status === statusFilter)
    if (search) {
      const q = search.toLowerCase()
      l = l.filter(lead =>
        lead.name.toLowerCase().includes(q) ||
        lead.city.toLowerCase().includes(q) ||
        lead.category.toLowerCase().includes(q) ||
        (lead.email ?? '').toLowerCase().includes(q),
      )
    }
    return l
  }, [verticalLeads, categoryFilter, statusFilter, search])

  // Keyboard navigation: j/k to move, Escape to close, x to toggle selection of focused lead
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === 'Escape') {
        setSelectedLead(null)
        setSelectedIds(new Set())
        return
      }
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedLead(prev => {
          const idx = prev ? filteredLeads.findIndex(l => l.id === prev.id) : -1
          return filteredLeads[idx + 1] ?? prev ?? filteredLeads[0] ?? null
        })
        return
      }
      if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedLead(prev => {
          const idx = prev ? filteredLeads.findIndex(l => l.id === prev.id) : filteredLeads.length
          return filteredLeads[idx - 1] ?? prev ?? null
        })
        return
      }
      if (e.key === 'e' && selectedLead) {
        setEditTrigger(n => n + 1)
        return
      }
      if (e.key === 'x' && selectedLead) {
        setSelectedIds(prev => {
          const next = new Set(prev)
          if (next.has(selectedLead.id)) next.delete(selectedLead.id)
          else next.add(selectedLead.id)
          return next
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [filteredLeads, selectedLead])

  async function handleLeadsAdded(newLeads: Lead[]) {
    const all = dedupeLeads([...leads, ...newLeads])
    setLeads(all)
    for (const lead of newLeads) await saveLead(lead, all)
  }

  async function handleLeadUpdate(updated: Lead) {
    const next = leads.map(l => l.id === updated.id ? updated : l)
    setLeads(next)
    setSelectedLead(updated)
    await saveLead(updated, next)
  }

  async function handleLeadDelete(id: string) {
    const next = leads.filter(l => l.id !== id)
    setLeads(next)
    setSelectedLead(null)
    await removeLead(id, next)
  }

  async function handleClearVertical() {
    const count = verticalLeads.length
    if (count === 0) return
    if (!confirm(`Delete all ${count} leads in ${activeVertical.name}? This cannot be undone.`)) return
    const next = leads.filter(l => l.vertical_id !== activeVerticalId)
    setLeads(next)
    setSelectedLead(null)
    await replaceLeads(next)
  }

  async function handleBulkStatus(status: OutreachStatus) {
    const now = new Date().toISOString()
    const next = leads.map(l => selectedIds.has(l.id) ? { ...l, status, updated_at: now } : l)
    setLeads(next)
    await replaceLeads(next)
    setSelectedIds(new Set())
  }

  async function handleBulkDelete() {
    const count = selectedIds.size
    if (!confirm(`Delete ${count} selected leads? This cannot be undone.`)) return
    const next = leads.filter(l => !selectedIds.has(l.id))
    setLeads(next)
    if (selectedLead && selectedIds.has(selectedLead.id)) setSelectedLead(null)
    await replaceLeads(next)
    setSelectedIds(new Set())
  }

  async function handleClearFiltered() {
    const count = filteredLeads.length
    if (count === 0) return
    if (!confirm(`Delete ${count} leads matching current filters? This cannot be undone.`)) return
    const filteredIds = new Set(filteredLeads.map(l => l.id))
    const next = leads.filter(l => !filteredIds.has(l.id))
    setLeads(next)
    setSelectedLead(null)
    await replaceLeads(next)
  }

  async function handleStatusChange(id: string, status: OutreachStatus) {
    const lead = leads.find(l => l.id === id)
    if (!lead) return
    const updated = { ...lead, status, updated_at: new Date().toISOString() }
    setLeads(leads.map(l => l.id === id ? updated : l))
    await saveLead(updated, leads.map(l => l.id === id ? updated : l))
  }

  function handleAddVertical(v: Omit<Vertical, 'isCustom'>) {
    const newVertical = addCustomVertical(v)
    setVerticals(loadAllVerticals())
    setActiveVerticalId(newVertical.id)
  }

  function handleUpdateVertical(v: Vertical) {
    updateVertical(v)
    setVerticals(loadAllVerticals())
    setEditingVertical(null)
  }

  function handleDeleteVertical(id: string) {
    removeCustomVertical(id)
    setVerticals(loadAllVerticals())
    if (activeVerticalId === id) setActiveVerticalId(verticals[0]?.id ?? 'nightlife')
  }

  function handleSaveSettings(s: AppSettings) {
    saveSettings(s)
    setSettings(s)
    setScraperUrlOverride(s.scraperUrl)
    setScraperStatus('checking')
    pingScraperHealth().then(h => setScraperStatus(h.status === 'connected' ? 'connected' : 'unavailable'))
  }

  const spotStyle = {
    '--spot': activeVertical.color,
    '--spot-dim': `${activeVertical.color}18`,
  } as React.CSSProperties

  const aiOptions = {
    openRouterApiKey: settings.openRouterApiKey || undefined,
    openRouterModel: settings.openRouterModel !== 'auto' ? settings.openRouterModel : undefined,
  }

  return (
    <div className="app-wrap" style={spotStyle}>
      <header className="header">
        <div className="header-brand">
          <div className="dot" />
          <span>POCKET</span>
          <span className="unit-tag">PKT-02</span>
          <span style={{ color: 'var(--faint)', fontWeight: 400 }}>LEAD ENGINE</span>
        </div>
        <div className="header-spacer" />
        <div className={`header-status ${scraperStatus}`}>
          <div className="dot-sm" />
          <span className="mono" style={{ fontSize: 10 }}>
            {scraperStatus === 'checking' ? 'connecting...' : scraperStatus === 'connected' ? 'scraper online' : 'scraper offline'}
          </span>
        </div>
        <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 8px' }} />
        <button
          className="btn btn-ghost"
          style={{ height: 30, fontSize: 11, letterSpacing: '.06em' }}
          onClick={() => setGraphOpen(true)}
          title="Open the immersive graph view"
        >
          ◇ Graph
        </button>
        <button
          className="btn btn-ghost"
          style={{ height: 30, fontSize: 11 }}
          onClick={() => exportCsv(filteredLeads, `${activeVertical.name.toLowerCase()}-leads`)}
          disabled={filteredLeads.length === 0}
        >
          Export CSV
        </button>
        <button
          className="btn btn-ghost"
          style={{ height: 30, fontSize: 11 }}
          onClick={() => exportJson(filteredLeads, `${activeVertical.name.toLowerCase()}-leads`)}
          disabled={filteredLeads.length === 0}
        >
          Export JSON
        </button>
        <button
          className="btn btn-ghost"
          style={{ height: 30, fontSize: 11, position: 'relative' }}
          onClick={() => setShowSettings(true)}
          title="Settings"
        >
          Settings
          {!settings.openRouterApiKey && (
            <span style={{
              position: 'absolute', top: 4, right: 4,
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--accent)', display: 'block',
            }} />
          )}
        </button>
      </header>

      <VerticalPicker
        verticals={verticals}
        activeId={activeVerticalId}
        leads={leads}
        onSelect={id => { setActiveVerticalId(id); setSelectedLead(null) }}
        onAdd={() => setShowAddVertical(true)}
        onEdit={v => setEditingVertical(v)}
      />

      <div className="toolbar">
        <span className="toolbar-label">{activeVertical.icon}</span>
        <input
          className="search-input"
          placeholder={`Search ${activeVertical.name} leads...`}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {categories.length > 1 && (
          <select
            className="filter-select"
            value={categoryFilter ?? ''}
            onChange={e => setCategoryFilter(e.target.value || null)}
          >
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <StatusChips
          leads={verticalLeads}
          active={statusFilter}
          onToggle={s => setStatusFilter(prev => prev === s ? null : s)}
        />
        <div className="toolbar-spacer" />
        <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>
          {filteredLeads.length}{filteredLeads.length !== verticalLeads.length ? `/${verticalLeads.length}` : ''} lead{filteredLeads.length !== 1 ? 's' : ''}
        </span>
        {filteredLeads.length < verticalLeads.length && filteredLeads.length > 0 && (
          <button
            className="btn btn-ghost btn-danger"
            style={{ height: 30, fontSize: 11 }}
            onClick={handleClearFiltered}
            title="Delete leads matching current filters"
          >
            Clear filtered
          </button>
        )}
        {verticalLeads.length > 0 && (
          <button
            className="btn btn-ghost btn-danger"
            style={{ height: 30, fontSize: 11 }}
            onClick={handleClearVertical}
            title={`Delete all ${verticalLeads.length} leads in ${activeVertical.name}`}
          >
            Clear vertical
          </button>
        )}
        <button
          className="btn btn-primary"
          onClick={() => setScraperOpen(true)}
          disabled={scraperStatus === 'unavailable'}
          title={scraperStatus === 'unavailable' ? 'Scraper offline — check Settings' : undefined}
        >
          + Discover
        </button>
      </div>

      {selectedIds.size > 0 && (
        <div className="bulk-bar">
          <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
            {selectedIds.size} selected
          </span>
          <select
            className="filter-select"
            defaultValue=""
            onChange={e => { if (e.target.value) { handleBulkStatus(e.target.value as OutreachStatus); e.target.value = '' } }}
          >
            <option value="" disabled>Set status...</option>
            {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <button className="btn btn-ghost" style={{ height: 28, fontSize: 11 }}
            onClick={() => setSelectedIds(new Set(filteredLeads.map(l => l.id)))}>
            Select all {filteredLeads.length}
          </button>
          <button className="btn btn-ghost btn-danger" style={{ height: 28, fontSize: 11 }}
            onClick={handleBulkDelete}>
            Delete {selectedIds.size}
          </button>
          <button className="btn btn-ghost" style={{ height: 28, fontSize: 11 }}
            onClick={() => setSelectedIds(new Set())}>
            Clear
          </button>
        </div>
      )}

      <div className="main-content" style={{ flexDirection: 'row' }}>
        {loading ? (
          <div className="empty-state">
            <div className="empty-icon">--</div>
            <div className="empty-sub">Loading leads...</div>
          </div>
        ) : (
          <LeadTable
            leads={filteredLeads}
            vertical={activeVertical}
            selectedId={selectedLead?.id ?? null}
            selectedIds={selectedIds}
            onSelect={setSelectedLead}
            onSelectionChange={setSelectedIds}
            onStatusChange={handleStatusChange}
          />
        )}

        {selectedLead && (
          <LeadDetail
            lead={selectedLead}
            vertical={activeVertical}
            editTrigger={editTrigger}
            onUpdate={handleLeadUpdate}
            onDelete={handleLeadDelete}
            onClose={() => setSelectedLead(null)}
          />
        )}
      </div>

      {scraperOpen && (
        <ScraperPanel
          vertical={activeVertical}
          existingLeads={filteredLeads}
          aiOptions={aiOptions}
          onLeadsAdded={handleLeadsAdded}
          onClose={() => setScraperOpen(false)}
        />
      )}

      {showAddVertical && (
        <AddVerticalModal
          onSave={handleAddVertical}
          onClose={() => setShowAddVertical(false)}
        />
      )}

      {editingVertical && (
        <AddVerticalModal
          initial={editingVertical}
          onSave={v => handleUpdateVertical({ ...v, isCustom: true })}
          onClose={() => setEditingVertical(null)}
          onDelete={handleDeleteVertical}
        />
      )}

      {showSettings && (
        <SettingsModal
          initial={settings}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {graphOpen && (
        <Suspense fallback={
          <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#05060a',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#64748b', fontFamily: "'DM Mono', monospace", fontSize: 13 }}>
            entering graph space…
          </div>
        }>
          <GraphOverlay leads={leads} onClose={() => setGraphOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}

function StatusChips({
  leads,
  active,
  onToggle,
}: {
  leads: Lead[]
  active: OutreachStatus | null
  onToggle: (s: OutreachStatus) => void
}) {
  const counts = leads.reduce<Partial<Record<OutreachStatus, number>>>((acc, l) => {
    acc[l.status] = (acc[l.status] ?? 0) + 1
    return acc
  }, {})

  const present = (Object.entries(counts) as [OutreachStatus, number][])
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => a.localeCompare(b))

  if (present.length === 0) return null

  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'nowrap', overflow: 'hidden' }}>
      {present.map(([status, count]) => {
        const color = STATUS_COLOR[status]
        const isActive = active === status
        return (
          <button
            key={status}
            onClick={() => onToggle(status)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '3px 8px', borderRadius: 10,
              border: `1px solid ${isActive ? color : 'var(--border)'}`,
              background: isActive ? `${color}18` : 'transparent',
              color: isActive ? color : 'var(--faint)',
              fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 500,
              cursor: 'pointer', transition: 'all .12s', whiteSpace: 'nowrap',
            }}
          >
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
            {STATUS_LABEL[status]}
            <span style={{ opacity: .7 }}>{count}</span>
          </button>
        )
      })}
    </div>
  )
}
