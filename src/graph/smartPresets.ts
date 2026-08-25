// Studies the live Aura shape of a single vertical (node/relationship counts,
// property coverage, a few real sample names) and asks an LLM to propose a
// small catalog of grounded, read-only questions for it -- automatically,
// the first time GraphOverlay sees that vertical's data live, for ANY
// vertical (not hand-written per vertical the way verticalPresets() in
// ask.ts is). Generated questions are cached in localStorage per vertical id
// so this only runs once per vertical, not on every graph load.
//
// Deliberately generates QUESTIONS, not Cypher: the existing askLive()
// pipeline (NL -> LLM -> Cypher -> runReadCypher, see ask.ts) already turns
// a question into a live, validated, read-only query and highlights the
// result. Storing Cypher here too would mean two independently-drifting
// code paths for the exact same job; a generated preset instead just feeds
// its question text through the same pipeline a typed question would use
// (see GraphOverlay.tsx's runPreset() -> isSmart branch).

import type { Vertical } from '../types'
import { runReadRows } from './neo4jSource'
import { generateJSON } from '../services/orClient'

export interface SmartPreset {
  id: string
  q: string
}

const STORAGE_PREFIX = 'orbit:smart-presets:'

function storageKey(verticalId: string): string {
  return `${STORAGE_PREFIX}${verticalId}`
}

export function loadSmartPresets(verticalId: string): SmartPreset[] {
  try {
    const raw = localStorage.getItem(storageKey(verticalId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveSmartPresets(verticalId: string, presets: SmartPreset[]): void {
  try {
    localStorage.setItem(storageKey(verticalId), JSON.stringify(presets))
  } catch (err) {
    console.warn('Failed to save smart presets', err)
  }
}

// Compact, plain-text schema profile for one vertical -- counts and property
// coverage only, never raw contact/company rows beyond a handful of names
// for grounding (same data already visible on-screen in the graph itself).
async function profileVertical(verticalId: string): Promise<string> {
  const [labelCounts, relCounts, propCoverage, samples] = await Promise.all([
    runReadRows(`MATCH (n) WHERE n.vertical_id = $vid RETURN labels(n)[0] AS label, count(n) AS n`, { vid: verticalId }),
    runReadRows(
      `MATCH (a)-[r]->(b) WHERE a.vertical_id = $vid OR b.vertical_id = $vid RETURN type(r) AS rel, count(r) AS n`,
      { vid: verticalId },
    ),
    runReadRows(
      `MATCH (n) WHERE n.vertical_id = $vid UNWIND keys(n) AS k
       RETURN labels(n)[0] AS label, k AS prop, count(n) AS withProp ORDER BY label, withProp DESC`,
      { vid: verticalId },
    ),
    runReadRows(
      `MATCH (n) WHERE n.vertical_id = $vid AND n.name IS NOT NULL
       WITH labels(n)[0] AS label, n.name AS name
       WITH label, collect(DISTINCT name)[0..5] AS names
       RETURN label, names`,
      { vid: verticalId },
    ),
  ])

  const lines: string[] = []
  lines.push(`Node counts: ${labelCounts.map(r => `${r.label} ${r.n}`).join(', ') || 'none'}`)
  lines.push(`Relationship counts: ${relCounts.map(r => `${r.rel} ${r.n}`).join(', ') || 'none'}`)
  const byLabel = new Map<string, string[]>()
  for (const r of propCoverage) {
    const list = byLabel.get(r.label) ?? []
    list.push(`${r.prop} ${r.withProp}`)
    byLabel.set(r.label, list)
  }
  for (const [label, props] of byLabel) lines.push(`${label} property coverage: ${props.join(', ')}`)
  for (const r of samples) lines.push(`Sample ${r.label} names: ${(r.names as string[]).join(', ')}`)
  return lines.join('\n')
}

const SMART_PRESET_SCHEMA_NOTE = `
Graph schema reminder (only relationships that actually connect these labels):
  (:Contact)-[:WORKS_AT]->(:Venue)
  (:Contact)-[:VERIFIED_BY]->(:Source)
  (:Contact)-[:ENROLLED_IN]->(:Sequence)
  (:Sequence)-[:TARGETS]->(:Venue)
  (:Contact)-[:COLLEAGUE_OF]->(:Contact)`

export async function generateSmartPresets(
  vertical: Vertical,
  apiKey: string,
  model?: string,
): Promise<SmartPreset[]> {
  const profile = await profileVertical(vertical.id)
  const prompt = `You design a small catalog of useful natural-language questions for a graph-exploration UI, scoped to ONE data vertical.

Vertical: "${vertical.name}" (vertical_id: "${vertical.id}")
Live data profile, from the real database right now:
${profile}
${SMART_PRESET_SCHEMA_NOTE}

Propose up to 4 genuinely useful questions someone exploring THIS vertical's data would want to ask. Ground every question in what the profile above actually shows -- never ask about a relationship type or property with a count of 0, and never invent a property that isn't listed. Each question must be answerable by a single read-only Cypher query in principle (you are NOT writing the Cypher, just the question).

Return ONLY a JSON array, no prose, no markdown fences:
[{"q": "short natural-language question"}, ...]`

  const raw = await generateJSON({ apiKey, model, prompt, appTitle: 'Orbit', temperature: 0.3 })
  const seen = new Set<string>()
  const presets: SmartPreset[] = []
  for (const item of raw) {
    const q = typeof item?.q === 'string' ? item.q.trim() : ''
    if (!q || seen.has(q.toLowerCase())) continue
    seen.add(q.toLowerCase())
    presets.push({ id: `smart:${vertical.id}:${presets.length}`, q })
    if (presets.length >= 4) break
  }
  saveSmartPresets(vertical.id, presets)
  return presets
}
