// VOD → Neo4j GraphRAG — LOAD CSV statements
// ---------------------------------------------------------------------------
// NOTE: Aura's LOAD CSV needs each file at a publicly reachable https:// URL.
// For the hackathon, the reliable path is `scripts/load_graph.py` (Python
// driver + UNWIND batches from local sanitized CSVs — no file hosting needed).
// These statements document the equivalent graph shape and can be run in Aura
// Browser once the CSVs are hosted; set :param csv_base first, e.g.
//   :param csv_base => 'https://<host>/data/sanitized';
// ---------------------------------------------------------------------------

// --- Nodes -----------------------------------------------------------------

// venues.csv: venue_id,name,category,district
LOAD CSV WITH HEADERS FROM $csv_base + '/venues.csv' AS row
MERGE (v:Venue {venue_id: row.venue_id})
SET v.name = row.name, v.category = row.category, v.district = row.district;

// contacts.csv: contact_id,role,verified,venue_id,source
LOAD CSV WITH HEADERS FROM $csv_base + '/contacts.csv' AS row
MERGE (c:Contact {contact_id: row.contact_id})
SET c.role = row.role, c.verified = toBoolean(row.verified);

// sequences.csv: sequence_id,name,status
LOAD CSV WITH HEADERS FROM $csv_base + '/sequences.csv' AS row
MERGE (s:Sequence {sequence_id: row.sequence_id})
SET s.name = row.name, s.status = row.status;

// Source nodes are derived from the contacts.source column
LOAD CSV WITH HEADERS FROM $csv_base + '/contacts.csv' AS row
WITH DISTINCT row.source AS source_name
WHERE source_name IS NOT NULL AND source_name <> ''
MERGE (:Source {name: source_name});

// --- Relationships ---------------------------------------------------------

// WORKS_AT: Contact → Venue   (from contacts.venue_id)
LOAD CSV WITH HEADERS FROM $csv_base + '/contacts.csv' AS row
MATCH (c:Contact {contact_id: row.contact_id})
MATCH (v:Venue {venue_id: row.venue_id})
MERGE (c)-[:WORKS_AT]->(v);

// VERIFIED_BY: Contact → Source   (from contacts.source, verified only)
LOAD CSV WITH HEADERS FROM $csv_base + '/contacts.csv' AS row
WITH row WHERE toBoolean(row.verified) = true AND row.source IS NOT NULL
MATCH (c:Contact {contact_id: row.contact_id})
MATCH (src:Source {name: row.source})
MERGE (c)-[:VERIFIED_BY]->(src);

// ENROLLED_IN: Contact → Sequence   (enrollments.csv: contact_id,sequence_id)
LOAD CSV WITH HEADERS FROM $csv_base + '/enrollments.csv' AS row
MATCH (c:Contact {contact_id: row.contact_id})
MATCH (s:Sequence {sequence_id: row.sequence_id})
MERGE (c)-[:ENROLLED_IN]->(s);

// TARGETS: Sequence → Venue   (sequence_targets.csv: sequence_id,venue_id)
LOAD CSV WITH HEADERS FROM $csv_base + '/sequence_targets.csv' AS row
MATCH (s:Sequence {sequence_id: row.sequence_id})
MATCH (v:Venue {venue_id: row.venue_id})
MERGE (s)-[:TARGETS]->(v);
