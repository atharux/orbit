import type { GraphData, GraphLink } from './types'
import { callOpenRouter } from '../services/orClient'
import { runReadCypher, isLiveConfigured } from './neo4jSource'

// "Ask the graph" — two engines:
//   PRESETS  run in-memory over GraphData (works offline, on sample/leads data).
//   askLive  turns free text into read-only Cypher via OpenRouter, runs it on
//            Aura, and returns the nodes to light up. Needs live Neo4j + a key.

export interface AskResult {
  answer: string
  nodeIds: string[]
  cypher?: string
}

export interface Preset {
  id: string
  q: string
  run: (g: GraphData) => AskResult
}

// --- small adjacency helpers ------------------------------------------------

function linksOfKind(g: GraphData, kind: GraphLink['kind']) {
  return g.links.filter(l => l.kind === kind)
}
function nodesOfKind(g: GraphData, kind: GraphData['nodes'][number]['kind']) {
  return g.nodes.filter(n => n.kind === kind)
}

// --- preset questions (mirror agent/queries.md) -----------------------------

export const PRESETS: Preset[] = [
  {
    id: 'unenrolled-verified',
    q: 'Verified contacts not in any sequence',
    run: g => {
      const enrolled = new Set(linksOfKind(g, 'ENROLLED_IN').map(l => l.source))
      const hits = nodesOfKind(g, 'contact').filter(c => c.verified && !enrolled.has(c.id))
      return {
        answer: hits.length
          ? `${hits.length} verified contact${hits.length === 1 ? '' : 's'} not yet enrolled in any sequence — warm leads you're sitting on.`
          : 'Every verified contact is already enrolled in a sequence.',
        nodeIds: hits.map(c => c.id),
      }
    },
  },
  {
    id: 'venues-no-verified-contact',
    q: 'Venues with no verified contact',
    run: g => {
      const worksAt = linksOfKind(g, 'WORKS_AT') // contact -> venue
      const verified = new Set(nodesOfKind(g, 'contact').filter(c => c.verified).map(c => c.id))
      const venuesWithVerified = new Set(worksAt.filter(l => verified.has(l.source)).map(l => l.target))
      const hits = nodesOfKind(g, 'venue').filter(v => !venuesWithVerified.has(v.id))
      return {
        answer: hits.length
          ? `${hits.length} venue${hits.length === 1 ? '' : 's'} have no verified contact yet — the whitespace to prospect next.`
          : 'Every venue has at least one verified contact.',
        nodeIds: hits.map(v => v.id),
      }
    },
  },
  {
    id: 'seq-multi-verified',
    q: 'Sequences hitting venues with 2+ verified contacts',
    run: g => {
      const worksAt = linksOfKind(g, 'WORKS_AT')
      const verified = new Set(nodesOfKind(g, 'contact').filter(c => c.verified).map(c => c.id))
      const verifiedPerVenue = new Map<string, number>()
      for (const l of worksAt) if (verified.has(l.source)) verifiedPerVenue.set(l.target, (verifiedPerVenue.get(l.target) ?? 0) + 1)
      const hitIds = new Set<string>()
      for (const l of linksOfKind(g, 'TARGETS')) { // seq -> venue
        if ((verifiedPerVenue.get(l.target) ?? 0) > 1) { hitIds.add(l.source); hitIds.add(l.target) }
      }
      const seqCount = [...hitIds].filter(id => id.startsWith('seq')).length
      return {
        answer: hitIds.size
          ? `Outreach is concentrated: sequences targeting ${seqCount ? seqCount + ' ' : ''}venue-clusters with more than one verified contact.`
          : 'No sequence currently targets a venue with more than one verified contact.',
        nodeIds: [...hitIds],
      }
    },
  },
  {
    id: 'venues-per-district',
    q: 'Venue count by district',
    run: g => {
      const byDistrict = new Map<string, number>()
      for (const v of nodesOfKind(g, 'venue')) {
        const d = v.district || 'unknown'
        byDistrict.set(d, (byDistrict.get(d) ?? 0) + 1)
      }
      const top = [...byDistrict.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
      return {
        answer: top.length
          ? 'Venues by district — ' + top.map(([d, n]) => `${d}: ${n}`).join(' · ')
          : 'No venue districts recorded.',
        nodeIds: nodesOfKind(g, 'venue').map(v => v.id),
      }
    },
  },
  {
    id: 'top-source',
    q: 'Which source verified the most contacts',
    run: g => {
      const verifiedBy = linksOfKind(g, 'VERIFIED_BY') // contact -> source
      const perSource = new Map<string, number>()
      for (const l of verifiedBy) perSource.set(l.target, (perSource.get(l.target) ?? 0) + 1)
      const top = [...perSource.entries()].sort((a, b) => b[1] - a[1])[0]
      if (!top) return { answer: 'No verified-by relationships in the graph yet.', nodeIds: [] }
      const [srcId, count] = top
      const label = g.nodes.find(n => n.id === srcId)?.label ?? srcId
      const contacts = verifiedBy.filter(l => l.target === srcId).map(l => l.source)
      return {
        answer: `${label} verified the most contacts (${count}).`,
        nodeIds: [srcId, ...contacts],
      }
    },
  },
  {
    id: 'no-website',
    q: 'Venues with no website',
    run: g => {
      const hits = nodesOfKind(g, 'venue').filter(v => !v.website)
      return {
        answer: hits.length
          ? `${hits.length} venue${hits.length === 1 ? '' : 's'} have no website on file — prime targets if you sell websites.`
          : 'Every venue has a website on file.',
        nodeIds: hits.map(v => v.id),
      }
    },
  },
  {
    id: 'targeted-no-contact',
    q: 'Venues targeted by a sequence but with zero contacts',
    run: g => {
      const targeted = new Set(linksOfKind(g, 'TARGETS').map(l => l.target))
      const hasContact = new Set(linksOfKind(g, 'WORKS_AT').map(l => l.target))
      const hits = nodesOfKind(g, 'venue').filter(v => targeted.has(v.id) && !hasContact.has(v.id))
      return {
        answer: hits.length
          ? `${hits.length} venue${hits.length === 1 ? '' : 's'} are in a sequence but have no contact attached — outreach with nobody to reach.`
          : 'Every targeted venue has at least one contact.',
        nodeIds: hits.map(v => v.id),
      }
    },
  },
]

// --- live free-text engine (NL -> Cypher -> Aura) ---------------------------

const SCHEMA_PROMPT = `You write a single read-only Cypher query for a Neo4j graph.
Schema:
  (:Venue {name, category, district})
  (:Contact {role, verified})
  (:Source {name})
  (:Sequence {name, status})
  (:Contact)-[:WORKS_AT]->(:Venue)
  (:Contact)-[:VERIFIED_BY]->(:Source)
  (:Contact)-[:ENROLLED_IN]->(:Sequence)
  (:Sequence)-[:TARGETS]->(:Venue)
Rules:
- READ ONLY. Never CREATE/MERGE/SET/DELETE/REMOVE/CALL {}/LOAD.
- Always RETURN the node(s) the question is about (not just counts) so they can be highlighted.
- Return ONLY the Cypher, no prose, no markdown fences.`

export function liveAvailable(apiKey?: string): boolean {
  return isLiveConfigured() && Boolean(apiKey)
}

const WRITE_RE = /\b(CREATE|MERGE|SET|DELETE|REMOVE|DROP|LOAD\s+CSV|CALL\s*\{)\b/i

export async function askLive(
  question: string,
  apiKey: string,
  model?: string,
): Promise<AskResult> {
  const { text } = await callOpenRouter({
    apiKey,
    model,
    appTitle: 'Orbit',
    temperature: 0,
    messages: [
      { role: 'system', content: SCHEMA_PROMPT },
      { role: 'user', content: question },
    ],
  })
  const cypher = text.replace(/```(?:cypher)?/gi, '').replace(/```/g, '').trim()
  if (!cypher) throw new Error('Model returned no query.')
  if (WRITE_RE.test(cypher)) throw new Error('Refused: generated query was not read-only.')
  const { summary, nodeIds } = await runReadCypher(cypher)
  return { answer: summary, nodeIds, cypher }
}

// --- local free-text engine (no Aura) ---------------------------------------
// Answers over the in-memory graph using just an OpenRouter key. The model gets
// a compact listing of nodes + edges and returns the ids that answer the
// question, which we light up. Capped so it stays within a small context.

const LOCAL_CAP = 1500

export function localAvailable(apiKey: string | undefined, g: GraphData | null): boolean {
  return Boolean(apiKey) && Boolean(g) && (g as GraphData).nodes.length <= LOCAL_CAP
}

export async function askLocal(
  question: string,
  g: GraphData,
  apiKey: string,
  model?: string,
): Promise<AskResult> {
  if (g.nodes.length > LOCAL_CAP) {
    throw new Error(`Graph too large for local answering (${g.nodes.length} nodes). Connect Aura for free-text at this scale.`)
  }
  const nodeLines = g.nodes.map(n =>
    `${n.id}\t${n.kind}\t${n.label}${n.verified ? '\t[verified]' : ''}${n.district ? '\t{' + n.district + '}' : ''}${n.kind === 'venue' && !n.website ? '\t[no-website]' : ''}`,
  )
  const edgeLines = g.links.map(l => `${l.source} -${l.kind}-> ${l.target}`)
  const prompt = `You answer a question about a small graph and return the node ids that answer it.
Node kinds: venue, contact, source, sequence.
Relationships: (contact)-WORKS_AT->(venue), (contact)-VERIFIED_BY->(source), (contact)-ENROLLED_IN->(sequence), (sequence)-TARGETS->(venue).

NODES (id, kind, label, flags):
${nodeLines.join('\n')}

EDGES:
${edgeLines.join('\n')}

Question: ${question}

Return ONLY minified JSON: {"answer":"<one short sentence>","ids":["<exact node id>", ...]}. Use only ids from the NODES list. If nothing matches, return an empty ids array.`

  const { text } = await callOpenRouter({
    apiKey, model, appTitle: 'Orbit', temperature: 0, maxTokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  })
  let obj: { answer?: string; ids?: string[] }
  try {
    const s = text.indexOf('{')
    const e = text.lastIndexOf('}')
    obj = JSON.parse(text.slice(s, e + 1))
  } catch {
    throw new Error('Could not read the model response. Try rephrasing.')
  }
  const known = new Set(g.nodes.map(n => n.id))
  const nodeIds = (Array.isArray(obj.ids) ? obj.ids : []).filter(id => known.has(id))
  return { answer: (obj.answer || '').trim() || `${nodeIds.length} matching node${nodeIds.length === 1 ? '' : 's'}`, nodeIds }
}
