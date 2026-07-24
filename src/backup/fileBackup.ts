// Durable local backup via the File System Access API. The user picks a folder
// on any drive (internal, USB, external); Orbit autosaves the ENTIRE local
// database (all leads/sequences/verticals/settings) to a JSON file there on
// every change, keeps timestamped snapshots, and can restore from it. The folder
// handle is persisted in IndexedDB so it survives reloads (with a permission
// re-grant). Chromium only — falls back to Export JSON elsewhere.
//
// This exists because localStorage alone is fragile (origin-scoped, easily
// overwritten). A real file you control is the safety net.

const LATEST = 'orbit-db-latest.json'
const SNAP_PREFIX = 'orbit-db-'
const KEEP_SNAPSHOTS = 10
const LAST_AT_KEY = 'orbit:backup:lastAt'

// Which localStorage keys constitute "the database".
const DB_PREFIXES = ['pocket-leads', 'orbit:']

export function backupSupported(): boolean {
  return typeof (window as any).showDirectoryPicker === 'function'
}

// ---------- IndexedDB: persist the directory handle across sessions ----------

const IDB_NAME = 'orbit-backup'
const IDB_STORE = 'handles'
const HANDLE_KEY = 'backupDir'

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbSet(key: string, val: any): Promise<void> {
  const db = await openIdb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(val, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function idbGet<T = any>(key: string): Promise<T | null> {
  const db = await openIdb()
  const res = await new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const r = tx.objectStore(IDB_STORE).get(key)
    r.onsuccess = () => resolve((r.result ?? null) as T | null)
    r.onerror = () => reject(r.error)
  })
  db.close()
  return res
}

// ---------- handle + permission ----------

let cachedHandle: any = null // in-memory cache so isConfigured() is sync after init

export async function initBackup(): Promise<string | null> {
  if (!backupSupported()) return null
  cachedHandle = await idbGet<any>(HANDLE_KEY)
  return cachedHandle?.name ?? null
}

export function isConfigured(): boolean {
  return Boolean(cachedHandle)
}

export function backupFolderName(): string | null {
  return cachedHandle?.name ?? null
}

export function lastBackupAt(): string | null {
  return localStorage.getItem(LAST_AT_KEY)
}

async function ensurePermission(handle: any, mode: 'read' | 'readwrite' = 'readwrite'): Promise<boolean> {
  const opts = { mode }
  if ((await handle.queryPermission(opts)) === 'granted') return true
  return (await handle.requestPermission(opts)) === 'granted'
}

export async function pickBackupFolder(): Promise<string> {
  const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' })
  await idbSet(HANDLE_KEY, handle)
  cachedHandle = handle
  return handle.name
}

export async function forgetBackupFolder(): Promise<void> {
  await idbSet(HANDLE_KEY, null)
  cachedHandle = null
}

// ---------- snapshot / restore of the localStorage database ----------

export function snapshotDb(): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && DB_PREFIXES.some(p => k.startsWith(p)) && k !== LAST_AT_KEY) {
      const v = localStorage.getItem(k)
      if (v != null) out[k] = v
    }
  }
  return out
}

export function restoreDb(data: Record<string, string>): void {
  for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v)
}

// ---------- read / write the backup files ----------

async function writeFile(dir: any, name: string, text: string): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true })
  const w = await fh.createWritable()
  await w.write(text)
  await w.close()
}

async function pruneSnapshots(dir: any): Promise<void> {
  const snaps: string[] = []
  for await (const [name, entry] of dir.entries()) {
    if (entry.kind === 'file' && name.startsWith(SNAP_PREFIX) && name !== LATEST) snaps.push(name)
  }
  snaps.sort() // ISO timestamps sort chronologically
  const excess = snaps.slice(0, Math.max(0, snaps.length - KEEP_SNAPSHOTS))
  for (const name of excess) await dir.removeEntry(name).catch(() => {})
}

export interface BackupResult { savedAt: string; rows: number }

// Write the whole DB to <folder>/orbit-db-latest.json plus a timestamped copy.
export async function backupNow(): Promise<BackupResult> {
  if (!cachedHandle) throw new Error('No backup folder set. Choose one first.')
  if (!(await ensurePermission(cachedHandle, 'readwrite'))) {
    throw new Error('Backup folder permission was denied.')
  }
  const snap = snapshotDb()
  const savedAt = new Date().toISOString()
  const json = JSON.stringify({ app: 'orbit', version: 1, savedAt, data: snap }, null, 2)
  try {
    await writeFile(cachedHandle, LATEST, json)
    await writeFile(cachedHandle, `${SNAP_PREFIX}${savedAt.replace(/[:.]/g, '-')}.json`, json)
    await pruneSnapshots(cachedHandle)
  } catch (err: any) {
    // e.g. an unplugged USB target — surface it so the UI can warn.
    throw new Error(`Backup write failed (is the drive available?): ${err?.message ?? err}`)
  }
  localStorage.setItem(LAST_AT_KEY, savedAt)
  const leads = snap['pocket-leads:v1']
  let rows = 0
  try { rows = leads ? (JSON.parse(leads) as unknown[]).length : 0 } catch { /* ignore */ }
  return { savedAt, rows }
}

// Read the latest backup's data map (for restore). Null if none.
export async function readLatestBackup(): Promise<Record<string, string> | null> {
  if (!cachedHandle) return null
  if (!(await ensurePermission(cachedHandle, 'read'))) throw new Error('Backup folder permission was denied.')
  try {
    const fh = await cachedHandle.getFileHandle(LATEST)
    const text = await (await fh.getFile()).text()
    const parsed = JSON.parse(text)
    return parsed?.data ?? null
  } catch {
    return null // no file yet
  }
}

// ---------- source-of-truth reconcile (on load) ----------
// Merge the backup file with local storage so every copy converges to the same
// state — NEWEST record wins, nothing is clobbered. This is what makes the file
// the source of truth across machines/drives: point two instances at the same
// file and they agree. Reuses the app's own dedupe (name::city, newest updated_at).

import { dedupeLeads } from '../storage'
import type { Lead } from '../types'

function safeArr(s?: string): any[] { try { return s ? JSON.parse(s) : [] } catch { return [] } }

function mergeById(localStr?: string, fileStr?: string): string {
  const m = new Map<string, any>()
  for (const x of [...safeArr(localStr), ...safeArr(fileStr)]) {
    const ex = m.get(x.id)
    if (!ex || String(x.updated_at ?? '') > String(ex.updated_at ?? '')) m.set(x.id, x)
  }
  return JSON.stringify([...m.values()])
}

function unionById(localStr?: string, fileStr?: string): string {
  const m = new Map<string, any>()
  for (const x of [...safeArr(fileStr), ...safeArr(localStr)]) m.set(x.id, x) // local overrides file on ties
  return JSON.stringify([...m.values()])
}

export interface ReconcileResult { changed: boolean; leads: number }

// Call on app startup when a backup folder is configured. Returns null if there
// is no backup file yet (first run — nothing to reconcile).
export async function reconcileFromBackup(): Promise<ReconcileResult | null> {
  const fileData = await readLatestBackup()
  if (!fileData) return null
  const local = snapshotDb()
  const merged: Record<string, string> = { ...fileData, ...local } // start from union of keys

  // Leads — newest per company (name::city), never lose a newer edit from either side.
  const mergedLeads = dedupeLeads([
    ...(safeArr(local['pocket-leads:v1']) as Lead[]),
    ...(safeArr(fileData['pocket-leads:v1']) as Lead[]),
  ])
  merged['pocket-leads:v1'] = JSON.stringify(mergedLeads)

  // Sequences — newest per id.
  merged['orbit:sequences:v1'] = mergeById(local['orbit:sequences:v1'], fileData['orbit:sequences:v1'])
  // Custom verticals — union (local wins ties).
  merged['pocket-leads:custom-verticals'] = unionById(local['pocket-leads:custom-verticals'], fileData['pocket-leads:custom-verticals'])
  // Settings / flags — keep local (holds this machine's API keys) if present.
  for (const k of ['pocket-leads:settings', 'orbit:seq:coached']) {
    merged[k] = local[k] ?? fileData[k]
  }

  const before = snapshotDb()
  restoreDb(merged)
  const changed = JSON.stringify(before) !== JSON.stringify(snapshotDb())
  // Write the converged truth back so the file and local now match exactly.
  await backupNow().catch(() => {})
  return { changed, leads: mergedLeads.length }
}
