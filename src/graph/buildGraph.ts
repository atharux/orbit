import type { Lead } from '../types'
import { STATUS_LABEL } from '../types'
import type { GraphData, GraphNode, GraphLink } from './types'

// Project the app's real Lead records onto the Neo4j graph shape so the
// immersive view shows YOUR data, not a mock. No fabrication: every node comes
// from a field that exists on the lead.
//
//   Lead                → Venue        (venue:<id>)
//   lead.email|phone    → Contact      (contact:<id>)   WORKS_AT venue
//   lead.source         → Source       (source:<slug>)  Contact VERIFIED_BY source
//   lead.status         → Sequence     (seq:<status>)   Contact ENROLLED_IN, Sequence TARGETS venue

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

export function buildGraphFromLeads(leads: Lead[]): GraphData {
  const nodes = new Map<string, GraphNode>()
  const links: GraphLink[] = []
  const linkSeen = new Set<string>()

  const addNode = (n: GraphNode) => { if (!nodes.has(n.id)) nodes.set(n.id, n) }
  const addLink = (l: GraphLink) => {
    const key = `${l.kind}:${l.source}->${l.target}`
    if (!linkSeen.has(key)) { linkSeen.add(key); links.push(l) }
  }

  for (const lead of leads) {
    const venueId = `venue:${lead.id}`
    addNode({
      id: venueId, kind: 'venue', label: lead.name,
      sub: lead.category || undefined, district: lead.city || undefined,
      website: lead.website || undefined,
      apps: lead.custom_fields?.apps ? lead.custom_fields.apps.split(' · ') : undefined,
      lastShipped: lead.custom_fields?.last_shipped || undefined,
    })

    // Sequence node per outreach status; the venue is TARGETS-ed by it.
    const seqId = `seq:${lead.status}`
    addNode({ id: seqId, kind: 'sequence', label: STATUS_LABEL[lead.status], sub: 'status' })
    addLink({ source: seqId, target: venueId, kind: 'TARGETS' })

    // Contact only if the lead is actually reachable.
    const reachable = Boolean(lead.email || lead.phone)
    if (reachable) {
      const contactId = `contact:${lead.id}`
      const verified = Boolean(lead.email) // an email = a verified channel
      addNode({
        id: contactId, kind: 'contact',
        label: lead.name, sub: verified ? 'email on file' : 'phone only',
        verified,
      })
      addLink({ source: contactId, target: venueId, kind: 'WORKS_AT' })
      addLink({ source: contactId, target: seqId, kind: 'ENROLLED_IN' })

      if (lead.source) {
        const srcId = `source:${slug(lead.source)}`
        addNode({ id: srcId, kind: 'source', label: lead.source })
        if (verified) addLink({ source: contactId, target: srcId, kind: 'VERIFIED_BY' })
      }
    }
  }

  return {
    nodes: [...nodes.values()],
    links,
    origin: 'leads',
    note: `${leads.length} leads`,
  }
}
