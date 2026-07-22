import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import SpriteText from 'three-spritetext'
import ForceGraph3D from '3d-force-graph'
import type { Lead } from '../types'
import type { GraphData, GraphNode, GraphLink } from './types'
import { KIND_COLOR, KIND_LABEL } from './types'
import { buildGraphFromLeads } from './buildGraph'
import { sampleGraph } from './sampleGraph'
import { isLiveConfigured, fetchLiveGraph } from './neo4jSource'
import { PRESETS, askLive, liveAvailable, type AskResult } from './ask'

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

export function GraphOverlay({ leads, onClose, openRouterApiKey, openRouterModel }: {
  leads: Lead[]
  onClose: () => void
  openRouterApiKey?: string
  openRouterModel?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<any>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [meta, setMeta] = useState<{ origin: Origin; nodes: number; links: number; note?: string } | null>(null)
  const [liveWarning, setLiveWarning] = useState<string | null>(null)
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [errMsg, setErrMsg] = useState('')
  const [graphData, setGraphData] = useState<GraphData | null>(null)

  // Ask panel state
  const [askInput, setAskInput] = useState('')
  const [asking, setAsking] = useState(false)
  const [askResult, setAskResult] = useState<(AskResult & { q: string }) | null>(null)
  const [askError, setAskError] = useState('')
  const canAskLive = liveAvailable(openRouterApiKey)

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
      let focused: GraphNode | null = null

      const nodeIsHot = (n: any) => highlightNodes.size === 0 || highlightNodes.has(n.id)

      const linkRestColor = (l: any) =>
        highlightLinks.has(l) ? LINK_COLOR[l.kind as GraphLink['kind']]
          : highlightNodes.size ? '#151b26'
          : LINK_DIM[l.kind as GraphLink['kind']]

      const Graph = new ForceGraph3D(el, { controlType: 'orbit' })
        .backgroundColor('#05060a')
        .graphData(structuredClone(data))
        .nodeRelSize(4)
        .nodeVal((n: any) => (n.kind === 'venue' ? 6 : n.kind === 'sequence' ? 5 : 3))
        .nodeOpacity(1)
        .nodeColor((n: any) => (nodeIsHot(n) ? KIND_COLOR[n.kind as GraphNode['kind']] : DIM))
        // Permanent text label on every node — kept alongside the default sphere.
        .nodeThreeObjectExtend(true)
        .nodeThreeObject((n: any) => {
          const kind = n.kind as GraphNode['kind']
          const t = new SpriteText(n.label)
          t.color = '#dfe6f0'
          t.fontFace = 'DM Mono, ui-monospace, monospace'
          t.fontWeight = '600'
          t.textHeight = kind === 'venue' || kind === 'sequence' ? 3.4 : 2.4
          // Solid opaque plate; near-invisible neutral border (no neon frame).
          t.backgroundColor = 'rgba(6,8,13,0.82)'
          t.borderColor = 'rgba(120,132,148,0.18)'
          t.borderWidth = 0.15
          t.borderRadius = 2.5
          t.padding = 2.2
          t.position.set(0, kind === 'venue' ? 11 : kind === 'sequence' ? 10 : 8, 0)
          return t
        })
        // Hover card carries the detail so the always-on labels stay short.
        .nodeLabel((n: any) => `
          <div style="font:12px/1.4 'DM Mono',monospace;background:#0b0e14;border:1px solid ${KIND_COLOR[n.kind as GraphNode['kind']]};
            padding:6px 9px;border-radius:4px;color:#e5e7eb;max-width:220px">
            <div style="color:${KIND_COLOR[n.kind as GraphNode['kind']]};text-transform:uppercase;letter-spacing:.1em;font-size:9px">
              ${KIND_LABEL[n.kind as GraphNode['kind']]}${n.verified ? ' · verified' : ''}</div>
            <div style="font-weight:600;margin-top:2px">${n.label}</div>
            ${n.sub ? `<div style="color:#9ca3af">${n.sub}</div>` : ''}
            ${n.district ? `<div style="color:#9ca3af">${n.district}</div>` : ''}
          </div>`)
        .linkColor(linkRestColor)
        .linkWidth((l: any) => (highlightLinks.has(l) ? 1.8 : 0.7))
        .linkOpacity(0.6)
        // Arrowheads show relationship DIRECTION (who relates to whom) at rest.
        .linkDirectionalArrowLength(3.4)
        .linkDirectionalArrowRelPos(0.92)
        .linkDirectionalArrowColor(linkRestColor)
        .linkLabel((l: any) => `<span style="font:10px 'DM Mono',monospace;color:${LINK_COLOR[l.kind as GraphLink['kind']]}">${REL_LABEL[l.kind as GraphLink['kind']]}</span>`)
        // Particles now only stream on the focused neighbourhood — less noise.
        .linkDirectionalParticles((l: any) => (highlightLinks.has(l) ? 3 : 0))
        .linkDirectionalParticleWidth(1.8)
        .linkDirectionalParticleSpeed(0.008)
        .width(el.clientWidth)
        .height(el.clientHeight)

      // Spread nodes out further so labels don't collide.
      Graph.d3Force('charge')?.strength(-320)

      // Very gentle bloom: nodes still glow softly, but thin label text no
      // longer smears (low strength + tight radius keeps small bright areas crisp).
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(el.clientWidth, el.clientHeight), 0.32, 0.28, 0.35,
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
      Graph.scene().add(stars)

      // Gentle cinematic auto-orbit; pauses while a node is focused.
      const controls: any = Graph.controls()
      controls.autoRotate = true
      controls.autoRotateSpeed = 0.55

      function refreshHighlight() {
        Graph.nodeColor(Graph.nodeColor())
          .linkColor(Graph.linkColor())
          .linkWidth(Graph.linkWidth())
          .linkDirectionalArrowColor(Graph.linkDirectionalArrowColor())
          .linkDirectionalParticles(Graph.linkDirectionalParticles())
      }

      function selectNode(node: any) {
        focused = node
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

      Graph.onNodeClick(selectNode)

      Graph.onBackgroundClick(() => {
        focused = null
        controls.autoRotate = true
        highlightNodes.clear()
        highlightLinks.clear()
        refreshHighlight()
        setSelected(null)
      })

      // Imperative handle for the ask panel: light up an arbitrary node set.
      function focusNodes(ids: string[]) {
        highlightNodes.clear()
        highlightLinks.clear()
        setSelected(null)
        if (ids.length === 0) { controls.autoRotate = true; refreshHighlight(); return }
        ids.forEach(id => highlightNodes.add(id))
        for (const l of (Graph.graphData().links as any[])) {
          const s = typeof l.source === 'object' ? l.source.id : l.source
          const t = typeof l.target === 'object' ? l.target.id : l.target
          if (highlightNodes.has(s) && highlightNodes.has(t)) highlightLinks.add(l)
        }
        refreshHighlight()
        controls.autoRotate = false
        Graph.zoomToFit(1400, 90, (n: any) => highlightNodes.has(n.id))
      }

      // Select a node by id (used by the connections list to navigate).
      function selectNodeById(id: string) {
        const node = (Graph.graphData().nodes as any[]).find(n => n.id === id)
        if (node) selectNode(node)
      }

      const onResize = () => Graph.width(el.clientWidth).height(el.clientHeight)
      window.addEventListener('resize', onResize)

      // fit once the layout settles
      setTimeout(() => Graph.zoomToFit(1200, 60), 700)

      graphRef.current = { Graph, onResize, focusNodes, selectNodeById }
      void focused
    }

    return () => {
      disposed = true
      const g = graphRef.current
      if (g) {
        window.removeEventListener('resize', g.onResize)
        g.Graph._destructor?.()
      }
      graphRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function runPreset(p: typeof PRESETS[number]) {
    if (!graphData) return
    setAskError('')
    const res = p.run(graphData)
    setAskResult({ ...res, q: p.q })
    graphRef.current?.focusNodes(res.nodeIds)
  }

  async function runAsk() {
    const q = askInput.trim()
    if (!q || !graphData) return
    setAskError(''); setAsking(true); setAskResult(null)
    try {
      if (!canAskLive) {
        setAskError('Free-text questions need a live Neo4j Aura connection plus an OpenRouter key. Use a preset below, or connect Aura in .env.')
        return
      }
      const res = await askLive(q, openRouterApiKey!, openRouterModel)
      setAskResult({ ...res, q })
      graphRef.current?.focusNodes(res.nodeIds)
    } catch (e: any) {
      setAskError(String(e?.message ?? e))
    } finally {
      setAsking(false)
    }
  }

  function clearAsk() {
    setAskResult(null); setAskError(''); setAskInput('')
    graphRef.current?.focusNodes([])
  }

  // Legend action: light up every node of a kind.
  function spotlightKind(kind: GraphNode['kind']) {
    if (!graphData) return
    graphRef.current?.focusNodes(graphData.nodes.filter(n => n.kind === kind).map(n => n.id))
  }

  const stats = graphData ? computeStats(graphData) : null
  const neighbors = graphData && selected ? neighborsOf(graphData, selected.id) : []

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
        {meta && <div style={styles.counts}>{meta.nodes} nodes · {meta.links} edges</div>}
        <div style={{ flex: 1 }} />
        <button style={styles.closeBtn} onClick={onClose}>Exit graph ✕</button>
      </div>

      {/* Pipeline stats HUD */}
      {stats && status === 'ready' && (
        <div style={styles.stats}>
          <div style={styles.statsHead}>OUTREACH STATE</div>
          <div style={styles.statGrid}>
            <Stat label="Venues" value={stats.venues} color="#22d3ee" />
            <Stat label="Contacts" value={stats.contacts} color="#a78bfa" />
            <Stat label="Verified" value={stats.verified} color="#34d399" />
            <Stat label="Sources" value={stats.sources} color="#f97316" />
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
              {stats.uncovered} venue{stats.uncovered === 1 ? '' : 's'} with no verified contact →
            </button>
          )}
        </div>
      )}

      {liveWarning && <div style={styles.warn}>{liveWarning}</div>}
      {meta?.origin === 'sample' && <div style={styles.sampleNote}>{meta.note}</div>}

      {status === 'loading' && <div style={styles.center}>connecting to graph…</div>}
      {status === 'error' && <div style={styles.center}>could not build graph — {errMsg}</div>}

      {/* Legend — nodes (dots) + relationships (arrows) */}
      <div style={styles.legend}>
        <div style={styles.legendHead}>NODES · click to spotlight</div>
        {(Object.keys(KIND_COLOR) as GraphNode['kind'][]).map(k => (
          <button key={k} style={styles.legendBtn} onClick={() => spotlightKind(k)} title={`Light up all ${KIND_LABEL[k]} nodes`}>
            <span style={{ ...styles.legendDot, background: KIND_COLOR[k] }} />
            {KIND_LABEL[k]}
          </button>
        ))}
        <div style={{ ...styles.legendHead, marginTop: 8 }}>RELATIONSHIPS</div>
        {(Object.keys(REL_LABEL) as GraphLink['kind'][]).map(k => (
          <div key={k} style={styles.legendRow}>
            <span style={{ ...styles.legendArrow, color: LINK_COLOR[k] }}>→</span>
            {REL_LABEL[k]}
          </div>
        ))}
      </div>

      {/* Ask the graph */}
      {status === 'ready' && (
        <div style={styles.ask}>
          <div style={styles.askHead}>
            ASK THE GRAPH
            <span style={{ ...styles.askLive, color: canAskLive ? '#34d399' : '#475569' }}>
              {canAskLive ? '● live' : '○ presets'}
            </span>
          </div>

          <div style={styles.askRow}>
            <input
              style={styles.askInput}
              placeholder={canAskLive ? 'Ask in plain English…' : 'Connect Aura for free text'}
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
        </div>
      )}

      {/* Selected node card */}
      {selected && (
        <div style={{ ...styles.card, borderColor: KIND_COLOR[selected.kind] }}>
          <div style={{ ...styles.cardKind, color: KIND_COLOR[selected.kind] }}>
            {KIND_LABEL[selected.kind]}{selected.verified ? ' · verified' : ''}
          </div>
          <div style={styles.cardTitle}>{selected.label}</div>
          {selected.sub && <div style={styles.cardSub}>{selected.sub}</div>}
          {selected.district && <div style={styles.cardSub}>{selected.district}</div>}

          {neighbors.length > 0 && (
            <div style={styles.connections}>
              <div style={styles.connHead}>{neighbors.length} connection{neighbors.length === 1 ? '' : 's'} · click to jump</div>
              {neighbors.map((nb, i) => (
                <button key={i} style={styles.connRow} onClick={() => graphRef.current?.selectNodeById(nb.id)}>
                  <span style={{ ...styles.connDot, background: KIND_COLOR[nb.node.kind] }} />
                  <span style={styles.connRel}>{nb.dir === 'out' ? REL_LABEL[nb.rel] : `←${REL_LABEL[nb.rel]}`}</span>
                  <span style={styles.connName}>{nb.node.label}</span>
                </button>
              ))}
            </div>
          )}

          <div style={styles.cardHint}>neighbors highlighted · click empty space to release</div>
        </div>
      )}

      <div style={styles.hint}>drag to orbit · scroll to zoom · click a node to fly in</div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={styles.stat}>
      <div style={{ ...styles.statValue, color }}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, zIndex: 1000, background: '#05060a', overflow: 'hidden' },
  canvas: { position: 'absolute', inset: 0 },
  hudTop: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 52, display: 'flex', alignItems: 'center',
    gap: 14, padding: '0 20px', zIndex: 2,
    background: 'linear-gradient(#05060aee, #05060a00)', color: '#e5e7eb',
    fontFamily: "'DM Mono', monospace",
  },
  brand: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, letterSpacing: '.14em', fontWeight: 600 },
  brandDot: { width: 8, height: 8, borderRadius: '50%', background: '#22d3ee', boxShadow: '0 0 12px #22d3ee' },
  brandSub: { fontSize: 10, color: '#64748b', letterSpacing: '.1em', marginLeft: 4 },
  badge: { fontSize: 10, letterSpacing: '.14em', border: '1px solid', borderRadius: 3, padding: '3px 8px' },
  counts: { fontSize: 11, color: '#64748b' },
  closeBtn: {
    fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#e5e7eb', background: '#111826',
    border: '1px solid #1f2937', borderRadius: 4, padding: '6px 12px', cursor: 'pointer',
  },
  warn: {
    position: 'absolute', top: 60, left: '50%', transform: 'translateX(-50%)', zIndex: 3,
    background: '#3b1d0e', border: '1px solid #f97316', color: '#fdba74', fontFamily: "'DM Mono', monospace",
    fontSize: 11, padding: '6px 12px', borderRadius: 4, maxWidth: '80%', textAlign: 'center',
  },
  sampleNote: {
    position: 'absolute', top: 60, left: '50%', transform: 'translateX(-50%)', zIndex: 3,
    color: '#f97316', fontFamily: "'DM Mono', monospace", fontSize: 10, letterSpacing: '.05em',
  },
  center: {
    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#64748b', fontFamily: "'DM Mono', monospace", fontSize: 13, zIndex: 2, pointerEvents: 'none',
  },
  ask: {
    position: 'absolute', left: 20, top: 64, zIndex: 3, width: 300,
    maxHeight: 'calc(100vh - 200px)', overflowY: 'auto',
    background: '#0b0e14e6', border: '1px solid #1f2937', borderRadius: 8, padding: 14,
    fontFamily: "'DM Mono', monospace", color: '#e5e7eb',
    boxShadow: '0 10px 40px #0008',
  },
  askHead: { fontSize: 11, letterSpacing: '.14em', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  askLive: { fontSize: 10, letterSpacing: '.06em' },
  askRow: { display: 'flex', gap: 6, marginTop: 10 },
  askInput: {
    flex: 1, background: '#05060a', border: '1px solid #1f2937', borderRadius: 4,
    padding: '7px 9px', color: '#e5e7eb', fontFamily: "'DM Mono', monospace", fontSize: 12, outline: 'none',
  },
  askBtn: {
    width: 34, background: '#111826', border: '1px solid #22d3ee55', borderRadius: 4,
    color: '#22d3ee', cursor: 'pointer', fontSize: 14,
  },
  presetList: { display: 'flex', flexDirection: 'column', gap: 5, marginTop: 10 },
  presetChip: {
    textAlign: 'left', background: '#111826', border: '1px solid #1f2937', borderRadius: 4,
    padding: '7px 9px', color: '#cbd5e1', cursor: 'pointer', fontSize: 11, lineHeight: 1.35,
    fontFamily: "'DM Mono', monospace",
  },
  askErr: {
    marginTop: 10, background: '#3b1d0e', border: '1px solid #f97316', color: '#fdba74',
    fontSize: 11, padding: '7px 9px', borderRadius: 4, lineHeight: 1.4,
  },
  answer: {
    marginTop: 10, borderTop: '1px solid #1f2937', paddingTop: 10,
  },
  answerQ: { fontSize: 10, color: '#64748b', letterSpacing: '.04em' },
  answerA: { fontSize: 12.5, color: '#e5e7eb', marginTop: 4, lineHeight: 1.5 },
  cypher: {
    marginTop: 8, background: '#05060a', border: '1px solid #1f2937', borderRadius: 4,
    padding: '8px 9px', color: '#67e8f9', fontSize: 10.5, lineHeight: 1.45,
    whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 160, overflowY: 'auto',
  },
  clearBtn: {
    marginTop: 8, background: 'transparent', border: '1px solid #1f2937', borderRadius: 4,
    color: '#94a3b8', cursor: 'pointer', fontSize: 10, padding: '4px 10px', fontFamily: "'DM Mono', monospace",
  },
  legend: {
    position: 'absolute', left: 20, bottom: 20, zIndex: 2, display: 'flex', flexDirection: 'column', gap: 6,
    background: '#0b0e14cc', border: '1px solid #1f2937', borderRadius: 6, padding: '10px 12px',
    fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#cbd5e1',
  },
  legendHead: { fontSize: 9, letterSpacing: '.16em', color: '#64748b' },
  legendRow: { display: 'flex', alignItems: 'center', gap: 8 },
  legendBtn: {
    display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none',
    color: '#cbd5e1', cursor: 'pointer', fontFamily: "'DM Mono', monospace", fontSize: 11,
    padding: '1px 0', textAlign: 'left',
  },
  legendDot: { width: 9, height: 9, borderRadius: '50%', display: 'inline-block', flexShrink: 0 },
  legendArrow: { width: 9, textAlign: 'center', fontWeight: 700, display: 'inline-block' },

  // Pipeline stats HUD
  stats: {
    position: 'absolute', right: 20, top: 64, zIndex: 3, width: 230,
    background: '#0b0e14e6', border: '1px solid #1f2937', borderRadius: 8, padding: 14,
    fontFamily: "'DM Mono', monospace", color: '#e5e7eb', boxShadow: '0 10px 40px #0008',
  },
  statsHead: { fontSize: 10, letterSpacing: '.16em', color: '#94a3b8', marginBottom: 10 },
  statGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  stat: { background: '#05060a', border: '1px solid #141a24', borderRadius: 5, padding: '8px 10px' },
  statValue: { fontSize: 20, fontWeight: 700, lineHeight: 1 },
  statLabel: { fontSize: 9, letterSpacing: '.08em', color: '#64748b', marginTop: 3, textTransform: 'uppercase' },
  coverageRow: { display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#94a3b8', marginTop: 12 },
  coverageBar: { height: 5, background: '#141a24', borderRadius: 3, marginTop: 5, overflow: 'hidden' },
  coverageFill: { height: '100%', background: 'linear-gradient(90deg,#22d3ee,#34d399)', borderRadius: 3 },
  statAction: {
    marginTop: 10, width: '100%', textAlign: 'left', background: '#111826', border: '1px solid #f9731644',
    borderRadius: 4, color: '#fdba74', cursor: 'pointer', fontSize: 10.5, padding: '7px 9px',
    fontFamily: "'DM Mono', monospace", lineHeight: 1.35,
  },

  card: {
    position: 'absolute', right: 20, bottom: 20, zIndex: 2, width: 248,
    maxHeight: 'calc(100vh - 320px)', overflowY: 'auto',
    background: '#0b0e14f2', border: '1px solid', borderRadius: 8, padding: '14px 16px',
    fontFamily: "'DM Mono', monospace", color: '#e5e7eb',
  },
  connections: { marginTop: 12, borderTop: '1px solid #1f2937', paddingTop: 10 },
  connHead: { fontSize: 9, letterSpacing: '.1em', color: '#64748b', marginBottom: 6 },
  connRow: {
    display: 'flex', alignItems: 'center', gap: 7, width: '100%', textAlign: 'left',
    background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 0',
    fontFamily: "'DM Mono', monospace", color: '#cbd5e1', fontSize: 11,
  },
  connDot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  connRel: { color: '#64748b', fontSize: 10, minWidth: 66, flexShrink: 0 },
  connName: { color: '#e5e7eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cardKind: { fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase' },
  cardTitle: { fontSize: 15, fontWeight: 600, margin: '4px 0 2px' },
  cardSub: { fontSize: 12, color: '#9ca3af' },
  cardHint: { fontSize: 10, color: '#475569', marginTop: 10 },
  hint: {
    position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 2,
    color: '#475569', fontFamily: "'DM Mono', monospace", fontSize: 11, pointerEvents: 'none',
  },
}
