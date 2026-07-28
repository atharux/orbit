import type { Lead } from './types'

// Leads live in localStorage; the durable copy is the JSON backup file the user
// points at a folder or drive (src/backup/fileBackup.ts).
//
// There used to be a second path here — a Node SQLite server behind
// VITE_LEAD_API_URL — but nothing could reach it. The packaged app ships that
// var blank and has no way to launch the server, so every call fell through to
// the localStorage branch anyway. It read like a live storage backend while
// being dead code, which made storage bugs genuinely confusing to diagnose.
// localStorage plus the backup file is the whole story.

const LS_KEY = 'pocket-leads:v1'

// ---------- localStorage ----------

function loadLocal(): Lead[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as Lead[]) : []
  } catch {
    return []
  }
}

function saveLocal(leads: Lead[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(leads))
  } catch (err) {
    console.warn('localStorage write failed', err)
  }
}

// ---------- unified API ----------
// Async signatures are kept even though localStorage is synchronous: callers in
// App.tsx await these, and the backup layer they feed is genuinely async.

export async function listLeads(): Promise<Lead[]> {
  return loadLocal()
}

export async function saveLead(lead: Lead, allLeads: Lead[]): Promise<Lead> {
  saveLocal(allLeads)
  return lead
}

export async function removeLead(_id: string, allLeads: Lead[]): Promise<void> {
  saveLocal(allLeads)
}

export async function replaceLeads(leads: Lead[]): Promise<void> {
  saveLocal(leads)
}

export function exportJson(leads: Lead[], filename = 'leads'): void {
  const blob = new Blob([JSON.stringify(leads, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function exportCsv(leads: Lead[], filename = 'leads'): void {
  const COLS: Array<{ header: string; get: (l: Lead) => string }> = [
    { header: 'name', get: l => l.name },
    { header: 'vertical_id', get: l => l.vertical_id },
    { header: 'category', get: l => l.category },
    { header: 'city', get: l => l.city },
    { header: 'status', get: l => l.status },
    { header: 'email', get: l => l.email ?? '' },
    { header: 'phone', get: l => l.phone ?? '' },
    { header: 'website', get: l => l.website ?? '' },
    { header: 'instagram', get: l => l.instagram ?? '' },
    { header: 'address', get: l => l.address ?? '' },
    { header: 'tags', get: l => (l.tags ?? []).join(';') },
    { header: 'notes', get: l => l.notes ?? '' },
    { header: 'last_contacted', get: l => l.last_contacted ?? '' },
    { header: 'source', get: l => l.source ?? '' },
    { header: 'created_at', get: l => l.created_at },
    { header: 'updated_at', get: l => l.updated_at },
  ]
  const escape = (val: string) => `"${val.replace(/"/g, '""')}"`
  const header = COLS.map(c => escape(c.header)).join(',')
  const rows = leads.map(l => COLS.map(c => escape(c.get(l))).join(','))
  const csv = [header, ...rows].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function leadKey(lead: Pick<Lead, 'name' | 'city'>): string {
  return `${lead.name.trim().toLowerCase()}::${lead.city.trim().toLowerCase()}`
}

export function dedupeLeads(leads: Lead[]): Lead[] {
  const byKey = new Map<string, Lead>()
  for (const lead of leads) {
    const key = leadKey(lead)
    const existing = byKey.get(key)
    if (!existing) { byKey.set(key, lead); continue }
    byKey.set(key, existing.updated_at > lead.updated_at ? existing : lead)
  }
  return Array.from(byKey.values())
}
