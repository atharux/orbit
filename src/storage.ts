import type { Lead } from './types'

const LS_KEY = 'pocket-leads:v1'
const LEAD_API_URL = import.meta.env.VITE_LEAD_API_URL as string | undefined

export const storageMode: 'local-api' | 'localStorage' = LEAD_API_URL ? 'local-api' : 'localStorage'

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

// ---------- local-api (SQLite) ----------

function apiUrl(path: string): string {
  return `${(LEAD_API_URL ?? '').replace(/\/$/, '')}${path}`
}

async function loadLocalApi(): Promise<Lead[]> {
  const res = await fetch(apiUrl('/leads'))
  if (!res.ok) throw new Error(`Local API ${res.status}: ${await res.text()}`)
  return res.json() as Promise<Lead[]>
}

async function bulkReplaceLocalApi(leads: Lead[]): Promise<void> {
  const res = await fetch(apiUrl('/leads/bulk'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leads }),
  })
  if (!res.ok) throw new Error(`Local API ${res.status}: ${await res.text()}`)
}

// ---------- unified API ----------

export async function listLeads(): Promise<Lead[]> {
  if (storageMode === 'local-api') {
    try {
      const fileLeads = await loadLocalApi()
      const cached = loadLocal()
      // Merge the server (file) with the localStorage cache instead of letting
      // the file blindly overwrite it. dedupeLeads keeps the newest record per
      // lead (by updated_at), so edits made while the server was down survive a
      // reload rather than being clobbered by the stale file.
      const merged = dedupeLeads([...fileLeads, ...cached])
      saveLocal(merged) // keep the localStorage mirror current
      // If the merge added or updated anything the file lacked, push it back so
      // the two stores converge to the newest of each.
      if (leadSignature(fileLeads) !== leadSignature(merged)) {
        try {
          await bulkReplaceLocalApi(merged)
        } catch (err) {
          console.warn('Local API reconcile failed, merged data is in localStorage cache', err)
        }
      }
      return merged
    } catch (err) {
      console.warn('Local API unavailable, using localStorage cache', err)
      return loadLocal()
    }
  }
  return loadLocal()
}

export async function saveLead(lead: Lead, allLeads: Lead[]): Promise<Lead> {
  saveLocal(allLeads) // always keep localStorage in sync as a backup
  if (storageMode === 'local-api') {
    try {
      await bulkReplaceLocalApi(allLeads)
    } catch (err) {
      console.warn('Local API save failed, data is in localStorage cache', err)
    }
  }
  return lead
}

export async function removeLead(_id: string, allLeads: Lead[]): Promise<void> {
  saveLocal(allLeads)
  if (storageMode === 'local-api') {
    try {
      await bulkReplaceLocalApi(allLeads)
    } catch (err) {
      console.warn('Local API remove failed, data is in localStorage cache', err)
    }
  }
}

export async function replaceLeads(leads: Lead[]): Promise<void> {
  saveLocal(leads)
  if (storageMode === 'local-api') {
    try {
      await bulkReplaceLocalApi(leads)
    } catch (err) {
      console.warn('Local API replace failed, data is in localStorage cache', err)
    }
  }
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

// Order-independent fingerprint of a lead set: which leads exist and how fresh
// each is. Used to detect whether a merge changed anything vs. the file so we
// only push back when reconciliation is actually needed.
function leadSignature(leads: Lead[]): string {
  return leads
    .map(l => `${l.id}@${l.updated_at}`)
    .sort()
    .join('|')
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
