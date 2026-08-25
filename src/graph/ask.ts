import type { GraphData, GraphLink } from './types'
import type { Vertical } from '../types'
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
  category: string
  verticalId?: string // set only for vertical-scoped presets — undefined means generic
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
    category: 'Verification',
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
    q: 'Companies with no verified contact',
    category: 'Coverage',
    run: g => {
      const worksAt = linksOfKind(g, 'WORKS_AT') // contact -> venue
      const verified = new Set(nodesOfKind(g, 'contact').filter(c => c.verified).map(c => c.id))
      const venuesWithVerified = new Set(worksAt.filter(l => verified.has(l.source)).map(l => l.target))
      const hits = nodesOfKind(g, 'venue').filter(v => !venuesWithVerified.has(v.id))
      return {
        answer: hits.length
          ? `${hits.length} ${hits.length === 1 ? 'company has' : 'companies have'} no verified contact yet — the whitespace to prospect next.`
          : 'Every company has at least one verified contact.',
        nodeIds: hits.map(v => v.id),
      }
    },
  },
  {
    id: 'seq-multi-verified',
    q: 'Sequences hitting companies with 2+ verified contacts',
    category: 'Outreach',
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
          ? `Outreach is concentrated: sequences targeting ${seqCount ? seqCount + ' ' : ''}company-clusters with more than one verified contact.`
          : 'No sequence currently targets a company with more than one verified contact.',
        nodeIds: [...hitIds],
      }
    },
  },
  {
    id: 'venues-per-district',
    q: 'Company count by district',
    category: 'Structure',
    run: g => {
      const byDistrict = new Map<string, number>()
      for (const v of nodesOfKind(g, 'venue')) {
        const d = v.district || 'unknown'
        byDistrict.set(d, (byDistrict.get(d) ?? 0) + 1)
      }
      const top = [...byDistrict.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
      return {
        answer: top.length
          ? 'Companies by district — ' + top.map(([d, n]) => `${d}: ${n}`).join(' · ')
          : 'No company districts recorded.',
        nodeIds: nodesOfKind(g, 'venue').map(v => v.id),
      }
    },
  },
  {
    id: 'top-source',
    q: 'Which source verified the most contacts',
    category: 'Verification',
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
    q: 'Companies with no website',
    category: 'Coverage',
    run: g => {
      const hits = nodesOfKind(g, 'venue').filter(v => !v.website)
      return {
        answer: hits.length
          ? `${hits.length} ${hits.length === 1 ? 'company has' : 'companies have'} no website on file — prime targets if you sell websites.`
          : 'Every company has a website on file.',
        nodeIds: hits.map(v => v.id),
      }
    },
  },
  {
    id: 'targeted-no-contact',
    q: 'Companies targeted by a sequence but with zero contacts',
    category: 'Coverage',
    run: g => {
      const targeted = new Set(linksOfKind(g, 'TARGETS').map(l => l.target))
      const hasContact = new Set(linksOfKind(g, 'WORKS_AT').map(l => l.target))
      const hits = nodesOfKind(g, 'venue').filter(v => targeted.has(v.id) && !hasContact.has(v.id))
      return {
        answer: hits.length
          ? `${hits.length} ${hits.length === 1 ? 'company is' : 'companies are'} in a sequence but have no contact attached — outreach with nobody to reach.`
          : 'Every targeted company has at least one contact.',
        nodeIds: hits.map(v => v.id),
      }
    },
  },
  {
    id: 'most-connected',
    q: 'Most-connected companies (degree centrality)',
    category: 'Structure',
    run: g => {
      // Degree = WORKS_AT (contact->venue) + TARGETS (sequence->venue) edges touching the venue.
      const degree = new Map<string, number>()
      for (const l of g.links) {
        if (l.kind === 'WORKS_AT' || l.kind === 'TARGETS') degree.set(l.target, (degree.get(l.target) ?? 0) + 1)
      }
      const top = [...degree.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      if (!top.length) return { answer: 'No company connections yet.', nodeIds: [] }
      const labelOf = (id: string) => g.nodes.find(n => n.id === id)?.label ?? id
      return {
        answer: 'Best-connected companies — ' + top.map(([id, n]) => `${labelOf(id)} (${n})`).join(' · '),
        nodeIds: top.map(([id]) => id),
      }
    },
  },
  {
    id: 'no-contact-at-all',
    q: 'Companies with no contact at all',
    category: 'Coverage',
    run: g => {
      const hasContact = new Set(linksOfKind(g, 'WORKS_AT').map(l => l.target))
      const hits = nodesOfKind(g, 'venue').filter(v => !hasContact.has(v.id))
      return {
        answer: hits.length
          ? `${hits.length} ${hits.length === 1 ? 'company has' : 'companies have'} no contact on file at all — not even an unverified one.`
          : 'Every company has at least one contact on file.',
        nodeIds: hits.map(v => v.id),
      }
    },
  },
  {
    id: 'districts-no-verified',
    q: 'Districts with zero verified contacts',
    category: 'Coverage',
    run: g => {
      const worksAt = linksOfKind(g, 'WORKS_AT') // contact -> venue
      const verified = new Set(nodesOfKind(g, 'contact').filter(c => c.verified).map(c => c.id))
      const venueById = new Map(nodesOfKind(g, 'venue').map(v => [v.id, v]))
      const verifiedDistricts = new Set<string>()
      for (const l of worksAt) {
        if (!verified.has(l.source)) continue
        const d = venueById.get(l.target)?.district
        if (d) verifiedDistricts.add(d)
      }
      const allDistricts = new Set(nodesOfKind(g, 'venue').map(v => v.district).filter((d): d is string => Boolean(d)))
      const hits = [...allDistricts].filter(d => !verifiedDistricts.has(d))
      const hitVenues = nodesOfKind(g, 'venue').filter(v => v.district && hits.includes(v.district))
      return {
        answer: hits.length
          ? `${hits.length} district${hits.length === 1 ? '' : 's'} with no verified contact yet — ${hits.join(', ')}.`
          : 'Every district with companies has at least one verified contact.',
        nodeIds: hitVenues.map(v => v.id),
      }
    },
  },
  {
    id: 'unverified-contacts',
    q: 'Contacts not yet verified',
    category: 'Verification',
    run: g => {
      const hits = nodesOfKind(g, 'contact').filter(c => !c.verified)
      return {
        answer: hits.length
          ? `${hits.length} contact${hits.length === 1 ? '' : 's'} still unverified.`
          : 'Every contact on file is verified.',
        nodeIds: hits.map(c => c.id),
      }
    },
  },
  {
    id: 'multi-source-verified',
    q: 'Contacts verified by more than one source',
    category: 'Verification',
    run: g => {
      const verifiedBy = linksOfKind(g, 'VERIFIED_BY') // contact -> source
      const perContact = new Map<string, number>()
      for (const l of verifiedBy) perContact.set(l.source, (perContact.get(l.source) ?? 0) + 1)
      const hitIds = [...perContact.entries()].filter(([, n]) => n > 1).map(([id]) => id)
      return {
        answer: hitIds.length
          ? `${hitIds.length} contact${hitIds.length === 1 ? '' : 's'} independently verified by more than one source — your highest-confidence leads.`
          : 'No contact is currently verified by more than one source.',
        nodeIds: hitIds,
      }
    },
  },
  {
    id: 'source-coverage',
    q: 'Companies each source has touched',
    category: 'Verification',
    run: g => {
      const verifiedBy = linksOfKind(g, 'VERIFIED_BY') // contact -> source
      const worksAt = new Map(linksOfKind(g, 'WORKS_AT').map(l => [l.source, l.target])) // contact -> venue
      const perSource = new Map<string, Set<string>>()
      for (const l of verifiedBy) {
        const venueId = worksAt.get(l.source)
        if (!venueId) continue
        if (!perSource.has(l.target)) perSource.set(l.target, new Set())
        perSource.get(l.target)!.add(venueId)
      }
      const top = [...perSource.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 5)
      if (!top.length) return { answer: 'No source has reached a company yet.', nodeIds: [] }
      const labelOf = (id: string) => g.nodes.find(n => n.id === id)?.label ?? id
      return {
        answer: 'Companies reached per source — ' + top.map(([id, venues]) => `${labelOf(id)} (${venues.size})`).join(' · '),
        nodeIds: top.flatMap(([id, venues]) => [id, ...venues]),
      }
    },
  },
  {
    id: 'dead-sequences',
    q: 'Sequences with no enrolled contacts',
    category: 'Outreach',
    run: g => {
      const enrolledSeqs = new Set(linksOfKind(g, 'ENROLLED_IN').map(l => l.target))
      const hits = nodesOfKind(g, 'sequence').filter(s => !enrolledSeqs.has(s.id))
      return {
        answer: hits.length
          ? `${hits.length} sequence${hits.length === 1 ? '' : 's'} with nobody enrolled — live but empty.`
          : 'Every sequence has at least one enrolled contact.',
        nodeIds: hits.map(s => s.id),
      }
    },
  },
  {
    id: 'top-sequence',
    q: 'Sequence with the most enrolled contacts',
    category: 'Outreach',
    run: g => {
      const enrolled = linksOfKind(g, 'ENROLLED_IN') // contact -> sequence
      const perSeq = new Map<string, number>()
      for (const l of enrolled) perSeq.set(l.target, (perSeq.get(l.target) ?? 0) + 1)
      const top = [...perSeq.entries()].sort((a, b) => b[1] - a[1])[0]
      if (!top) return { answer: 'No sequence has any contacts enrolled yet.', nodeIds: [] }
      const [seqId, count] = top
      const label = g.nodes.find(n => n.id === seqId)?.label ?? seqId
      const contacts = enrolled.filter(l => l.target === seqId).map(l => l.source)
      return {
        answer: `${label} has the most contacts enrolled (${count}).`,
        nodeIds: [seqId, ...contacts],
      }
    },
  },
  {
    id: 'multi-sequence-venues',
    q: 'Companies targeted by more than one sequence',
    category: 'Outreach',
    run: g => {
      const targets = linksOfKind(g, 'TARGETS') // sequence -> venue
      const perVenue = new Map<string, Set<string>>()
      for (const l of targets) {
        if (!perVenue.has(l.target)) perVenue.set(l.target, new Set())
        perVenue.get(l.target)!.add(l.source)
      }
      const hits = [...perVenue.entries()].filter(([, seqs]) => seqs.size > 1)
      return {
        answer: hits.length
          ? `${hits.length} ${hits.length === 1 ? 'company is' : 'companies are'} targeted by more than one sequence — possible outreach overlap.`
          : 'No company is targeted by more than one sequence.',
        nodeIds: hits.flatMap(([venueId, seqs]) => [venueId, ...seqs]),
      }
    },
  },
  {
    id: 'enrolled-not-verified',
    q: 'Contacts enrolled in a sequence but never verified',
    category: 'Outreach',
    run: g => {
      const enrolledIds = new Set(linksOfKind(g, 'ENROLLED_IN').map(l => l.source))
      const hits = nodesOfKind(g, 'contact').filter(c => enrolledIds.has(c.id) && !c.verified)
      return {
        answer: hits.length
          ? `${hits.length} contact${hits.length === 1 ? '' : 's'} in an active sequence but never verified — outreach running on an unconfirmed lead.`
          : 'Every enrolled contact is verified.',
        nodeIds: hits.map(c => c.id),
      }
    },
  },
  {
    id: 'isolated-nodes',
    q: 'Nodes with no connections at all',
    category: 'Structure',
    run: g => {
      const touched = new Set<string>()
      for (const l of g.links) { touched.add(l.source); touched.add(l.target) }
      const hits = g.nodes.filter(n => !touched.has(n.id))
      return {
        answer: hits.length
          ? `${hits.length} node${hits.length === 1 ? '' : 's'} completely disconnected from the rest of the graph.`
          : 'Every node has at least one connection.',
        nodeIds: hits.map(n => n.id),
      }
    },
  },
  {
    id: 'contacts-per-venue',
    q: 'Companies with the most verified contacts',
    category: 'Structure',
    run: g => {
      const worksAt = linksOfKind(g, 'WORKS_AT') // contact -> venue
      const verified = new Set(nodesOfKind(g, 'contact').filter(c => c.verified).map(c => c.id))
      const perVenue = new Map<string, number>()
      for (const l of worksAt) if (verified.has(l.source)) perVenue.set(l.target, (perVenue.get(l.target) ?? 0) + 1)
      const top = [...perVenue.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      if (!top.length) return { answer: 'No company has a verified contact yet.', nodeIds: [] }
      const labelOf = (id: string) => g.nodes.find(n => n.id === id)?.label ?? id
      return {
        answer: 'Most verified contacts — ' + top.map(([id, n]) => `${labelOf(id)} (${n})`).join(' · '),
        nodeIds: top.map(([id]) => id),
      }
    },
  },
]

// --- vertical-scoped questions ----------------------------------------------
// Same shape as PRESETS, but filtered to one vertical's venues/contacts. Built
// from a Vertical rather than hardcoded so custom verticals get scoped
// questions for free, no extra wiring needed.

export function verticalPresets(v: Vertical): Preset[] {
  const inVertical = (n: { verticalId?: string }) => n.verticalId === v.id

  // LinkedIn Connections never creates Venue nodes — linkedinImport.ts only
  // ever tags Contact nodes with vertical_id 'linkedin' (WORKS_AT links to an
  // existing Venue only on an exact name match; no Venue is ever minted). The
  // generic company-scoped presets below would silently return "Every ...
  // company has ..." over zero companies — read as full coverage rather than
  // "there are no companies here at all" — so this vertical gets its own
  // contact-scoped presets instead.
  if (v.id === 'linkedin') {
    return [
      {
        id: 'v-linkedin-unverified',
        q: 'LinkedIn connections not yet verified',
        category: v.name,
        verticalId: v.id,
        run: g => {
          const hits = nodesOfKind(g, 'contact').filter(inVertical).filter(c => !c.verified)
          return {
            answer: hits.length
              ? `${hits.length} LinkedIn ${hits.length === 1 ? 'connection is' : 'connections are'} not yet verified.`
              : 'Every imported LinkedIn connection is verified.',
            nodeIds: hits.map(c => c.id),
          }
        },
      },
      {
        id: 'v-linkedin-matched-company',
        q: 'LinkedIn connections matched to an existing company',
        category: v.name,
        verticalId: v.id,
        run: g => {
          const linked = new Set(linksOfKind(g, 'WORKS_AT').map(l => l.source))
          const contacts = nodesOfKind(g, 'contact').filter(inVertical)
          const hits = contacts.filter(c => linked.has(c.id))
          return {
            answer: contacts.length
              ? `${hits.length} of ${contacts.length} LinkedIn ${contacts.length === 1 ? 'connection' : 'connections'} matched to an existing company by name.`
              : 'No LinkedIn connections imported yet.',
            nodeIds: hits.map(c => c.id),
          }
        },
      },
    ]
  }

  const presets: Preset[] = [
    {
      id: `v-${v.id}-no-verified`,
      q: `${v.name} companies with no verified contact`,
      category: v.name,
      verticalId: v.id,
      run: g => {
        const worksAt = linksOfKind(g, 'WORKS_AT') // contact -> venue
        const verified = new Set(nodesOfKind(g, 'contact').filter(c => c.verified).map(c => c.id))
        const venuesWithVerified = new Set(worksAt.filter(l => verified.has(l.source)).map(l => l.target))
        const hits = nodesOfKind(g, 'venue').filter(inVertical).filter(v2 => !venuesWithVerified.has(v2.id))
        return {
          answer: hits.length
            ? `${hits.length} ${v.name.toLowerCase()} ${hits.length === 1 ? 'company has' : 'companies have'} no verified contact yet.`
            : `Every ${v.name.toLowerCase()} company has a verified contact.`,
          nodeIds: hits.map(v2 => v2.id),
        }
      },
    },
    {
      id: `v-${v.id}-no-website`,
      q: `${v.name} companies with no website`,
      category: v.name,
      verticalId: v.id,
      run: g => {
        const hits = nodesOfKind(g, 'venue').filter(inVertical).filter(v2 => !v2.website)
        return {
          answer: hits.length
            ? `${hits.length} ${v.name.toLowerCase()} ${hits.length === 1 ? 'company has' : 'companies have'} no website on file.`
            : `Every ${v.name.toLowerCase()} company has a website on file.`,
          nodeIds: hits.map(v2 => v2.id),
        }
      },
    },
    {
      id: `v-${v.id}-most-connected`,
      q: `Best-connected ${v.name.toLowerCase()} companies`,
      category: v.name,
      verticalId: v.id,
      run: g => {
        const venueIds = new Set(nodesOfKind(g, 'venue').filter(inVertical).map(v2 => v2.id))
        const degree = new Map<string, number>()
        for (const l of g.links) {
          if ((l.kind === 'WORKS_AT' || l.kind === 'TARGETS') && venueIds.has(l.target)) {
            degree.set(l.target, (degree.get(l.target) ?? 0) + 1)
          }
        }
        const top = [...degree.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
        if (!top.length) return { answer: `No ${v.name.toLowerCase()} company connections yet.`, nodeIds: [] }
        const labelOf = (id: string) => g.nodes.find(n => n.id === id)?.label ?? id
        return {
          answer: `Best-connected ${v.name.toLowerCase()} companies — ` + top.map(([id, n]) => `${labelOf(id)} (${n})`).join(' · '),
          nodeIds: top.map(([id]) => id),
        }
      },
    },
  ]

  if (v.id === 'dev-studios') {
    const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000
    presets.push(
      {
        id: 'v-dev-studios-stale',
        q: "iOS studios that haven't shipped in over a year",
        category: v.name,
        verticalId: v.id,
        run: g => {
          const now = Date.now()
          const hits = nodesOfKind(g, 'venue').filter(inVertical).filter(v2 => {
            if (!v2.lastShipped) return true
            const t = Date.parse(v2.lastShipped)
            return Number.isNaN(t) || now - t > ONE_YEAR_MS
          })
          return {
            answer: hits.length
              ? `${hits.length} studio${hits.length === 1 ? '' : 's'} with no App Store release in over a year.`
              : 'Every studio has shipped within the last year.',
            nodeIds: hits.map(v2 => v2.id),
          }
        },
      },
      {
        id: 'v-dev-studios-prolific',
        q: 'iOS studios with the most apps published',
        category: v.name,
        verticalId: v.id,
        run: g => {
          const top = nodesOfKind(g, 'venue')
            .filter(inVertical)
            .map(v2 => [v2, v2.apps?.length ?? 0] as const)
            .filter(([, n]) => n > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
          if (!top.length) return { answer: 'No studio has an app catalogue on file yet.', nodeIds: [] }
          return {
            answer: 'Most apps published — ' + top.map(([v2, n]) => `${v2.label} (${n})`).join(' · '),
            nodeIds: top.map(([v2]) => v2.id),
          }
        },
      },
    )
  }

  return presets
}

// --- shortest path between two selected nodes (pure BFS, no Cypher/GDS needed) ---

export function findShortestPath(g: GraphData, fromId: string, toId: string): AskResult {
  const labelOf = (id: string) => g.nodes.find(n => n.id === id)?.label ?? id
  if (fromId === toId) return { answer: 'Pick two different nodes to find a path.', nodeIds: [fromId] }

  const adjacent = new Map<string, string[]>()
  for (const l of g.links) {
    if (!adjacent.has(l.source)) adjacent.set(l.source, [])
    if (!adjacent.has(l.target)) adjacent.set(l.target, [])
    adjacent.get(l.source)!.push(l.target)
    adjacent.get(l.target)!.push(l.source)
  }

  const prev = new Map<string, string>()
  const visited = new Set<string>([fromId])
  const queue = [fromId]
  let found = false
  while (queue.length) {
    const cur = queue.shift()!
    if (cur === toId) { found = true; break }
    for (const next of adjacent.get(cur) ?? []) {
      if (visited.has(next)) continue
      visited.add(next); prev.set(next, cur); queue.push(next)
    }
  }
  if (!found) {
    return {
      answer: `No path between ${labelOf(fromId)} and ${labelOf(toId)} — they're in disconnected parts of the graph.`,
      nodeIds: [fromId, toId],
    }
  }

  const path: string[] = [toId]
  for (let cur = toId; cur !== fromId; ) { cur = prev.get(cur)!; path.push(cur) }
  path.reverse()
  const hops = path.length - 1
  return {
    answer: (hops === 1 ? 'Directly connected: ' : `${hops} hops: `) + path.map(labelOf).join(' → '),
    nodeIds: path,
  }
}

// --- live free-text engine (NL -> Cypher -> Aura) ---------------------------

const SCHEMA_PROMPT = `You write a single read-only Cypher query for a Neo4j graph.
The :Venue label represents a business/company (this dataset is trades businesses),
so map "business", "company", or "trade" in the question to the :Venue label.
Schema:
  (:Venue {name, category, district})
  (:Contact {name, title, role, verified})
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

// Exported so any other raw-Cypher entry point (the in-app Cypher editor)
// applies the exact same client-side write guard, not a second copy that can
// drift. The driver's own routing:'READ' in runReadCypher is the real
// enforcement -- this is a fast, friendly rejection before the round trip.
export const WRITE_RE = /\b(CREATE|MERGE|SET|DELETE|REMOVE|DROP|LOAD\s+CSV|CALL\s*\{)\b/i

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
Node kinds: venue, contact, source, sequence. (A "venue" node is a business/company — treat "business", "company", "trade", and "venue" as the same kind.)
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
