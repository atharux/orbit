// VOD → Neo4j GraphRAG — schema constraints + indexes
// Apply first, before load.cypher. Idempotent (IF NOT EXISTS).

CREATE CONSTRAINT venue_id IF NOT EXISTS
  FOR (v:Venue) REQUIRE v.venue_id IS UNIQUE;

CREATE CONSTRAINT contact_id IF NOT EXISTS
  FOR (c:Contact) REQUIRE c.contact_id IS UNIQUE;

CREATE CONSTRAINT sequence_id IF NOT EXISTS
  FOR (s:Sequence) REQUIRE s.sequence_id IS UNIQUE;

CREATE INDEX venue_district IF NOT EXISTS
  FOR (v:Venue) ON (v.district);

CREATE INDEX contact_verified IF NOT EXISTS
  FOR (c:Contact) ON (c.verified);
