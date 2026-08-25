// LinkedIn Sales Navigator / personal Connections CSV import — Constructor
// hackathon demo.
//
// SCHEMA DECISION (revised — this import now mints Company nodes, it used
// not to): a LinkedIn export contains NO relationship data between your
// connections — LinkedIn does not expose who-knows-who between them via
// export or API. So "interconnectedness" for a personal-network import
// (e.g. your own ~2000 connections) can only come from a real signal that
// IS in the CSV: shared employer. Each contact links to its Company via
// WORKS_AT — reusing an existing Venue on a case-insensitive name match
// (so a LinkedIn contact can land on a Company you already have as a
// trades/iOS-studios lead), otherwise minting a new one tagged
// vertical_id: 'linkedin'. A second pass then derives a direct
// COLLEAGUE_OF edge between any two imported contacts sharing a company —
// see Q_COLLEAGUES below. Placeholder employers ("Freelance",
// "Self-employed", ...) are skipped so they don't cluster hundreds of
// unrelated people onto one fake company.
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
// No dependency: a personal Connections export runs to low thousands of rows
// at most, well within what a single UNWIND write handles, and this is the
// only place we parse CSV.
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

// LinkedIn's own personal data export ("Connections.csv" from Settings & Privacy
// → Get a copy of your data — what a ~2000-contact personal import actually is,
// as opposed to a Sales Navigator list export) prepends a "Notes:" paragraph
// before the real header row. Scan for the first row that looks like a real
// header (matches at least 2 known aliases) instead of assuming row 1 is it —
// with a preamble present, row 1 would otherwise silently misparse every column.
function findHeaderRowIndex(table: string[][]): number {
  return table.findIndex(row => Object.keys(buildHeaderIndex(row)).length >= 2)
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

// Generic placeholder "employers" LinkedIn exports are full of — never worth
// minting a Venue for. Without this filter, every self-employed/freelance
// connection in a 2000-row export would MERGE onto one shared "Freelance"
// node and read as colleagues of hundreds of unrelated people.
const PLACEHOLDER_COMPANIES = new Set([
  'self-employed', 'freelance', 'freelancer', 'independent', 'independent consultant',
  'n/a', 'na', 'none', '-', 'unemployed', 'retired', 'student', 'stealth', 'stealth mode', 'confidential',
])

// Single query per row (via UNWIND) so the name-fallback match, the Contact
// MERGE, the Venue resolution, the WORKS_AT link, and the Source link all
// see the same resolved contact identity in one pass:
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
//     (or was unset). linkedin_url/industry/location use coalesce(new, old)
//     rather than a plain overwrite: a re-export where a profile went
//     blank/private must not erase a previously-good value with null.
//  3. Resolve the Venue: reuse an existing one on a case-insensitive name
//     match (within the same vertical, same wildcard as above) if there is
//     one — this is what lets a LinkedIn contact land on a Company you
//     already have as a trades/iOS-studios lead. Otherwise MINT a new Venue
//     named exactly as the CSV wrote it, tagged vertical_id: 'linkedin' only
//     ON CREATE (so it never overwrites an existing Venue's own vertical).
//     Placeholder employers (PLACEHOLDER_COMPANIES) are skipped entirely —
//     no Venue, no WORKS_AT — since they'd otherwise wrongly cluster
//     hundreds of unrelated freelancers under one node.
//  4. Tag provenance via a shared Source node, same pattern as syncToNeo4j.ts.
const Q_IMPORT = `
UNWIND $rows AS r
OPTIONAL MATCH (existing:Contact)-[:WORKS_AT]->(v0:Venue)
  WHERE r.matchByName AND r.company IS NOT NULL
    AND toLower(existing.name) = toLower(r.name) AND toLower(v0.name) = toLower(r.company)
    AND (v0.vertical_id IS NULL OR v0.vertical_id = '' OR toLower(v0.vertical_id) = toLower(r.verticalId))
    AND (existing.vertical_id IS NULL OR existing.vertical_id = '' OR toLower(existing.vertical_id) = toLower(r.verticalId))
WITH r, existing
ORDER BY existing.contact_id
// Two different real people can share a name at a same-named company (both
// wildcard-eligible) -- collapse any fan-out to one deterministic pick per
// row instead of writing this row's data onto every match.
WITH r, head(collect(existing)) AS existing
WITH r, coalesce(existing.contact_id, r.contactId) AS cid
MERGE (c:Contact {contact_id: cid})
  SET c.name = r.name, c.title = r.title, c.vertical_id = r.verticalId,
      c.linkedin_url = coalesce(r.linkedinUrl, c.linkedin_url),
      c.linkedin_industry = coalesce(r.linkedinIndustry, c.linkedin_industry),
      c.linkedin_location = coalesce(r.location, c.linkedin_location)
WITH c, r,
  r.company IS NOT NULL AND NOT toLower(r.company) IN $placeholderCompanies AS hasRealCompany
OPTIONAL MATCH (existingV:Venue)
  WHERE hasRealCompany AND toLower(existingV.name) = toLower(r.company)
    AND (existingV.vertical_id IS NULL OR existingV.vertical_id = '' OR toLower(existingV.vertical_id) = toLower(r.verticalId))
WITH c, r, hasRealCompany,
  CASE WHEN hasRealCompany THEN coalesce(existingV.name, r.company) END AS resolvedVenueName
FOREACH (_ IN CASE WHEN resolvedVenueName IS NOT NULL THEN [1] ELSE [] END |
  MERGE (v:Venue {name: resolvedVenueName})
    ON CREATE SET v.vertical_id = r.verticalId, v.source = 'linkedin-import'
  MERGE (c)-[:WORKS_AT]->(v)
)
WITH c, r, resolvedVenueName IS NOT NULL AS linked
MERGE (src:Source {name: 'linkedin-import'})
  SET src.imported_at = r.importedAt
MERGE (c)-[:VERIFIED_BY]->(src)
RETURN count(*) AS n, sum(CASE WHEN linked THEN 1 ELSE 0 END) AS linked`

// Run once after Q_IMPORT, over the whole vertical rather than per-row: any
// two LinkedIn-imported Contacts who share a WORKS_AT Venue get a direct
// COLLEAGUE_OF edge. This is the only "interconnectedness" signal a LinkedIn
// export actually contains — LinkedIn doesn't expose who-knows-who between
// your connections, so shared employer is the real proxy, not a literal
// connection graph. elementId(c1) < elementId(c2) keeps this to one edge per
// unordered pair; MERGE keeps re-imports idempotent.
const Q_COLLEAGUES = `
MATCH (c1:Contact)-[:WORKS_AT]->(v:Venue)<-[:WORKS_AT]-(c2:Contact)
WHERE c1.vertical_id = $verticalId AND c2.vertical_id = $verticalId
  AND elementId(c1) < elementId(c2)
MERGE (c1)-[:COLLEAGUE_OF]->(c2)
RETURN count(*) AS edgesCreated`

export interface ImportSummary {
  rowsInFile: number
  contactsUpserted: number
  venuesLinked: number // rows that matched or minted a Venue
  colleagueEdges: number // COLLEAGUE_OF edges created/confirmed across the whole vertical
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
  if (table.length === 0) return { rowsInFile: 0, contactsUpserted: 0, venuesLinked: 0, colleagueEdges: 0, skippedNoName: 0 }

  const headerIdx = findHeaderRowIndex(table)
  if (headerIdx === -1) {
    throw new Error(
      "Couldn't find a recognizable header row (name/company/URL columns) — " +
      'is this a LinkedIn export? If it has a "Notes:" preamble, that\'s expected and handled; ' +
      'if the column names are unusual, add them to HEADER_ALIASES.',
    )
  }
  const [headerRow, ...dataRows] = table.slice(headerIdx)
  const parsed = rowsToParsed(headerRow, dataRows)
  const importedAt = new Date().toISOString()
  const rows = parsed
    .map(p => toContactRow(p, verticalId, importedAt))
    .filter((r): r is ContactRow => r !== null)
  const skippedNoName = parsed.length - rows.length

  if (rows.length === 0) {
    return { rowsInFile: parsed.length, contactsUpserted: 0, venuesLinked: 0, colleagueEdges: 0, skippedNoName }
  }

  const { driver, database } = envDriver()
  const session = driver.session({ database })
  try {
    const result = await session.executeWrite(tx =>
      tx.run(Q_IMPORT, { rows, placeholderCompanies: [...PLACEHOLDER_COMPANIES] }),
    )
    const linked = result.records.reduce((sum, rec) => sum + Number(rec.get('linked')), 0)
    const colleagues = await session.executeWrite(tx => tx.run(Q_COLLEAGUES, { verticalId }))
    const colleagueEdges = Number(colleagues.records[0]?.get('edgesCreated') ?? 0)
    return { rowsInFile: parsed.length, contactsUpserted: rows.length, venuesLinked: linked, colleagueEdges, skippedNoName }
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
      console.log(`  linked to a company: ${summary.venuesLinked} (existing match, or newly created)`)
      console.log(`  colleague edges:     ${summary.colleagueEdges} (contacts sharing a company)`)
      console.log(`  skipped (no name):   ${summary.skippedNoName}`)
    })
    .catch(err => { console.error(err); process.exit(1) })
}
