import { useEffect, useRef } from 'react'

// Orbit "science exhibit" — an interactive, animated About view that explains
// how the app works and why, station by station. Pure SVG/CSS animation, no
// deps. Opened from the header; full-screen dark overlay matching graph space.

const TEAL = '#22d3ee'
const PURPLE = '#a78bfa'
const ORANGE = '#f97316'
const GREEN = '#34d399'

export function AboutExhibit({ onClose }: { onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null)

  // Reveal each station as it scrolls into view — the exhibit "walk".
  useEffect(() => {
    const els = rootRef.current?.querySelectorAll('[data-reveal]')
    if (!els) return
    const obs = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('ax-in') }),
      { threshold: 0.25 },
    )
    els.forEach(el => obs.observe(el))
    return () => obs.disconnect()
  }, [])

  return (
    <div className="ax-root" ref={rootRef}>
      <style>{CSS}</style>

      <header className="ax-top">
        <div className="ax-brand"><span className="ax-brand-dot" /> ORBIT <span className="ax-brand-sub">/ how it works</span></div>
        <div style={{ flex: 1 }} />
        <button className="ax-close" onClick={onClose}>Close ✕</button>
      </header>

      <div className="ax-scroll">
        {/* HERO */}
        <section className="ax-hero" data-reveal>
          <div className="ax-hero-badge">A KNOWLEDGE GRAPH YOU CAN FLY THROUGH</div>
          <h1 className="ax-hero-title">Orbit</h1>
          <p className="ax-hero-lead">
            Outreach means juggling three questions at once — who's a real contact, have we
            reached them, which venues are still untouched. In a flat table that's three joins
            and a headache. As a graph, it's <em>one question</em>. Orbit turns your leads into a
            live graph you can explore, ask in plain English, and grow as you work.
          </p>
          <div className="ax-scroll-hint">scroll to walk the exhibit ↓</div>
        </section>

        {/* STATION 1 — DATA CASCADE */}
        <Station n="01" title="The data cascade" reveal>
          <p className="ax-why">
            The same view works whether or not a database exists yet. Orbit resolves its graph
            from the first available source — so it demos today and lights up with live data the
            moment you connect Aura. Synthetic sample data is always badged, never mistaken for real.
          </p>
          <svg viewBox="0 0 640 260" className="ax-svg">
            {[
              { y: 46, c: GREEN, label: 'LIVE · NEO4J AURA', note: 'when creds are set' },
              { y: 130, c: TEAL, label: 'YOUR LEADS', note: 'projected from the app' },
              { y: 214, c: ORANGE, label: 'SAMPLE', note: 'labeled, never real' },
            ].map((s, i) => (
              <g key={i}>
                <rect x="16" y={s.y - 22} width="196" height="44" rx="6" fill="#0b0e14" stroke={s.c} strokeOpacity="0.5" />
                <text x="30" y={s.y - 2} className="ax-t" fill={s.c}>{s.label}</text>
                <text x="30" y={s.y + 14} className="ax-t-sm" fill="#64748b">{s.note}</text>
                <path id={`cas${i}`} d={`M212 ${s.y} C 320 ${s.y}, 360 130, 452 130`} fill="none" stroke={s.c} strokeOpacity="0.35" strokeWidth="1.5" className="ax-flow" />
                <circle r="3.5" fill={s.c}>
                  <animateMotion dur={`${2.4 + i * 0.4}s`} repeatCount="indefinite"><mpath href={`#cas${i}`} /></animateMotion>
                </circle>
              </g>
            ))}
            <circle cx="470" cy="130" r="30" fill="#0b0e14" stroke={TEAL} className="ax-pulse-node" />
            <text x="470" y="134" textAnchor="middle" className="ax-t" fill="#e5e7eb">GRAPH</text>
            <text x="470" y="182" textAnchor="middle" className="ax-t-sm" fill="#64748b">first available wins</text>
          </svg>
        </Station>

        {/* STATION 2 — THE MODEL */}
        <Station n="02" title="The graph model" reveal>
          <p className="ax-why">
            Four node types and four typed relationships — the exact shape stored in Neo4j.
            Everything you see, and every question you ask, is expressed in this vocabulary.
          </p>
          <svg viewBox="0 0 640 300" className="ax-svg">
            {/* edges */}
            <Edge id="e1" d="M300 150 L150 80" color={PURPLE} label="works at" lx={210} ly={105} />
            <Edge id="e2" d="M150 80 L110 210" color={ORANGE} label="verified by" lx={70} ly={150} />
            <Edge id="e3" d="M150 80 L340 250" color={GREEN} label="enrolled in" lx={230} ly={185} />
            <Edge id="e4" d="M470 210 L300 150" color={TEAL} label="targets" lx={370} ly={195} />
            {/* nodes */}
            <Node x={300} y={150} c={TEAL} label="Venue" kind="Neon Cellar" />
            <Node x={150} y={80} c={PURPLE} label="Contact" kind="booker" />
            <Node x={110} y={210} c={ORANGE} label="Source" kind="Overpass" />
            <Node x={470} y={210} c={GREEN} label="Sequence" kind="Active" />
          </svg>
          <div className="ax-legend-inline">
            <span><i style={{ background: TEAL }} />Venue</span>
            <span><i style={{ background: PURPLE }} />Contact</span>
            <span><i style={{ background: ORANGE }} />Source</span>
            <span><i style={{ background: GREEN }} />Sequence</span>
          </div>
        </Station>

        {/* STATION 3 — INGEST PIPELINE */}
        <Station n="03" title="From lead to graph" reveal>
          <p className="ax-why">
            As you discover leads they flow through a pipeline: <b>sanitize</b> strips personal
            data (an email becomes just its domain) and refuses any field it doesn't recognize,
            then each lead is <b>MERGE</b>d into Aura — keyed on a stable id, so re-running never
            duplicates. It upserts.
          </p>
          <div className="ax-pipe">
            <Stage color={TEAL} title="DISCOVER" sub="scrape / add leads" />
            <Pipe />
            <Stage color={ORANGE} title="SANITIZE" sub="PII stripped, audited" transform />
            <Pipe />
            <Stage color={GREEN} title="MERGE → AURA" sub="idempotent upsert" />
          </div>
          <div className="ax-transform">
            <code className="ax-code-was">jane@neoncellar.com</code>
            <span className="ax-arrow">→</span>
            <code className="ax-code-is">@neoncellar.com</code>
            <span className="ax-transform-note">name → initial · address → district · notes → removed</span>
          </div>
        </Station>

        {/* STATION 4 — ASK THE GRAPH */}
        <Station n="04" title="Ask the graph" reveal>
          <p className="ax-why">
            Two engines. <b>Presets</b> run in-memory over the graph and work with no setup —
            click a question, the answer nodes light up. <b>Free text</b> sends your question to
            an LLM that writes <b>read-only</b> Cypher, runs it on Aura, and highlights the result.
            Write queries are hard-refused — the demo graph is never mutated by a question.
          </p>
          <div className="ax-ask">
            <div className="ax-ask-chip ax-ask-q">"Which venues have no verified contact?"</div>
            <div className="ax-ask-lane">
              <span className="ax-ask-step" style={{ borderColor: PURPLE, color: PURPLE }}>LLM</span>
              <span className="ax-ask-pipe" />
              <span className="ax-ask-step ax-mono-chip">{'MATCH (v:Venue) WHERE NOT (…)-[:WORKS_AT]->(v)'}</span>
              <span className="ax-ask-pipe" />
              <span className="ax-ask-step" style={{ borderColor: GREEN, color: GREEN }}>NEO4J</span>
              <span className="ax-ask-pipe" />
              <span className="ax-ask-step" style={{ borderColor: TEAL, color: TEAL }}>NODES LIGHT UP</span>
            </div>
            <div className="ax-ask-note">read-only · CREATE / MERGE / DELETE refused</div>
          </div>
        </Station>

        {/* STATION 5 — THE STACK */}
        <Station n="05" title="What runs where — and why" reveal>
          <div className="ax-stack">
            <StackRow layer="INTERFACE" color={TEAL} items={[
              ['React 19 + Vite + TS', 'the base Pocket Leads app, local-first'],
              ['3d-force-graph + Three.js', 'the immersive scene; vanilla lib avoids React-19 peer issues'],
              ['three-spritetext', 'always-on node labels'],
            ]} />
            <StackRow layer="AI" color={PURPLE} items={[
              ['Resilient OpenRouter client', 'free-tier NL→Cypher that never spins-then-nothing'],
              ['Read-only Cypher guard', 'a question can never write to the graph'],
            ]} />
            <StackRow layer="GRAPH" color={GREEN} items={[
              ['Neo4j Aura', 'the knowledge graph; GraphRAG centerpiece'],
              ['neo4j-driver-lite', 'browser reads + live MERGE sync, lazy-loaded'],
            ]} />
            <StackRow layer="DATA PIPELINE" color={ORANGE} items={[
              ['Python: sanitize.py / load_graph.py', 'one-shot PII strip + bulk load, Python-native ecosystem'],
              ['Cypher schema + MCP', 'constraints, indexes, agent access'],
            ]} />
          </div>
        </Station>

        <footer className="ax-footer" data-reveal>
          <div className="ax-footer-grid">
            <div><span className="ax-dot" style={{ background: GREEN }} /> local-first — runs with zero backend</div>
            <div><span className="ax-dot" style={{ background: TEAL }} /> read-only demo agent — never mutates the graph</div>
            <div><span className="ax-dot" style={{ background: ORANGE }} /> secrets stay in .env — never committed</div>
          </div>
          <button className="ax-enter" onClick={onClose}>Enter Orbit →</button>
        </footer>
      </div>
    </div>
  )
}

// ---- small building blocks -------------------------------------------------

function Station({ n, title, children, reveal }: { n: string; title: string; children: React.ReactNode; reveal?: boolean }) {
  return (
    <section className="ax-station" data-reveal={reveal ? '' : undefined}>
      <div className="ax-station-head">
        <span className="ax-station-n">{n}</span>
        <h2 className="ax-station-title">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function Node({ x, y, c, label, kind }: { x: number; y: number; c: string; label: string; kind: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r="17" fill={c} className="ax-node-glow" style={{ ['--gc' as any]: c }} />
      <text x={x} y={y + 34} textAnchor="middle" className="ax-t" fill="#e5e7eb">{label}</text>
      <text x={x} y={y + 48} textAnchor="middle" className="ax-t-sm" fill="#64748b">{kind}</text>
    </g>
  )
}

function Edge({ id, d, color, label, lx, ly }: { id: string; d: string; color: string; label: string; lx: number; ly: number }) {
  return (
    <g>
      <path id={id} d={d} fill="none" stroke={color} strokeOpacity="0.4" strokeWidth="1.5" className="ax-flow" />
      <circle r="3" fill={color}><animateMotion dur="2.6s" repeatCount="indefinite"><mpath href={`#${id}`} /></animateMotion></circle>
      <text x={lx} y={ly} className="ax-t-sm" fill={color}>{label}</text>
    </g>
  )
}

function Stage({ color, title, sub }: { color: string; title: string; sub: string; transform?: boolean }) {
  return (
    <div className="ax-stage" style={{ borderColor: color }}>
      <div className="ax-stage-title" style={{ color }}>{title}</div>
      <div className="ax-stage-sub">{sub}</div>
    </div>
  )
}

function Pipe() {
  return <div className="ax-pipe-seg"><span className="ax-pipe-dot" /></div>
}

function StackRow({ layer, color, items }: { layer: string; color: string; items: [string, string][] }) {
  return (
    <div className="ax-stack-row">
      <div className="ax-stack-layer" style={{ color, borderColor: color }}>{layer}</div>
      <div className="ax-stack-items">
        {items.map(([t, why], i) => (
          <div key={i} className="ax-stack-item">
            <span className="ax-stack-tech">{t}</span>
            <span className="ax-stack-why">{why}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const CSS = `
.ax-root { position: fixed; inset: 0; z-index: 1100; background: radial-gradient(120% 90% at 50% 0%, #0a1018 0%, #05060a 55%); color: #e5e7eb; font-family: 'DM Mono', ui-monospace, monospace; }
.ax-top { position: sticky; top: 0; z-index: 2; height: 52px; display: flex; align-items: center; gap: 12px; padding: 0 20px; background: linear-gradient(#05060aee, #05060a00); }
.ax-brand { display: flex; align-items: center; gap: 8px; font-size: 14px; letter-spacing: .14em; font-weight: 600; }
.ax-brand-dot { width: 8px; height: 8px; border-radius: 50%; background: ${TEAL}; box-shadow: 0 0 12px ${TEAL}; }
.ax-brand-sub { color: #64748b; font-size: 11px; letter-spacing: .08em; }
.ax-close { font: 11px 'DM Mono', monospace; color: #e5e7eb; background: #111826; border: 1px solid #1f2937; border-radius: 4px; padding: 6px 12px; cursor: pointer; }
.ax-scroll { height: calc(100vh - 52px); overflow-y: auto; scroll-behavior: smooth; }

[data-reveal] { opacity: 0; transform: translateY(24px); transition: opacity .7s ease, transform .7s ease; }
[data-reveal].ax-in { opacity: 1; transform: none; }

.ax-hero { max-width: 760px; margin: 0 auto; padding: 90px 24px 60px; text-align: center; }
.ax-hero-badge { display: inline-block; font-size: 10px; letter-spacing: .22em; color: ${TEAL}; border: 1px solid ${TEAL}44; border-radius: 999px; padding: 5px 14px; }
.ax-hero-title { font-size: 84px; font-weight: 700; letter-spacing: .04em; margin: 22px 0 8px; background: linear-gradient(120deg, ${TEAL}, ${PURPLE} 60%, ${GREEN}); -webkit-background-clip: text; background-clip: text; color: transparent; }
.ax-hero-lead { font-size: 16px; line-height: 1.7; color: #cbd5e1; }
.ax-hero-lead em { color: ${TEAL}; font-style: normal; }
.ax-scroll-hint { margin-top: 40px; color: #475569; font-size: 12px; animation: ax-bob 2s ease-in-out infinite; }
@keyframes ax-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(6px) } }

.ax-station { max-width: 860px; margin: 0 auto; padding: 70px 24px; border-top: 1px solid #10161f; }
.ax-station-head { display: flex; align-items: baseline; gap: 14px; margin-bottom: 18px; }
.ax-station-n { font-size: 13px; color: ${TEAL}; letter-spacing: .2em; }
.ax-station-title { font-size: 26px; font-weight: 700; letter-spacing: .01em; }
.ax-why { font-size: 14.5px; line-height: 1.7; color: #9fb0c3; max-width: 680px; margin-bottom: 26px; }
.ax-why b { color: #e5e7eb; font-weight: 600; }

.ax-svg { width: 100%; height: auto; background: #070a10; border: 1px solid #141a24; border-radius: 10px; }
.ax-t { font: 600 12px 'DM Mono', monospace; }
.ax-t-sm { font: 400 10px 'DM Mono', monospace; }
.ax-flow { stroke-dasharray: 5 6; animation: ax-dash 1s linear infinite; }
@keyframes ax-dash { to { stroke-dashoffset: -22; } }
.ax-pulse-node { animation: ax-pulse 2.2s ease-in-out infinite; }
@keyframes ax-pulse { 0%,100% { stroke-opacity: .5; } 50% { stroke-opacity: 1; filter: drop-shadow(0 0 6px ${TEAL}); } }
.ax-node-glow { filter: drop-shadow(0 0 7px var(--gc)); animation: ax-nodepulse 3s ease-in-out infinite; }
@keyframes ax-nodepulse { 0%,100% { opacity: .85 } 50% { opacity: 1 } }

.ax-legend-inline { display: flex; gap: 18px; margin-top: 16px; font-size: 12px; color: #cbd5e1; flex-wrap: wrap; }
.ax-legend-inline span { display: flex; align-items: center; gap: 7px; }
.ax-legend-inline i { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }

.ax-pipe { display: flex; align-items: stretch; gap: 0; }
.ax-stage { flex: 1; background: #0b0e14; border: 1px solid; border-radius: 8px; padding: 18px 14px; text-align: center; }
.ax-stage-title { font-size: 13px; font-weight: 700; letter-spacing: .1em; }
.ax-stage-sub { font-size: 11px; color: #64748b; margin-top: 6px; }
.ax-pipe-seg { position: relative; width: 54px; align-self: center; height: 2px; background: #1f2937; overflow: visible; }
.ax-pipe-dot { position: absolute; top: -3px; left: 0; width: 8px; height: 8px; border-radius: 50%; background: ${TEAL}; box-shadow: 0 0 8px ${TEAL}; animation: ax-travel 1.8s linear infinite; }
@keyframes ax-travel { from { left: -4px; opacity: 0 } 10% { opacity: 1 } 90% { opacity: 1 } to { left: 50px; opacity: 0 } }

.ax-transform { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 22px; padding: 16px; background: #070a10; border: 1px solid #141a24; border-radius: 8px; }
.ax-code-was { color: #f87171; text-decoration: line-through; font-size: 13px; }
.ax-code-is { color: ${GREEN}; font-size: 13px; }
.ax-arrow { color: #64748b; }
.ax-transform-note { color: #64748b; font-size: 11px; margin-left: auto; }

.ax-ask { background: #070a10; border: 1px solid #141a24; border-radius: 10px; padding: 22px; }
.ax-ask-chip { display: inline-block; background: #0b0e14; border: 1px solid #1f2937; border-radius: 6px; padding: 9px 14px; font-size: 13px; }
.ax-ask-q { color: #e5e7eb; }
.ax-ask-lane { display: flex; align-items: center; gap: 8px; margin-top: 18px; flex-wrap: wrap; }
.ax-ask-step { border: 1px solid; border-radius: 6px; padding: 8px 12px; font-size: 11px; letter-spacing: .06em; white-space: nowrap; }
.ax-mono-chip { color: #67e8f9; border-color: #164e63; background: #05060a; font-size: 10.5px; letter-spacing: 0; }
.ax-ask-pipe { width: 26px; height: 2px; background: #1f2937; position: relative; }
.ax-ask-pipe::after { content: ''; position: absolute; top: -3px; width: 7px; height: 7px; border-radius: 50%; background: ${PURPLE}; box-shadow: 0 0 7px ${PURPLE}; animation: ax-lane 1.6s linear infinite; }
@keyframes ax-lane { from { left: -4px; opacity: 0 } 20%,80% { opacity: 1 } to { left: 22px; opacity: 0 } }
.ax-ask-note { margin-top: 16px; font-size: 11px; color: #64748b; }

.ax-stack { display: flex; flex-direction: column; gap: 12px; }
.ax-stack-row { display: flex; gap: 16px; align-items: flex-start; }
.ax-stack-layer { flex-shrink: 0; width: 130px; font-size: 11px; letter-spacing: .12em; border-left: 2px solid; padding: 4px 0 4px 12px; }
.ax-stack-items { flex: 1; display: flex; flex-direction: column; gap: 8px; }
.ax-stack-item { display: flex; flex-direction: column; gap: 2px; background: #0b0e14; border: 1px solid #141a24; border-radius: 6px; padding: 10px 14px; }
.ax-stack-tech { font-size: 13px; color: #e5e7eb; }
.ax-stack-why { font-size: 11.5px; color: #64748b; }

.ax-footer { max-width: 860px; margin: 0 auto; padding: 60px 24px 90px; text-align: center; border-top: 1px solid #10161f; }
.ax-footer-grid { display: flex; flex-direction: column; gap: 10px; align-items: center; font-size: 13px; color: #9fb0c3; }
.ax-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; }
.ax-enter { margin-top: 34px; background: linear-gradient(120deg, ${TEAL}, ${GREEN}); color: #05060a; border: none; border-radius: 6px; padding: 12px 26px; font: 700 13px 'DM Mono', monospace; letter-spacing: .04em; cursor: pointer; }
.ax-enter:hover { filter: brightness(1.1); }

@media (max-width: 640px) {
  .ax-hero-title { font-size: 56px; }
  .ax-stack-row { flex-direction: column; gap: 6px; }
  .ax-pipe { flex-direction: column; gap: 10px; }
  .ax-pipe-seg { width: 2px; height: 34px; }
}
`
