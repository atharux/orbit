// Minimal, dependency-free CSV parser. Handles quoted fields, escaped quotes
// (""), commas inside quotes, and CRLF/LF line endings. Good enough for the
// hand-exported CSVs this importer stages.

export interface ParsedCsv {
  headers: string[]
  rows: string[][]
}

export function parseCsv(text: string): ParsedCsv {
  const s = text.replace(/\r\n?/g, '\n')
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false

  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ } // escaped quote
        else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = ''
    } else {
      field += c
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }

  const headers = (rows.shift() ?? []).map(h => h.trim())
  // Drop rows that are entirely empty.
  const body = rows.filter(r => r.some(cell => cell.trim() !== ''))
  return { headers, rows: body }
}
