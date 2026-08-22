// LinkedIn Sales Navigator CSV import — Constructor hackathon demo.
//
// IMPORTANT (schema decision, agreed with the user before writing this):
// the graph already has a Contact -[:WORKS_AT]-> Venue pair per trades business
// (see syncToNeo4j.ts). A LinkedIn import must NOT spawn a third node — no new
// Venue/Company node is ever created here. LinkedIn data lands as properties on
// the existing Contact node (or a new Contact, if this person truly isn't in the
// graph yet), keyed primarily by LinkedIn profile URL. WORKS_AT is only added
// when an existing Venue's name exactly matches the CSV's company column — no
// fuzzy/domain matching, no Venue creation, ever.
//
// Run directly (Node 22+, native TS support — no build step):
//   node --env-file=.env src/graph/linkedinImport.ts <path-to.csv> <verticalId>
// (uses NEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORD / NEO4J_DATABASE — the same
// unprefixed vars scripts/load_graph.py uses, not the browser's VITE_NEO4J_*.)

import neo4j from 'neo4j-driver-lite'
import { readFile } from 'node:fs/promises'
import { BUILT_IN_VERTICALS } from '../verticals.ts'

// ---------------------------------------------------------------------------
// CSV parsing — RFC4180-ish (quoted fields, embedded commas/quotes/newlines).
// No dependency: Sales Nav exports are small (a few hundred rows at most for
// a hackathon list) and this is the only place we parse CSV.
// ---------------------------------------------------------------------------

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const pushField = () => { row.push(field); field = '' }
  const pushRow = () => { pushField(); rows.push(row); row = [] }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      pushField()
    } else if (ch === '\n') {
      pushRow()
    } else if (ch === '\r') {
      // swallow — \r\n handled by the following \n
    } else {
      field += ch
    }
  }
  // last row (file may or may not end with a newline)
  if (field.length > 0 || row.length > 0) pushRow()
  return rows.filter(r => !(r.length === 1 && r[0] === ''))
}

// ---------------------------------------------------------------------------
// Header mapping — Sales Nav's own export column names drift by account/region,
// so match by a list of accepted aliases (case/space-insensitive) rather than
// one hardcoded header string per field.
// ---------------------------------------------------------------------------

const HEADER_ALIASES: Record<string, string[]> = {
  fullName: ['full name', 'name'],
  firstName: ['first name'],
  lastName: ['last name'],
  title: ['title', 'position', 'headline', 'job title', 'current position'],
  company: ['company', 'current company', 'account name', 'company name'],
  profileUrl: ['profile url', 'linkedin profile', 'profile link', 'linkedin url', 'url'],
  location: ['location', 'geography', 'region'],
  industry: ['industry'],
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ')
}

function buildHeaderIndex(headerRow: string[]): Partial<Record<keyof typeof HEADER_ALIASES, number>> {
  const normalized = headerRow.map(normalizeHeader)
  const index: Partial<Record<keyof typeof HEADER_ALIASES, number>> = {}
  for (const key of Object.keys(HEADER_ALIASES) as (keyof typeof HEADER_ALIASES)[]) {
    const aliases = HEADER_ALIASES[key]
    const col = normalized.findIndex(h => aliases.includes(h))
    if (col !== -1) index[key] = col
  }
  return index
}

interface ParsedRow {
  fullName: string
  title: string
  company: string
  profileUrl: string
  location: string
  industry: string
}

function rowsToParsed(headerRow: string[], dataRows: string[][]): ParsedRow[] {
  const idx = buildHeaderIndex(headerRow)
  const get = (row: string[], key: keyof typeof HEADER_ALIASES) =>
    idx[key] !== undefined ? (row[idx[key]!] ?? '').trim() : ''

  return dataRows.map(row => {
    const first = get(row, 'firstName')
    const last = get(row, 'lastName')
    const combinedName = [first, last].filter(Boolean).join(' ')
    return {
      fullName: get(row, 'fullName') || combinedName,
      title: get(row, 'title'),
      company: get(row, 'company'),
      profileUrl: get(row, 'profileUrl'),
      location: get(row, 'location'),
      industry: get(row, 'industry'),
    }
  })
}

// ---------------------------------------------------------------------------
// Identity keys
// ---------------------------------------------------------------------------

function slugify(s: string): string {
  return s
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // decompose + strip diacritics, not just drop them
    .trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// LinkedIn profile URLs vary (query params, trailing slash, locale subdomain);
// the "/in/<vanity-slug>" segment is the stable identity. A cell that isn't a
// real profile URL (blank, "N/A", "Private profile", ...) must NOT fall back
// to being used as an identity key — every row with the same placeholder text
// would otherwise collide onto a single Contact node.
function normalizeProfileUrl(url: string): string | null {
  const m = /\/in\/([^/?#]+)/i.exec(url)
  return m ? m[1].toLowerCase() : null
}

interface ContactRow {
  contactId: string
  matchByName: boolean // true when no profile URL — attempt name+company fallback match
  name: string
  title: string
  company: string | null
  linkedinUrl: string | null
  linkedinIndustry: string | null
  location: string | null
  verticalId: string
  importedAt: string
}

function toContactRow(p: ParsedRow, verticalId: string, importedAt: string): ContactRow | null {
  if (!p.fullName) return null // nothing to key or display — skip
  const urlSlug = p.profileUrl ? normalizeProfileUrl(p.profileUrl) : null
  // No profile URL: fall back to a composite key. Name+company alone collides
  // for two different people sharing a name with no company on the row (e.g.
  // two blank-company "John Smith" rows) — location/title narrow that, and
  // staying deterministic (no random/row-index component) keeps re-imports
  // of the same CSV idempotent rather than minting a fresh node every run.
  const contactId = urlSlug
    ? `contact:li:${urlSlug}`
    : `contact:li:name:${slugify([p.fullName, p.company, p.location, p.title].filter(Boolean).join('|'))}`
  return {
    contactId,
    matchByName: !urlSlug,
    name: p.fullName,
    title: p.title,
    company: p.company || null,
    linkedinUrl: p.profileUrl || null,
    linkedinIndustry: p.industry || null,
    location: p.location || null,
    verticalId,
    importedAt,
  }
}

// ---------------------------------------------------------------------------
// Neo4j write
// ---------------------------------------------------------------------------

// Single query per row (via UNWIND) so the name-fallback match, the Contact
// MERGE, the optional WORKS_AT link, and the Source link all see the same
// resolved contact identity in one pass:
//
//  1. If this row has no LinkedIn URL, look for an existing Contact with the
//     same name already WORKS_AT a same-named Venue IN THE SAME VERTICAL —
//     reuse its contact_id instead of minting a new node (best-effort
//     de-dup; current Contact nodes carry no name today, so this mostly
//     matches future LinkedIn-sourced contacts re-imported without a URL,
//     which is fine). Scoped by vertical_id so two same-named businesses in
//     different verticals never merge into one contact -- but treated as a
//     wildcard when vertical_id is missing OR empty, since neither of this
//     repo's other two write paths sets a real value on every node:
//     scripts/load_graph.py never sets vertical_id on Venue at all (so it's
//     absent/null there), and syncToNeo4j.ts sets it to '' for any lead
//     with no vertical tag (see `l.vertical_id || ''`) rather than leaving
//     it unset. A strict equality check -- or a null-only wildcard -- would
//     silently stop matching most of the real seeded graph. Comparison is
//     also case-insensitive, since a value written by an earlier, differently
//     -cased run of this same script must still count as a match.
//  2. MERGE the Contact by the resolved id, set LinkedIn-sourced properties.
//     vertical_id is safe to (re)set unconditionally here because step 1
//     only ever matches an existing contact whose vertical already agrees
//     (or was unset).
//  3. Link to an existing Venue ONLY on an exact case-insensitive name match
//     within the same vertical (same missing-or-empty vertical_id wildcard
//     as above). Never create a Venue — OPTIONAL MATCH can't create, so
//     this is safe by construction, not just by convention.
//  4. Tag provenance via a shared Source node, same pattern as syncToNeo4j.ts.
const Q_IMPORT = `
UNWIND $rows AS r
OPTIONAL MATCH (existing:Contact)-[:WORKS_AT]->(v0:Venue)
  WHERE r.matchByName AND r.company IS NOT NULL
    AND toLower(existing.name) = toLower(r.name) AND toLower(v0.name) = toLower(r.company)
    AND (v0.vertical_id IS NULL OR v0.vertical_id = '' OR toLower(v0.vertical_id) = toLower(r.verticalId))
    AND (existing.vertical_id IS NULL OR existing.vertical_id = '' OR toLower(existing.vertical_id) = toLower(r.verticalId))
WITH r, coalesce(existing.contact_id, r.contactId) AS cid
MERGE (c:Contact {contact_id: cid})
  SET c.name = r.name, c.title = r.title,
      c.linkedin_url = r.linkedinUrl, c.linkedin_industry = r.linkedinIndustry,
      c.linkedin_location = r.location, c.vertical_id = r.verticalId
WITH c, r
OPTIONAL MATCH (v:Venue)
  WHERE r.company IS NOT NULL AND toLower(v.name) = toLower(r.company)
    AND (v.vertical_id IS NULL OR v.vertical_id = '' OR toLower(v.vertical_id) = toLower(r.verticalId))
FOREACH (_ IN CASE WHEN v IS NOT NULL THEN [1] ELSE [] END | MERGE (c)-[:WORKS_AT]->(v))
WITH c, r, v
MERGE (src:Source {name: 'linkedin-import'})
  SET src.imported_at = r.importedAt
MERGE (c)-[:VERIFIED_BY]->(src)
RETURN count(*) AS n, count(v) AS linked`

export interface ImportSummary {
  rowsInFile: number
  contactsUpserted: number
  venuesLinked: number // rows that matched an existing Venue by exact name
  skippedNoName: number
}

function envDriver() {
  const URI = process.env.NEO4J_URI
  const USER = process.env.NEO4J_USERNAME
  const PASS = process.env.NEO4J_PASSWORD
  const DB = process.env.NEO4J_DATABASE || 'neo4j'
  if (!URI || !USER || !PASS) {
    throw new Error('Missing NEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORD env vars (run with --env-file=.env)')
  }
  return { driver: neo4j.driver(URI, neo4j.auth.basic(USER, PASS)), database: DB }
}

export async function importLinkedInCsv(filePath: string, verticalId: string): Promise<ImportSummary> {
  const text = await readFile(filePath, 'utf8')
  const table = parseCsv(text)
  if (table.length === 0) return { rowsInFile: 0, contactsUpserted: 0, venuesLinked: 0, skippedNoName: 0 }

  const [headerRow, ...dataRows] = table
  const parsed = rowsToParsed(headerRow, dataRows)
  const importedAt = new Date().toISOString()
  const rows = parsed
    .map(p => toContactRow(p, verticalId, importedAt))
    .filter((r): r is ContactRow => r !== null)
  const skippedNoName = parsed.length - rows.length

  if (rows.length === 0) {
    return { rowsInFile: parsed.length, contactsUpserted: 0, venuesLinked: 0, skippedNoName }
  }

  const { driver, database } = envDriver()
  const session = driver.session({ database })
  try {
    const result = await session.executeWrite(tx => tx.run(Q_IMPORT, { rows }))
    const linked = result.records.reduce((sum, rec) => sum + Number(rec.get('linked')), 0)
    return { rowsInFile: parsed.length, contactsUpserted: rows.length, venuesLinked: linked, skippedNoName }
  } finally {
    await session.close()
    await driver.close()
  }
}

// CLI entry point: `node --env-file=.env src/graph/linkedinImport.ts <csv> <verticalId>`
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , csvPath, rawVerticalId] = process.argv
  if (!csvPath || !rawVerticalId) {
    console.error('usage: node --env-file=.env src/graph/linkedinImport.ts <path-to.csv> <verticalId>')
    process.exit(1)
  }
  // Cypher `=` is case-sensitive and verticalId flows straight into the
  // query -- normalize so 'Trades' (what the UI displays) works the same
  // as the actual id 'trades'. A custom vertical the user added in-app
  // won't be in BUILT_IN_VERTICALS, so an unrecognized id only warns.
  const verticalId = rawVerticalId.trim().toLowerCase()
  if (!BUILT_IN_VERTICALS.some(v => v.id === verticalId)) {
    console.warn(
      `Warning: '${verticalId}' isn't a built-in vertical id (${BUILT_IN_VERTICALS.map(v => v.id).join(', ')}). ` +
      `Proceeding -- fine if this is a custom vertical you added in the app, otherwise check for a typo.`,
    )
  }
  importLinkedInCsv(csvPath, verticalId)
    .then(summary => {
      console.log(`\nLinkedIn import: ${csvPath}`)
      console.log(`  rows in file:        ${summary.rowsInFile}`)
      console.log(`  contacts upserted:   ${summary.contactsUpserted}`)
      console.log(`  linked to a venue:   ${summary.venuesLinked} (exact name match only)`)
      console.log(`  skipped (no name):   ${summary.skippedNoName}`)
    })
    .catch(err => { console.error(err); process.exit(1) })
}
