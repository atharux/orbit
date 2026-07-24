import type { Lead } from '../types'
import { leadKey } from '../storage'

// The staging layer: map arbitrary CSV headers onto Orbit's lead fields, then
// classify every row (new / duplicate / invalid) BEFORE anything is committed —
// so old or messy exports are validated and deduped against your live leads
// instead of contaminating them.

export const IMPORT_FIELDS = [
  'name', 'city', 'category', 'email', 'phone', 'website', 'instagram', 'address', 'notes', 'source',
] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]

export const FIELD_LABEL: Record<ImportField, string> = {
  name: 'Name', city: 'City', category: 'Category', email: 'Email', phone: 'Phone',
  website: 'Website', instagram: 'Instagram', address: 'Address', notes: 'Notes', source: 'Source',
}

// Only name is required (it's the identity anchor; city sharpens dedupe).
export const REQUIRED_FIELDS: ImportField[] = ['name']

const SYNONYMS: Record<ImportField, string[]> = {
  name: ['name', 'company', 'company name', 'business', 'business name', 'venue', 'title', 'firma'],
  city: ['city', 'town', 'ort', 'stadt', 'location'],
  category: ['category', 'type', 'trade', 'industry', 'kategorie', 'branche'],
  email: ['email', 'e-mail', 'mail', 'contact email', 'e mail'],
  phone: ['phone', 'tel', 'telephone', 'telefon', 'mobile', 'number', 'phone number'],
  website: ['website', 'url', 'web', 'site', 'homepage', 'webseite'],
  instagram: ['instagram', 'ig', 'insta', 'instagram handle'],
  address: ['address', 'street', 'addr', 'adresse', 'strasse', 'straße'],
  notes: ['notes', 'note', 'comment', 'comments', 'remarks', 'bemerkung'],
  source: ['source', 'origin', 'quelle', 'lead source'],
}

export type Mapping = Record<ImportField, number> // CSV header index, -1 = unmapped

export function guessMapping(headers: string[]): Mapping {
  const norm = headers.map(h => h.trim().toLowerCase())
  const m = {} as Mapping
  const used = new Set<number>()
  for (const f of IMPORT_FIELDS) {
    let idx = norm.findIndex((h, i) => !used.has(i) && SYNONYMS[f].includes(h)) // exact synonym
    if (idx === -1) idx = norm.findIndex((h, i) => !used.has(i) && SYNONYMS[f].some(syn => h.includes(syn))) // contains
    m[f] = idx
    if (idx >= 0) used.add(idx)
  }
  return m
}

export type RowStatus = 'new' | 'duplicate' | 'dupe-in-file' | 'invalid'

export interface StagedRow {
  index: number
  values: Partial<Record<ImportField, string>>
  status: RowStatus
  reason?: string
}

export function stageRows(rows: string[][], mapping: Mapping, existing: Lead[]): StagedRow[] {
  const existingKeys = new Set(existing.map(l => leadKey(l)))
  const seen = new Set<string>()
  return rows.map((r, index) => {
    const values: Partial<Record<ImportField, string>> = {}
    for (const f of IMPORT_FIELDS) {
      const idx = mapping[f]
      if (idx >= 0) {
        const v = (r[idx] ?? '').trim()
        if (v) values[f] = v
      }
    }
    let status: RowStatus = 'new'
    let reason: string | undefined
    if (!values.name) {
      status = 'invalid'; reason = 'no name'
    } else {
      const key = leadKey({ name: values.name, city: values.city ?? '' })
      if (existingKeys.has(key)) { status = 'duplicate'; reason = 'already in your leads' }
      else if (seen.has(key)) { status = 'dupe-in-file'; reason = 'repeated in this file' }
      else seen.add(key)
    }
    return { index, values, status, reason }
  })
}

export function stagedToLead(row: StagedRow, verticalId: string): Lead {
  const now = new Date().toISOString()
  const v = row.values
  return {
    id: crypto.randomUUID(),
    vertical_id: verticalId,
    name: v.name ?? '',
    category: v.category ?? '',
    city: v.city ?? '',
    address: v.address,
    website: v.website,
    email: v.email,
    phone: v.phone,
    instagram: v.instagram,
    notes: v.notes,
    status: 'new',
    tags: [],
    source: v.source || 'csv-import',
    created_at: now,
    updated_at: now,
  }
}
