# Orbit — Neo4j GraphRAG (hackathon build)

**Orbit** is a copy of the **Pocket Leads** app (`atharux/pocket-leads` — chosen
over venueDB because it's the pipeline still producing results), extended into a
small Neo4j-powered GraphRAG demo per `VOD-NEO4J-BUILD-PLAN.md` (copied in as
`BUILD-PLAN.md`). The React/Vite app is untouched (local-first storage —
localStorage + optional local SQLite API, no Supabase); the GraphRAG layer is
additive. Venues and contacts are nodes; relationships are the edges that light
up the graph — hence *Orbit*.

## What's new vs. the app

```
data/
  raw/          # gitignored — original exports
  sanitized/    # gitignored — cleaned CSVs, safe to load
  README.md     # expected CSV columns
scripts/
  sanitize.py   # data/raw/*.csv → data/sanitized/*.csv, audited, PII-stripped
  load_graph.py # loads sanitized CSVs into Aura via the Python driver (UNWIND)
cypher/
  schema.cypher # constraints + indexes
  load.cypher   # LOAD CSV equivalents (needs hosted CSVs; loader is preferred)
mcp/
  mcp-config.json  # mcp-neo4j-cypher + mcp-neo4j-data-modeling
agent/
  queries.md    # sample NL questions + reference Cypher
demo/
  SCRIPT.md     # spoken walkthrough
```

## Quickstart

1. `cp .env.example .env` and fill `NEO4J_URI` / `NEO4J_USERNAME` /
   `NEO4J_PASSWORD` (and `OPENAI_API_KEY` if used). Never commit `.env`.
2. Put raw CSVs in `data/raw/`.
3. `pip install -r scripts/requirements.txt`
4. `python scripts/sanitize.py` — review the per-row strip log and
   `data/sanitized/`.
5. `python scripts/load_graph.py` — applies the schema, loads the graph, prints
   node/edge counts.
6. Wire `mcp/mcp-config.json` into your CLI/agent; test `agent/queries.md`.
7. Build the read-only Aura Agent; rehearse `demo/SCRIPT.md`.

## Graph schema

Nodes: `Venue`, `Contact`, `Source`, `Sequence`
Edges: `WORKS_AT` (Contact→Venue), `VERIFIED_BY` (Contact→Source),
`ENROLLED_IN` (Contact→Sequence), `TARGETS` (Sequence→Venue)

## Guardrails (from the build plan)

- Never commit `data/raw/`, `data/sanitized/`, or `.env`.
- The Aura demo agent stays **read-only** — no write access.
- `sanitize.py` STOPS on any column it has no rule for — add the rule, don't
  guess.
