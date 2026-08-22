#!/usr/bin/env bash
# update-free-models.sh — Validate and refresh free model list for OpenCode
#
# Modes:
#   --check (default): validate model+small_model+every agent.*.model in
#     BOTH ~/.config/opencode/opencode.json AND docs/opencode.json.example
#     against cache -> print per-agent PASS/DEAD, exit 1 if any DEAD.
#     Also verify each configured model exists in appropriate pool; report
#     STALE-POOL warning if a configured model is no longer in any live pool.
#     Offline -> use stale cache with warning.
#   --refresh: refetch then check.
#   --pools: print auto-generated pools from cache (regenerate if stale/missing).
set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
err()  { echo -e "${RED}✗${NC} $*"; }

# ── Paths ───────────────────────────────────────────────────────────
CACHE_DIR="${HOME}/.config/opencode/state"
CACHE_FILE="${CACHE_DIR}/free-models.json"
POOLS_FILE="${CACHE_DIR}/model-pools.json"
REMOTE_URL="https://opencode.ai/zen/v1/models"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SYSTEM_CONFIG="${HOME}/.config/opencode/opencode.json"
EXAMPLE_CONFIG="${REPO_ROOT}/docs/opencode.json.example"

# ── Known-dead models ───────────────────────────────────────────────
# Listed by the API but rejected at runtime — filtered out of BOTH the
# flat free-models cache and the generated pools below.
KNOWN_DEAD=(
  "deepseek-v4-flash-free"
)
KNOWN_DEAD_CSV="$(IFS=,; echo "${KNOWN_DEAD[*]}")"

# ── Write pools JSON from the free-models cache + live context data ─
write_pools() {
  if [[ ! -f "$CACHE_FILE" ]]; then
    warn "No free-models cache found; cannot generate pools"
    return 1
  fi

  mkdir -p "$CACHE_DIR"

  python3 -c "
import json, os, sys, datetime

cache_file = sys.argv[1]
pools_file = sys.argv[2]
known_dead = set(sys.argv[3].split(',')) if len(sys.argv) > 3 and sys.argv[3] else set()

with open(cache_file) as f:
    cache = json.load(f)

# Fetch full model data with context windows from live API
tmp = os.path.join(os.path.dirname(pools_file), '.tmp-zen-models.json')
os.system('curl -sS --max-time 15 -o ' + tmp + ' https://opencode.ai/zen/v1/models 2>/dev/null')

model_ctx = {}
try:
    with open(tmp) as f:
        data = json.load(f)
    models_raw = data if isinstance(data, list) else data.get('data', [])
    for m in models_raw:
        mid = m.get('id', '')
        pricing = m.get('pricing', {})
        inp = pricing.get('input', 1)
        out = pricing.get('output', 1)
        try:
            is_free = (float(inp) == 0 and float(out) == 0) or 'free' in mid.lower()
        except (ValueError, TypeError):
            is_free = 'free' in mid.lower()
        if is_free:
            ctx = 0
            for key in ('context_window', 'context_length'):
                raw = m.get(key, 0)
                try:
                    ctx = int(raw)
                    break
                except (ValueError, TypeError):
                    continue
            model_ctx[mid] = ctx
except Exception:
    pass
finally:
    try:
        os.remove(tmp)
    except OSError:
        pass

# Classify
pools = {'frontend': [], 'heavy': [], 'light': []}

for mid in cache.get('models', []):
    if mid in known_dead:
        continue
    ctx = model_ctx.get(mid, 0)
    lower = mid.lower()

    in_frontend = any(k in lower for k in ('spark', 'muse', 'design', 'ui', 'vision'))
    in_heavy = ctx >= 400000 or any(k in lower for k in ('pro', 'max', 'ultra', 'preview', 'coder', 'kimi', 'glm', 'minimax'))
    in_light = any(k in lower for k in ('flash', 'lightning', 'mini', 'nano', 'fast', 'lite'))

    entry = {'id': mid, 'provider': 'opencode', 'context': ctx}

    if in_frontend:
        pools['frontend'].append(entry)
    if in_heavy:
        pools['heavy'].append(entry)
    if in_light:
        pools['light'].append(entry)

# Sort: frontend/heavy by context desc; light by context asc (smaller = faster)
pools['frontend'].sort(key=lambda x: x['context'], reverse=True)
pools['heavy'].sort(key=lambda x: x['context'], reverse=True)
pools['light'].sort(key=lambda x: x['context'])

result = {
    'updated': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'source': 'opencode-zen',
    'pools': pools
}

tmp_pools = pools_file + '.tmp'
with open(tmp_pools, 'w') as f:
    json.dump(result, f, indent=2)
os.replace(tmp_pools, pools_file)

for name, items in pools.items():
    print('  %s: %d models' % (name, len(items)))
" "$CACHE_FILE" "$POOLS_FILE" "$KNOWN_DEAD_CSV"
}

# ── Fetch free models ───────────────────────────────────────────────
fetch_free_models() {
  mkdir -p "$CACHE_DIR"

  local tmp
  tmp=$(mktemp)

  if curl -sS --max-time 15 -o "$tmp" "$REMOTE_URL" 2>/dev/null; then
    if command -v python3 &>/dev/null; then
      python3 -c "
import json, sys
known_dead = set('$KNOWN_DEAD_CSV'.split(','))
with open('$tmp') as f:
    data = json.load(f)
models = data if isinstance(data, list) else data.get('data', [])
free = []
for m in models:
    mid = m.get('id', '')
    pricing = m.get('pricing', {})
    inp = pricing.get('input', 1)
    out = pricing.get('output', 1)
    try:
        is_free = (float(inp) == 0 and float(out) == 0) or 'free' in mid.lower()
    except (ValueError, TypeError):
        is_free = 'free' in mid.lower()
    if is_free and mid not in known_dead:
        free.append(mid)
print(json.dumps({'models': sorted(free), 'fetched': '$(date -u +%Y-%m-%dT%H:%M:%SZ)'}, indent=2))
" > "${CACHE_FILE}.tmp"
    elif command -v jq &>/dev/null; then
      jq --arg known_dead "$KNOWN_DEAD_CSV" '[.data[]? // .[]? | select(
        ((.pricing.input // "1") | tonumber == 0 and (.pricing.output // "1") | tonumber == 0)
        or (.id | ascii_downcase | test("free"))
      ) | select((.id // empty as $mid | $known_dead | split(",") | index($mid)) | not) | .id] | {models: (sort_by(.) | .[]), fetched: (now | todate)}' "$tmp" > "${CACHE_FILE}.tmp" 2>/dev/null || {
        err "jq parse failed"
        rm -f "$tmp" "${CACHE_FILE}.tmp"
        return 1
      }
    else
      err "Neither python3 nor jq available -- cannot parse model list"
      rm -f "$tmp"
      return 1
    fi
    mv -f "${CACHE_FILE}.tmp" "$CACHE_FILE"
    rm -f "$tmp"
    local count
    count=$(python3 -c "import json; print(len(json.load(open('$CACHE_FILE')).get('models', [])))" 2>/dev/null || echo "?")
    ok "Fetched $count free models"

    # Auto-generate pools on every successful fetch
    ok "Generating model pools..."
    write_pools || warn "Pool generation failed (non-fatal)"
    ok "Pools written to $POOLS_FILE"

    return 0
  else
    rm -f "$tmp"
    return 1
  fi
}

# ── Extract model IDs from a config file ────────────────────────────
# Outputs one model ID per line (strips opencode/ prefix)
extract_models() {
  local config_file="$1"
  [[ -f "$config_file" ]] || return 0

  if command -v python3 &>/dev/null; then
    python3 -c "
import json, sys
with open('$config_file') as f:
    cfg = json.load(f)
models = set()
for key in ('model', 'small_model'):
    v = cfg.get(key, '')
    if v:
        mid = v.split('/')[-1] if '/' in v else v
        models.add(mid)
agents = cfg.get('agent', {})
for name, a in agents.items():
    v = a.get('model', '')
    if v:
        mid = v.split('/')[-1] if '/' in v else v
        models.add(mid)
for m in sorted(models):
    print(m)
"
  elif command -v jq &>/dev/null; then
    jq -r '
      [.model, .small_model] + [(.agent // {} | to_entries[] | .value.model // empty)] |
      map(split("/") | last) | sort | unique | .[]
    ' "$config_file" 2>/dev/null
  fi
}

# ── Validate models against cache ───────────────────────────────────
validate_models() {
  local label="$1"
  local config_file="$2"
  local free_models="$3"

  if [[ ! -f "$config_file" ]]; then
    warn "$label: config not found at $config_file"
    return 0
  fi

  echo -e "\n${CYAN}── $label ──${NC}"

  local has_dead=0
  while IFS= read -r model_id; do
    [[ -z "$model_id" ]] && continue
    if echo "$free_models" | grep -qxF "$model_id"; then
      ok "$model_id: PASS"
    else
      err "$model_id: DEAD (not in free model list)"
      has_dead=1
    fi
  done < <(extract_models "$config_file")

  return $has_dead
}

# ── Pool-aware check: verify each configured model is in some pool ──
check_pools() {
  local label="$1"
  local config_file="$2"

  if [[ ! -f "$POOLS_FILE" ]]; then
    warn "$label: no pool cache -- skipping pool check"
    return 0
  fi
  if [[ ! -f "$config_file" ]]; then
    return 0
  fi

  echo -e "\n${CYAN}── $label (pool check) ──${NC}"

  python3 -c "
import json, sys

pools_file = sys.argv[1]
config_file = sys.argv[2]

with open(pools_file) as f:
    pools_data = json.load(f)
pools = pools_data.get('pools', {})
all_pool_ids = set()
for members in pools.values():
    for e in members:
        all_pool_ids.add(e['id'])

with open(config_file) as f:
    cfg = json.load(f)

model_ids = set()
for key in ('model', 'small_model'):
    v = cfg.get(key, '')
    if v:
        mid = v.split('/')[-1] if '/' in v else v
        model_ids.add(mid)
agents = cfg.get('agent', {})
for name, a in agents.items():
    v = a.get('model', '')
    if v:
        mid = v.split('/')[-1] if '/' in v else v
        model_ids.add(mid)

for mid in sorted(model_ids):
    if mid in all_pool_ids:
        in_pools = [name for name, members in pools.items() if any(e['id'] == mid for e in members)]
        print('  ok  %s -> %s' % (mid, ', '.join(in_pools)))
    else:
        print('  STALE-POOL  %s not in any live pool' % mid)
" "$POOLS_FILE" "$config_file"
}

# ── Check mode ──────────────────────────────────────────────────────
run_check() {
  if [[ ! -f "$CACHE_FILE" ]]; then
    warn "No cache found. Run --refresh first."
    # Try to fetch
    if ! fetch_free_models; then
      err "Cannot fetch models and no cache exists. Aborting."
      return 1
    fi
  fi

  local stale=""
  if [[ -f "$CACHE_FILE" ]]; then
    local age
    age=$(python3 -c "
import os, time
mtime = os.path.getmtime('$CACHE_FILE')
age_h = (time.time() - mtime) / 3600
print(f'{age_h:.1f}')
" 2>/dev/null || echo "?")
    if [[ "$age" != "?" ]] && (( $(echo "$age > 24" | bc -l 2>/dev/null || echo 0) )); then
      warn "Cache is ${age}h old -- consider --refresh"
      stale=1
    fi
  fi

  local free_models
  free_models=$(python3 -c "
import json
with open('$CACHE_FILE') as f:
    data = json.load(f)
for m in data.get('models', []):
    print(m)
" 2>/dev/null)

  local total_dead=0
  validate_models "System config ($SYSTEM_CONFIG)" "$SYSTEM_CONFIG" "$free_models" || total_dead=1
  validate_models "Example config (docs/opencode.json.example)" "$EXAMPLE_CONFIG" "$free_models" || total_dead=1

  # Pool-aware checks (STALE-POOL warnings)
  check_pools "System config ($SYSTEM_CONFIG)" "$SYSTEM_CONFIG"
  check_pools "Example config (docs/opencode.json.example)" "$EXAMPLE_CONFIG"

  echo ""
  if [[ $total_dead -ne 0 ]]; then
    err "Some models are DEAD -- run --refresh or fix config"
    return 1
  else
    ok "All configured models are free and live"
    return 0
  fi
}

# ── Refresh mode ────────────────────────────────────────────────────
run_refresh() {
  echo -e "${CYAN}Refreshing free model list...${NC}"
  if fetch_free_models; then
    run_check
  else
    err "Failed to fetch models from $REMOTE_URL"
    if [[ -f "$CACHE_FILE" ]]; then
      warn "Using stale cache"
      run_check
    else
      return 1
    fi
  fi
}

# ── Pools mode ──────────────────────────────────────────────────────
run_pools() {
  if [[ ! -f "$POOLS_FILE" ]]; then
    warn "No pools cache found. Generating..."
    if [[ ! -f "$CACHE_FILE" ]]; then
      echo -e "${CYAN}Fetching models...${NC}"
      fetch_free_models || { err "Cannot fetch models"; return 1; }
    else
      write_pools || { err "Pool generation failed"; return 1; }
    fi
  fi

  if [[ ! -f "$POOLS_FILE" ]]; then
    err "No pools file available"
    return 1
  fi

  echo -e "${CYAN}Auto-generated model pools from Zen catalog:${NC}"
  echo -e "Source: $POOLS_FILE"
  echo ""

  python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
print('Updated: %s' % data.get('updated', '?'))
print()
for name in ('frontend', 'heavy', 'light'):
    pool = data.get('pools', {}).get(name, [])
    print('%s (%d):' % (name, len(pool)))
    for entry in pool:
        ctx = entry.get('context', 0)
        ctx_str = (' ctx=%d' % ctx) if ctx else ''
        print('  %s%s' % (entry['id'], ctx_str))
    print()
" "$POOLS_FILE"
}

# ── Help ────────────────────────────────────────────────────────────
show_help() {
  cat <<'EOF'
update-free-models.sh — Validate and refresh free model list for OpenCode

Usage:
  bash update-free-models.sh            Check configured models against cache
  bash update-free-models.sh --check    Same as above (default)
  bash update-free-models.sh --refresh  Re-fetch model list then check
  bash update-free-models.sh --pools    Print auto-generated model pools
  bash update-free-models.sh --help     Show this help

Checks both ~/.config/opencode/opencode.json and docs/opencode.json.example
for dead model IDs and STALE-POOL warnings. Exit code 1 if any DEAD models found.

Pools are auto-generated on every --refresh into ~/.config/opencode/state/model-pools.json.
EOF
}

# ── Main ────────────────────────────────────────────────────────────
case "${1:-}" in
  --help|-h) show_help ;;
  --refresh) run_refresh ;;
  --pools) run_pools ;;
  --check|"") run_check ;;
  *) err "Unknown option: $1"; show_help; exit 1 ;;
esac
