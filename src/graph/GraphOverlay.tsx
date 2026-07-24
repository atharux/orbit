import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import SpriteText from 'three-spritetext'
import ForceGraph3D from '3d-force-graph'
import type { Lead, OutreachStatus } from '../types'
import { STATUSES, STATUS_LABEL, STATUS_COLOR } from '../types'
import type { GraphData, GraphNode, GraphLink } from './types'
import { KIND_COLOR, KIND_LABEL } from './types'
import { buildGraphFromLeads } from './buildGraph'
import { sampleGraph } from './sampleGraph'
import { isLiveConfigured, fetchLiveGraph, liveInstanceInfo, browserDeepLink } from './neo4jSource'
import { PRESETS, askLive, askLocal, liveAvailable, localAvailable, type AskResult } from './ask'
import { exportCsv } from '../storage'
import { loadSequences, saveSequences, enrollLeads, newSequence } from '../sequences/store'

// Full-screen immersive 3D graph. The light dashboard drops away into a dark
// space where venues/contacts float and relationships stream particles. Orbit
// the camera; click a node to fly to it and light up its neighborhood.

type Origin = GraphData['origin']

// Each relationship type gets a colour: full when focused, muted at rest (so
// you can still read how things relate), near-invisible when a different node
// is focused.
const LINK_COLOR: Record<GraphLink['kind'], string> = {
  WORKS_AT: '#8aa0b8',
  VERIFIED_BY: '#f97316',
  ENROLLED_IN: '#34d399',
  TARGETS: '#22d3ee',
}
const LINK_DIM: Record<GraphLink['kind'], string> = {
  WORKS_AT: '#39465a',
  VERIFIED_BY: '#5c3a1e',
  ENROLLED_IN: '#204a3b',
  TARGETS: '#1f4552',
}
const REL_LABEL: Record<GraphLink['kind'], string> = {
  WORKS_AT: 'works at',
  VERIFIED_BY: 'verified by',
  ENROLLED_IN: 'enrolled in',
  TARGETS: 'targets',
}

const DIM = '#1f2937'

export type ThemeMode = 'dark' | 'light'

// Light "plate" palette (muted plate inks) — mirrors the About exhibit.
const KIND_COLOR_LIGHT: Record<GraphNode['kind'], string> = {
  venue: '#2f7d84', contact: '#6a5aa6', source: '#b5622a', sequence: '#4d7a46',
}
const LINK_COLOR_LIGHT: Record<GraphLink['kind'], string> = {
  WORKS_AT: '#6b6659', VERIFIED_BY: '#b5622a', ENROLLED_IN: '#4d7a46', TARGETS: '#2f7d84',
}
const LINK_DIM_LIGHT: Record<GraphLink['kind'], string> = {
  WORKS_AT: '#c3bba6', VERIFIED_BY: '#d8b48f', ENROLLED_IN: '#a9c2a0', TARGETS: '#9ec6cb',
}

interface CanvasTheme {
  bg: string; bloom: number; stars: boolean
  node: Record<GraphNode['kind'], string>; dim: string
  linkFull: Record<GraphLink['kind'], string>; linkRest: Record<GraphLink['kind'], string>; linkFade: string
  labelText: string; labelBg: string; labelBorder: string
}

// Dark = the original immersive space; light = an engraved cream "plate" (no
// bloom, ink lines, muted inks).
const CANVAS: Record<ThemeMode, CanvasTheme> = {
  dark: {
    bg: '#05060a', bloom: 0.32, stars: true, node: KIND_COLOR, dim: DIM,
    linkFull: LINK_COLOR, linkRest: LINK_DIM, linkFade: '#151b26',
    labelText: '#dfe6f0', labelBg: 'rgba(6,8,13,0.82)', labelBorder: 'rgba(120,132,148,0.18)',
  },
  light: {
    bg: '#efeadd', bloom: 0, stars: false, node: KIND_COLOR_LIGHT, dim: '#cfc7b5',
    linkFull: LINK_COLOR_LIGHT, linkRest: LINK_DIM_LIGHT, linkFade: '#ddd5c2',
    labelText: '#201e18', labelBg: 'rgba(246,242,231,0.92)', labelBorder: 'rgba(32,30,24,0.22)',
  },
}

// Pipeline stats derived from the graph — the HUD's numbers.
function computeStats(g: GraphData) {
  const venues = g.nodes.filter(n => n.kind === 'venue')
  const contacts = g.nodes.filter(n => n.kind === 'contact')
  const verified = contacts.filter(c => c.verified)
  const verifiedIds = new Set(verified.map(c => c.id))
  const covered = new Set(
    g.links.filter(l => l.kind === 'WORKS_AT' && verifiedIds.has(l.source)).map(l => l.target),
  )
  return {
    venues: venues.length,
    contacts: contacts.length,
    verified: verified.length,
    sources: g.nodes.filter(n => n.kind === 'source').length,
    sequences: g.nodes.filter(n => n.kind === 'sequence').length,
    coverage: venues.length ? Math.round((covered.size / venues.length) * 100) : 0,
    uncovered: venues.length - covered.size,
  }
}

// venue/contact nodes encode the originating lead id (buildGraph.ts). Recover it
// so the selected-node card can act on the real record. Returns null for
// source/sequence nodes and for live/sample graphs (ids won't match a lead).
function leadForNode(node: GraphNode | null, leads: Lead[]): Lead | null {
  if (!node) return null
  const m = /^(?:venue|contact):(.+)$/.exec(node.id)
  if (!m) return null
  return leads.find(l => l.id === m[1]) ?? null
}

// Normalize a stored website into an openable URL (leads often omit the scheme).
function hrefFor(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

// Instagram may be stored as a handle (@name) or a full URL.
function instagramHref(ig: string): string {
  if (/^https?:\/\//i.test(ig)) return ig
  return `https://instagram.com/${ig.replace(/^@/, '')}`
}

interface Neighbor { id: string; rel: GraphLink['kind']; dir: 'in' | 'out'; node: GraphNode }

function neighborsOf(g: GraphData, id: string): Neighbor[] {
  const out: Neighbor[] = []
  for (const l of g.links) {
    if (l.source === id) {
      const node = g.nodes.find(n => n.id === l.target)
      if (node) out.push({ id: l.target, rel: l.kind, dir: 'out', node })
    } else if (l.target === id) {
      const node = g.nodes.find(n => n.id === l.source)
      if (node) out.push({ id: l.source, rel: l.kind, dir: 'in', node })
    }
  }
  return out
}

// Smart find: multi-token AND match over a node's label/sub/district, plus
// kind and verified constraints. Returns the ids of matching nodes.
function filterNodeIds(
  g: GraphData, text: string, kinds: Set<GraphNode['kind']>, verifiedOnly: boolean,
): string[] {
  const tokens = text.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return g.nodes
    .filter(n => {
      if (kinds.size && !kinds.has(n.kind)) return false
      if (verifiedOnly && !n.verified) return false
      if (tokens.length) {
        const hay = `${n.label} ${n.sub ?? ''} ${n.district ?? ''}`.toLowerCase()
        if (!tokens.every(t => hay.includes(t))) return false
      }
      return true
    })
    .map(n => n.id)
}

export function GraphOverlay({ leads, onClose, openRouterApiKey, openRouterModel, onLeadStatusChange, onOpenLead }: {
  leads: Lead[]
  onClose: () => void
  openRouterApiKey?: string
  openRouterModel?: string
  // Persist an outreach-status change made from a node's action bar. Optional —
  // when absent (e.g. live/sample graph), the status control is hidden.
  onLeadStatusChange?: (leadId: string, status: OutreachStatus) => void
  // Jump from a company/contact node to its full lead-detail panel in the main
  // app (closes the graph). Optional — only shown for nodes backed by a lead.
  onOpenLead?: (leadId: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<any>(null)
  const [theme, setTheme] = useState<ThemeMode>('dark')
  const canvasThemeRef = useRef<CanvasTheme>(CANVAS.dark)
  const styles = makeStyles(theme)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [meta, setMeta] = useState<{ origin: Origin; nodes: number; links: number; note?: string } | null>(null)
  const [liveWarning, setLiveWarning] = useState<string | null>(null)
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([]) // multi-selection for bulk actions
  const [bulkMsg, setBulkMsg] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const [graphData, setGraphData] = useState<GraphData | null>(null)

  // Ask panel state
  const [askInput, setAskInput] = useState('')
  const [asking, setAsking] = useState(false)
  const [askResult, setAskResult] = useState<(AskResult & { q: string }) | null>(null)
  const [askError, setAskError] = useState('')
  const [askNote, setAskNote] = useState('')
  const canAskLive = liveAvailable(openRouterApiKey)
  const canAskLocal = !canAskLive && localAvailable(openRouterApiKey, graphData)

  // FIND panel state — instant client-side search + toggle filter chips.
  const [filterText, setFilterText] = useState('')
  const [activeKinds, setActiveKinds] = useState<Set<GraphNode['kind']>>(new Set())
  const [verifiedOnly, setVerifiedOnly] = useState(false)
  const [filterCount, setFilterCount] = useState<number | null>(null)

  useEffect(() => {
    let disposed = false

    async function resolveData(): Promise<GraphData> {
      if (isLiveConfigured()) {
        try {
          return await fetchLiveGraph()
        } catch (e: any) {
          setLiveWarning(`Live Neo4j unreachable — showing local data. (${e?.message ?? e})`)
        }
      }
      if (leads.length) return buildGraphFromLeads(leads)
      return sampleGraph()
    }

    resolveData()
      .then(data => {
        if (disposed || !containerRef.current) return
        initGraph(data)
        setGraphData(data)
        setMeta({ origin: data.origin, nodes: data.nodes.length, links: data.links.length, note: data.note })
        setStatus('ready')
      })
      .catch(e => {
        if (disposed) return
        setErrMsg(String(e?.message ?? e))
        setStatus('error')
      })

    function initGraph(data: GraphData) {
      const el = containerRef.current!
      const highlightNodes = new Set<string>()
      const highlightLinks = new Set<GraphLink>()
      const multiSel = new Set<string>() // shift/⌘-click or preset-driven multi-selection
      let focused: GraphNode | null = null

      const nodeIsHot = (n: any) => highlightNodes.size === 0 || highlightNodes.has(n.id)
      // Live canvas theme — read fresh on every accessor call so applyTheme() takes effect.
      const ct = () => canvasThemeRef.current

      const linkRestColor = (l: any) =>
        highlightLinks.has(l) ? ct().linkFull[l.kind as GraphLink['kind']]
          : highlightNodes.size ? ct().linkFade
          : ct().linkRest[l.kind as GraphLink['kind']]

      const Graph = new ForceGraph3D(el, { controlType: 'orbit' })
        .backgroundColor(ct().bg)
        .graphData(structuredClone(data))
        .nodeRelSize(4)
        .nodeVal((n: any) => (n.kind === 'venue' ? 6 : n.kind === 'sequence' ? 5 : 3))
        .nodeOpacity(1)
        .nodeColor((n: any) => (nodeIsHot(n) ? ct().node[n.kind as GraphNode['kind']] : ct().dim))
        // Permanent text label on every node — kept alongside the default sphere.
        .nodeThreeObjectExtend(true)
        .nodeThreeObject((n: any) => {
          const kind = n.kind as GraphNode['kind']
          const t = new SpriteText(n.label)
          t.color = ct().labelText
          t.fontFace = 'DM Mono, ui-monospace, monospace'
          t.fontWeight = '600'
          t.textHeight = kind === 'venue' || kind === 'sequence' ? 3.4 : 2.4
          t.backgroundColor = ct().labelBg
          t.borderColor = ct().labelBorder
          t.borderWidth = 0.15
          t.borderRadius = 2.5
          t.padding = 2.2
          t.position.set(0, kind === 'venue' ? 11 : kind === 'sequence' ? 10 : 8, 0)
          return t
        })
        // Hover card carries the detail so the always-on labels stay short.
        .nodeLabel((n: any) => `
          <div style="font:12px/1.4 'DM Mono',monospace;background:${ct().labelBg};border:1px solid ${ct().node[n.kind as GraphNode['kind']]};
            padding:6px 9px;border-radius:4px;color:${ct().labelText};max-width:220px">
            <div style="color:${ct().node[n.kind as GraphNode['kind']]};text-transform:uppercase;letter-spacing:.1em;font-size:9px">
              ${KIND_LABEL[n.kind as GraphNode['kind']]}${n.verified ? ' · verified' : ''}</div>
            <div style="font-weight:600;margin-top:2px">${n.label}</div>
            ${n.sub ? `<div style="opacity:.7">${n.sub}</div>` : ''}
            ${n.district ? `<div style="opacity:.7">${n.district}</div>` : ''}
          </div>`)
        .linkColor(linkRestColor)
        .linkWidth((l: any) => (highlightLinks.has(l) ? 1.8 : 0.7))
        .linkOpacity(0.6)
        // Arrowheads show relationship DIRECTION (who relates to whom) at rest.
        .linkDirectionalArrowLength(3.4)
        .linkDirectionalArrowRelPos(0.92)
        .linkDirectionalArrowColor(linkRestColor)
        .linkLabel((l: any) => `<span style="font:10px 'DM Mono',monospace;color:${ct().linkFull[l.kind as GraphLink['kind']]}">${REL_LABEL[l.kind as GraphLink['kind']]}</span>`)
        // Particles now only stream on the focused neighbourhood — less noise.
        .linkDirectionalParticles((l: any) => (highlightLinks.has(l) ? 3 : 0))
        .linkDirectionalParticleWidth(1.8)
        .linkDirectionalParticleSpeed(0.008)
        .linkDirectionalParticleColor((l: any) => ct().linkFull[l.kind as GraphLink['kind']])
        .width(el.clientWidth)
        .height(el.clientHeight)

      // Spread nodes out further so labels don't collide.
      Graph.d3Force('charge')?.strength(-320)

      // Very gentle bloom (dark theme only; light "plate" theme sets it to 0).
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(el.clientWidth, el.clientHeight), ct().bloom, 0.28, 0.35,
      )
      Graph.postProcessingComposer().addPass(bloom)

      // Starfield backdrop.
      const starGeo = new THREE.BufferGeometry()
      const starN = 1400
      const pos = new Float32Array(starN * 3)
      for (let i = 0; i < starN * 3; i++) pos[i] = (Math.random() - 0.5) * 4000
      starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      const stars = new THREE.Points(
        starGeo,
        new THREE.PointsMaterial({ color: 0x334155, size: 1.4, sizeAttenuation: true }),
      )
      stars.visible = ct().stars
      Graph.scene().add(stars)

      // Gentle cinematic auto-orbit; pauses while a node is focused.
      const controls: any = Graph.controls()
      controls.autoRotate = true
      controls.autoRotateSpeed = 0.55

      // Ambient "synaptic" heartbeat — a slow, sparse impulse that fires ONLY
      // along live/covered edges: a verified contact reaching its company, or a
      // sequence targeting a company. Cold prospects (no verified contact, not
      // targeted) never fire, so the graph's resting activity reads as real
      // outreach coverage — quiet regions are the whitespace to work next.
      // Subtle by design: at most one impulse in flight per tick.
      const verifiedIds = new Set(
        data.nodes.filter(n => n.kind === 'contact' && n.verified).map(n => n.id),
      )
      const isLiveLink = (l: any) => {
        const s = typeof l.source === 'object' ? l.source.id : l.source
        return l.kind === 'TARGETS'
          || ((l.kind === 'WORKS_AT' || l.kind === 'VERIFIED_BY' || l.kind === 'ENROLLED_IN') && verifiedIds.has(s))
      }
      const impulseTimer = window.setInterval(() => {
        const live = (Graph.graphData().links as any[]).filter(isLiveLink)
        if (live.length) (Graph as any).emitParticle(live[Math.floor(Math.random() * live.length)])
      }, 680)

      function refreshHighlight() {
        Graph.nodeColor(Graph.nodeColor())
          .linkColor(Graph.linkColor())
          .linkWidth(Graph.linkWidth())
          .linkDirectionalArrowColor(Graph.linkDirectionalArrowColor())
          .linkDirectionalParticles(Graph.linkDirectionalParticles())
      }

      function selectNode(node: any) {
        focused = node
        multiSel.clear()
        setSelectedIds([])
        controls.autoRotate = false
        highlightNodes.clear()
        highlightLinks.clear()
        highlightNodes.add(node.id)
        for (const l of (Graph.graphData().links as any[])) {
          const s = typeof l.source === 'object' ? l.source.id : l.source
          const t = typeof l.target === 'object' ? l.target.id : l.target
          if (s === node.id || t === node.id) {
            highlightLinks.add(l)
            highlightNodes.add(s); highlightNodes.add(t)
          }
        }
        refreshHighlight()
        setSelected({ id: node.id, kind: node.kind, label: node.label, sub: node.sub, verified: node.verified, district: node.district })

        // Fly the camera to the node.
        const dist = 120
        const r = 1 + dist / Math.hypot(node.x || 1, node.y || 1, node.z || 1)
        Graph.cameraPosition({ x: node.x * r, y: node.y * r, z: node.z * r }, node, 1400)
      }

      // Reflect the multi-selection into the highlight + sync to React.
      function applySelectionHighlight() {
        highlightNodes.clear(); highlightLinks.clear()
        multiSel.forEach(id => highlightNodes.add(id))
        for (const l of (Graph.graphData().links as any[])) {
          const s = typeof l.source === 'object' ? l.source.id : l.source
          const t = typeof l.target === 'object' ? l.target.id : l.target
          if (multiSel.has(s) && multiSel.has(t)) highlightLinks.add(l)
        }
        refreshHighlight()
        controls.autoRotate = multiSel.size === 0
        setSelectedIds([...multiSel])
      }
      function toggleSelect(id: string) {
        multiSel.has(id) ? multiSel.delete(id) : multiSel.add(id)
        setSelected(null)
        applySelectionHighlight()
      }

      // Plain click = focus one node; shift/⌘/ctrl-click = add/remove from selection.
      Graph.onNodeClick((node: any, event: any) => {
        if (event && (event.shiftKey || event.metaKey || event.ctrlKey)) toggleSelect(node.id)
        else { multiSel.clear(); selectNode(node) }
      })

      Graph.onBackgroundClick(() => {
        focused = null
        controls.autoRotate = true
        multiSel.clear()
        highlightNodes.clear()
        highlightLinks.clear()
        refreshHighlight()
        setSelected(null)
        setSelectedIds([])
      })

      // Imperative handle for the ask panel: light up an arbitrary node set.
      function focusNodes(ids: string[]) {
        highlightNodes.clear()
        highlightLinks.clear()
        multiSel.clear()
        setSelected(null)
        if (ids.length === 0) { controls.autoRotate = true; refreshHighlight(); setSelectedIds([]); return }
        ids.forEach(id => { highlightNodes.add(id); multiSel.add(id) })
        for (const l of (Graph.graphData().links as any[])) {
          const s = typeof l.source === 'object' ? l.source.id : l.source
          const t = typeof l.target === 'object' ? l.target.id : l.target
          if (highlightNodes.has(s) && highlightNodes.has(t)) highlightLinks.add(l)
        }
        refreshHighlight()
        controls.autoRotate = false
        Graph.zoomToFit(1400, 90, (n: any) => highlightNodes.has(n.id))
        // A preset/filter result IS a selection you can act on in bulk.
        setSelectedIds([...ids])
      }

      // Select a node by id (used by the connections list to navigate).
      function selectNodeById(id: string) {
        const node = (Graph.graphData().nodes as any[]).find(n => n.id === id)
        if (node) selectNode(node)
      }

      // Re-skin the live scene when the theme toggles (no rebuild / layout reset).
      function applyTheme(next: CanvasTheme) {
        canvasThemeRef.current = next
        Graph.backgroundColor(next.bg)
        bloom.strength = next.bloom
        stars.visible = next.stars
        Graph.nodeColor(Graph.nodeColor())
          .nodeThreeObject(Graph.nodeThreeObject()) // rebuild labels with new colours
          .nodeLabel(Graph.nodeLabel())
          .linkColor(Graph.linkColor())
          .linkDirectionalArrowColor(Graph.linkDirectionalArrowColor())
      }

      const onResize = () => Graph.width(el.clientWidth).height(el.clientHeight)
      window.addEventListener('resize', onResize)

      // fit once the layout settles
      setTimeout(() => Graph.zoomToFit(1200, 60), 700)

      graphRef.current = { Graph, onResize, focusNodes, selectNodeById, applyTheme, impulseTimer }
      void focused
    }

    return () => {
      disposed = true
      const g = graphRef.current
      if (g) {
        window.removeEventListener('resize', g.onResize)
        clearInterval(g.impulseTimer)
        g.Graph._destructor?.()
      }
      graphRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-skin the canvas when the theme flips.
  useEffect(() => {
    graphRef.current?.applyTheme?.(CANVAS[theme])
  }, [theme])

  function runPreset(p: typeof PRESETS[number]) {
    if (!graphData) return
    setAskError(''); setAskNote('')
    const res = p.run(graphData)
    setAskResult({ ...res, q: p.q })
    graphRef.current?.focusNodes(res.nodeIds)
  }

  async function runAsk() {
    const q = askInput.trim()
    if (!q || !graphData) return
    setAskError(''); setAskNote(''); setAsking(true); setAskResult(null)
    try {
      if (canAskLive) {
        const res = await askLive(q, openRouterApiKey!, openRouterModel)
        setAskResult({ ...res, q })
        graphRef.current?.focusNodes(res.nodeIds)
      } else if (canAskLocal) {
        const res = await askLocal(q, graphData, openRouterApiKey!, openRouterModel)
        setAskResult({ ...res, q })
        graphRef.current?.focusNodes(res.nodeIds)
      } else {
        setAskNote(openRouterApiKey
          ? 'This graph is too large for local free-text — connect Aura in .env for questions at this scale. Presets still work.'
          : 'Add an OpenRouter key in Settings to ask free-text questions (no Aura needed). Or use a preset below.')
      }
    } catch (e: any) {
      setAskError(String(e?.message ?? e))
    } finally {
      setAsking(false)
    }
  }

  function clearAsk() {
    setAskResult(null); setAskError(''); setAskNote(''); setAskInput('')
    graphRef.current?.focusNodes([])
  }

  // Legend action: light up every node of a kind.
  function spotlightKind(kind: GraphNode['kind']) {
    if (!graphData) return
    graphRef.current?.focusNodes(graphData.nodes.filter(n => n.kind === kind).map(n => n.id))
  }

  // FIND: recompute the highlighted set from the current search + chips and
  // push it to the canvas. Empty filter releases the highlight (rest state).
  function applyFilter(text: string, kinds: Set<GraphNode['kind']>, vOnly: boolean) {
    if (!graphData) return
    const active = Boolean(text.trim()) || kinds.size > 0 || vOnly
    if (!active) { setFilterCount(null); graphRef.current?.focusNodes([]); return }
    const ids = filterNodeIds(graphData, text, kinds, vOnly)
    setFilterCount(ids.length)
    graphRef.current?.focusNodes(ids)
  }

  function onSearchChange(v: string) {
    setFilterText(v)
    applyFilter(v, activeKinds, verifiedOnly)
  }
  function toggleKind(k: GraphNode['kind']) {
    const next = new Set(activeKinds)
    next.has(k) ? next.delete(k) : next.add(k)
    setActiveKinds(next)
    applyFilter(filterText, next, verifiedOnly)
  }
  function toggleVerified() {
    const v = !verifiedOnly
    setVerifiedOnly(v)
    applyFilter(filterText, activeKinds, v)
  }
  function clearFilter() {
    setFilterText(''); setActiveKinds(new Set()); setVerifiedOnly(false); setFilterCount(null)
    graphRef.current?.focusNodes([])
  }
  const filterActive = Boolean(filterText.trim()) || activeKinds.size > 0 || verifiedOnly

  // ---- bulk actions on the selection (closes "found the leak → now act") ----
  const selectedLeads: Lead[] = (() => {
    const seen = new Set<string>(); const out: Lead[] = []
    for (const id of selectedIds) {
      const m = /^(?:venue|contact):(.+)$/.exec(id)
      if (!m || seen.has(m[1])) continue
      seen.add(m[1])
      const l = leads.find(x => x.id === m[1])
      if (l) out.push(l)
    }
    return out
  })()
  const selectedNodes = graphData ? (selectedIds.map(id => graphData.nodes.find(n => n.id === id)).filter(Boolean) as GraphNode[]) : []

  function bulkStatus(status: OutreachStatus) {
    if (!onLeadStatusChange || !selectedLeads.length) return
    selectedLeads.forEach(l => onLeadStatusChange(l.id, status))
    setBulkMsg(`Set ${selectedLeads.length} to "${STATUS_LABEL[status]}"`)
  }
  function bulkEnroll(seqId: string) {
    if (!selectedLeads.length) return
    const seqs = loadSequences()
    let target = seqs.find(s => s.id === seqId)
    if (!target) { target = newSequence('From graph selection'); seqs.push(target) }
    const updated = enrollLeads(target, selectedLeads.map(l => l.id))
    saveSequences(seqs.map(s => (s.id === updated.id ? updated : s)))
    setBulkMsg(`Enrolled ${selectedLeads.length} into "${updated.name}"`)
  }
  function bulkExport() {
    if (selectedLeads.length) { exportCsv(selectedLeads, 'graph-selection'); return }
    const esc = (v: string) => `"${(v || '').replace(/"/g, '""')}"`
    const rows = selectedNodes.map(n => [n.label, KIND_LABEL[n.kind], n.sub ?? '', n.district ?? ''].map(esc).join(','))
    const csv = [['name', 'kind', 'detail', 'district'].map(esc).join(','), ...rows].join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a'); a.href = url; a.download = `graph-selection-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url)
  }
  function clearSelection() { setBulkMsg(''); graphRef.current?.focusNodes([]) }

  const stats = graphData ? computeStats(graphData) : null
  const neighbors = graphData && selected ? neighborsOf(graphData, selected.id) : []
  // The real lead behind the selected node (venue/contact on a leads graph),
  // driving the action bar. Re-derived from the live `leads` prop so a status
  // change re-renders the control with the new value.
  const activeLead = leadForNode(selected, leads)
  const nodeCol = CANVAS[theme].node // theme-aware node/relationship colours for the HTML chrome
  const relCol = CANVAS[theme].linkFull
  // Only offer chips for kinds/attributes actually present in this graph.
  const presentKinds = graphData
    ? (Object.keys(KIND_COLOR) as GraphNode['kind'][]).filter(k => graphData.nodes.some(n => n.kind === k))
    : []
  const hasVerifiedNodes = graphData ? graphData.nodes.some(n => n.verified) : false

  // Live Aura instance metadata + schema counts for the "it's real" demo chrome.
  const instance = meta?.origin === 'live' ? liveInstanceInfo() : null
  const nodeCounts = graphData
    ? graphData.nodes.reduce<Record<string, number>>((a, n) => { a[n.kind] = (a[n.kind] ?? 0) + 1; return a }, {})
    : {}
  const relCounts = graphData
    ? graphData.links.reduce<Record<string, number>>((a, l) => { a[l.kind] = (a[l.kind] ?? 0) + 1; return a }, {})
    : {}
  // Open the live model in Neo4j Browser's own schema view — proof it's the real DB.
  const browserUrl = meta?.origin === 'live' ? browserDeepLink('CALL db.schema.visualization()') : null

  const originBadge: Record<Origin, { text: string; color: string }> = {
    live: { text: 'LIVE · NEO4J AURA', color: '#34d399' },
    leads: { text: 'YOUR LEADS', color: '#22d3ee' },
    sample: { text: 'SAMPLE DATA', color: '#f97316' },
  }

  return (
    <div style={styles.overlay}>
      <div ref={containerRef} style={styles.canvas} />

      {/* Top HUD */}
      <div style={styles.hudTop}>
        <div style={styles.brand}>
          <span style={styles.brandDot} /> ORBIT
          <span style={styles.brandSub}>graph space</span>
        </div>
        {meta && (
          <div style={{ ...styles.badge, borderColor: originBadge[meta.origin].color, color: originBadge[meta.origin].color }}>
            {originBadge[meta.origin].text}
          </div>
        )}
        {instance && (
          <div style={styles.instance} title={`${instance.host} · db: ${instance.database} · user: ${instance.user}`}>
            ◆ {instance.name ?? instance.instanceId}
            <span style={styles.instanceId}>{instance.name ? instance.instanceId : instance.host}</span>
          </div>
        )}
        {meta && <div style={styles.counts}>{meta.nodes} nodes · {meta.links} edges</div>}
        <div style={{ flex: 1 }} />
        <button
          style={styles.themeBtn}
          onClick={() => setTheme(m => (m === 'dark' ? 'light' : 'dark'))}
          title="Toggle light / dark"
        >
          {theme === 'dark' ? 'Light plate' : 'Dark space'}
        </button>
        <button style={styles.closeBtn} onClick={onClose}>Exit graph ✕</button>
      </div>

      {/* Pipeline stats HUD */}
      {stats && status === 'ready' && (
        <div style={styles.stats}>
          <div style={styles.statsHead}>OUTREACH STATE</div>
          <div style={styles.statGrid}>
            <Stat label="Companies" value={stats.venues} color={CANVAS[theme].node.venue} s={styles} />
            <Stat label="Contacts" value={stats.contacts} color={CANVAS[theme].node.contact} s={styles} />
            <Stat label="Verified" value={stats.verified} color={CANVAS[theme].node.sequence} s={styles} />
            <Stat label="Sources" value={stats.sources} color={CANVAS[theme].node.source} s={styles} />
          </div>
          <div style={styles.coverageRow}>
            <span>verified-contact coverage</span>
            <span style={{ color: stats.coverage >= 60 ? '#34d399' : stats.coverage >= 30 ? '#f97316' : '#EF4444' }}>
              {stats.coverage}%
            </span>
          </div>
          <div style={styles.coverageBar}>
            <div style={{ ...styles.coverageFill, width: `${stats.coverage}%` }} />
          </div>
          {stats.uncovered > 0 && (
            <button style={styles.statAction} onClick={() => runPreset(PRESETS[1])}>
              {stats.uncovered} {stats.uncovered === 1 ? 'company' : 'companies'} with no verified contact →
            </button>
          )}
        </div>
      )}

      {liveWarning && <div style={styles.warn}>{liveWarning}</div>}
      {meta?.origin === 'sample' && <div style={styles.sampleNote}>{meta.note}</div>}

      {status === 'loading' && <div style={styles.center}>connecting to graph…</div>}
      {status === 'error' && <div style={styles.center}>could not build graph — {errMsg}</div>}

      {/* Ask the graph */}
      {status === 'ready' && (
        <div style={styles.ask}>
          {/* FIND — instant client-side search + filter chips */}
          <div style={styles.askHead}>
            FIND
            {filterCount != null && (
              <span style={{ ...styles.askLive, color: filterCount ? nodeCol.venue : '#EF4444' }}>
                {filterCount} match{filterCount === 1 ? '' : 'es'}
              </span>
            )}
          </div>
          <div style={styles.askRow}>
            <input
              style={styles.askInput}
              placeholder="Find by name, category, city…"
              value={filterText}
              onChange={e => onSearchChange(e.target.value)}
            />
            {filterActive && (
              <button style={styles.askBtn} onClick={clearFilter} title="Clear filter">✕</button>
            )}
          </div>
          {(presentKinds.length > 0 || hasVerifiedNodes) && (
            <div style={styles.filterChips}>
              {presentKinds.map(k => {
                const on = activeKinds.has(k)
                return (
                  <button
                    key={k}
                    style={{ ...styles.chip, ...(on ? { borderColor: nodeCol[k], color: nodeCol[k], background: nodeCol[k] + '1f' } : null) }}
                    onClick={() => toggleKind(k)}
                  >
                    <span style={{ ...styles.chipDot, background: nodeCol[k] }} />
                    {KIND_LABEL[k]}
                  </button>
                )
              })}
              {hasVerifiedNodes && (
                <button
                  style={{ ...styles.chip, ...(verifiedOnly ? { borderColor: nodeCol.sequence, color: nodeCol.sequence, background: nodeCol.sequence + '1f' } : null) }}
                  onClick={toggleVerified}
                >
                  ✓ Verified
                </button>
              )}
            </div>
          )}

          <div style={styles.filterDivider} />

          <div style={styles.askHead}>
            ASK THE GRAPH
            <span style={{ ...styles.askLive, color: canAskLive ? '#34d399' : canAskLocal ? '#22d3ee' : '#8b8677' }}>
              {canAskLive ? '● live' : canAskLocal ? '● local' : '○ presets'}
            </span>
          </div>

          <div style={styles.askRow}>
            <input
              style={styles.askInput}
              placeholder={canAskLive || canAskLocal ? 'Ask in plain English…' : 'Add an AI key to ask freely'}
              value={askInput}
              onChange={e => setAskInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runAsk() }}
            />
            <button style={styles.askBtn} onClick={runAsk} disabled={asking}>
              {asking ? '…' : '→'}
            </button>
          </div>

          <div style={styles.presetList}>
            {PRESETS.map(p => (
              <button key={p.id} style={styles.presetChip} onClick={() => runPreset(p)}>
                {p.q}
              </button>
            ))}
          </div>

          {askNote && <div style={styles.askInfo}>{askNote}</div>}
          {askError && <div style={styles.askErr}>{askError}</div>}

          {askResult && (
            <div style={styles.answer}>
              <div style={styles.answerQ}>{askResult.q}</div>
              <div style={styles.answerA}>{askResult.answer}</div>
              {askResult.cypher && (
                <pre style={styles.cypher}>{askResult.cypher}</pre>
              )}
              <button style={styles.clearBtn} onClick={clearAsk}>clear</button>
            </div>
          )}

          {/* Schema / legend — folded into the base of this plate so nothing overlaps */}
          <div style={styles.schema}>
            <div style={styles.legendHead}>{instance ? 'SCHEMA · LIVE' : 'NODES · click to spotlight'}</div>
            {(Object.keys(KIND_COLOR) as GraphNode['kind'][]).map(k => (
              <button key={k} style={{ ...styles.legendBtn, opacity: nodeCounts[k] ? 1 : 0.4 }} onClick={() => spotlightKind(k)} title={`Light up all ${KIND_LABEL[k]} nodes`}>
                <span style={{ ...styles.legendDot, background: nodeCol[k] }} />
                {KIND_LABEL[k]}
                <span style={styles.legendCount}>{nodeCounts[k] ?? 0}</span>
              </button>
            ))}
            <div style={{ ...styles.legendHead, marginTop: 8 }}>RELATIONSHIPS</div>
            {(Object.keys(REL_LABEL) as GraphLink['kind'][]).map(k => (
              <div key={k} style={{ ...styles.legendRow, opacity: relCounts[k] ? 1 : 0.4 }}>
                <span style={{ ...styles.legendArrow, color: relCol[k] }}>→</span>
                {REL_LABEL[k]}
                <span style={styles.legendCount}>{relCounts[k] ?? 0}</span>
              </div>
            ))}
            {browserUrl && (
              <a style={styles.browserBtn} href={browserUrl} target="_blank" rel="noopener noreferrer" title="Open this Aura instance in Neo4j Browser">
                Open in Neo4j Browser ↗
              </a>
            )}
          </div>
        </div>
      )}

      {/* Selected node card */}
      {selected && (
        <div style={{ ...styles.card, borderColor: nodeCol[selected.kind] }}>
          <div style={{ ...styles.cardKind, color: nodeCol[selected.kind] }}>
            {KIND_LABEL[selected.kind]}{selected.verified ? ' · verified' : ''}
          </div>
          <div style={styles.cardTitle}>{selected.label}</div>
          {selected.sub && <div style={styles.cardSub}>{selected.sub}</div>}
          {selected.district && <div style={styles.cardSub}>{selected.district}</div>}

          {/* Action bar — only for nodes backed by a real lead */}
          {activeLead && (
            <div style={styles.actions}>
              <div style={styles.actionLinks}>
                {activeLead.website && (
                  <a style={styles.actionBtn} href={hrefFor(activeLead.website)} target="_blank" rel="noopener noreferrer">↗ Website</a>
                )}
                {activeLead.email && (
                  <a style={styles.actionBtn} href={`mailto:${activeLead.email}`}>✉ Email</a>
                )}
                {activeLead.phone && (
                  <a style={styles.actionBtn} href={`tel:${activeLead.phone}`}>☎ Call</a>
                )}
                {activeLead.instagram && (
                  <a style={styles.actionBtn} href={instagramHref(activeLead.instagram)} target="_blank" rel="noopener noreferrer">◎ Instagram</a>
                )}
              </div>
              {onLeadStatusChange && (
                <label style={styles.statusRow}>
                  <span style={styles.statusLabel}>Status</span>
                  <select
                    style={{ ...styles.statusSelect, color: STATUS_COLOR[activeLead.status], borderColor: STATUS_COLOR[activeLead.status] + '66' }}
                    value={activeLead.status}
                    onChange={e => onLeadStatusChange(activeLead.id, e.target.value as OutreachStatus)}
                  >
                    {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </label>
              )}
              {onOpenLead && (
                <button style={styles.openDetailBtn} onClick={() => onOpenLead(activeLead.id)}>
                  Open full detail ↗
                </button>
              )}
            </div>
          )}

          {neighbors.length > 0 && (
            <div style={styles.connections}>
              <div style={styles.connHead}>{neighbors.length} connection{neighbors.length === 1 ? '' : 's'} · click to jump</div>
              {neighbors.map((nb, i) => (
                <button key={i} style={styles.connRow} onClick={() => graphRef.current?.selectNodeById(nb.id)}>
                  <span style={{ ...styles.connDot, background: nodeCol[nb.node.kind] }} />
                  <span style={styles.connRel}>{nb.dir === 'out' ? REL_LABEL[nb.rel] : `←${REL_LABEL[nb.rel]}`}</span>
                  <span style={styles.connName}>{nb.node.label}</span>
                </button>
              ))}
            </div>
          )}

          <div style={styles.cardHint}>neighbors highlighted · click empty space to release</div>
        </div>
      )}

      {/* Bulk action bar — the selection (from clicks OR a preset) becomes actions */}
      {selectedIds.length > 0 && (
        <div style={styles.bulkBar}>
          <span style={styles.bulkCount}>
            {selectedIds.length} selected{selectedLeads.length !== selectedIds.length ? ` · ${selectedLeads.length} editable` : ''}
          </span>
          {onLeadStatusChange && selectedLeads.length > 0 && (
            <select style={styles.bulkSelect} value="" onChange={e => e.target.value && bulkStatus(e.target.value as OutreachStatus)}>
              <option value="">Set status…</option>
              {STATUSES.map(st => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}
            </select>
          )}
          {selectedLeads.length > 0 && (
            <select style={styles.bulkSelect} value="" onChange={e => { if (e.target.value) bulkEnroll(e.target.value) }}>
              <option value="">Enroll in sequence…</option>
              {loadSequences().map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              <option value="__new">+ New sequence</option>
            </select>
          )}
          <button style={styles.bulkBtn} onClick={bulkExport}>Export ↓</button>
          <button style={styles.bulkClear} onClick={clearSelection}>Clear</button>
          {bulkMsg && <span style={styles.bulkMsg}>{bulkMsg}</span>}
        </div>
      )}

      <div style={styles.hint}>drag to orbit · scroll to zoom · click to fly in · shift-click to multi-select</div>
    </div>
  )
}

function Stat({ label, value, color, s }: { label: string; value: number; color: string; s: Styles }) {
  return (
    <div style={s.stat}>
      <div style={{ ...s.statValue, color }}>{value}</div>
      <div style={s.statLabel}>{label}</div>
    </div>
  )
}

type Styles = Record<string, React.CSSProperties>

// Panel (HTML chrome) tokens per theme. Dark values reproduce the original look
// exactly; light values are the cream "plate" palette from the About exhibit.
function panelTokens(mode: ThemeMode) {
  return mode === 'dark'
    ? {
      overlayBg: '#05060a', bg: '#0b0e14e6', card: '#0b0e14f2', legend: '#0b0e14cc',
      solid: '#05060a', btn: '#111826', border: '#1f2937', border2: '#141a24',
      text: '#e5e7eb', text2: '#cbd5e1', muted: '#94a3b8', faint: '#64748b', faint2: '#475569',
      cardSub: '#9ca3af', topGrad: 'linear-gradient(#05060aee, #05060a00)', shadow: '0 10px 40px #0008',
      accent: '#22d3ee', accentDim: '#22d3ee55', cypher: '#67e8f9', brandGlow: '0 0 12px #22d3ee',
    }
    : {
      overlayBg: '#efeadd', bg: '#f6f2e7f2', card: '#f6f2e7f7', legend: '#f6f2e7ee',
      solid: '#efeadd', btn: '#efe9db', border: '#c3bba6', border2: '#ddd5c2',
      text: '#201e18', text2: '#3a362e', muted: '#6b6659', faint: '#8b8677', faint2: '#a89f89',
      cardSub: '#6b6659', topGrad: 'linear-gradient(#efeaddee, #efeadd00)', shadow: '4px 4px 0 rgba(32,30,24,.10)',
      accent: '#2f7d84', accentDim: '#2f7d8455', cypher: '#2f6d74', brandGlow: 'none',
    }
}

function makeStyles(mode: ThemeMode): Styles {
  const t = panelTokens(mode)
  const mono = "'DM Mono', monospace"
  return {
    overlay: { position: 'fixed', inset: 0, zIndex: 1000, background: t.overlayBg, overflow: 'hidden' },
    canvas: { position: 'absolute', inset: 0 },
    hudTop: {
      position: 'absolute', top: 0, left: 0, right: 0, height: 52, display: 'flex', alignItems: 'center',
      gap: 14, padding: '0 20px', zIndex: 2, background: t.topGrad, color: t.text, fontFamily: mono,
    },
    brand: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, letterSpacing: '.14em', fontWeight: 600 },
    brandDot: { width: 8, height: 8, borderRadius: '50%', background: t.accent, boxShadow: t.brandGlow },
    brandSub: { fontSize: 10, color: t.faint, letterSpacing: '.1em', marginLeft: 4 },
    badge: { fontSize: 10, letterSpacing: '.14em', border: '1px solid', borderRadius: 3, padding: '3px 8px' },
    instance: {
      display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, letterSpacing: '.1em',
      color: '#34d399', border: '1px solid #34d39955', borderRadius: 3, padding: '3px 8px',
    },
    instanceId: { color: t.faint, letterSpacing: '.04em', fontSize: 9 },
    counts: { fontSize: 11, color: t.faint },
    closeBtn: {
      fontFamily: mono, fontSize: 11, color: t.text, background: t.btn,
      border: `1px solid ${t.border}`, borderRadius: 4, padding: '6px 12px', cursor: 'pointer',
    },
    warn: {
      position: 'absolute', top: 60, left: '50%', transform: 'translateX(-50%)', zIndex: 3,
      background: '#3b1d0e', border: '1px solid #f97316', color: '#fdba74', fontFamily: mono,
      fontSize: 11, padding: '6px 12px', borderRadius: 4, maxWidth: '80%', textAlign: 'center',
    },
    sampleNote: {
      position: 'absolute', top: 60, left: '50%', transform: 'translateX(-50%)', zIndex: 3,
      color: '#f97316', fontFamily: mono, fontSize: 10, letterSpacing: '.05em',
    },
    center: {
      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: t.faint, fontFamily: mono, fontSize: 13, zIndex: 2, pointerEvents: 'none',
    },
    ask: {
      position: 'absolute', left: 20, top: 64, bottom: 20, zIndex: 3, width: 300,
      overflowY: 'auto',
      background: t.bg, border: `1px solid ${t.border}`, borderRadius: 8, padding: 14,
      fontFamily: mono, color: t.text, boxShadow: t.shadow,
    },
    schema: {
      marginTop: 12, borderTop: `1px solid ${t.border}`, paddingTop: 10,
      display: 'flex', flexDirection: 'column', gap: 6,
    },
    askHead: { fontSize: 11, letterSpacing: '.14em', color: t.muted, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
    askLive: { fontSize: 10, letterSpacing: '.06em' },
    askRow: { display: 'flex', gap: 6, marginTop: 10 },
    askInput: {
      flex: 1, background: t.solid, border: `1px solid ${t.border}`, borderRadius: 4,
      padding: '7px 9px', color: t.text, fontFamily: mono, fontSize: 12, outline: 'none',
    },
    askBtn: {
      width: 34, background: t.btn, border: `1px solid ${t.accentDim}`, borderRadius: 4,
      color: t.accent, cursor: 'pointer', fontSize: 14,
    },
    filterChips: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 },
    chip: {
      display: 'inline-flex', alignItems: 'center', gap: 6, background: t.btn,
      border: `1px solid ${t.border}`, borderRadius: 20, padding: '4px 10px',
      color: t.text2, cursor: 'pointer', fontFamily: mono, fontSize: 10.5,
    },
    chipDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
    filterDivider: { borderTop: `1px solid ${t.border}`, margin: '12px 0' },
    presetList: { display: 'flex', flexDirection: 'column', gap: 5, marginTop: 10 },
    presetChip: {
      textAlign: 'left', background: t.btn, border: `1px solid ${t.border}`, borderRadius: 4,
      padding: '7px 9px', color: t.text2, cursor: 'pointer', fontSize: 11, lineHeight: 1.35, fontFamily: mono,
    },
    askErr: {
      marginTop: 10, background: '#3b1d0e', border: '1px solid #f97316', color: '#fdba74',
      fontSize: 11, padding: '7px 9px', borderRadius: 4, lineHeight: 1.4,
    },
    askInfo: {
      marginTop: 10, background: t.solid, border: `1px solid ${t.border}`, color: t.muted,
      fontSize: 11, padding: '7px 9px', borderRadius: 4, lineHeight: 1.45,
    },
    answer: { marginTop: 10, borderTop: `1px solid ${t.border}`, paddingTop: 10 },
    answerQ: { fontSize: 10, color: t.faint, letterSpacing: '.04em' },
    answerA: { fontSize: 12.5, color: t.text, marginTop: 4, lineHeight: 1.5 },
    cypher: {
      marginTop: 8, background: t.solid, border: `1px solid ${t.border}`, borderRadius: 4,
      padding: '8px 9px', color: t.cypher, fontSize: 10.5, lineHeight: 1.45,
      whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 160, overflowY: 'auto',
    },
    clearBtn: {
      marginTop: 8, background: 'transparent', border: `1px solid ${t.border}`, borderRadius: 4,
      color: t.muted, cursor: 'pointer', fontSize: 10, padding: '4px 10px', fontFamily: mono,
    },
    legend: {
      position: 'absolute', left: 20, bottom: 20, zIndex: 2, display: 'flex', flexDirection: 'column', gap: 6,
      background: t.legend, border: `1px solid ${t.border}`, borderRadius: 6, padding: '10px 12px',
      fontFamily: mono, fontSize: 11, color: t.text2,
    },
    legendHead: { fontSize: 9, letterSpacing: '.16em', color: t.faint },
    legendRow: { display: 'flex', alignItems: 'center', gap: 8 },
    legendBtn: {
      display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none',
      color: t.text2, cursor: 'pointer', fontFamily: mono, fontSize: 11, padding: '1px 0', textAlign: 'left',
    },
    legendDot: { width: 9, height: 9, borderRadius: '50%', display: 'inline-block', flexShrink: 0 },
    legendArrow: { width: 9, textAlign: 'center', fontWeight: 700, display: 'inline-block' },
    legendCount: { marginLeft: 'auto', paddingLeft: 10, color: t.faint, fontVariantNumeric: 'tabular-nums' },
    browserBtn: {
      marginTop: 10, display: 'block', textAlign: 'center', textDecoration: 'none',
      background: t.btn, border: '1px solid #34d39955', borderRadius: 4, padding: '6px 9px',
      color: '#34d399', fontFamily: mono, fontSize: 10.5, cursor: 'pointer',
    },

    stats: {
      position: 'absolute', right: 20, top: 64, zIndex: 3, width: 230,
      background: t.bg, border: `1px solid ${t.border}`, borderRadius: 8, padding: 14,
      fontFamily: mono, color: t.text, boxShadow: t.shadow,
    },
    statsHead: { fontSize: 10, letterSpacing: '.16em', color: t.muted, marginBottom: 10 },
    statGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
    stat: { background: t.solid, border: `1px solid ${t.border2}`, borderRadius: 5, padding: '8px 10px' },
    statValue: { fontSize: 20, fontWeight: 700, lineHeight: 1 },
    statLabel: { fontSize: 9, letterSpacing: '.08em', color: t.faint, marginTop: 3, textTransform: 'uppercase' },
    coverageRow: { display: 'flex', justifyContent: 'space-between', fontSize: 10, color: t.muted, marginTop: 12 },
    coverageBar: { height: 5, background: t.border2, borderRadius: 3, marginTop: 5, overflow: 'hidden' },
    coverageFill: { height: '100%', background: mode === 'dark' ? 'linear-gradient(90deg,#22d3ee,#34d399)' : 'linear-gradient(90deg,#2f7d84,#4d7a46)', borderRadius: 3 },
    statAction: {
      marginTop: 10, width: '100%', textAlign: 'left', background: t.btn, border: '1px solid #f9731644',
      borderRadius: 4, color: mode === 'dark' ? '#fdba74' : '#b5622a', cursor: 'pointer', fontSize: 10.5,
      padding: '7px 9px', fontFamily: mono, lineHeight: 1.35,
    },

    card: {
      position: 'absolute', right: 20, bottom: 20, zIndex: 2, width: 248,
      maxHeight: 'calc(100vh - 320px)', overflowY: 'auto',
      background: t.card, border: '1px solid', borderRadius: 8, padding: '14px 16px',
      fontFamily: mono, color: t.text,
    },
    actions: { marginTop: 12, borderTop: `1px solid ${t.border}`, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 },
    actionLinks: { display: 'flex', flexWrap: 'wrap', gap: 6 },
    actionBtn: {
      display: 'inline-block', background: t.btn, border: `1px solid ${t.border}`, borderRadius: 4,
      padding: '5px 9px', color: t.text2, fontFamily: mono, fontSize: 10.5, textDecoration: 'none', cursor: 'pointer',
    },
    statusRow: { display: 'flex', alignItems: 'center', gap: 8 },
    statusLabel: { fontSize: 9, letterSpacing: '.12em', color: t.faint, textTransform: 'uppercase' },
    statusSelect: {
      flex: 1, background: t.solid, border: '1px solid', borderRadius: 4, padding: '5px 7px',
      fontFamily: mono, fontSize: 11, cursor: 'pointer', outline: 'none',
    },
    openDetailBtn: {
      width: '100%', background: t.btn, border: `1px solid ${t.accentDim}`, borderRadius: 4,
      padding: '7px 9px', color: t.accent, fontFamily: mono, fontSize: 11, cursor: 'pointer',
    },
    connections: { marginTop: 12, borderTop: `1px solid ${t.border}`, paddingTop: 10 },
    connHead: { fontSize: 9, letterSpacing: '.1em', color: t.faint, marginBottom: 6 },
    connRow: {
      display: 'flex', alignItems: 'center', gap: 7, width: '100%', textAlign: 'left',
      background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 0',
      fontFamily: mono, color: t.text2, fontSize: 11,
    },
    connDot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
    connRel: { color: t.faint, fontSize: 10, minWidth: 66, flexShrink: 0 },
    connName: { color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    cardKind: { fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase' },
    cardTitle: { fontSize: 15, fontWeight: 600, margin: '4px 0 2px' },
    cardSub: { fontSize: 12, color: t.cardSub },
    cardHint: { fontSize: 10, color: t.faint2, marginTop: 10 },
    hint: {
      position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 2,
      color: t.faint2, fontFamily: mono, fontSize: 11, pointerEvents: 'none',
    },
    bulkBar: {
      position: 'absolute', bottom: 52, left: '50%', transform: 'translateX(-50%)', zIndex: 4,
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', maxWidth: '92vw',
      background: t.bg, border: `1px solid ${t.accentDim}`, borderRadius: 8, padding: '8px 12px',
      boxShadow: t.shadow, fontFamily: mono, color: t.text,
    },
    bulkCount: { fontSize: 11, color: t.text2, letterSpacing: '.04em', fontWeight: 600 },
    bulkSelect: {
      background: t.solid, border: `1px solid ${t.border}`, borderRadius: 4, color: t.text,
      fontFamily: mono, fontSize: 11, padding: '5px 7px', cursor: 'pointer', outline: 'none',
    },
    bulkBtn: {
      background: t.btn, border: `1px solid ${t.accentDim}`, borderRadius: 4, color: t.accent,
      fontFamily: mono, fontSize: 11, padding: '5px 11px', cursor: 'pointer',
    },
    bulkClear: {
      background: 'transparent', border: `1px solid ${t.border}`, borderRadius: 4, color: t.muted,
      fontFamily: mono, fontSize: 10.5, padding: '5px 9px', cursor: 'pointer',
    },
    bulkMsg: { fontSize: 10.5, color: '#34d399' },
    themeBtn: {
      fontFamily: mono, fontSize: 11, color: t.text, background: t.btn,
      border: `1px solid ${t.border}`, borderRadius: 4, padding: '6px 12px', cursor: 'pointer',
    },
  }
}
