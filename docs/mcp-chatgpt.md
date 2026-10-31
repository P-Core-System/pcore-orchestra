# MCP Knowledge Server — ChatGPT & remote connectors

The orchestra already ships a **stdio** MCP server (`bundle/hooks/lib/mcp-server.js`)
for local hosts (Claude Code, Cursor, OpenCode, Qoder). ChatGPT's MCP connectors
cannot attach to stdio — they require a **remote Streamable HTTP** endpoint over
HTTPS. This guide covers the HTTP front and the project-knowledge tools layered
on top of it.

## What it exposes

**Read / knowledge tools** (`bundle/hooks/lib/knowledge-tools.js`):

| Tool | Purpose | Writes? |
|------|---------|---------|
| `search_docs` | Full-text search across `docs/**`, `context/*.md`, top-level markdown | No |
| `read_doc` | Read one allowlisted markdown file by project-relative path | No |
| `read_context` | Read one onboarding context file (`context/<name>.md`) | No |
| `search_memory` | Hybrid recall from the orchestra memory index (goals/decisions) | No |
| `share_knowledge` | Append a knowledge item to the store as `pending` | Store only |
| `list_knowledge` | List entries, optionally filter `status=pending\|approved\|rejected\|applied` | No |
| `review_knowledge` | Promote/demote an entry (`approved`/`rejected`/`applied`/`pending`) | Store status only |

**Chat + pairing tools** (resume work across connectors and the local CLI):

| Tool | Purpose |
|------|---------|
| `start_thread` | Open a project chat thread, optionally bound to an external conversation id |
| `post_message` | Append a message (role `assistant`/`user`/`system`) |
| `get_thread` | Resume a thread by id *or* by external binding (`externalKind`+`externalId`) |
| `list_threads` | List this project's threads |
| `pair_thread` / `list_pairs` | Bind / list external-conversation ↔ thread mappings |

Plus the existing read-only run tools: `get_run_status`, `get_gate_results`,
`get_evidence`, `list_runs`.

**Master prompts** (`bundle/hooks/lib/master-prompts.js`, first-class MCP
`prompts` capability): `orchestra_plan`, `orchestra_implement`,
`orchestra_verify`, `orchestra_review`, `project_knowledge`. Each is rendered
with the project identity and any `approved` knowledge baked in, and is
reachable over `prompts/list` / `prompts/get` or the `get_master_prompt` /
`list_master_prompts` tools.

Security posture:

- Only `docs/`, `context/*.md`, and top-level `AGENTS/README/CONTRIBUTING/SECURITY/ORCHESTRA.md`
  are readable. Anything matching `.env`, `secret`, `credential`, `token`,
  `private-key`, `.pem`, `id_rsa` is denied even inside an allowed directory;
  paths that escape the project root are denied; files over 200 KB are refused.
- The server **never edits docs or context directly**. `share_knowledge` writes
  a `pending` row to the SQLite store at `~/.pcore/state/knowledge.db` (JSON
  inbox fallback on a Node without `node:sqlite`, honoring `PCORE_STATE_DIR`);
  `review_knowledge` flips status. A human or orchestra phase reads `approved`
  rows back and edits the files. Every row is partitioned by `project.slug`, so
  one connector serving project A cannot read project B's knowledge or threads.
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
   `source: "chatgpt"`; list the queue with `list_knowledge`, promote what you
   want to keep with `review_knowledge { status: "approved" }`, then a human or
   an orchestra phase reads `approved` rows back into `context/` or `docs/`.
   To continue the same conversation locally, `get_thread` by the connector's
   conversation id once you've `pair_thread`'d it.

## Managed service & client registration

For anything longer-lived than a single `node …` invocation, `scripts/mcp-service.sh`
runs the hub as a managed service (systemd user unit / launchd plist / nohup),
loopback by default; `--expose` binds `0.0.0.0` and is **refused without a token**:

```bash
scripts/mcp-service.sh install --port 8765 --root "$PWD"   # write the unit
scripts/mcp-service.sh start                               # start + health probe
scripts/mcp-service.sh tunnel                              # cloudflared quick tunnel
scripts/mcp-service.sh status | logs | stop | uninstall
```

Register the stdio server into an `mcpServers` config that Cursor / Claude Code /
Qoder read (idempotent — unrelated entries are preserved):

```bash
node <orchestra>/scripts/mcp-register.js --root "$PWD"                 # writes ./.mcp.json
node <orchestra>/scripts/mcp-register.js --target ~/.cursor/mcp.json   # global Cursor
node <orchestra>/scripts/mcp-register.js --url https://<tunnel>/mcp    # remote HTTP instead
```

## Verify

```bash
node scripts/test-mcp-knowledge.js        # allowlist, tools surface, HTTP handshake, bind policy
node scripts/test-mcp-knowledge-store.js  # SQLite store, review, chat, pairing, project split, JSON fallback
node scripts/test-mcp-prompts.js          # master prompts over stdio config + HTTP prompts/list|get
bash scripts/test-mcp-service.sh          # service lifecycle + mcp-register merge
```

Covers the allowlist (deny `.env`, secret names, `../` escapes), the search/read
tools, the share→list→review round trip, the chat-thread + pairing surface, the
project-slug partition, the JSON-inbox fallback, the tool surface inside
`tools/list`, the master-prompt rendering (project-aware + approved-knowledge
injection) over `prompts/list`/`prompts/get`, the bind policy (non-loopback
without token is refused), and a real HTTP `initialize` → `tools/list` →
`tools/call` handshake with bearer enforcement.

## Design notes

- Transport: `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk`
  with `sessionIdGenerator: undefined` (stateless mode) — the mode remote
  connectors such as ChatGPT and Claude.ai expect.
- Capabilities: `resources`, `tools`, and `prompts`. The stdio path is unchanged;
  HTTP is additive. Both reuse the same `McpServer` class, so the tool and prompt
  surface cannot drift between transports.
- Storage: `node:sqlite` (`DatabaseSync`), the same driver as `memory-fts.js`,
  loaded lazily so a Node without it falls back to the JSON inbox rather than
  throwing. The store is the single writer for knowledge, chat, and pairs;
  `knowledge-tools.js` stays the allowlist/authz boundary.
- Files are byte-mirrored into `bundle/opencode/hooks/lib/` per the mirror rule
  (`node scripts/test-mirror-sync.js`).
