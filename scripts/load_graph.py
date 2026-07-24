#!/usr/bin/env python3
"""
load_graph.py — load sanitized CSVs into Neo4j Aura via the Python driver.

Reads data/sanitized/*.csv and writes the graph described in
VOD-NEO4J-BUILD-PLAN.md §3 using UNWIND batches. Unlike LOAD CSV, this needs
no public file hosting — it streams local rows straight to Aura.

Order:  applies cypher/schema.cypher first, then loads nodes, then rels.

Env (from .env):  NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD

    pip install neo4j python-dotenv
    python scripts/load_graph.py
"""

from __future__ import annotations

import csv
import os
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
    from neo4j import GraphDatabase
except ImportError:
    sys.exit("Missing deps. Run: pip install neo4j python-dotenv")

SANITIZED = Path("data/sanitized")
SCHEMA = Path("cypher/schema.cypher")


def read_csv(name: str) -> list[dict]:
    path = SANITIZED / name
    if not path.exists():
        print(f"  [skip] {name} not found")
        return []
    with path.open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def apply_schema(session) -> None:
    if not SCHEMA.exists():
        print("  [skip] cypher/schema.cypher not found")
        return
    statements = [s.strip() for s in SCHEMA.read_text().split(";") if s.strip()
                  and not s.strip().startswith("//")]
    for stmt in statements:
        session.run(stmt)
    print(f"  applied {len(statements)} schema statement(s)")


def load(session) -> None:
    venues = read_csv("venues.csv")
    contacts = read_csv("contacts.csv")
    sequences = read_csv("sequences.csv")
    enrollments = read_csv("enrollments.csv")
    targets = read_csv("sequence_targets.csv")

    # Nodes
    session.run(
        """
        UNWIND $rows AS row
        MERGE (v:Venue {venue_id: row.venue_id})
        SET v.name = row.name, v.category = row.category, v.district = row.district
        """, rows=venues)

    session.run(
        """
        UNWIND $rows AS row
        MERGE (c:Contact {contact_id: row.contact_id})
        SET c.role = row.role,
            c.name = coalesce(row.contact_name, row.person),
            c.title = row.title,
            c.verified = (toLower(coalesce(row.verified,'false')) IN ['true','1','yes'])
        """, rows=contacts)

    session.run(
        """
        UNWIND $rows AS row
        MERGE (s:Sequence {sequence_id: row.sequence_id})
        SET s.name = row.name, s.status = row.status
        """, rows=sequences)

    session.run(
        """
        UNWIND [x IN $rows WHERE x.source IS NOT NULL AND x.source <> '' | x.source] AS src
        WITH DISTINCT src MERGE (:Source {name: src})
        """, rows=contacts)

    # Relationships
    session.run(
        """
        UNWIND $rows AS row
        MATCH (c:Contact {contact_id: row.contact_id})
        MATCH (v:Venue {venue_id: row.venue_id})
        MERGE (c)-[:WORKS_AT]->(v)
        """, rows=contacts)

    session.run(
        """
        UNWIND [x IN $rows WHERE toLower(coalesce(x.verified,'false')) IN ['true','1','yes']
                AND x.source IS NOT NULL AND x.source <> ''] AS row
        MATCH (c:Contact {contact_id: row.contact_id})
        MATCH (src:Source {name: row.source})
        MERGE (c)-[:VERIFIED_BY]->(src)
        """, rows=contacts)

    session.run(
        """
        UNWIND $rows AS row
        MATCH (c:Contact {contact_id: row.contact_id})
        MATCH (s:Sequence {sequence_id: row.sequence_id})
        MERGE (c)-[:ENROLLED_IN]->(s)
        """, rows=enrollments)

    session.run(
        """
        UNWIND $rows AS row
        MATCH (s:Sequence {sequence_id: row.sequence_id})
        MATCH (v:Venue {venue_id: row.venue_id})
        MERGE (s)-[:TARGETS]->(v)
        """, rows=targets)

    print(f"  loaded: {len(venues)} venues, {len(contacts)} contacts, "
          f"{len(sequences)} sequences, {len(enrollments)} enrollments, "
          f"{len(targets)} targets")


def verify(session) -> None:
    print("\nCounts in Aura:")
    for label in ("Venue", "Contact", "Source", "Sequence"):
        n = session.run(f"MATCH (n:{label}) RETURN count(n) AS c").single()["c"]
        print(f"  {label}: {n}")
    for rel in ("WORKS_AT", "VERIFIED_BY", "ENROLLED_IN", "TARGETS"):
        n = session.run(f"MATCH ()-[r:{rel}]->() RETURN count(r) AS c").single()["c"]
        print(f"  {rel}: {n}")


def main() -> None:
    load_dotenv()
    uri = os.getenv("NEO4J_URI")
    user = os.getenv("NEO4J_USERNAME")
    pwd = os.getenv("NEO4J_PASSWORD")
    if not all([uri, user, pwd]):
        sys.exit("Missing NEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORD in .env")

    driver = GraphDatabase.driver(uri, auth=(user, pwd))
    with driver.session() as session:
        print("Applying schema...")
        apply_schema(session)
        print("Loading data...")
        load(session)
        verify(session)
    driver.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
