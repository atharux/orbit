// Client for the shared Cloudflare scraper worker.
// Same worker used by venue-outreach-db — it's generic enough for any business type.

import type { ScrapeResult } from './types'

const SCRAPER_URL = import.meta.env.VITE_SCRAPER_URL as string | undefined
const FALLBACK_WORKER_URL = 'https://venue-scraper.athar-hafiz.workers.dev'

// ---------- transport ----------
// The worker only sends CORS headers for https://venues.atharux.com, so a
// direct fetch from the webview fails everywhere except production. In dev the
// Vite proxy hides that (see getScraperBases). The packaged desktop app has no
// proxy and its origin is tauri://localhost, so every request was blocked —
// the scraper simply never worked there.
//
// Fix: on desktop, issue the request from Rust via tauri-plugin-http, where
// CORS does not apply. Relative URLs stay on window.fetch (they only occur
// under the dev proxy, which the Rust client cannot resolve).

function isTauri(): boolean {
  return typeof (window as any).__TAURI_INTERNALS__ !== 'undefined'
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

let _tauriFetch: FetchFn | null = null

async function httpFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!isTauri() || url.startsWith('/')) return fetch(url, init)
  if (!_tauriFetch) {
    const mod = await import('@tauri-apps/plugin-http')
    _tauriFetch = mod.fetch as unknown as FetchFn
  }
  try {
    return await _tauriFetch(url, init)
  } catch (err) {
    // The HTTP scope in capabilities/default.json only allows the known worker.
    // A user-configured scraperUrl lands here; fall back to the webview so the
    // Settings override degrades to "needs CORS" rather than silently dying.
    console.warn('Tauri HTTP transport refused, falling back to webview fetch', err)
    return fetch(url, init)
  }
}

// No localhost fallback — 8787 is reserved for the local leads API.
// Runtime override via settings.scraperUrl takes highest priority.
let _scraperUrlOverride: string | null = null

export function setScraperUrlOverride(url: string) {
  _scraperUrlOverride = url || null
  _activeBase = null
}

function getScraperBases(): string[] {
  const override = _scraperUrlOverride || SCRAPER_URL
  if (override) return [override]
  // In dev the worker only allows CORS from the production origin.
  // Route through the Vite proxy so requests are server-side (no CORS).
  if (import.meta.env.DEV) return ['/scraper-api', FALLBACK_WORKER_URL]
  return [FALLBACK_WORKER_URL]
}

export const SCRAPER_BASE_LIST: readonly string[] = [FALLBACK_WORKER_URL]

export interface ScraperHealth {
  status: 'connected' | 'unavailable'
  base: string | null
  hasSearch?: boolean
  hasEnrich?: boolean
  triedBases: readonly string[]
  checkedAt: string
  error?: string
}

export async function pingScraperHealth(timeoutMs = 2500): Promise<ScraperHealth> {
  const checkedAt = new Date().toISOString()
  const bases = getScraperBases()
  let lastError = ''
  for (const base of bases) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const res = await httpFetch(`${base.replace(/\/$/, '')}/health`, {
        method: 'GET',
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (!res.ok) { lastError = `${base} → ${res.status}`; continue }
      let payload: { hasSearch?: boolean; hasEnrich?: boolean } | null = null
      try { payload = (await res.json()) as { hasSearch?: boolean; hasEnrich?: boolean } } catch { payload = null }
      return { status: 'connected', base, hasSearch: payload?.hasSearch, hasEnrich: payload?.hasEnrich, triedBases: bases, checkedAt }
    } catch (err) {
      lastError = `${base} → ${err instanceof Error ? err.message : String(err)}`
    }
  }
  return { status: 'unavailable', base: null, triedBases: bases, checkedAt, error: lastError || 'No /health response from any backend' }
}

export interface AiScraperOptions {
  openRouterApiKey?: string
  openRouterModel?: string
}

export interface EnrichmentResult {
  website?: string
  instagram?: string
  email?: string
  phone?: string
  notes?: string
  model?: string
  attempts?: Array<{
    url: string
    ok: boolean
    emails: number
    instagrams: number
    phones: number
    error?: string
  }>
}

function withAiHeaders(headers: HeadersInit, options?: AiScraperOptions): HeadersInit {
  return {
    ...headers,
    ...(options?.openRouterApiKey ? { 'X-OpenRouter-Api-Key': options.openRouterApiKey } : {}),
    ...(options?.openRouterModel ? { 'X-OpenRouter-Model': options.openRouterModel } : {}),
  }
}

let _activeBase: string | null = null

async function resolveBase(): Promise<string> {
  if (_activeBase) return _activeBase
  const bases = getScraperBases()
  for (const base of bases) {
    try {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 2000)
      const res = await httpFetch(`${base.replace(/\/$/, '')}/health`, { signal: controller.signal })
      if (res.ok) { _activeBase = base; return base }
    } catch { /* try next */ }
  }
  return bases[bases.length - 1]!
}

async function requestJson<T>(path: string, body: Record<string, unknown>, options?: AiScraperOptions): Promise<T> {
  const base = await resolveBase()
  const url = `${base.replace(/\/$/, '')}${path}`
  const res = await httpFetch(url, {
    method: 'POST',
    headers: withAiHeaders({ 'Content-Type': 'application/json' }, options),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Scraper ${res.status} at ${url}: ${await res.text()}`)
  return res.json() as Promise<T>
}

export async function scrapeUrl(url: string, options?: AiScraperOptions): Promise<ScrapeResult> {
  return requestJson<ScrapeResult>('/scrape', { url }, options)
}

export interface SearchResult {
  title: string
  url: string
  description: string
}

export async function searchWeb(query: string, options?: AiScraperOptions): Promise<SearchResult[]> {
  const data = await requestJson<{ results: SearchResult[] }>('/search', { query }, options)
  return data.results
}

export interface PlacesResult {
  place_id: string
  name: string
  address: string
  lat: number
  lng: number
  phone?: string
  website?: string
  rating?: number
  user_ratings_total?: number
  primary_type?: string
}

export async function searchPlaces(query: string, options?: AiScraperOptions): Promise<PlacesResult[]> {
  const data = await requestJson<{ results: PlacesResult[] }>('/places', { query }, options)
  return data.results
}

export interface OsmBusiness {
  osm_id: number
  osm_type: string
  source?: string
  name: string
  lat: number
  lng: number
  category: string
  address: { road?: string; city?: string; country?: string; postcode?: string }
  website?: string
  phone?: string
  email?: string
  opening_hours?: string
}

export async function discoverByLocation(
  location: string,
  categories: string[],
  options?: AiScraperOptions,
): Promise<OsmBusiness[]> {
  const data = await requestJson<{ results: OsmBusiness[] }>(
    '/discover',
    { location, categories, limit: 200 },
    options,
  )
  return data.results
}

async function discoverWebsite(
  input: { name: string; city?: string },
  options?: AiScraperOptions,
): Promise<string | null> {
  try {
    const query = `${input.name} ${input.city ?? ''} official website`
    const results = await searchWeb(query, options)
    const first = results.find(r =>
      r.url.startsWith('http') &&
      !r.url.includes('yelp') &&
      !r.url.includes('tripadvisor') &&
      !r.url.includes('facebook') &&
      !r.url.includes('instagram'),
    )
    return first?.url ?? null
  } catch {
    return null
  }
}

export async function enrichLead(
  input: {
    name: string
    city?: string
    website?: string
    instagram?: string
    email?: string
    phone?: string
    notes?: string
  },
  options?: AiScraperOptions,
): Promise<EnrichmentResult> {
  try {
    return await requestJson<EnrichmentResult>('/enrich', input, options)
  } catch {
    const website = input.website ?? (await discoverWebsite(input, options))
    if (!website) {
      return { website: input.website, instagram: input.instagram, email: input.email, phone: input.phone, notes: input.notes }
    }
    try {
      const scraped = await scrapeUrl(website, options)
      return {
        website,
        instagram: input.instagram ?? scraped.instagram_handles[0],
        email: input.email ?? scraped.emails[0],
        phone: input.phone ?? scraped.phones[0],
        notes: input.notes,
      }
    } catch {
      return { website, instagram: input.instagram, email: input.email, phone: input.phone, notes: input.notes }
    }
  }
}

// ---------- Direct Overpass / Nominatim discovery ----------
// Used for all non-nightlife verticals. The venue-scraper Worker only understands
// amenity tags and was built for nightlife — sending craft:painter to it returns junk.

export function parseOsmCategory(cat: string): { key: string; value: string } {
  const idx = cat.indexOf(':')
  if (idx === -1) return { key: 'amenity', value: cat }
  return { key: cat.slice(0, idx), value: cat.slice(idx + 1) }
}

export function categoryDisplayName(cat: string): string {
  return parseOsmCategory(cat).value.replace(/_/g, ' ')
}

// Nominatim serves its responses through a Varnish cache that does not vary on
// Origin, so a cached entry stored for a request without one comes back with no
// access-control-allow-origin header and the webview rejects it. Routing through
// httpFetch sidesteps that on desktop — and makes the User-Agent below actually
// take effect, since browsers silently drop that header but Rust does not.
// Nominatim's usage policy requires an identifying User-Agent.
async function nominatimGeocode(location: string): Promise<{ lat: number; lng: number } | null> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`
  const res = await httpFetch(url, {
    headers: { 'User-Agent': 'PocketLeads/1.0 (athar@atharux.com)' },
  })
  if (!res.ok) return null
  const data = await res.json() as Array<{ lat: string; lon: string }>
  if (!data[0]) return null
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
}

interface OverpassElement {
  type: string
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

export async function discoverViaOverpass(
  location: string,
  categories: string[],
  radiusMeters = 5000,
): Promise<OsmBusiness[]> {
  const coords = await nominatimGeocode(location)
  if (!coords) throw new Error(`Could not geocode "${location}" — try a more specific city name`)

  const { lat, lng } = coords
  const around = `(around:${radiusMeters},${lat},${lng})`

  const tagLines = categories.flatMap(cat => {
    const { key, value } = parseOsmCategory(cat)
    return [
      `  node["${key}"="${value}"]${around};`,
      `  way["${key}"="${value}"]${around};`,
    ]
  }).join('\n')

  const query = `[out:json][timeout:30];\n(\n${tagLines}\n);\nout center;`

  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: query,
  })
  if (!res.ok) throw new Error(`Overpass API error ${res.status}`)

  const data = await res.json() as { elements: OverpassElement[] }

  return data.elements
    .filter(el => el.tags?.name?.trim())
    .map(el => {
      const elLat = el.lat ?? el.center?.lat ?? 0
      const elLng = el.lon ?? el.center?.lon ?? 0
      const tags = el.tags ?? {}

      const matchedCat = categories.find(cat => {
        const { key, value } = parseOsmCategory(cat)
        return tags[key] === value
      }) ?? categories[0] ?? 'unknown'

      return {
        osm_id: el.id,
        osm_type: el.type,
        source: 'overpass',
        name: tags.name!,
        lat: elLat,
        lng: elLng,
        category: parseOsmCategory(matchedCat).value,
        address: {
          road: tags['addr:street'],
          city: tags['addr:city'] ?? location,
          country: tags['addr:country'],
          postcode: tags['addr:postcode'],
        },
        website: tags['website'] ?? tags['contact:website'],
        phone: tags['phone'] ?? tags['contact:phone'],
        email: tags['email'] ?? tags['contact:email'],
        opening_hours: tags['opening_hours'],
      }
    })
}
