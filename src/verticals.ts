import type { Vertical } from './types'

export const BUILT_IN_VERTICALS: Vertical[] = [
  {
    id: 'nightlife',
    name: 'Nightlife',
    icon: '◆',
    color: '#8B5CF6',
    // These are amenity values the venue-scraper Cloudflare Worker understands natively.
    osmCategories: ['nightclub', 'bar', 'music_venue', 'events_venue', 'casino'],
    discoveryMode: 'worker',
  },
  {
    id: 'trades',
    name: 'Trades',
    icon: '◈',
    color: '#F97316',
    // OSM uses craft=* for tradespeople, not amenity=*
    osmCategories: [
      'craft:painter', 'craft:plumber', 'craft:electrician', 'craft:carpenter',
      'craft:roofer', 'craft:locksmith', 'craft:hvac', 'craft:glazier', 'craft:tiler', 'craft:builder',
    ],
    discoveryMode: 'overpass',
  },
  {
    id: 'food',
    name: 'Food & Drink',
    icon: '◉',
    color: '#10B981',
    osmCategories: [
      'amenity:restaurant', 'amenity:cafe', 'amenity:fast_food', 'amenity:bar',
      'amenity:ice_cream', 'amenity:food_court',
      'shop:bakery', 'shop:deli', 'shop:confectionery',
    ],
    discoveryMode: 'overpass',
  },
  {
    id: 'health',
    name: 'Health & Wellness',
    icon: '◎',
    color: '#06B6D4',
    osmCategories: [
      'leisure:fitness_centre', 'leisure:spa',
      'shop:hairdresser', 'shop:beauty', 'shop:optician',
      'amenity:dentist', 'amenity:pharmacy',
      'healthcare:physiotherapist',
    ],
    discoveryMode: 'overpass',
  },
  {
    id: 'retail',
    name: 'Retail',
    icon: '◇',
    color: '#EC4899',
    osmCategories: [
      'shop:clothes', 'shop:florist', 'shop:books', 'shop:shoes',
      'shop:jewellery', 'shop:gift', 'shop:sports', 'shop:electronics',
    ],
    discoveryMode: 'overpass',
  },
  {
    id: 'dev-studios',
    name: 'iOS Studios',
    icon: '◐',
    color: '#2F7D84',
    // Not OSM tags — these are iTunes Search terms. App studios are frequently
    // remote or unmapped, and OSM has no notion of "publishes iOS apps", which is
    // the only signal that qualifies a lead for App Review work.
    // Legal-form and studio naming conventions, not descriptive keywords. The
    // iTunes API searches app names and descriptions, so "app studio" returns apps
    // *about* making apps (Google, GoDaddy, BandLab) rather than studios that make
    // them. Searching how a studio names itself finds the studio.
    osmCategories: [
      'appstore:GmbH', 'appstore:Studio', 'appstore:Labs', 'appstore:Interactive',
      'appstore:Digital', 'appstore:Software', 'appstore:Solutions', 'appstore:Media',
    ],
    discoveryMode: 'appstore',
  },
  {
    id: 'linkedin',
    name: 'LinkedIn Connections',
    icon: '◑',
    color: '#0A66C2', // LinkedIn blue — reads as "this came from LinkedIn" at a glance
    // No discovery query at all: contacts land here only via
    // `node src/graph/linkedinImport.ts <csv> linkedin`, which tags every
    // imported Contact's vertical_id directly. Nothing to search, so no
    // osmCategories/discoveryMode — the Scraper panel's "Discover" button
    // is a no-op for this vertical by construction (empty category list).
    osmCategories: [],
  },
  {
    id: 'professional',
    name: 'Professional Services',
    icon: '○',
    color: '#64748B',
    osmCategories: [
      'office:lawyer', 'office:accountant', 'office:estate_agent',
      'office:architect', 'office:insurance', 'office:travel_agent',
      'amenity:bank',
    ],
    discoveryMode: 'overpass',
  },
]

const CUSTOM_VERTICALS_KEY = 'pocket-leads:custom-verticals'

export function loadCustomVerticals(): Vertical[] {
  try {
    const raw = localStorage.getItem(CUSTOM_VERTICALS_KEY)
    if (!raw) return []
    return (JSON.parse(raw) as Vertical[]).map(v => ({ ...v, isCustom: true }))
  } catch {
    return []
  }
}

export function saveCustomVerticals(verticals: Vertical[]): void {
  try {
    localStorage.setItem(CUSTOM_VERTICALS_KEY, JSON.stringify(verticals.filter(v => v.isCustom)))
  } catch (err) {
    console.warn('Failed to save custom verticals', err)
  }
}

export function loadAllVerticals(): Vertical[] {
  return [...BUILT_IN_VERTICALS, ...loadCustomVerticals()]
}

export function addCustomVertical(v: Omit<Vertical, 'isCustom'>): Vertical {
  const newVertical: Vertical = { ...v, isCustom: true }
  const existing = loadCustomVerticals()
  saveCustomVerticals([...existing, newVertical])
  return newVertical
}

export function removeCustomVertical(id: string): void {
  const existing = loadCustomVerticals()
  saveCustomVerticals(existing.filter(v => v.id !== id))
}

export function updateVertical(updated: Vertical): void {
  if (!updated.isCustom) return
  const existing = loadCustomVerticals()
  saveCustomVerticals(existing.map(v => (v.id === updated.id ? updated : v)))
}
