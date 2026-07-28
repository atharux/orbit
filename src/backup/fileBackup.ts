// Durable local backup to a folder on any drive (internal, USB, external). The
// user picks a folder; Orbit autosaves the ENTIRE local database (all leads/
// sequences/verticals/settings) to a JSON file there on every change, keeps
// timestamped snapshots, and can restore from it.
//
// This exists because localStorage alone is fragile (origin-scoped, easily
// overwritten). A real file you control is the safety net.
//
// TWO TRANSPORTS, one format. The browser build uses the File System Access API
// (Chromium only). The desktop build cannot: WKWebView has no showDirectoryPicker,
// which is why Orbit.app previously ran with no backup at all. There, the folder
// picker and file I/O go through Tauri commands (see src-tauri/src/lib.rs) with
// the picked absolute path persisted in localStorage — no permission re-grant,
// and an external drive is a first-class target.
//
// The on-disk format is identical across both, so the same orbit-db-latest.json
// is readable by either build and two instances pointed at one folder converge.

const LATEST = 'orbit-db-latest.json'
const SNAP_PREFIX = 'orbit-db-'
const KEEP_SNAPSHOTS = 10
const LAST_AT_KEY = 'orbit:backup:lastAt'

// Which localStorage keys constitute "the database".
const DB_PREFIXES = ['pocket-leads', 'orbit:']

function isTauri(): boolean {
  return typeof (window as any).__TAURI_INTERNALS__ !== 'undefined'
}

// ---------- transport seam ----------
// Everything below the backend boundary (snapshot/merge/reconcile) is transport
// agnostic — it only ever sees file names and text.

interface Backend {
  init(): Promise<string | null>
  isConfigured(): boolean
  folderName(): string | null
  folderPath(): string | null
  pick(): Promise<string>
  forget(): Promise<void>
  available(): Promise<boolean>
  read(name: string): Promise<string | null>
  write(name: string, text: string): Promise<void>
  list(): Promise<string[]>
  remove(name: string): Promise<void>
}

// ---------- browser transport: File System Access API ----------

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

let cachedHandle: any = null // in-memory cache so isConfigured() is sync after init

async function ensurePermission(handle: any, mode: 'read' | 'readwrite' = 'readwrite'): Promise<boolean> {
  const opts = { mode }
  if ((await handle.queryPermission(opts)) === 'granted') return true
  return (await handle.requestPermission(opts)) === 'granted'
}

const fsaBackend: Backend = {
  async init() {
    cachedHandle = await idbGet<any>(HANDLE_KEY)
    return cachedHandle?.name ?? null
  },
  isConfigured() { return Boolean(cachedHandle) },
  folderName() { return cachedHandle?.name ?? null },
  folderPath() { return null }, // the browser never reveals the absolute path
  async pick() {
    const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' })
    await idbSet(HANDLE_KEY, handle)
    cachedHandle = handle
    return handle.name
  },
  async forget() {
    await idbSet(HANDLE_KEY, null)
    cachedHandle = null
  },
  async available() {
    if (!cachedHandle) return false
    // query only — never request. This runs on modal open, and a request there
    // would pop a permission prompt the user didn't ask for.
    try { return (await cachedHandle.queryPermission({ mode: 'read' })) === 'granted' } catch { return false }
  },
  async read(name) {
    if (!cachedHandle) return null
    if (!(await ensurePermission(cachedHandle, 'read'))) throw new Error('Backup folder permission was denied.')
    try {
      const fh = await cachedHandle.getFileHandle(name)
      return await (await fh.getFile()).text()
    } catch {
      return null // no file yet
    }
  },
  async write(name, text) {
    if (!(await ensurePermission(cachedHandle, 'readwrite'))) {
      throw new Error('Backup folder permission was denied.')
    }
    const fh = await cachedHandle.getFileHandle(name, { create: true })
    const w = await fh.createWritable()
    await w.write(text)
    await w.close()
  },
  async list() {
    const names: string[] = []
    for await (const [name, entry] of cachedHandle.entries()) {
      if (entry.kind === 'file') names.push(name)
    }
    return names
  },
  async remove(name) {
    await cachedHandle.removeEntry(name).catch(() => {})
  },
}

// ---------- desktop transport: Tauri commands over std::fs ----------

const DIR_KEY = 'orbit:backup:dir'

let cachedPath: string | null = null

async function invokeTauri<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

function baseName(p: string): string {
  return p.replace(/\/+$/, '').split('/').pop() || p
}

const tauriBackend: Backend = {
  async init() {
    // Read the path back even if the drive is currently unplugged: the folder
    // stays configured, and available() reports the drive as missing so the UI
    // can say so instead of silently failing every autosave.
    cachedPath = localStorage.getItem(DIR_KEY)
    return cachedPath ? baseName(cachedPath) : null
  },
  isConfigured() { return Boolean(cachedPath) },
  folderName() { return cachedPath ? baseName(cachedPath) : null },
  folderPath() { return cachedPath },
  async pick() {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({ directory: true, multiple: false, title: 'Choose Orbit backup folder' })
    if (typeof picked !== 'string') {
      const err: any = new Error('No folder chosen.')
      err.name = 'AbortError' // matches the FSA cancel path the modal already handles
      throw err
    }
    localStorage.setItem(DIR_KEY, picked)
    cachedPath = picked
    return baseName(picked)
  },
  async forget() {
    localStorage.removeItem(DIR_KEY)
    cachedPath = null
  },
  async available() {
    if (!cachedPath) return false
    try { return await invokeTauri<boolean>('backup_dir_available', { dir: cachedPath }) } catch { return false }
  },
  async read(name) {
    if (!cachedPath) return null
    return invokeTauri<string | null>('backup_read', { dir: cachedPath, name })
  },
  async write(name, text) {
    if (!cachedPath) throw new Error('No backup folder set.')
    await invokeTauri<void>('backup_write', { dir: cachedPath, name, contents: text })
  },
  async list() {
    if (!cachedPath) return []
    return invokeTauri<string[]>('backup_list', { dir: cachedPath })
  },
  async remove(name) {
    if (!cachedPath) return
    await invokeTauri<void>('backup_remove', { dir: cachedPath, name }).catch(() => {})
  },
}

const backend: Backend = isTauri() ? tauriBackend : fsaBackend

// ---------- public handle / status API ----------

export function backupSupported(): boolean {
  return isTauri() || typeof (window as any).showDirectoryPicker === 'function'
}

export async function initBackup(): Promise<string | null> {
  if (!backupSupported()) return null
  return backend.init()
}

export function isConfigured(): boolean {
  return backend.isConfigured()
}

export function backupFolderName(): string | null {
  return backend.folderName()
}

// Absolute path of the backup folder — desktop only (null in the browser, which
// never exposes it). Lets the UI show "/Volumes/…" so an external-drive target
// is unambiguous.
export function backupFolderPath(): string | null {
  return backend.folderPath()
}

// Is the configured folder reachable right now? False means an unplugged drive.
export function backupTargetAvailable(): Promise<boolean> {
  return backend.available()
}

export function lastBackupAt(): string | null {
  return localStorage.getItem(LAST_AT_KEY)
}

export async function pickBackupFolder(): Promise<string> {
  return backend.pick()
}

export async function forgetBackupFolder(): Promise<void> {
  return backend.forget()
}

// ---------- snapshot / restore of the localStorage database ----------

export function snapshotDb(): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && DB_PREFIXES.some(p => k.startsWith(p)) && k !== LAST_AT_KEY && k !== DIR_KEY) {
      const v = localStorage.getItem(k)
      if (v != null) out[k] = v
    }
  }
  return out
}

// ---------- credentials never leave this machine ----------
// Settings live in one JSON blob that also holds the OpenRouter API key. The
// blob has to be backed up (model choice, scraper URL, automation toggles), the
// key must not be: a backup file is designed to sit on a portable drive.
//
// Redaction happens at the WRITE boundary only, never in snapshotDb(). Stripping
// it there would poison reconcileFromBackup(), which feeds snapshotDb() straight
// back through restoreDb() — every reconcile would silently erase your live key.

const SETTINGS_LS_KEY = 'pocket-leads:settings'
const CREDENTIAL_FIELDS = ['openRouterApiKey']

// Drop credential fields from a settings blob before it is written to a file.
function redactSettings(settingsJson?: string): string | undefined {
  if (!settingsJson) return settingsJson
  try {
    const s = JSON.parse(settingsJson)
    let touched = false
    for (const f of CREDENTIAL_FIELDS) {
      if (f in s) { delete s[f]; touched = true }
    }
    return touched ? JSON.stringify(s) : settingsJson
  } catch {
    return settingsJson // unparseable — leave it alone rather than corrupt it
  }
}

// Put this machine's credentials back into a settings blob arriving from a file
// (which, by design, carries none). Without this, "Restore from folder" would
// log you out of OpenRouter every time.
function keepLocalCredentials(incomingJson: string): string {
  try {
    const incoming = JSON.parse(incomingJson)
    const local = JSON.parse(localStorage.getItem(SETTINGS_LS_KEY) ?? '{}')
    for (const f of CREDENTIAL_FIELDS) {
      if (local[f]) incoming[f] = local[f]
    }
    return JSON.stringify(incoming)
  } catch {
    return incomingJson
  }
}

// The single choke point where file data becomes localStorage — both the manual
// restore and the startup reconcile route through here.
export function restoreDb(data: Record<string, string>): void {
  for (const [k, v] of Object.entries(data)) {
    localStorage.setItem(k, k === SETTINGS_LS_KEY ? keepLocalCredentials(v) : v)
  }
}

// ---------- read / write the backup files ----------

async function pruneSnapshots(): Promise<void> {
  const snaps = (await backend.list())
    .filter(name => name.startsWith(SNAP_PREFIX) && name !== LATEST && name.endsWith('.json'))
  snaps.sort() // ISO timestamps sort chronologically
  const excess = snaps.slice(0, Math.max(0, snaps.length - KEEP_SNAPSHOTS))
  for (const name of excess) await backend.remove(name)
}

export interface BackupResult { savedAt: string; rows: number }

// Write the whole DB to <folder>/orbit-db-latest.json plus a timestamped copy.
export async function backupNow(): Promise<BackupResult> {
  if (!isConfigured()) throw new Error('No backup folder set. Choose one first.')
  const snap = snapshotDb()
  const savedAt = new Date().toISOString()
  // What goes to disk is the snapshot minus this machine's credentials.
  const forFile: Record<string, string> = { ...snap }
  const redacted = redactSettings(forFile[SETTINGS_LS_KEY])
  if (redacted != null) forFile[SETTINGS_LS_KEY] = redacted
  const json = JSON.stringify({ app: 'orbit', version: 1, savedAt, data: forFile }, null, 2)
  try {
    await backend.write(LATEST, json)
    await backend.write(`${SNAP_PREFIX}${savedAt.replace(/[:.]/g, '-')}.json`, json)
    await pruneSnapshots()
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
  if (!isConfigured()) return null
  const text = await backend.read(LATEST)
  if (!text) return null
  try {
    return JSON.parse(text)?.data ?? null
  } catch {
    return null // unreadable / half-written file — treat as "no backup yet"
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
