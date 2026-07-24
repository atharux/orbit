// Read-only SQLite inspector + backup — for auditing external-drive lead stores
// before wiring them into Orbit's shared pool. NEVER opens the original file:
// it copies the DB (with its -wal/-shm siblings, so uncheckpointed data is
// preserved) and inspects the copy. Also drops a timestamped safety backup
// next to the original.
//
//   node scripts/inspect-db.mjs /Volumes/1a1/pocket-leads/leads.db
//
// Optional 2nd arg: a directory for the throwaway working copy (defaults to the
// OS temp dir). The safety backup always lands next to the source.

import Database from 'better-sqlite3'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const src = process.argv[2]
const workRoot = process.argv[3] || tmpdir()

if (!src) {
  console.error('usage: node scripts/inspect-db.mjs <path-to.db> [work-dir]')
  process.exit(1)
}
if (!existsSync(src)) {
  console.error(`not found: ${src}`)
  process.exit(1)
}

const SIBLINGS = ['', '-wal', '-shm'] // main db + write-ahead log + shared-memory
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const base = path.basename(src)

function copyBundle(destDir) {
  mkdirSync(destDir, { recursive: true })
  for (const s of SIBLINGS) {
    if (existsSync(src + s)) copyFileSync(src + s, path.join(destDir, base + s))
  }
  return path.join(destDir, base)
}

// 1. Safety backup on the drive, right next to the original (includes WAL/SHM).
const backupDir = path.join(path.dirname(src), `_backup-${stamp}`)
const backupPath = copyBundle(backupDir)
console.log(`\n🛟 Backup written: ${backupPath} (+ wal/shm if present)`)

// 2. Throwaway working copy — the ONLY file we open. Original is never touched.
const workDir = path.join(workRoot, `db-inspect-${stamp}`)
const workPath = copyBundle(workDir)

// Open the COPY read-write so it can fold the WAL in; the source stays pristine.
const db = new Database(workPath)
db.pragma('wal_checkpoint(TRUNCATE)') // materialize WAL data into the copy

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()

console.log(`\n📂 ${src}`)
console.log(`   tables: ${tables.length ? tables.map(t => t.name).join(', ') : '(none)'}`)

for (const { name } of tables) {
  const cols = db.prepare(`PRAGMA table_info(${JSON.stringify(name)})`).all()
  const count = db.prepare(`SELECT COUNT(*) AS n FROM ${JSON.stringify(name)}`).get().n
  console.log(`\n── table "${name}" — ${count} row${count === 1 ? '' : 's'}`)
  console.log('   columns: ' + cols.map(c => `${c.name}:${c.type || 'ANY'}${c.pk ? ' PK' : ''}`).join(', '))

  if (count > 0) {
    const rows = db.prepare(`SELECT * FROM ${JSON.stringify(name)} LIMIT 3`).all()
    rows.forEach((r, i) => {
      const flat = JSON.stringify(r)
      console.log(`   [${i}] ${flat.length > 400 ? flat.slice(0, 400) + '…' : flat}`)
    })
  }
}

db.close()
console.log('\n✅ Inspection complete. Original untouched; working copy in ' + workDir)
