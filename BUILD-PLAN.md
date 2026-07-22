# VOD → Neo4j GraphRAG Hackathon Build Plan

**Project code:** VOD (existing)
**Goal:** Rebuild the venue-outreach-db pipeline as a small Neo4j-powered AI app for the hackathon demo.
**Centerpiece:** GraphRAG via Neo4j Aura + Aura MCP + Aura Agent
**Data:** Sanitized real venue/contact data
**Timeline:** 3 working days + 1 buffer day

Hand this file to Claude Code CLI as the working brief. Each phase below is scoped so CLI can execute it as a discrete, verifiable unit — confirm scope before starting a phase, stop and ask if data sanitization rules are unclear.

---

## 0. Prerequisites (do before CLI starts)

- [ ] Neo4j Aura account + new AuraDB instance (Free or Professional tier)
- [ ] Aura instance connection URI, username, password saved to `.env` (never commit)
- [ ] OpenAI API key (provided at event) saved to `.env`
- [ ] Node.js ≥18 and Python ≥3.10 available locally
- [ ] Existing VOD export: raw venue/contact CSVs from Overpass, Foursquare, Yelp, Hunter.io
- [ ] Decide sanitization rule set (see Phase 1) before any data touches the repo

---

## 1. Repo structure

```
vod-graphrag/
├── .env.example
├── README.md
├── data/
│   ├── raw/              # gitignored — original exports
│   └── sanitized/        # gitignored — cleaned CSVs, safe to load
├── scripts/
│   ├── sanitize.py       # strips PII, keeps structural fields
│   └── load_graph.py     # runs Cypher LOAD CSV against Aura
├── cypher/
│   ├── schema.cypher      # constraints + indexes
│   └── load.cypher        # LOAD CSV statements
├── mcp/
│   └── mcp-config.json    # MCP server definitions for CLI/agent
├── agent/
│   └── queries.md         # sample natural-language questions for the demo
└── demo/
    └── SCRIPT.md           # spoken demo walkthrough
```

---

## 2. Data sanitization rules (Phase 1)

Strip or hash before anything leaves `data/raw/`:
- Personal emails/phones → keep domain only (e.g. `@venuename.com`) or hash
- Full names → keep role/title only, or first-name + last-initial
- Exact addresses → keep neighborhood/district level only
- Any internal notes or pricing → remove entirely

`scripts/sanitize.py` should take `data/raw/*.csv` → `data/sanitized/*.csv` and log what was stripped per row, so the transformation is auditable.

---

## 3. Graph schema

**Nodes:**
| Label | Key properties |
|---|---|
| `Venue` | `venue_id` (unique), `name`, `category`, `district` |
| `Contact` | `contact_id` (unique), `role`, `verified` (bool) |
| `Source` | `name` (Overpass / Foursquare / Yelp / Hunter.io) |
| `Sequence` | `sequence_id` (unique), `name`, `status` |

**Relationships:**
| Type | From → To |
|---|---|
| `WORKS_AT` | Contact → Venue |
| `VERIFIED_BY` | Contact → Source |
| `ENROLLED_IN` | Contact → Sequence |
| `TARGETS` | Sequence → Venue |

`cypher/schema.cypher`:
```cypher
CREATE CONSTRAINT venue_id IF NOT EXISTS FOR (v:Venue) REQUIRE v.venue_id IS UNIQUE;
CREATE CONSTRAINT contact_id IF NOT EXISTS FOR (c:Contact) REQUIRE c.contact_id IS UNIQUE;
CREATE CONSTRAINT sequence_id IF NOT EXISTS FOR (s:Sequence) REQUIRE s.sequence_id IS UNIQUE;
CREATE INDEX venue_district IF NOT EXISTS FOR (v:Venue) ON (v.district);
CREATE INDEX contact_verified IF NOT EXISTS FOR (c:Contact) ON (c.verified);
```

---

## 4. MCP setup

Install and configure these Neo4j Labs MCP servers (bundle mirrors the Neo4j Gemini CLI extension approach, adapted for Claude Code CLI):

- `mcp-neo4j-data-modeling` — validate the schema above interactively before loading data
- `mcp-neo4j-cypher` — natural-language → Cypher for the GraphRAG query layer
- `mcp-neo4j-aura-manager` — optional, only if CLI needs to provision/monitor the Aura instance itself

`mcp/mcp-config.json` skeleton:
```json
{
  "mcpServers": {
    "neo4j-cypher": {
      "command": "uvx",
      "args": ["mcp-neo4j-cypher@latest"],
      "env": {
        "NEO4J_URI": "<from .env>",
        "NEO4J_USERNAME": "<from .env>",
        "NEO4J_PASSWORD": "<from .env>"
      }
    },
    "neo4j-data-modeling": {
      "command": "uvx",
      "args": ["mcp-neo4j-data-modeling@latest"]
    }
  }
}
```

---

## 5. Aura Agent (GraphRAG layer)

- Build the agent in the Aura console's no/low-code Aura Agent UI, pointed at this AuraDB instance
- Give it read-only Cypher access (do not grant write access for the demo agent)
- Test iteratively in the Aura Agent UI with the sample questions in `agent/queries.md`, e.g.:
  - "Which verified contacts have never been enrolled in a sequence?"
  - "Which venues in [district] have no verified contact yet?"
  - "Show sequences targeting venues with more than one verified contact"
- Once satisfied, expose the agent via its MCP server endpoint so it's callable from the demo UI/CLI

---

## 6. Day-by-day execution order for CLI

**Day 1**
1. Scaffold repo structure (Section 1)
2. Write `scripts/sanitize.py`, run against `data/raw/`, review output
3. Write `cypher/schema.cypher`, apply to Aura instance
4. Write `cypher/load.cypher` + `scripts/load_graph.py`, load sanitized data, verify counts in Aura Browser

**Day 2**
5. Configure `mcp/mcp-config.json`, verify `mcp-neo4j-cypher` returns correct schema introspection
6. Draft and test 5–8 natural-language questions against the graph via MCP
7. Log which queries work well vs. need schema/prompt adjustment

**Day 3**
8. Build the Aura Agent, wire read-only Cypher tool access
9. Expose agent via MCP endpoint
10. Build minimal demo surface (simple CLI chat loop or single-page UI) that calls the agent endpoint

**Day 4 (buffer)**
11. Write `demo/SCRIPT.md` — the spoken walkthrough (problem → data → what worked → what was hard → what's next)
12. Rehearse end-to-end; record a backup video in case live network fails at the event
13. Final scope check: confirm no unsanitized data or secrets are in the repo before it's shared

---

## 7. `.env.example`

```
NEO4J_URI=neo4j+s://<your-instance-id>.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=
OPENAI_API_KEY=
```

---

## 8. Stop conditions for CLI

Per the standing execution contract: stop and ask before proceeding if —
- Sanitization rules in Section 2 don't cover a field found in the raw data
- Aura Agent needs write access for any reason (should stay read-only for the demo)
- Any step would require committing `data/raw/` or `.env` to version control
