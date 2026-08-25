#!/usr/bin/env bash
# Launches the mcp-neo4j-cypher server locally in HTTP mode so Orbit's
# smartPresets.ts can genuinely call it (see src/graph/mcpClient.ts) instead
# of mcp-config.json just sitting there unused. Read-only: the server only
# ever exposes get_neo4j_schema and read_neo4j_cypher when started this way
# -- no write tool exists on it at all, a real boundary, not a convention.
#
# Run from the repo root: mcp/start.sh
# Uses the same unprefixed NEO4J_* vars as scripts/load_graph.py and
# linkedinImport.ts (not the browser's VITE_NEO4J_*) -- reads them from .env.
#
# Orbit works fine without this running: smartPresets.ts falls back to its
# direct Neo4j driver call automatically if the MCP server isn't up.

set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "No .env file found in repo root -- need NEO4J_URI/NEO4J_USERNAME/NEO4J_PASSWORD/NEO4J_DATABASE." >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a; source .env; set +a

: "${NEO4J_URI:?NEO4J_URI not set in .env}"
: "${NEO4J_USERNAME:?NEO4J_USERNAME not set in .env}"
: "${NEO4J_PASSWORD:?NEO4J_PASSWORD not set in .env}"
DATABASE="${NEO4J_DATABASE:-neo4j}"
PORT="${MCP_PORT:-8765}"

echo "Starting mcp-neo4j-cypher on http://127.0.0.1:${PORT}/mcp/ (read-only, database: ${DATABASE})"
exec uvx mcp-neo4j-cypher@latest \
  --db-url "$NEO4J_URI" \
  --username "$NEO4J_USERNAME" \
  --password "$NEO4J_PASSWORD" \
  --database "$DATABASE" \
  --transport http \
  --server-port "$PORT" \
  --read-only \
  --allow-origins "*" \
  --allowed-hosts "*"
