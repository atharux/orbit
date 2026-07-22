import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import ForceGraph3D from '3d-force-graph'
import type { Lead } from '../types'
import type { GraphData, GraphNode, GraphLink } from './types'
import { KIND_COLOR, KIND_LABEL } from './types'
import { buildGraphFromLeads } from './buildGraph'
import { sampleGraph } from './sampleGraph'
import { isLiveConfigured, fetchLiveGraph } from './neo4jSource'

// Full-screen immersive 3D graph. The light dashboard drops away into a dark
// space where venues/contacts float and relationships stream particles. Orbit
// the camera; click a node to fly to it and light up its neighborhood.

type Origin = GraphData['origin']

const LINK_COLOR: Record<GraphLink['kind'], string> = {
  WORKS_AT: '#64748b',
  VERIFIED_BY: '#f97316',
  ENROLLED_IN: '#34d399',
  TARGETS: '#22d3ee',
}

const DIM = '#1f2937'

export function GraphOverlay({ leads, onClose }: { leads: Lead[]; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<any>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [meta, setMeta] = useState<{ origin: Origin; nodes: number; links: number; note?: string } | null>(null)
  const [liveWarning, setLiveWarning] = useState<string | null>(null)
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [errMsg, setErrMsg] = useState('')

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

      const Graph = new ForceGraph3D(el, { controlType: 'orbit' })
        .backgroundColor('#05060a')
        .graphData(structuredClone(data))
        .nodeRelSize(5)
        .nodeVal((n: any) => (n.kind === 'venue' ? 6 : n.kind === 'sequence' ? 5 : 3))
        .nodeOpacity(0.92)
        .nodeColor((n: any) => (nodeIsHot(n) ? KIND_COLOR[n.kind as GraphNode['kind']] : DIM))
        .nodeLabel((n: any) => `
          <div style="font:12px/1.4 'DM Mono',monospace;background:#0b0e14;border:1px solid ${KIND_COLOR[n.kind as GraphNode['kind']]};
            padding:6px 9px;border-radius:4px;color:#e5e7eb;max-width:220px">
            <div style="color:${KIND_COLOR[n.kind as GraphNode['kind']]};text-transform:uppercase;letter-spacing:.1em;font-size:9px">
              ${KIND_LABEL[n.kind as GraphNode['kind']]}${n.verified ? ' · verified' : ''}</div>
            <div style="font-weight:600;margin-top:2px">${n.label}</div>
            ${n.sub ? `<div style="color:#9ca3af">${n.sub}</div>` : ''}
            ${n.district ? `<div style="color:#9ca3af">${n.district}</div>` : ''}
          </div>`)
        .linkColor((l: any) => (highlightLinks.has(l) ? LINK_COLOR[l.kind as GraphLink['kind']] : '#141a24'))
        .linkWidth((l: any) => (highlightLinks.has(l) ? 1.4 : 0.4))
        .linkOpacity(0.5)
        .linkDirectionalParticles((l: any) => (highlightLinks.has(l) || highlightNodes.size === 0 ? 2 : 0))
        .linkDirectionalParticleWidth(1.6)
        .linkDirectionalParticleSpeed(0.006)
        .width(el.clientWidth)
        .height(el.clientHeight)

      // Spread nodes out for a more open, navigable space.
      Graph.d3Force('charge')?.strength(-140)

      // Bloom glow — the core of the "immersion".
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(el.clientWidth, el.clientHeight), 2.4, 0.9, 0.02,
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
          .linkDirectionalParticles(Graph.linkDirectionalParticles())
      }

      Graph.onNodeClick((node: any) => {
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
      })

      Graph.onBackgroundClick(() => {
        focused = null
        controls.autoRotate = true
        highlightNodes.clear()
        highlightLinks.clear()
        refreshHighlight()
        setSelected(null)
      })

      const onResize = () => Graph.width(el.clientWidth).height(el.clientHeight)
      window.addEventListener('resize', onResize)

      // fit once the layout settles
      setTimeout(() => Graph.zoomToFit(1200, 60), 700)

      graphRef.current = { Graph, onResize }
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

      {liveWarning && <div style={styles.warn}>{liveWarning}</div>}
      {meta?.origin === 'sample' && <div style={styles.sampleNote}>{meta.note}</div>}

      {status === 'loading' && <div style={styles.center}>connecting to graph…</div>}
      {status === 'error' && <div style={styles.center}>could not build graph — {errMsg}</div>}

      {/* Legend */}
      <div style={styles.legend}>
        {(Object.keys(KIND_COLOR) as GraphNode['kind'][]).map(k => (
          <div key={k} style={styles.legendRow}>
            <span style={{ ...styles.legendDot, background: KIND_COLOR[k] }} />
            {KIND_LABEL[k]}
          </div>
        ))}
      </div>

      {/* Selected node card */}
      {selected && (
        <div style={{ ...styles.card, borderColor: KIND_COLOR[selected.kind] }}>
          <div style={{ ...styles.cardKind, color: KIND_COLOR[selected.kind] }}>
            {KIND_LABEL[selected.kind]}{selected.verified ? ' · verified' : ''}
          </div>
          <div style={styles.cardTitle}>{selected.label}</div>
          {selected.sub && <div style={styles.cardSub}>{selected.sub}</div>}
          {selected.district && <div style={styles.cardSub}>{selected.district}</div>}
          <div style={styles.cardHint}>neighbors highlighted · click empty space to release</div>
        </div>
      )}

      <div style={styles.hint}>drag to orbit · scroll to zoom · click a node to fly in</div>
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
  legend: {
    position: 'absolute', left: 20, bottom: 20, zIndex: 2, display: 'flex', flexDirection: 'column', gap: 6,
    background: '#0b0e14cc', border: '1px solid #1f2937', borderRadius: 6, padding: '10px 12px',
    fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#cbd5e1',
  },
  legendRow: { display: 'flex', alignItems: 'center', gap: 8 },
  legendDot: { width: 9, height: 9, borderRadius: '50%', display: 'inline-block' },
  card: {
    position: 'absolute', right: 20, bottom: 20, zIndex: 2, width: 240,
    background: '#0b0e14ee', border: '1px solid', borderRadius: 8, padding: '14px 16px',
    fontFamily: "'DM Mono', monospace", color: '#e5e7eb',
  },
  cardKind: { fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase' },
  cardTitle: { fontSize: 15, fontWeight: 600, margin: '4px 0 2px' },
  cardSub: { fontSize: 12, color: '#9ca3af' },
  cardHint: { fontSize: 10, color: '#475569', marginTop: 10 },
  hint: {
    position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 2,
    color: '#475569', fontFamily: "'DM Mono', monospace", fontSize: 11, pointerEvents: 'none',
  },
}
