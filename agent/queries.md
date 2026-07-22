# Sample natural-language questions for the GraphRAG demo

Test these against the graph via `mcp-neo4j-cypher` (Day 2) and in the Aura
Agent UI (Day 3). Log which return correct Cypher first-try vs. need a
schema/prompt nudge.

## Core demo questions (from the build plan §5)

1. Which verified contacts have never been enrolled in a sequence?
2. Which venues in [district] have no verified contact yet?
3. Show sequences targeting venues with more than one verified contact.

## Supporting questions (5–8 total for the demo)

4. How many venues do we have per district?
5. Which source verified the most contacts?
6. List venues that are targeted by a sequence but have zero contacts.
7. Which sequences are currently `active`, and how many venues does each target?
8. Show the contacts at [venue name] and whether each is verified.

## Expected Cypher (reference — for judging agent output)

```cypher
// 1. Verified contacts never enrolled
MATCH (c:Contact {verified: true})
WHERE NOT (c)-[:ENROLLED_IN]->(:Sequence)
RETURN c.contact_id, c.role;

// 2. Venues in a district with no verified contact
MATCH (v:Venue {district: $district})
WHERE NOT (:Contact {verified: true})-[:WORKS_AT]->(v)
RETURN v.name, v.category;

// 3. Sequences targeting venues with >1 verified contact
MATCH (s:Sequence)-[:TARGETS]->(v:Venue)
MATCH (c:Contact {verified: true})-[:WORKS_AT]->(v)
WITH s, v, count(c) AS verified_contacts
WHERE verified_contacts > 1
RETURN s.name, v.name, verified_contacts
ORDER BY verified_contacts DESC;
```
