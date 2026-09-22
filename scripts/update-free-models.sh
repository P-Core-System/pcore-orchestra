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
#   --apply: pick primary (highest-stability probe-reachable free model, all
#     pools) + heavy fallback DYNAMICALLY from
#     state/free-models.json + state/model-pools.json ordered by probes.json
#     reachability/stability (no hardcoded IDs) and atomically rewrite ONLY
#     global model/small_model in bundle/config/opencode/autonomy.json,
#     docs/opencode.json.example, and installed opencode.json. Agents inherit
#     the main model — per-agent model keys and frontmatter lines are stripped,
#     not rewritten. Fetches first if cache empty; aborts only if fetch fails with no cache.
#   --schedule: install weekly refresh+apply (systemd user timer; cron fallback).
#   Flags combine: `--refresh --apply` = fetch, assign, rewrite, check.
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
PROBES_FILE="${CACHE_DIR}/probes.json"
REMOTE_URL="https://opencode.ai/zen/v1/models"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SYSTEM_CONFIG="${HOME}/.config/opencode/opencode.json"
EXAMPLE_CONFIG="${REPO_ROOT}/docs/opencode.json.example"

# ── Static deny-list (offline fallback only) ────────────────────────
# Listed by the API but rejected at runtime (or superseded) — filtered
# out of BOTH the flat free-models cache and the generated pools below.
# When the live cache is present it is the source of truth (see --apply
# / merge).
KNOWN_DEAD=(
  "deepseek-v4-flash-free"
  "mimo-v2.5-free"
  "ling-3.0-flash-fin-free"
)
KNOWN_DEAD_CSV="$(IFS=,; echo "${KNOWN_DEAD[*]}")"

# Free on Zen docs but no "free" in id and empty pricing in /v1/models.
# Docs: Big Pickle is Free/Free/Free (stealth free-for-limited-time).
KNOWN_FREE=(
  "big-pickle"
)
KNOWN_FREE_CSV="$(IFS=,; echo "${KNOWN_FREE[*]}")"
# Free/curated models also classified into the light pool (by id, not name keyword).

# ── Load probe reachability data ────────────────────────────
# Returns a JSON string of {modelId: {reachable, timestamp, error?}} or "{}"
load_probes() {
  if [[ -f "$PROBES_FILE" ]]; then
    python3 -c "import json; print(json.dumps(json.load(open('$PROBES_FILE'))))" 2>/dev/null || echo "{}"
  else
    echo "{}"
  fi
}

# ── Write pools JSON from the free-models cache + live context data ─
write_pools() {
  if [[ ! -f "$CACHE_FILE" ]]; then
    warn "No free-models cache found; cannot generate pools"
    return 1
  fi

  mkdir -p "$CACHE_DIR"
  local probes_json
  probes_json=$(load_probes)

  python3 -c "
import json, os, sys, datetime

cache_file = sys.argv[1]
pools_file = sys.argv[2]
known_dead = set(x for x in sys.argv[3].split(',') if x) if len(sys.argv) > 3 and sys.argv[3] else set()
known_free = set(x for x in sys.argv[5].split(',') if x) if len(sys.argv) > 5 and sys.argv[5] else set()
probes = json.loads(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] else {}

def is_reachable(mid):
    p = probes.get(mid, {})
    return p.get('reachable', False)

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
            zero_price = float(inp) == 0 and float(out) == 0
        except (ValueError, TypeError):
            zero_price = False
        is_free = zero_price or 'free' in mid.lower() or mid in known_free
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
    in_light = (mid in known_free) or any(k in lower for k in ('flash', 'lightning', 'mini', 'nano', 'fast', 'lite', 'hy3'))

    entry = {'id': mid, 'provider': 'opencode', 'context': ctx}

    if in_frontend:
        pools['frontend'].append(entry)
    if in_heavy:
        pools['heavy'].append(entry)
    if in_light:
        pools['light'].append(entry)

# Sort: verified-reachable models first within each pool, then by context
def reachable_first(entry):
    mid = entry['id']
    return (0 if is_reachable(mid) else 1, -(probes.get(mid, {}).get('stability_score', 0)), entry['context'])

pools['frontend'].sort(key=reachable_first)
pools['heavy'].sort(key=reachable_first)
pools['light'].sort(key=reachable_first)

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
" "$CACHE_FILE" "$POOLS_FILE" "$KNOWN_DEAD_CSV" "$probes_json" "$KNOWN_FREE_CSV"
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
known_dead = set('$KNOWN_DEAD_CSV'.split(',')) if '$KNOWN_DEAD_CSV' else set()
known_free = set(x for x in '$KNOWN_FREE_CSV'.split(',') if x)
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
        zero_price = float(inp) == 0 and float(out) == 0
    except (ValueError, TypeError):
        zero_price = False
    is_free = zero_price or 'free' in mid.lower() or mid in known_free
    if is_free and mid not in known_dead:
        free.append(mid)
print(json.dumps({'models': sorted(free), 'fetched': '$(date -u +%Y-%m-%dT%H:%M:%SZ)'}, indent=2))
" > "${CACHE_FILE}.tmp"
    elif command -v jq &>/dev/null; then
      jq --arg known_dead "$KNOWN_DEAD_CSV" --arg known_free "$KNOWN_FREE_CSV" '
        ($known_dead | split(",")) as $dead |
        ($known_free | split(",")) as $free_extra |
        [.data[]? // .[]? | select(
          ((.pricing.input // "1") | tonumber? // 1) == 0 and ((.pricing.output // "1") | tonumber? // 1) == 0
          or (.id | ascii_downcase | test("free"))
          or ((.id // "") as $mid | $free_extra | index($mid))
        ) | select((.id // empty as $mid | $dead | index($mid)) | not) | .id]
        | {models: (sort_by(.) | .[]), fetched: (now | todate)}
      ' "$tmp" > "${CACHE_FILE}.tmp" 2>/dev/null || {
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

# ── Probe reachability check for a model ──
check_probe_reachability() {
  local model_id="$1"
  [[ ! -f "$PROBES_FILE" ]] && { echo "UNKNOWN"; return; }
  python3 -c "
import json
try:
    with open('$PROBES_FILE') as f: probes = json.load(f)
    entry = probes.get('$model_id', {})
    print('REACHABLE' if entry.get('reachable') is True else 'UNREACHABLE' if entry.get('reachable') is False else 'UNKNOWN')
except Exception:
    print('UNKNOWN')
" 2>/dev/null || echo "UNKNOWN"
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
  local has_unreachable=0
  while IFS= read -r model_id; do
    [[ -z "$model_id" ]] && continue
    if echo "$free_models" | grep -qxF "$model_id"; then
      local reach_status
      reach_status=$(check_probe_reachability "$model_id")
      if [[ "$reach_status" == "UNREACHABLE" ]]; then
        err "$model_id: UNREACHABLE (in free list but probes say unreachable — region-blocked/timeout)"
        has_unreachable=1
      elif [[ "$reach_status" == "UNKNOWN" ]]; then
        warn "$model_id: PASS (no probe data)"
      else
        ok "$model_id: PASS"
      fi
    else
      err "$model_id: DEAD (not in free model list)"
      has_dead=1
    fi
  done < <(extract_models "$config_file")

  if [[ $has_unreachable -ne 0 ]]; then
    err "UNREACHABLE models detected — run --refresh --probe --apply to reassign global model"
  fi

  if [[ $has_dead -ne 0 || $has_unreachable -ne 0 ]]; then
    return 1
  else
    return 0
  fi
}

# ── Check OpenCode agent markdowns for hardcoded models ────────────
# Agents must inherit global model — frontmatter model: lines are discouraged.
extract_agent_models() {
  local roots=(
    "${REPO_ROOT}/bundle/opencode/agents"
    "${HOME}/.config/opencode/agents"
  )
  local out=""
  for root in "${roots[@]}"; do
    [[ -d "$root" ]] || continue
    out+=$(grep -RohE '^model:\s*opencode/[A-Za-z0-9_.-]+' "$root" 2>/dev/null || true)
    out+=$'\n'
  done
  printf '%s\n' "$out" | sed -E 's/^model:\s*opencode\///' | grep -v '^$' | sort -u
}

check_opencode_agents() {
  local free_models="$1"
  echo -e "\n${CYAN}── OpenCode agents (bundle + installed) ──${NC}"
  local has_hardcode=0
  local found=0
  while IFS= read -r model_id; do
    [[ -z "$model_id" ]] && continue
    found=1
    if echo "$free_models" | grep -qxF "$model_id"; then
      warn "$model_id: hardcoded in frontmatter (prefer inherit — strip with --apply)"
      has_hardcode=1
    else
      err "$model_id: DEAD + hardcoded (not in free model list; agents should inherit)"
      has_hardcode=1
    fi
  done < <(extract_agent_models)
  if [[ $found -eq 0 ]]; then
    ok "No per-agent model hardcodes (agents inherit global model)"
  fi
  return $has_hardcode
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

  check_opencode_agents "$free_models" || total_dead=1

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

# ── Probe mode: live ping each free model ───────────────────────────
# Results persisted to PROBES_FILE as {modelId: {reachable, timestamp, error?}}.
run_probe() {
  set +e
  if [[ ! -f "$CACHE_FILE" ]]; then
    warn "No cache — fetching first..."
    fetch_free_models || { err "Cannot fetch models"; return 1; }
  fi

  if ! command -v opencode &>/dev/null; then
    warn "opencode CLI not found — skipping probe; writing empty probes.json (pools will use name-keyword ordering)"
    mkdir -p "$CACHE_DIR"
    echo '{}' > "$PROBES_FILE"
    return 0
  fi

  echo -e "${CYAN}Probing free models (opencode run, 60s timeout each)...${NC}"
  echo ""

  local failed=0
  local mid tmp probe_jsonl
  probe_jsonl=$(mktemp)
  mapfile -t _probe_models < <(python3 -c "
import json
with open('$CACHE_FILE') as f:
    data = json.load(f)
for m in data.get('models', []):
    print(m)
" 2>/dev/null)

  for mid in "${_probe_models[@]}"; do
    [[ -z "$mid" ]] && continue
    echo -e "${CYAN}── opencode/$mid ──${NC}"
    tmp=$(mktemp)
    local reachable=0 reach_error=""
    if timeout 60 opencode run -m "opencode/$mid" --format json "Reply with exactly: OK" >"$tmp" 2>&1; then
      if grep -q '"type":"text"' "$tmp" && grep -q 'OK' "$tmp"; then
        ok "$mid: PASS (text response)"
        reachable=1
      elif grep -q 'RegionError\|not available in your country' "$tmp"; then
        warn "$mid: REGION (blocked in this locale)"
        reach_error="region-blocked"
        failed=1
      elif grep -q '"type":"error"' "$tmp"; then
        err "$mid: ERROR ($(grep -o '"message":"[^"]*"' "$tmp" | head -1 | cut -d'"' -f4))"
        reach_error="error"
        failed=1
      else
        warn "$mid: NO_RESPONSE (no text in output — reasoning model may need variant fast or higher steps)"
        reach_error="no-response"
        failed=1
      fi
    else
      if grep -q 'RegionError\|not available in your country' "$tmp" 2>/dev/null; then
        warn "$mid: REGION (blocked in this locale)"
        reach_error="region-blocked"
        failed=1
      elif grep -q '"type":"error"' "$tmp" 2>/dev/null; then
        err "$mid: ERROR ($(grep -o '"message":"[^"]*"' "$tmp" | head -1 | cut -d'"' -f4))"
        reach_error="error"
        failed=1
      else
        err "$mid: TIMEOUT or CLI failure"
        reach_error="timeout"
        failed=1
      fi
    fi
    rm -f "$tmp"
    # Append JSONL entry
    python3 -c "
import json, sys
print(json.dumps({'id': '$mid', 'reachable': $reachable, 'timestamp': '$(date -u +%Y-%m-%dT%H:%M:%SZ)', 'error': '$reach_error'}))
" >> "$probe_jsonl" 2>/dev/null || true
    echo ""
  done

  # Consolidate JSONL into probes.json
  mkdir -p "$CACHE_DIR"
  python3 -c "
import json, sys
results = {}
try:
    with open('$probe_jsonl') as f:
        for line in f:
            line = line.strip()
            if line:
                e = json.loads(line)
                results[e['id']] = {'reachable': e['reachable'], 'timestamp': e['timestamp'], 'error': e.get('error', '')}
except Exception:
    pass
with open('$PROBES_FILE', 'w') as f:
    json.dump(results, f, indent=2)
print('Wrote probe results to $PROBES_FILE')
"
  rm -f "$probe_jsonl"

  if [[ $failed -ne 0 ]]; then
    warn "Some models failed probe — probes.json written with partial results; pools sorted by verified reachability"
  else
    ok "All probed models responded"
  fi
  return 0
}

# ── Pick primary (light free) + heavy fallback from live cache ──────
# Prints two bare model IDs (primary, heavy) on separate lines.
# No hardcoded IDs: pool order from model-pools.json, membership from
# free-models.json. Exits 1 if no usable model remains after filtering.
pick_models() {
  python3 - "$CACHE_FILE" "$POOLS_FILE" "$KNOWN_DEAD_CSV" "$PROBES_FILE" <<'PY'
import json, sys

cache_file, pools_file, dead_csv, probes_file = sys.argv[1:5]
dead = set(x for x in dead_csv.split(',') if x) if dead_csv else set()

with open(cache_file) as f:
    cache = json.load(f)
models = [m for m in cache.get('models', []) if m not in dead]
if not models:
    sys.exit(1)

pools = {}
try:
    with open(pools_file) as f:
        pools = json.load(f).get('pools', {})
except Exception:
    pass

probes = {}
try:
    with open(probes_file) as f:
        probes = json.load(f)
except Exception:
    pass

def pool_ids(name):
    return [e.get('id') for e in pools.get(name, []) if e.get('id') in models]

light = pool_ids('light')
heavy_pool = pool_ids('heavy')
frontend = pool_ids('frontend')

# Reachability + stability check
def is_reachable(mid):
    return probes.get(mid, {}).get('reachable', False)
def stability_score(mid):
    return probes.get(mid, {}).get('stability_score', 0)

# Primary: highest-stability probe-reachable free model (any pool, not just light).
# Falls back to light pool head, then first free model.
reachable_all = sorted(models, key=lambda m: (0 if is_reachable(m) else 1, -stability_score(m), 0 if m in light else 1))
primary = reachable_all[0] if reachable_all else models[0]
if not is_reachable(primary) and light:
    primary = light[0]

# Heavy fallback: reachable, not primary, sorted by stability_score.
# Prefer probe-reachable high-ctx models (e.g. nemotron-3-ultra) only when live.
reachable_heavy = sorted([m for m in heavy_pool if is_reachable(m) and m != primary], key=stability_score, reverse=True)
reachable_other = sorted(
    [m for m in (frontend + models) if m != primary and is_reachable(m)],
    key=stability_score,
    reverse=True,
)
heavy = (
    next((x for x in reachable_heavy), None)
    or next((x for x in reachable_other), None)
    or next((x for x in heavy_pool if x != primary and is_reachable(x)), None)
    or primary
)
print(primary)
print(heavy)
PY
}

# ── Apply mode: dynamic free-pool assignment into bundle + install ──
run_apply() {
  if [[ ! -f "$CACHE_FILE" ]] || ! python3 -c \
      "import json,sys; sys.exit(0 if json.load(open(sys.argv[1])).get('models') else 1)" \
      "$CACHE_FILE" 2>/dev/null; then
    warn "Free-model cache missing or empty — fetching first"
    fetch_free_models || {
      err "Cannot fetch free models and no cache exists (offline first-run). Aborting --apply."
      return 1
    }
  fi
  [[ -f "$POOLS_FILE" ]] || write_pools || warn "Pool generation failed (continuing with flat cache)"

  local picked primary heavy
  if ! picked=$(pick_models); then
    err "No usable free model in cache after deny-list filter — run --refresh"
    return 1
  fi
  primary=$(printf '%s\n' "$picked" | sed -n 1p)
  heavy=$(printf '%s\n' "$picked" | sed -n 2p)
  if [[ -z "$primary" ]]; then
    err "Failed to pick primary free model from cache"
    return 1
  fi

  echo -e "${CYAN}Applying dynamic model assignment...${NC}"
  python3 - "$REPO_ROOT" "$primary" "$heavy" "$SYSTEM_CONFIG" <<'PY'
import glob, json, os, re, sys, tempfile

repo, primary, heavy, system_config = sys.argv[1:5]
primary_ref = 'opencode/' + primary
heavy_ref = 'opencode/' + heavy

def atomic_write(path, data):
    """Write data to path atomically (tmp in same dir + os.replace)."""
    directory = os.path.dirname(path) or '.'
    fd, tmp = tempfile.mkstemp(dir=directory, prefix='.tmp-apply-')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write(data)
        if os.path.exists(path):
            os.chmod(tmp, os.stat(path).st_mode & 0o777)
        os.replace(tmp, path)
    except Exception:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise

def apply_owned_config(path):
    """Rewrite model refs in repo-owned JSON config (autonomy / example)."""
    if not os.path.isfile(path):
        return False
    with open(path, encoding='utf-8') as f:
        cfg = json.load(f)
    for key in ('model', 'small_model'):
        cfg[key] = primary_ref
    # Agents inherit the main model — never pin per-agent free IDs.
    stripped_agents = 0
    for entry in (cfg.get('agent') or {}).values():
        if isinstance(entry, dict) and 'model' in entry:
            del entry['model']
            stripped_agents += 1
    if stripped_agents:
        print('  stripped %d agent model keys (inherit global)' % stripped_agents)
    provider = (cfg.get('provider') or {}).get('opencode') or {}
    models_dict = provider.get('models')
    if isinstance(models_dict, dict) and models_dict:
        variants = None
        for value in models_dict.values():
            if isinstance(value, dict) and 'variants' in value:
                variants = value
                break
        if variants is None:
            variants = {'variants': {'fast': {'reasoningEffort': 'low', 'textVerbosity': 'low'}}}
        provider['models'] = {primary: variants}
    atomic_write(path, json.dumps(cfg, indent=2) + '\n')
    return True

def bare(model_id):
    return model_id.split('/')[-1] if isinstance(model_id, str) else ''

# 1) Repo-owned configs
for rel in ('bundle/config/opencode/autonomy.json', 'docs/opencode.json.example'):
    target = os.path.join(repo, rel)
    if apply_owned_config(target):
        print('  updated', rel)

# 2) Installed opencode.json — set global model only; strip agent model keys
#    so agents inherit. Custom providers / paid models untouched.
if os.path.isfile(system_config):
    with open(system_config, encoding='utf-8') as f:
        cfg = json.load(f)
    changed = False
    for key in ('model', 'small_model'):
        if cfg.get(key) != primary_ref:
            cfg[key] = primary_ref
            changed = True
    stripped = 0
    for entry in (cfg.get('agent') or {}).values():
        if isinstance(entry, dict) and 'model' in entry:
            # Only strip free-tier / opencode/* refs; leave deliberate paid overrides
            val = entry['model']
            if isinstance(val, str) and (val.startswith('opencode/') or bare(val).endswith('-free')):
                del entry['model']
                stripped += 1
                changed = True
    if changed:
        atomic_write(system_config, json.dumps(cfg, indent=2) + '\n')
        print('  updated installed opencode.json (global=%s, stripped %d agent models)' % (primary_ref, stripped))

# 3) Agent frontmatter — STRIP hardcoded model: lines (inherit global)
#    Bundle + installed ~/.config/opencode/agents (frontmatter overrides global)
updated = 0
pattern = re.compile(r'(?m)^model:[ \t]*opencode/[A-Za-z0-9_.-]+[ \t]*\n?')
agent_roots = [
    os.path.join(repo, 'bundle', 'opencode', 'agents'),
    os.path.join(os.path.expanduser('~'), '.config', 'opencode', 'agents'),
]
for agent_root in agent_roots:
    if not os.path.isdir(agent_root):
        continue
    for md in glob.glob(os.path.join(agent_root, '**', '*.md'), recursive=True):
        try:
            with open(md, encoding='utf-8') as f:
                text = f.read()
        except OSError:
            continue
        bom = ''
        if text.startswith('﻿'):
            bom, text = '﻿', text[1:]
        match = re.match(r'^---\n(.*?)\n---\n(.*)$', text, re.S)
        if not match:
            continue
        frontmatter, rest = match.group(1), match.group(2)
        new_frontmatter, count = pattern.subn('', frontmatter)
        if count:
            new_frontmatter = re.sub(r'\n{3,}', '\n\n', new_frontmatter)
            atomic_write(md, bom + '---\n' + new_frontmatter + '\n---\n' + rest)
            updated += 1
if updated:
    print('  stripped %d agent frontmatter model: lines (inherit global)' % updated)

print('  primary: %s (light free pool)' % primary_ref)
print('  heavy fallback: %s' % heavy_ref)
PY
  ok "Applied dynamic free-model assignment"
  return 0
}

# ── Schedule mode: weekly refresh+apply (systemd timer; cron fallback) ──
install_cron_fallback() {
  local log_dir="$HOME/.cache"
  mkdir -p "$log_dir"
  local line
  line="17 4 * * 1 /bin/bash \"$REPO_ROOT/scripts/update-free-models.sh\" --refresh --apply >> \"$log_dir/pcore-free-models.log\" 2>&1"
  if ! command -v crontab &>/dev/null; then
    err "Neither systemd user nor crontab available — add manually: $line"
    return 1
  fi
  {
    crontab -l 2>/dev/null | grep -vF 'update-free-models.sh' || true
    echo "$line"
  } | crontab -
  ok "cron fallback installed (Mon 04:17): update-free-models.sh --refresh --apply"
}

run_schedule() {
  local unit_dir="$HOME/.config/systemd/user"
  local service_src="$SCRIPT_DIR/systemd/pcore-free-models.service"
  local timer_src="$SCRIPT_DIR/systemd/pcore-free-models.timer"

  if command -v systemctl &>/dev/null && [[ -f "$service_src" && -f "$timer_src" ]] \
      && systemctl --user daemon-reload &>/dev/null; then
    mkdir -p "$unit_dir"
    sed "s|@REPO_ROOT@|$REPO_ROOT|g" "$service_src" > "$unit_dir/pcore-free-models.service"
    cp -f "$timer_src" "$unit_dir/pcore-free-models.timer"
    systemctl --user daemon-reload
    systemctl --user enable --now pcore-free-models.timer
    ok "systemd user timer installed: pcore-free-models.timer (weekly)"
    systemctl --user list-timers pcore-free-models.timer --no-pager 2>/dev/null || true
    return 0
  fi

  warn "systemd user units unavailable — installing cron fallback"
  install_cron_fallback
}

# ── Help ────────────────────────────────────────────────────────────
show_help() {
  cat <<'EOF'
update-free-models.sh — Validate, refresh, and apply free models for OpenCode

Usage:
  bash update-free-models.sh            Check configured models against cache
  bash update-free-models.sh --check    Same as above (default)
  bash update-free-models.sh --refresh  Re-fetch model list then check
  bash update-free-models.sh --apply    Pick primary+heavy from probe-ordered pools;
                                        set GLOBAL model only; strip agent model
                                        hardcodes so agents inherit the main model
  bash update-free-models.sh --refresh --apply   Weekly job: fetch, assign, check
  bash update-free-models.sh --schedule Install weekly refresh+apply (systemd
                                        user timer; cron fallback when missing)
  bash update-free-models.sh --pools    Print auto-generated model pools
  bash update-free-models.sh --probe    Live ping every cached free model via opencode run;
                                         results persisted to probes.json for pool ordering
  bash update-free-models.sh --help     Show this help

Checks both ~/.config/opencode/opencode.json and docs/opencode.json.example
for dead/unreachable model IDs and STALE-POOL warnings. Exit code 1 if any found.

Model IDs are assigned DYNAMICALLY from free-models.json + model-pools.json
ordered by probes.json reachability/stability — no hardcoded agent IDs.
Agents inherit top-level model/small_model. Pools regenerate on every --refresh.

Weekly schedule: scripts/systemd/pcore-free-models.{service,timer}
(OnCalendar=weekly), installed via --schedule; cron fallback documented in README.
EOF
}

# ── Main ────────────────────────────────────────────────────────────
RUN_REFRESH=0
RUN_APPLY=0
RUN_CHECK=0
SPECIAL=""

if [[ $# -eq 0 ]]; then
  RUN_CHECK=1
fi

for arg in "$@"; do
  case "$arg" in
    --help|-h) SPECIAL="help" ;;
    --refresh) RUN_REFRESH=1; RUN_CHECK=1 ;;
    --apply)   RUN_APPLY=1; RUN_CHECK=1 ;;
    --check)   RUN_CHECK=1 ;;
    --pools)   SPECIAL="pools" ;;
    --probe)   SPECIAL="probe" ;;
    --schedule) SPECIAL="schedule" ;;
    *) err "Unknown option: $arg"; show_help; exit 1 ;;
  esac
done

if [[ -n "$SPECIAL" ]]; then
  case "$SPECIAL" in
    help) show_help ;;
    pools) run_pools ;;
    probe) run_probe ;;
    schedule) run_schedule ;;
  esac
  exit $?
fi

if [[ "$RUN_REFRESH" -eq 1 ]]; then
  echo -e "${CYAN}Refreshing free model list...${NC}"
  if ! fetch_free_models; then
    if [[ -f "$CACHE_FILE" ]]; then
      warn "Fetch failed — using stale cache"
    else
      err "Failed to fetch models from $REMOTE_URL and no cache exists"
      exit 1
    fi
  fi
fi

if [[ "$RUN_APPLY" -eq 1 ]]; then
  run_apply || exit 1
fi

if [[ "$RUN_CHECK" -eq 1 ]]; then
  run_check || exit 1
fi
