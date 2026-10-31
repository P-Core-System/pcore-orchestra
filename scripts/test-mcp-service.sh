#!/usr/bin/env bash
# Test the MCP service manager + client registration helper:
#   - mcp-register.js: stdio/http entries, idempotent, preserves foreign keys
#   - mcp-service.sh: --help, dry-run install, non-loopback refusal
#   - a real loopback start → /health → status → stop (nohup backend)
#   - tunnel reports a clear failure when cloudflared is absent
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
SVC="$SCRIPT_DIR/mcp-service.sh"
REG="$SCRIPT_DIR/mcp-register.js"

PASS=0; FAIL=0
ok()  { echo "  ok  - $*"; PASS=$((PASS+1)); }
bad() { echo "  FAIL- $*"; FAIL=$((FAIL+1)); }
note(){ echo "  (skip) $*"; }

TMPX="$(mktemp -d)"
cleanup() { rm -rf "$TMPX"; }
trap cleanup EXIT

if ! command -v node >/dev/null 2>&1; then
  echo "node not found — skipping test-mcp-service.sh"; exit 0
fi

export PCORE_ORCHESTRA_REPO="$REPO"
export XDG_STATE_HOME="$TMPX/state"
export XDG_DATA_HOME="$TMPX/log"
export PCORE_STATE_DIR="$TMPX/kdata"
mkdir -p "$PCORE_STATE_DIR"

# ── mcp-register.js ──────────────────────────────────────────────────────
echo "=== mcp-register.js ==="

# pre-seed a foreign server + a top-level key that must survive the merge
TARGET="$TMPX/.mcp.json"
cat > "$TARGET" <<'JSON'
{ "mcpServers": { "existing": { "command": "echo" } }, "keepme": 42 }
JSON

if node "$REG" --target "$TARGET" --name orchestra --root "$REPO" >/dev/null 2>&1 && \
   node -e "
     const c=require(process.argv[1]);
     const o=c.mcpServers.orchestra;
     if (!o) throw new Error('no orchestra entry');
     if (o.command!=='node') throw new Error('command not node');
     if (!o.args.includes('--stdio')) throw new Error('not stdio');
     if (!o.args.includes(process.argv[2])) throw new Error('root not threaded');
     if (c.mcpServers.existing.command!=='echo') throw new Error('foreign server dropped');
     if (c.keepme!==42) throw new Error('top-level key dropped');
   " "$TARGET" "$REPO"; then
  ok "stdio entry merged; foreign keys preserved"
else
  bad "stdio registration / merge"
fi

# idempotent: second run reports changed=false
CH2="$(node "$REG" --target "$TARGET" --name orchestra --root "$REPO" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).changed))')"
[[ "$CH2" == "false" ]] && ok "re-register is idempotent (changed=false)" || bad "expected changed=false, got $CH2"

# http transport via --url
HT="$TMPX/http.json"
node "$REG" --target "$HT" --url "https://example.trycloudflare.com/mcp" >/dev/null 2>&1 && \
node -e "
  const c=require(process.argv[1]); const o=c.mcpServers.orchestra;
  if (o.type!=='streamable-http' || !/\/mcp\$/.test(o.url)) throw new Error('bad http entry');
  if (o.url.includes('token')) throw new Error('token leaked into url');
" "$HT" && ok "--url registers streamable-http entry" || bad "http registration"

# --dry-run must not create the file
DRY="$TMPX/dry.json"
node "$REG" --target "$DRY" --dry-run >/dev/null 2>&1
[[ ! -f "$DRY" ]] && ok "--dry-run writes nothing" || bad "--dry-run created $DRY"

# ── mcp-service.sh (non-starting commands) ───────────────────────────────
echo "=== mcp-service.sh ==="

bash "$SVC" --help >/dev/null 2>&1 && ok "--help exits 0" || bad "--help"

bash "$SVC" --backend nohup --port 8899 --root "$REPO" install --dry-run >/dev/null 2>&1 \
  && ok "dry-run install (nohup) succeeds" || bad "dry-run install"

# non-loopback without token must be refused (exit != 0)
if bash "$SVC" --backend nohup --expose install --dry-run >/dev/null 2>&1; then
  bad "0.0.0.0 bind without token was NOT refused"
else
  ok "0.0.0.0 bind without token refused"
fi

# ── real loopback lifecycle ──────────────────────────────────────────────
echo "=== mcp-service.sh loopback lifecycle ==="

PORT="$(node -e 'const n=require("net");const s=n.createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close();})')"

bash "$SVC" --backend nohup --port "$PORT" --root "$REPO" start >/dev/null 2>&1 \
  && ok "loopback start returned healthy" || bad "loopback start failed"

if bash "$SVC" --backend nohup status >/dev/null 2>&1; then ok "status reports running+healthy"; else bad "status"; fi
if bash "$SVC" --backend nohup stop >/dev/null 2>&1; then ok "stop succeeds"; else bad "stop"; fi
if bash "$SVC" --backend nohup status >/dev/null 2>&1; then bad "status still running after stop"; else ok "status reports not-running after stop"; fi

# ── tunnel: clear failure when cloudflared is absent ─────────────────────
echo "=== tunnel ==="
if command -v cloudflared >/dev/null 2>&1; then
  note "cloudflared present — skipping the not-found assertion"
else
  if bash "$SVC" tunnel >/dev/null 2>&1; then bad "tunnel succeeded without cloudflared"; else ok "tunnel fails clearly without cloudflared"; fi
fi

echo
echo "=== Results: $PASS passed, $FAIL failed ==="
[[ "$FAIL" -eq 0 ]] || exit 1
