// Minimal MCP (Model Context Protocol) client — genuinely speaks to the
// server defined in mcp/mcp-config.json, over MCP's "Streamable HTTP"
// transport (JSON-RPC 2.0 requests; each response is a single SSE frame).
// Not a decoy: mcp-config.json previously had nothing calling into it —
// this is the code that actually does.
//
// Launch the server locally before use:
//   uvx mcp-neo4j-cypher@latest --db-url <NEO4J_URI> --username <NEO4J_USERNAME> \
//     --password <NEO4J_PASSWORD> --database <NEO4J_DATABASE> \
//     --transport http --server-port 8765 --read-only \
//     --allow-origins "*" --allowed-hosts "*"
// (--read-only removes every write tool from the server's exposed surface
// entirely — a real boundary, not just a client-side convention.)
//
// Deliberately a hand-rolled ~60-line client, not the full MCP TypeScript
// SDK: Orbit only ever needs two tools (get_neo4j_schema, read_neo4j_cypher)
// against one already-known local server, so the SDK's transport
// negotiation/reconnection machinery is more than this needs. If Orbit
// grows to talk to multiple/remote MCP servers, revisit that tradeoff.

const MCP_URL = 'http://127.0.0.1:8765/mcp/'

let reqId = 1
let initialized: Promise<boolean> | null = null

async function rpc(method: string, params: unknown, id?: number): Promise<any> {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify(id === undefined ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params }),
  })
  if (!res.ok) throw new Error(`MCP server error: ${res.status} ${res.statusText}`)
  if (id === undefined) return null // notification — no response body to parse
  const text = await res.text()
  // Streamable HTTP wraps the JSON-RPC response in one SSE frame:
  // "event: message\r\ndata: {...}\r\n\r\n" — pull the JSON out of `data:`.
  const dataLine = text.split('\n').find(l => l.startsWith('data:'))
  if (!dataLine) throw new Error(`MCP server: unexpected response shape: ${text.slice(0, 200)}`)
  const payload = JSON.parse(dataLine.slice(5).trim())
  if (payload.error) throw new Error(`MCP error: ${payload.error.message ?? JSON.stringify(payload.error)}`)
  return payload.result
}

async function doInitialize(): Promise<boolean> {
  try {
    await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'orbit', version: '0.1.0' },
    }, reqId++)
    await rpc('notifications/initialized', {})
    return true
  } catch {
    return false
  }
}

// True once the handshake succeeds; false (and cheap to re-check) if the
// local server isn't running — callers should fall back to a direct driver
// call, not treat this as fatal. Memoized so repeated calls in one session
// don't re-handshake, but a failed attempt doesn't get stuck permanently
// false if the server starts up moments later.
export async function isMcpAvailable(): Promise<boolean> {
  if (!initialized) initialized = doInitialize()
  const ok = await initialized
  if (!ok) initialized = null // let the next call retry rather than caching a transient failure forever
  return ok
}

export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<any> {
  const result = await rpc('tools/call', { name, arguments: args }, reqId++)
  const first = result?.content?.[0]
  if (result?.isError) throw new Error(first?.text ?? `MCP tool "${name}" failed`)
  if (first?.type === 'text') {
    try { return JSON.parse(first.text) } catch { return first.text }
  }
  return result
}
