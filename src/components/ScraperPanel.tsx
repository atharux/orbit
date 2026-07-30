import { useState } from 'react'
import type { Vertical, Lead } from '../types'
import {
  discoverByLocation, discoverViaOverpass,
  enrichLead, categoryDisplayName,
  type OsmBusiness, type AiScraperOptions,
} from '../scraper'
import { discoverViaAppStore } from '../appstore'

interface Props {
  vertical: Vertical
  existingLeads: Lead[]
  aiOptions: AiScraperOptions
  onLeadsAdded: (leads: Lead[]) => void
  onClose: () => void
}

interface DiscoveredItem {
  business: OsmBusiness
  selected: boolean
  enrichStatus?: 'pending' | 'running' | 'done' | 'error'
  enriched?: Partial<Lead>
}

export function ScraperPanel({ vertical, existingLeads, aiOptions, onLeadsAdded, onClose }: Props) {
  const [location, setLocation] = useState('')
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set(vertical.osmCategories))
  const [customCat, setCustomCat] = useState('')
  const [extraCategories, setExtraCategories] = useState<string[]>([])
  const [discovering, setDiscovering] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [results, setResults] = useState<DiscoveredItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [hasSearched, setHasSearched] = useState(false)

  const allCategories = [...vertical.osmCategories, ...extraCategories]
  const selectedResults = results.filter(r => r.selected)

  function toggleCategory(cat: string) {
    setActiveCategories(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  function addCustomCategory() {
    const cat = customCat.trim().toLowerCase().replace(/\s+/g, '_')
    if (!cat || allCategories.includes(cat)) return
    setExtraCategories(prev => [...prev, cat])
    setActiveCategories(prev => new Set([...prev, cat]))
    setCustomCat('')
  }

  async function discover() {
    if (!location.trim()) return
    const cats = Array.from(activeCategories)
    if (!cats.length) { setError('Select at least one category'); return }
    setDiscovering(true)
    setError(null)
    setResults([])
    setStatus(vertical.discoveryMode === 'appstore' ? 'Searching the App Store…' : 'Querying OpenStreetMap…')
    try {
      const businesses =
        vertical.discoveryMode === 'appstore'
          ? await discoverViaAppStore(location.trim(), cats, setStatus)
          : vertical.discoveryMode === 'worker'
            ? await discoverByLocation(location.trim(), cats, aiOptions)
            : await discoverViaOverpass(location.trim(), cats)
      const existingKeys = new Set(existingLeads.map(l => `${l.name.toLowerCase()}::${l.city.toLowerCase()}`))
      const items: DiscoveredItem[] = businesses
        .filter(b => b.name?.trim())
        .map(b => {
          const key = `${b.name.toLowerCase()}::${(b.address?.city ?? location).toLowerCase()}`
          return {
            business: b,
            selected: !existingKeys.has(key),
          }
        })
      setResults(items)
      setStatus(`Found ${items.length} businesses — ${items.filter(i => !i.selected).length} already in DB`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setHasSearched(true)
      setDiscovering(false)
    }
  }

  async function addSelected() {
    const toAdd = selectedResults
    if (!toAdd.length) return

    const now = new Date().toISOString()
    const newLeads: Lead[] = toAdd.map(item => ({
      id: crypto.randomUUID(),
      vertical_id: vertical.id,
      name: item.business.name,
      category: item.business.category,
      city: item.business.address?.city ?? location,
      address: [item.business.address?.road, item.business.address?.city].filter(Boolean).join(', '),
      lat: item.business.lat,
      lng: item.business.lng,
      website: item.business.website,
      phone: item.business.phone,
      email: item.business.email,
      notes: (item.business as { notes?: string }).notes,
      status: 'new' as const,
      tags: [],
      source: item.business.source ?? 'osm',
      // App Store leads carry their published titles and shipping signal so the
      // operator can judge relevance without leaving the app.
      custom_fields: (() => {
        const b = item.business as { appTitles?: string[]; lastShipped?: string; reviewScore?: number }
        if (!b.appTitles?.length) return undefined
        return {
          apps: b.appTitles.join(' · '),
          app_count: String(b.appTitles.length),
          ...(b.lastShipped ? { last_shipped: b.lastShipped.slice(0, 10) } : {}),
          ...(b.reviewScore != null ? { review_score: String(b.reviewScore) } : {}),
        }
      })(),
      created_at: now,
      updated_at: now,
    }))

    onLeadsAdded(newLeads)
    setResults(prev => prev.map(r => r.selected ? { ...r, selected: false } : r))
    setStatus(`Added ${newLeads.length} lead${newLeads.length !== 1 ? 's' : ''} — ${results.length - newLeads.length} remaining`)
  }

  async function enrichSelected() {
    const toEnrich = selectedResults.filter(r => !r.enriched)
    if (!toEnrich.length) return

    setEnriching(true)
    const total = toEnrich.length

    for (let i = 0; i < toEnrich.length; i++) {
      const item = toEnrich[i]!
      setStatus(`Enriching ${i + 1} / ${total}: ${item.business.name}`)
      setResults(prev => prev.map(r =>
        r.business.osm_id === item.business.osm_id ? { ...r, enrichStatus: 'running' } : r,
      ))
      try {
        const result = await enrichLead({
          name: item.business.name,
          city: item.business.address?.city ?? location,
          website: item.business.website,
          phone: item.business.phone,
          email: item.business.email,
        }, aiOptions)
        setResults(prev => prev.map(r =>
          r.business.osm_id === item.business.osm_id
            ? { ...r, enrichStatus: 'done', enriched: result }
            : r,
        ))
      } catch {
        setResults(prev => prev.map(r =>
          r.business.osm_id === item.business.osm_id ? { ...r, enrichStatus: 'error' } : r,
        ))
      }
    }

    setEnriching(false)
    setStatus(`Enriched ${total} leads`)
  }

  function toggleAll() {
    const allSelected = results.every(r => r.selected)
    setResults(prev => prev.map(r => ({ ...r, selected: !allSelected })))
  }

  function toggleItem(osmId: number) {
    setResults(prev => prev.map(r =>
      r.business.osm_id === osmId ? { ...r, selected: !r.selected } : r,
    ))
  }

  const enrichedCount = results.filter(r => r.enriched).length
  const progressPct = enriching && results.length > 0
    ? Math.round((enrichedCount / selectedResults.length) * 100)
    : 0

  return (
    <div className="scraper-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="scraper-panel">
        <div className="panel-header">
          <div style={{ flex: 1 }}>
            <div className="panel-title">
              {vertical.icon} Discover {vertical.name} leads
            </div>
            <div className="panel-sub">
            {vertical.discoveryMode === 'appstore' ? 'iTunes Search API · Apple' : vertical.discoveryMode === 'worker' ? 'venue-scraper · Worker' : 'Overpass API · OpenStreetMap'}
          </div>
          </div>
          <button className="panel-close" onClick={onClose}>×</button>
        </div>

        <div className="panel-body">
          {/* Location */}
          <div>
            <div className="field-label">Location</div>
            <input
              className="field-input"
              placeholder="City, neighbourhood, or region…"
              value={location}
              onChange={e => setLocation(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') discover() }}
            />
          </div>

          {/* Categories */}
          <div>
            <div className="field-label">Categories <span className="text-faint">— toggle to filter</span></div>
            <div className="category-chips">
              {allCategories.map(cat => (
                <button
                  key={cat}
                  className={`category-chip${activeCategories.has(cat) ? ' active' : ''}`}
                  style={{ '--spot': vertical.color, '--spot-dim': `${vertical.color}18` } as React.CSSProperties}
                  onClick={() => toggleCategory(cat)}
                >
                  {categoryDisplayName(cat)}
                  {extraCategories.includes(cat) && (
                    <span
                      style={{ fontSize: 10, opacity: .6 }}
                      onClick={e => {
                        e.stopPropagation()
                        setExtraCategories(prev => prev.filter(c => c !== cat))
                        setActiveCategories(prev => { const n = new Set(prev); n.delete(cat); return n })
                      }}
                    >✕</span>
                  )}
                </button>
              ))}
            </div>
            <div className="add-category-input">
              <input
                placeholder="+ add category (e.g. tattoo_studio)"
                value={customCat}
                onChange={e => setCustomCat(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addCustomCategory() }}
              />
              <button className="btn btn-ghost" style={{ height: 32, padding: '0 10px', fontSize: 11 }} onClick={addCustomCategory}>
                Add
              </button>
            </div>
          </div>

          {/* Discover button */}
          <button
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', height: 40 }}
            onClick={discover}
            disabled={discovering || !location.trim()}
          >
            {discovering ? 'Searching…' : `Discover ${vertical.name} businesses`}
          </button>

          {error && (
            <div style={{ color: '#EF4444', fontSize: 12, fontFamily: 'var(--mono)', padding: '8px 12px', background: 'rgba(239,68,68,.06)', borderRadius: 'var(--radius)', border: '1px solid rgba(239,68,68,.2)' }}>
              {error}
            </div>
          )}

          {/* Zero results state */}
          {!discovering && !error && hasSearched && results.length === 0 && (
            <div style={{ textAlign: 'center', padding: '28px 16px', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
              <div style={{ fontSize: 28, opacity: .25, marginBottom: 10 }}>◎</div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>No businesses found</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                Try a larger city or check your spelling.
                {vertical.isCustom && (
                  <><br />Custom verticals need valid OSM tags —<br />e.g. <code style={{ fontFamily: 'var(--mono)', fontSize: 11, background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 3 }}>leisure:fitness_centre</code> not <code style={{ fontFamily: 'var(--mono)', fontSize: 11, background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 3 }}>gym</code></>
                )}
              </div>
            </div>
          )}

          {/* Status */}
          {status && !error && (
            <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
              {status}
              {enriching && (
                <div className="progress-bar-wrap" style={{ marginTop: 6 }}>
                  <div className="progress-bar" style={{ width: `${progressPct}%`, '--spot': vertical.color } as React.CSSProperties} />
                </div>
              )}
            </div>
          )}

          {/* Results */}
          {results.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div className="field-label" style={{ margin: 0 }}>
                  Results — {selectedResults.length} selected
                </div>
                <button className="btn btn-ghost" style={{ height: 26, padding: '0 8px', fontSize: 10 }} onClick={toggleAll}>
                  {results.every(r => r.selected) ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div className="discover-results">
                {results.map(item => (
                  <div
                    key={item.business.osm_id}
                    className={`discover-result-item${item.selected ? ' selected' : ''}`}
                    style={{ '--spot-dim': `${vertical.color}10` } as React.CSSProperties}
                    onClick={() => toggleItem(item.business.osm_id)}
                  >
                    <div className={`result-checkbox${item.selected ? ' checked' : ''}`}>
                      {item.selected && '✓'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="result-name">{item.business.name}</div>
                      <div className="result-meta">
                        {item.business.category}
                        {item.business.address?.city && ` · ${item.business.address.city}`}
                        {item.business.website && ` · web`}
                        {item.business.phone && ` · tel`}
                        {item.business.email && ` · email`}
                      </div>
                      {item.enriched && (
                        <div style={{ fontSize: 10, color: '#10B981', fontFamily: 'var(--mono)', marginTop: 2 }}>
                          enriched
                          {item.enriched.email && ` · ${item.enriched.email}`}
                        </div>
                      )}
                    </div>
                    {item.enrichStatus && (
                      <div className={`enrich-dot ${item.enrichStatus}`} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        {results.length > 0 && (
          <div className="panel-footer">
            <span className="count-tag">{selectedResults.length} selected</span>
            <button
              className="btn"
              onClick={enrichSelected}
              disabled={enriching || selectedResults.length === 0}
            >
              Enrich
            </button>
            <button
              className="btn btn-primary"
              style={{ '--spot': vertical.color } as React.CSSProperties}
              onClick={addSelected}
              disabled={selectedResults.length === 0}
            >
              Add {selectedResults.length > 0 ? selectedResults.length : ''} leads
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
