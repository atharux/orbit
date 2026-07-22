import { useEffect, useRef } from 'react'

// Orbit "exhibit" — an interactive About view styled as an early scientific
// plate. Lineage: Ernst Haeckel's Kunstformen der Natur (labelled naturalist
// plates, ink line-work, Fig. captions) crossed with German modernism —
// Bauhaus → HfG Ulm → Otl Aicher (geometric grotesk, systematic grid).
// Warm paper, ink line diagrams, leader-line labels, muted plate inks, no
// gradients. Technical terms carry interpretive annotations on hover.

// Muted "plate ink" spot colours (desaturated vs the neon graph palette).
const TEAL = '#2f7d84'
const PURPLE = '#6a5aa6'
const ORANGE = '#b5622a'
const GREEN = '#4d7a46'
const INK = '#201e18'

export function AboutExhibit({ onClose }: { onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const els = rootRef.current?.querySelectorAll('[data-reveal]')
    if (!els) return
    const obs = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('ax-in') }),
      { threshold: 0.2 },
    )
    els.forEach(el => obs.observe(el))
    return () => obs.disconnect()
  }, [])

  return (
    <div className="ax-root" ref={rootRef}>
      <style>{CSS}</style>

      <header className="ax-top">
        <div className="ax-brand">ORBIT</div>
        <div className="ax-brand-sub">Tabula · a field guide</div>
        <div style={{ flex: 1 }} />
        <button className="ax-close" onClick={onClose}>Close</button>
      </header>

      <div className="ax-scroll">
        {/* FRONTISPIECE */}
        <section className="ax-hero" data-reveal>
          <div className="ax-kicker">Frontispiece</div>
          <h1 className="ax-hero-title">A knowledge graph,<br />drawn from life.</h1>
          <p className="ax-hero-lead">
            Outreach holds three questions at once: who is a real contact, have we reached them,
            and which venues remain untouched. In a flat table that is three joins. As a{' '}
            <Term def="Data modelled as nodes (things) and edges (the relationships between them), rather than rows in tables.">knowledge graph</Term>{' '}
            it is a single question. Orbit renders your leads as a living specimen you can examine,
            interrogate in plain language, and cultivate as you work.
          </p>
          <div className="ax-hero-rule" />
          <div className="ax-hero-meta">Plates I – V · circa two minutes</div>
        </section>

        {/* PLATE I — CASCADE */}
        <Station n="I" title="Where the data comes from" fig="Fig. 1 — Source resolution, in order of preference.">
          <p className="ax-why">
            The specimen renders whether or not a database yet exists. Orbit draws its graph from
            the first available source, so it runs today and switches to live data the moment you
            connect <Term def="A hosted (cloud) Neo4j graph database — where Orbit's live graph is kept.">Aura</Term>.
            Synthetic data is always marked, never mistaken for a real record.
          </p>
          <figure className="ax-plate">
            <svg viewBox="0 0 640 250" className="ax-svg" role="img" aria-label="Data source cascade">
              {[
                { y: 44, c: GREEN, label: 'LIVE · NEO4J AURA', note: 'when credentials are set' },
                { y: 125, c: TEAL, label: 'YOUR LEADS', note: 'projected from the app' },
                { y: 206, c: ORANGE, label: 'SAMPLE', note: 'marked, never real' },
              ].map((s, i) => (
                <g key={i}>
                  <rect x="18" y={s.y - 21} width="212" height="42" rx="1" fill="none" stroke={INK} strokeOpacity="0.35" />
                  <circle cx="36" cy={s.y} r="4.5" fill="none" stroke={s.c} strokeWidth="1.5" />
                  <circle cx="36" cy={s.y} r="1.6" fill={s.c} />
                  <text x="52" y={s.y - 2} className="ax-svg-label">{s.label}</text>
                  <text x="52" y={s.y + 13} className="ax-svg-sub">{s.note}</text>
                  <path id={`cas${i}`} d={`M230 ${s.y} C 320 ${s.y}, 360 125, 452 125`} fill="none" stroke={INK} strokeOpacity="0.28" strokeWidth="1" className="ax-flow" />
                  <circle r="2.6" fill={s.c}>
                    <animateMotion dur={`${2.8 + i * 0.4}s`} repeatCount="indefinite"><mpath href={`#cas${i}`} /></animateMotion>
                  </circle>
                </g>
              ))}
              <circle cx="470" cy="125" r="30" fill="none" stroke={INK} strokeWidth="1.25" />
              <circle cx="470" cy="125" r="22" fill="none" stroke={INK} strokeOpacity="0.3" strokeDasharray="2 3" />
              <text x="470" y="122" textAnchor="middle" className="ax-svg-label">GRAPH</text>
              <text x="470" y="136" textAnchor="middle" className="ax-svg-sub">first wins</text>
            </svg>
            <figcaption className="ax-fig">Fig. 1 — Source resolution, in order of preference.</figcaption>
          </figure>
        </Station>

        {/* PLATE II — MODEL */}
        <Station n="II" title="How the graph is shaped">
          <p className="ax-why">
            Four classes of <Term def="A node is one thing in the graph — a venue, a contact, a source, or a sequence.">node</Term>,
            and four kinds of <Term def="An edge (relationship) is a typed, directed link between two nodes — e.g. a contact WORKS_AT a venue.">relationship</Term>{' '}
            between them. This is the precise structure held in the database, and the vocabulary in
            which every question is answered.
          </p>
          <figure className="ax-plate">
            <svg viewBox="0 0 640 300" className="ax-svg" role="img" aria-label="Graph model plate">
              <Edge id="e1" d="M300 152 L156 84" color={PURPLE} label="works at" lx={208} ly={108} />
              <Edge id="e2" d="M156 84 L116 208" color={ORANGE} label="verified by" lx={60} ly={150} />
              <Edge id="e3" d="M156 84 L336 246" color={GREEN} label="enrolled in" lx={232} ly={180} />
              <Edge id="e4" d="M462 208 L300 152" color={TEAL} label="targets" lx={366} ly={190} />
              <Node x={300} y={152} c={TEAL} fig="a" label="Venue" kind="Neon Cellar" />
              <Node x={156} y={84} c={PURPLE} fig="b" label="Contact" kind="booker" />
              <Node x={116} y={208} c={ORANGE} fig="c" label="Source" kind="Overpass" />
              <Node x={462} y={208} c={GREEN} fig="d" label="Sequence" kind="Active" />
            </svg>
            <figcaption className="ax-fig">Fig. 2 — The four node classes (a–d) and their relations.</figcaption>
          </figure>
        </Station>

        {/* PLATE III — INGEST */}
        <Station n="III" title="From lead to graph">
          <p className="ax-why">
            Discovered leads pass through an apparatus. <b>Sanitize</b> strips{' '}
            <Term def="Personally Identifiable Information — data that identifies a person, such as an email, phone number, or full name.">PII</Term>{' '}
            (an email is reduced to its domain) and refuses any field it does not recognise. Each
            lead is then <Term def="A Cypher command that creates a node or relationship only if it does not already exist, and updates it if it does.">MERGE</Term>d
            into the database, keyed on a stable identifier — re-running never duplicates. It{' '}
            <Term def="Insert-or-update: create the record if new, update it if it already exists.">upserts</Term>.
          </p>
          <figure className="ax-plate">
            <div className="ax-pipe">
              <Stage numeral="1" color={TEAL} title="DISCOVER" sub="scrape / add leads" />
              <Pipe />
              <Stage numeral="2" color={ORANGE} title="SANITIZE" sub="PII removed, audited" />
              <Pipe />
              <Stage numeral="3" color={GREEN} title="MERGE → AURA" sub="idempotent upsert" />
            </div>
            <div className="ax-transform">
              <code className="ax-code-was">jane@neoncellar.com</code>
              <span className="ax-arrow">reduces to</span>
              <code className="ax-code-is">@neoncellar.com</code>
              <span className="ax-transform-note">name → initial · address → district · notes removed</span>
            </div>
            <figcaption className="ax-fig">Fig. 3 — The ingest apparatus (stages 1–3).</figcaption>
          </figure>
        </Station>

        {/* PLATE IV — ASK */}
        <Station n="IV" title="Interrogating the specimen">
          <p className="ax-why">
            Two instruments. <b>Presets</b> run in memory and need no setup — pose a question and
            the answering nodes illuminate. <b>Free text</b> passes your question to an{' '}
            <Term def="Large Language Model — the AI that turns your plain-language question into a database query.">LLM</Term>{' '}
            which composes <Term def="Neo4j's query language — like SQL, but for graphs: it matches patterns of nodes and relationships.">Cypher</Term>,
            runs it on Aura, and marks the result. The whole path is{' '}
            <Term def="Can read data but never change it — no creates, updates, or deletes.">read-only</Term>;
            a question can never alter the specimen. Together this is{' '}
            <Term def="Retrieval-Augmented Generation over a graph: the AI answers by reading a knowledge graph rather than a pile of documents.">GraphRAG</Term>.
          </p>
          <figure className="ax-plate">
            <div className="ax-ask">
              <div className="ax-ask-q">“Which venues have no verified contact?”</div>
              <div className="ax-ask-lane">
                <span className="ax-ask-step" style={{ color: PURPLE }}>LLM</span>
                <span className="ax-ask-pipe" />
                <span className="ax-ask-step ax-mono-chip">{'MATCH (v:Venue) WHERE NOT (…)-[:WORKS_AT]->(v)'}</span>
                <span className="ax-ask-pipe" />
                <span className="ax-ask-step" style={{ color: GREEN }}>NEO4J</span>
                <span className="ax-ask-pipe" />
                <span className="ax-ask-step" style={{ color: TEAL }}>NODES ILLUMINATE</span>
              </div>
              <div className="ax-ask-note">read-only — create / merge / delete are refused</div>
            </div>
            <figcaption className="ax-fig">Fig. 4 — The question-to-answer instrument.</figcaption>
          </figure>
        </Station>

        {/* PLATE V — STACK */}
        <Station n="V" title="What runs where, and why">
          <div className="ax-stack">
            <StackRow layer="INTERFACE" items={[
              ['React 19 · Vite · TypeScript', 'the base Pocket Leads app, local-first'],
              ['3d-force-graph · Three.js', 'the immersive scene; the plain library sidesteps React-19 peer issues'],
              ['three-spritetext', 'always-on node labels'],
            ]} />
            <StackRow layer="INTELLIGENCE" items={[
              ['Resilient OpenRouter client', 'free-tier NL→Cypher that never spins then shows nothing'],
              ['Read-only query guard', 'a question can never write to the graph'],
            ]} />
            <StackRow layer="GRAPH" items={[
              ['Neo4j Aura', 'the knowledge graph; the centre of the demonstration'],
              ['neo4j-driver-lite', 'browser reads and live sync, loaded only when needed'],
            ]} />
            <StackRow layer="DATA" items={[
              ['Python · sanitize / load', 'one-shot PII strip and bulk load, in a Python-native ecosystem'],
              ['Cypher schema · MCP', 'constraints, indexes, and assistant access'],
            ]} />
          </div>
        </Station>

        <footer className="ax-footer" data-reveal>
          <div className="ax-colophon">Colophon</div>
          <div className="ax-principles">
            <div><span className="ax-mk" style={{ color: GREEN }}>·</span> <Term def="Runs and stores data on your machine by default, with the cloud optional.">Local-first</Term> — runs with zero backend</div>
            <div><span className="ax-mk" style={{ color: TEAL }}>·</span> Read-only demonstration agent — never mutates the graph</div>
            <div><span className="ax-mk" style={{ color: ORANGE }}>·</span> Secrets remain in .env — never committed</div>
          </div>
          <button className="ax-enter" onClick={onClose}>Enter Orbit</button>
        </footer>
      </div>
    </div>
  )
}

// ---- building blocks -------------------------------------------------------

function Term({ children, def }: { children: React.ReactNode; def: string }) {
  return (
    <span className="ax-term" tabIndex={0}>
      {children}
      <span className="ax-tip" role="tooltip">{def}</span>
    </span>
  )
}

function Station({ n, title, children }: { n: string; title: string; fig?: string; children: React.ReactNode }) {
  return (
    <section className="ax-station" data-reveal>
      <div className="ax-station-head">
        <span className="ax-plate-no">Plate {n}</span>
        <div className="ax-station-rule" />
        <h2 className="ax-station-title">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function Node({ x, y, c, label, kind, fig }: { x: number; y: number; c: string; label: string; kind: string; fig: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r="15" fill="none" stroke={c} strokeWidth="1.5" className="ax-node" />
      <circle cx={x} cy={y} r="9" fill="none" stroke={c} strokeOpacity="0.5" strokeWidth="1" />
      <circle cx={x} cy={y} r="2" fill={c} />
      <text x={x} y={y + 32} textAnchor="middle" className="ax-svg-label">{fig}. {label}</text>
      <text x={x} y={y + 45} textAnchor="middle" className="ax-svg-sub">{kind}</text>
    </g>
  )
}

function Edge({ id, d, color, label, lx, ly }: { id: string; d: string; color: string; label: string; lx: number; ly: number }) {
  return (
    <g>
      <path id={id} d={d} fill="none" stroke={INK} strokeOpacity="0.3" strokeWidth="1" className="ax-flow" />
      <circle r="2.4" fill={color}><animateMotion dur="3s" repeatCount="indefinite"><mpath href={`#${id}`} /></animateMotion></circle>
      <text x={lx} y={ly} className="ax-svg-edge" fill={color}>{label}</text>
    </g>
  )
}

function Stage({ numeral, color, title, sub }: { numeral: string; color: string; title: string; sub: string }) {
  return (
    <div className="ax-stage">
      <div className="ax-stage-no" style={{ borderColor: color, color }}>{numeral}</div>
      <div className="ax-stage-title">{title}</div>
      <div className="ax-stage-sub">{sub}</div>
    </div>
  )
}

function Pipe() {
  return <div className="ax-pipe-seg"><span className="ax-pipe-dot" /></div>
}

function StackRow({ layer, items }: { layer: string; items: [string, string][] }) {
  return (
    <div className="ax-stack-row">
      <div className="ax-stack-layer">{layer}</div>
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
.ax-root { position: fixed; inset: 0; z-index: 1100; background: #efeadd; color: ${INK};
  font-family: var(--mono, 'DM Mono', monospace); }
.ax-top { position: sticky; top: 0; z-index: 3; height: 54px; display: flex; align-items: baseline; gap: 14px;
  padding: 16px 26px 0; background: #efeadd; }
.ax-brand { font-family: var(--disp, system-ui); font-size: 18px; font-weight: 600; letter-spacing: .16em; }
.ax-brand-sub { font-size: 11px; letter-spacing: .12em; color: #8b8677; font-style: italic; }
.ax-close { align-self: center; font: 11px var(--mono, monospace); color: ${INK}; background: transparent;
  border: 1px solid #c3bba6; border-radius: 1px; padding: 6px 14px; cursor: pointer; letter-spacing: .06em; }
.ax-close:hover { background: ${INK}; color: #efeadd; }
.ax-scroll { height: calc(100vh - 54px); overflow-y: auto; scroll-behavior: smooth; }

[data-reveal] { opacity: 0; transform: translateY(14px); transition: opacity .6s ease, transform .6s ease; }
[data-reveal].ax-in { opacity: 1; transform: none; }

.ax-kicker { font-size: 11px; letter-spacing: .3em; text-transform: uppercase; color: #8b8677; }

.ax-hero { max-width: 780px; margin: 0 auto; padding: 84px 26px 60px; }
.ax-hero-title { font-family: var(--disp, system-ui); font-weight: 600; font-size: 50px; line-height: 1.1;
  letter-spacing: -0.02em; color: ${INK}; margin: 18px 0 26px; }
.ax-hero-lead { font-family: var(--disp, system-ui); font-size: 18px; line-height: 1.68; color: #47433a; max-width: 640px; }
.ax-hero-rule { height: 1px; background: #d3cbb8; margin: 42px 0 14px; }
.ax-hero-meta { font-size: 11px; letter-spacing: .12em; color: #8b8677; text-transform: uppercase; font-style: italic; }

.ax-station { max-width: 880px; margin: 0 auto; padding: 66px 26px; border-top: 1px solid #ddd5c2; }
.ax-station-head { display: flex; align-items: center; gap: 16px; margin-bottom: 22px; }
.ax-plate-no { font-size: 11px; letter-spacing: .18em; text-transform: uppercase; color: #a89f89;
  min-width: 74px; }
.ax-station-rule { width: 30px; height: 1px; background: #c3bba6; }
.ax-station-title { font-family: var(--disp, system-ui); font-size: 26px; font-weight: 600; letter-spacing: -0.01em; color: ${INK}; }
.ax-why { font-family: var(--disp, system-ui); font-size: 16px; line-height: 1.72; color: #56514a; max-width: 700px; margin-bottom: 30px; }
.ax-why b { color: ${INK}; font-weight: 600; }

/* Interpretive annotations — hover / focus */
.ax-term { position: relative; color: ${INK}; border-bottom: 1px dotted #a89f89; cursor: help; }
.ax-term:hover, .ax-term:focus { border-bottom-color: ${TEAL}; outline: none; }
.ax-tip { position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%) translateY(4px);
  width: 250px; background: #fbf8ef; border: 1px solid ${INK}; border-radius: 1px; padding: 10px 12px;
  font-family: var(--mono, monospace); font-size: 12px; line-height: 1.5; color: #3a362e; letter-spacing: 0;
  opacity: 0; pointer-events: none; transition: opacity .16s ease, transform .16s ease; z-index: 5;
  box-shadow: 3px 3px 0 rgba(32,30,24,.12); }
.ax-tip::after { content: ''; position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
  border: 5px solid transparent; border-top-color: ${INK}; }
.ax-term:hover .ax-tip, .ax-term:focus .ax-tip { opacity: 1; transform: translateX(-50%) translateY(0); }

.ax-plate { margin: 0; }
.ax-svg { width: 100%; height: auto; background: #f6f2e7; border: 1px solid ${INK}; border-radius: 1px; padding: 4px;
  box-shadow: 4px 4px 0 rgba(32,30,24,.06); }
.ax-svg-label { font: 500 11.5px var(--mono, monospace); letter-spacing: .04em; fill: ${INK}; }
.ax-svg-sub { font: 400 10px var(--mono, monospace); fill: #8b8677; }
.ax-svg-edge { font: italic 400 11px var(--disp, sans-serif); }
.ax-flow { stroke-dasharray: 3 5; animation: ax-dash 1.3s linear infinite; }
@keyframes ax-dash { to { stroke-dashoffset: -16; } }
.ax-node { animation: ax-node 4s ease-in-out infinite; }
@keyframes ax-node { 0%,100% { opacity: .82 } 50% { opacity: 1 } }
.ax-fig { font-family: var(--disp, sans-serif); font-style: italic; font-size: 13px; color: #7c7565; margin-top: 12px; text-align: center; }

.ax-pipe { display: flex; align-items: stretch; }
.ax-stage { flex: 1; background: #f6f2e7; border: 1px solid ${INK}; border-radius: 1px; padding: 18px 14px; text-align: center; }
.ax-stage-no { width: 22px; height: 22px; border: 1px solid; border-radius: 50%; margin: 0 auto 10px; display: flex;
  align-items: center; justify-content: center; font-size: 11px; }
.ax-stage-title { font-size: 12px; font-weight: 500; letter-spacing: .1em; color: ${INK}; }
.ax-stage-sub { font-size: 11px; color: #8b8677; margin-top: 6px; }
.ax-pipe-seg { position: relative; width: 56px; align-self: center; height: 1px; background: #c3bba6; }
.ax-pipe-dot { position: absolute; top: -2.5px; left: 0; width: 5px; height: 5px; border-radius: 50%; background: ${INK}; animation: ax-travel 2.1s linear infinite; }
@keyframes ax-travel { from { left: -3px; opacity: 0 } 12% { opacity: 1 } 88% { opacity: 1 } to { left: 52px; opacity: 0 } }

.ax-transform { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 18px; padding: 15px;
  background: #f6f2e7; border: 1px solid #d3cbb8; border-radius: 1px; }
.ax-code-was { color: #a1442f; text-decoration: line-through; font-size: 13px; }
.ax-code-is { color: ${GREEN}; font-size: 13px; }
.ax-arrow { color: #8b8677; font-size: 12px; font-style: italic; }
.ax-transform-note { color: #8b8677; font-size: 11px; margin-left: auto; }

.ax-ask { background: #f6f2e7; border: 1px solid ${INK}; border-radius: 1px; padding: 22px; }
.ax-ask-q { font-family: var(--disp, sans-serif); font-size: 17px; color: ${INK}; }
.ax-ask-lane { display: flex; align-items: center; gap: 8px; margin-top: 20px; flex-wrap: wrap; }
.ax-ask-step { border: 1px solid #c3bba6; border-radius: 1px; padding: 8px 12px; font-size: 11px; letter-spacing: .06em; white-space: nowrap; }
.ax-mono-chip { color: #2f6d74; border-color: #b9b19c; background: #efeadd; font-size: 10.5px; letter-spacing: 0; }
.ax-ask-pipe { position: relative; width: 22px; height: 1px; background: #c3bba6; }
.ax-ask-pipe::after { content: ''; position: absolute; top: -2.5px; width: 5px; height: 5px; border-radius: 50%; background: ${PURPLE}; animation: ax-lane 1.9s linear infinite; }
@keyframes ax-lane { from { left: -3px; opacity: 0 } 20%,80% { opacity: 1 } to { left: 18px; opacity: 0 } }
.ax-ask-note { margin-top: 18px; font-size: 11px; color: #8b8677; letter-spacing: .04em; font-style: italic; }

.ax-stack { display: flex; flex-direction: column; }
.ax-stack-row { display: flex; gap: 22px; align-items: flex-start; padding: 16px 0; border-top: 1px solid #ddd5c2; }
.ax-stack-row:first-child { border-top: none; }
.ax-stack-layer { flex-shrink: 0; width: 120px; font-size: 11px; letter-spacing: .16em; color: #a89f89; padding-top: 12px; }
.ax-stack-items { flex: 1; display: flex; flex-direction: column; gap: 6px; }
.ax-stack-item { display: flex; flex-direction: column; gap: 3px; padding: 10px 0; }
.ax-stack-tech { font-size: 13.5px; color: ${INK}; }
.ax-stack-why { font-family: var(--disp, sans-serif); font-size: 13px; color: #7c7565; }

.ax-footer { max-width: 880px; margin: 0 auto; padding: 58px 26px 100px; border-top: 1px solid #ddd5c2; }
.ax-colophon { font-size: 11px; letter-spacing: .3em; text-transform: uppercase; color: #a89f89; margin-bottom: 18px; }
.ax-principles { display: flex; flex-direction: column; gap: 11px; font-size: 14px; color: #47433a;
  font-family: var(--disp, sans-serif); }
.ax-mk { font-weight: 700; margin-right: 8px; }
.ax-enter { margin-top: 34px; background: transparent; color: ${INK}; border: 1px solid ${INK}; border-radius: 1px;
  padding: 12px 28px; font: 500 13px var(--mono, monospace); letter-spacing: .08em; cursor: pointer; }
.ax-enter:hover { background: ${INK}; color: #efeadd; }

@media (max-width: 640px) {
  .ax-hero-title { font-size: 36px; }
  .ax-stack-row { flex-direction: column; gap: 8px; }
  .ax-pipe { flex-direction: column; }
  .ax-pipe-seg { width: 1px; height: 30px; align-self: center; }
  .ax-tip { width: 200px; }
}
`
