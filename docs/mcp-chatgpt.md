# MCP Knowledge Server — ChatGPT & remote connectors

The orchestra already ships a **stdio** MCP server (`bundle/hooks/lib/mcp-server.js`)
for local hosts (Claude Code, Cursor, OpenCode, Qoder). ChatGPT's MCP connectors
cannot attach to stdio — they require a **remote Streamable HTTP** endpoint over
HTTPS. This guide covers the HTTP front and the project-knowledge tools layered
on top of it.

## What it exposes

Six read/queue tools over an allowlist (see `bundle/hooks/lib/knowledge-tools.js`):

| Tool | Purpose | Writes? |
|------|---------|---------|
| `search_docs` | Full-text search across `docs/**`, `context/*.md`, top-level markdown | No |
| `read_doc` | Read one allowlisted markdown file by project-relative path | No |
| `read_context` | Read one onboarding context file (`context/<name>.md`) | No |
| `search_memory` | Hybrid recall from the orchestra memory index (goals/decisions) | No |
| `share_knowledge` | Append a knowledge item to the **pending review inbox** | Inbox only |
| `list_knowledge` | List inbox entries, optionally filter `status=pending\|applied\|rejected` | No |

Plus the existing read-only run tools: `get_run_status`, `get_gate_results`,
`get_evidence`, `list_runs`.

Security posture:

- Only `docs/`, `context/*.md`, and top-level `AGENTS/README/CONTRIBUTING/SECURITY/ORCHESTRA.md`
  are readable. Anything matching `.env`, `secret`, `credential`, `token`,
  `private-key`, `.pem`, `id_rsa` is denied even inside an allowed directory;
  paths that escape the project root are denied; files over 200 KB are refused.
- The server **never edits docs or context directly**. `share_knowledge` only
  queues a `pending` entry in `~/.pcore/state/knowledge-inbox.json`
  (honors `PCORE_STATE_DIR`); a human or an orchestra phase promotes it.
- Loopback binds (`127.0.0.1`) need no auth. Any other bind address **refuses to
  start without a bearer token**.

## Run it locally

```bash
# from the project you want to expose
node <orchestra>/scripts/mcp-knowledge-server.js \
  --root "$PWD" --port 8765

# health check
curl -s http://127.0.0.1:8765/health
# → {"ok":true,"transport":"streamable-http","endpoint":"/mcp","auth":"loopback"}
```

| Flag | Default | Notes |
|------|---------|-------|
| `--port` | `8765` | HTTP port |
| `--host` | `127.0.0.1` | Set `0.0.0.0` only with a token |
| `--root` | cwd | Project root served by the knowledge tools |
| `--token` | `$PCORE_MCP_TOKEN` | Bearer token required on every `POST /mcp` |
| `--stdio` | — | Serve on stdin/stdout instead (local hosts) |

Endpoints: `GET /health` (liveness), `POST /mcp` (MCP Streamable HTTP, JSON-RPC).
Requests are stateless — each `POST` gets a fresh server+transport, no session
bookkeeping. Body size is capped at 1 MB.

## Expose to ChatGPT

ChatGPT (Plus/Pro with developer mode connectors, or the workspace connector
settings) only accepts **public HTTPS** MCP servers.

1. Start the server on loopback with a strong token:

   ```bash
   PCORE_MCP_TOKEN="$(openssl rand -hex 24)" \
     node scripts/mcp-knowledge-server.js --root "$PWD" --port 8765
   ```

   (Token is optional on loopback because tunnels connect locally, but keep it —
   it defends against other processes on the machine and survives if you later
   bind publicly.)

2. Tunnel the port. Cloudflare quick tunnel is the zero-account path:

   ```bash
   cloudflared tunnel --url http://localhost:8765
   ```

   Copy the printed `https://<random>.trycloudflare.com` URL. For a stable URL,
   use a named Cloudflare tunnel on your own domain and keep the bearer check on.

3. In ChatGPT: **Settings → Connectors (developer mode) → Create**, then:
   - URL: `https://<your-tunnel>/mcp`
   - Auth: **Bearer token** header `Authorization: Bearer <PCORE_MCP_TOKEN>`
     (or "No auth" if you deliberately run tokenless behind an access-protected tunnel)
   - Enable the connector and ask e.g. *"search_docs for 'heartbeat' and summarize
     what you find"*.

4. Knowledge exchange: ask ChatGPT to `share_knowledge` with
   `source: "chatgpt"`; review the queue locally with
   `node scripts/mcp-knowledge-server.js` + `list_knowledge`, then a human
   promotes entries into `context/` or `docs/`.

## Verify

```bash
node scripts/test-mcp-knowledge.js
```

Covers the allowlist (deny `.env`, secret names, `../` escapes), the search/read
tools, the share→list inbox round trip, the tool surface inside `tools/list`,
the bind policy (non-loopback without token is refused), and a real HTTP
`initialize` → `tools/list` → `tools/call` handshake with bearer enforcement.

## Design notes

- Transport: `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk`
  with `sessionIdGenerator: undefined` (stateless mode) — the mode remote
  connectors such as ChatGPT and Claude.ai expect.
- The stdio path is unchanged; HTTP is additive. Both reuse the same
  `McpServer` class, so the tool surface cannot drift between transports.
- Files are byte-mirrored into `bundle/opencode/hooks/lib/` per the mirror rule
  (`node scripts/test-mirror-sync.js`).
