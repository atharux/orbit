import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const PORT = Number(process.env.LOCAL_API_PORT || 8787)

// DB path: LEAD_DB_PATH env > ./data/leads.db
// Set LEAD_DB_PATH to an external drive for true pocket storage:
// LEAD_DB_PATH=/Volumes/1a1/pocket-leads/leads.db npm run local-api
const DATA_DIR = process.env.LEAD_DB_PATH
  ? path.dirname(process.env.LEAD_DB_PATH)
  : path.join(process.cwd(), 'data')

mkdirSync(DATA_DIR, { recursive: true })

const DB_PATH = process.env.LEAD_DB_PATH || path.join(DATA_DIR, 'leads.db')
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.exec(`CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  name TEXT,
  city TEXT,
  vertical_id TEXT,
  status TEXT,
  updated_at TEXT,
  data TEXT NOT NULL
)`)

const listStmt = db.prepare('SELECT data FROM leads ORDER BY updated_at DESC')
const countStmt = db.prepare('SELECT COUNT(*) AS n FROM leads')
const clearStmt = db.prepare('DELETE FROM leads')
const insertStmt = db.prepare(
  'INSERT OR REPLACE INTO leads (id, name, city, vertical_id, status, updated_at, data) VALUES (@id, @name, @city, @vertical_id, @status, @updated_at, @data)',
)

const replaceAll = db.transaction(leads => {
  clearStmt.run()
  for (const lead of leads) {
    if (!lead || lead.id == null) continue
    insertStmt.run({
      id: String(lead.id),
      name: lead.name ?? '',
      city: lead.city ?? '',
      vertical_id: lead.vertical_id ?? '',
      status: lead.status ?? '',
      updated_at: lead.updated_at ?? '',
      data: JSON.stringify(lead),
    })
  }
  return countStmt.get().n
})

createServer(async (req, res) => {
  setCors(res)
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`)

    if (url.pathname === '/health') {
      return sendJson(res, 200, { ok: true, mode: 'pocket-leads-local-api', db: DB_PATH, leads: countStmt.get().n })
    }

    if (url.pathname === '/leads' && req.method === 'GET') {
      return sendJson(res, 200, listStmt.all().map(row => JSON.parse(row.data)))
    }

    if (url.pathname === '/leads/bulk' && req.method === 'POST') {
      const body = await readBody(req)
      const { leads } = JSON.parse(body)
      if (!Array.isArray(leads)) { sendJson(res, 400, { error: '"leads" must be an array' }); return }
      const n = replaceAll(leads)
      return sendJson(res, 200, { ok: true, count: n })
    }

    sendJson(res, 404, { error: `No route: ${req.method} ${url.pathname}` })
  } catch (err) {
    console.error(err)
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
  }
}).listen(PORT, () => {
  console.log(`Pocket Leads local API — http://localhost:${PORT}`)
  console.log(`DB: ${DB_PATH}`)
  console.log(`Leads: ${countStmt.get().n}`)
})

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}
