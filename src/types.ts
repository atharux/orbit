export const STATUSES = [
  'new',
  'researching',
  'ready',
  'contacted',
  'in_conversation',
  'meeting_booked',
  'won',
  'lost',
  'on_hold',
] as const
export type OutreachStatus = (typeof STATUSES)[number]

export const STATUS_LABEL: Record<OutreachStatus, string> = {
  new: 'New',
  researching: 'Researching',
  ready: 'Ready to contact',
  contacted: 'Contacted',
  in_conversation: 'In conversation',
  meeting_booked: 'Meeting booked',
  won: 'Won',
  lost: 'Lost',
  on_hold: 'On hold',
}

export const STATUS_COLOR: Record<OutreachStatus, string> = {
  new: '#6B7280',
  researching: '#F59E0B',
  ready: '#3B82F6',
  contacted: '#8B5CF6',
  in_conversation: '#06B6D4',
  meeting_booked: '#F2540B',
  won: '#10B981',
  lost: '#EF4444',
  on_hold: '#9CA3AF',
}

export interface Lead {
  id: string
  vertical_id: string
  name: string
  category: string
  city: string
  address?: string
  lat?: number
  lng?: number
  website?: string
  email?: string
  phone?: string
  instagram?: string
  food_type?: string
  notes?: string
  status: OutreachStatus
  tags: string[]
  source?: string
  last_contacted?: string
  custom_fields?: Record<string, string>
  created_at: string
  updated_at: string
}

export type LeadDraft = Omit<Lead, 'id' | 'created_at' | 'updated_at'>

export interface Vertical {
  id: string
  name: string
  icon: string
  color: string
  // Categories are prefixed with OSM tag key: "craft:painter", "shop:bakery", "amenity:bar".
  // Unprefixed strings default to "amenity" (backwards compat with the nightlife worker).
  osmCategories: string[]
  // 'worker' = venue-scraper Cloudflare Worker (nightlife only)
  // 'overpass' = direct Overpass API query (all other verticals)
  discoveryMode?: 'worker' | 'overpass'
  isCustom?: boolean
}

export interface ScrapeResult {
  url: string
  fetched_at: string
  emails: string[]
  instagram_handles: string[]
  phones: string[]
  addresses: string[]
  title?: string
  description?: string
  raw_text_excerpt?: string
}
