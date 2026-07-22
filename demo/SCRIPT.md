# Demo walkthrough — VOD → Neo4j GraphRAG

Spoken script for the hackathon. Target: ~4 minutes. Structure:
problem → data → what worked → what was hard → what's next.

---

## 0. Setup (before you present)

- [ ] Aura instance up, graph loaded (`scripts/load_graph.py` counts verified)
- [ ] Aura Agent live, read-only Cypher tool wired
- [ ] Backup video recorded in case event network fails
- [ ] No unsanitized data or secrets in the repo (final check, build plan §6/13)

---

## 1. Problem (30s)

"Venue outreach means juggling three questions at once: who's a real
decision-maker, have we already contacted them, and which venues are still
untouched. In a flat table that's three joins and a headache. As a graph it's
one question."

## 2. Data (45s)

- Real Hydrat3 venue + contact data, **sanitized** first — emails reduced to
  domains, names to first-name + last-initial, addresses to district, internal
  notes and pricing stripped. Show `scripts/sanitize.py` and the per-row log.
- Loaded into Neo4j Aura: `Venue`, `Contact`, `Source`, `Sequence` nodes;
  `WORKS_AT`, `VERIFIED_BY`, `ENROLLED_IN`, `TARGETS` edges.
- Show the graph in Aura Browser — one screenshot of the neighborhood.

## 3. What worked — the GraphRAG moment (90s)

Ask the Aura Agent, live, in plain English:

1. "Which verified contacts have never been enrolled in a sequence?"
   → these are warm leads we're sitting on.
2. "Which venues in [district] have no verified contact yet?"
   → the whitespace to prospect next.
3. "Show sequences targeting venues with more than one verified contact."
   → where outreach is concentrated.

Point out: no SQL, no dashboard — the agent writes Cypher against the graph and
answers. That's the pitch.

## 4. What was hard (30s)

- Sanitization edge cases — the script STOPS on any column it has no rule for,
  so nothing PII leaks by accident.
- Getting the agent to emit correct Cypher for the "more than one" aggregation
  took prompt iteration (see `agent/queries.md` log).

## 5. What's next (20s)

- Wire the agent endpoint back into the Pocket Leads UI (this repo's frontend)
  so outreach status is graph-driven.
- Add a scoring node that ranks prospects by graph position before outreach.

---

## Fallback if the network dies

Play the backup video. Keep narrating the three questions over it — the story
is the same whether the query runs live or on tape.
