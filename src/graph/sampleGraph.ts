import type { GraphData, GraphNode, GraphLink } from './types'

// SYNTHETIC demo data — NOT real venues or contacts. Used only when
// there are no live/local leads to draw, so the immersive scene has something
// to render on first open. The HUD badges this as "SAMPLE" so it is never
// mistaken for real data.

interface Seed {
  venue: string
  district: string
  category: string
  source: 'Overpass' | 'Foursquare' | 'Yelp' | 'Hunter.io'
  status: 'Active' | 'Paused'
  verified: boolean
}

const SEEDS: Seed[] = [
  { venue: 'Halcyon Club', district: 'Kreuzberg', category: 'club', source: 'Overpass', status: 'Active', verified: true },
  { venue: 'Neon Cellar', district: 'Friedrichshain', category: 'club', source: 'Foursquare', status: 'Active', verified: true },
  { venue: 'Salt & Static', district: 'Neukölln', category: 'bar', source: 'Yelp', status: 'Paused', verified: false },
  { venue: 'Basalt Rooftop', district: 'Mitte', category: 'rooftop', source: 'Hunter.io', status: 'Active', verified: true },
  { venue: 'Amber Room', district: 'Kreuzberg', category: 'lounge', source: 'Overpass', status: 'Active', verified: false },
  { venue: 'Pyre Festival Stage', district: 'Treptow', category: 'festival', source: 'Foursquare', status: 'Active', verified: true },
  { venue: 'Low Tide', district: 'Neukölln', category: 'bar', source: 'Yelp', status: 'Paused', verified: true },
  { venue: 'Vertex Warehouse', district: 'Friedrichshain', category: 'club', source: 'Hunter.io', status: 'Active', verified: false },
]

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

export function sampleGraph(): GraphData {
  const nodes = new Map<string, GraphNode>()
  const links: GraphLink[] = []
  const add = (n: GraphNode) => { if (!nodes.has(n.id)) nodes.set(n.id, n) }

  SEEDS.forEach((s, i) => {
    const venueId = `venue:s${i}`
    const contactId = `contact:s${i}`
    const srcId = `source:${slug(s.source)}`
    const seqId = `seq:${slug(s.status)}`

    add({ id: venueId, kind: 'venue', label: s.venue, sub: s.category, district: s.district })
    add({ id: contactId, kind: 'contact', label: `${s.venue} booker`, sub: s.verified ? 'email on file' : 'unverified', verified: s.verified })
    add({ id: srcId, kind: 'source', label: s.source })
    add({ id: seqId, kind: 'sequence', label: s.status, sub: 'sequence' })

    links.push({ source: contactId, target: venueId, kind: 'WORKS_AT' })
    links.push({ source: seqId, target: venueId, kind: 'TARGETS' })
    if (s.verified) {
      links.push({ source: contactId, target: srcId, kind: 'VERIFIED_BY' })
      links.push({ source: contactId, target: seqId, kind: 'ENROLLED_IN' })
    }
  })

  return {
    nodes: [...nodes.values()],
    links,
    origin: 'sample',
    note: 'SAMPLE — synthetic demo data, not real records',
  }
}
