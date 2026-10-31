#!/usr/bin/env bash
# Install Orchestra bundle to ~/.cursor, ~/.config/opencode, ~/.qoder,
# ~/.claude, AND ~/.codex (global, all projects)
# Usage:
#   bash install.sh              # install Cursor + OpenCode + Qoder + Claude Code + Codex
#   bash install.sh --all        # same as default
#   bash install.sh --cursor     # Cursor only
#   bash install.sh --opencode   # OpenCode only
#   bash install.sh --qoder      # Qoder CLI only
#   bash install.sh --claude     # Claude Code only
#   bash install.sh --codex      # Codex CLI only
#   bash install.sh --project    # install project bridge into $PWD/.cursor (current repo)
#   bash install.sh --all --project
#   bash install.sh --project-dir /path/to/repo   # bridge into that repo instead of $PWD
#   bash install.sh --skip-opencode-upgrade   # skip npm/bun OpenCode CLI upgrade
#   bash install.sh --studio     # install Studio dashboard (build + launcher)
#   bash install.sh --all --studio
#   bash install.sh --uninstall  # remove Orchestra from selected hosts (default: all)
#   bash install.sh --cursor --uninstall   # uninstall Cursor only
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BUNDLE="$ROOT/bundle"
CURSOR="${CURSOR_HOME:-$HOME/.cursor}"
OPENCODE="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
QODER="${QODER_CONFIG_DIR:-$HOME/.qoder}"
CLAUDE="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
CODEX="${CODEX_HOME:-$HOME/.codex}"
AGENTS_SKILLS="${AGENTS_SKILLS:-$HOME/.agents/skills}"

INSTALL_CURSOR=0
INSTALL_OPENCODE=0
INSTALL_QODER=0
INSTALL_CLAUDE=0
INSTALL_CODEX=0
INSTALL_PROJECT=0
PROJECT_DIR=""
FORCE_PROJECT=0
SKIP_OPENCODE_UPGRADE=0
INSTALL_MCP=0
INSTALL_STUDIO=0
DRY_RUN=0
UNINSTALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)        INSTALL_CURSOR=1; INSTALL_OPENCODE=1; INSTALL_QODER=1; INSTALL_CLAUDE=1; INSTALL_CODEX=1; shift ;;
    --cursor)     INSTALL_CURSOR=1; shift ;;
    --opencode)   INSTALL_OPENCODE=1; shift ;;
    --qoder)      INSTALL_QODER=1; shift ;;
    --claude)     INSTALL_CLAUDE=1; shift ;;
    --codex)      INSTALL_CODEX=1; shift ;;
    --project)    INSTALL_PROJECT=1; shift ;;
    --project-dir)
      [[ $# -ge 2 && -n "${2:-}" && "${2}" != --* ]] || { echo "ERROR: --project-dir requires a path argument"; exit 1; }
      INSTALL_PROJECT=1; PROJECT_DIR="$2"; shift 2 ;;
    --force-project) INSTALL_PROJECT=1; FORCE_PROJECT=1; shift ;;
    --mcp)        INSTALL_MCP=1; shift ;;
    --studio)     INSTALL_STUDIO=1; shift ;;
    --dry-run)    DRY_RUN=1; shift ;;
    --uninstall)  UNINSTALL=1; shift ;;
    --skip-opencode-upgrade) SKIP_OPENCODE_UPGRADE=1; shift ;;
    -h|--help)
      cat <<'HELP'
Usage: bash install.sh [--all|--cursor|--opencode|--qoder|--claude|--codex] [--project|--project-dir PATH] [--mcp] [--studio] [--dry-run] [--skip-opencode-upgrade] [--uninstall]

Options:
  --all        Install for Cursor, OpenCode, Qoder CLI, Claude Code, and Codex CLI (default)
  --cursor     Install for Cursor IDE only
  --opencode   Install for OpenCode CLI only
  --qoder      Install for Qoder CLI only
  --claude     Install for Claude Code only
  --codex      Install for Codex CLI only
  --project    Install the project bridge into the CURRENT repo ($PWD/.cursor)
  --project-dir PATH  Install the project bridge into PATH/.cursor instead of $PWD
  --force-project  Allow the bridge target to be the orchestra clone itself
  --mcp        Install MCP server dependencies (npm install @modelcontextprotocol/sdk)
  --studio     Install Studio dashboard (build + launcher)
  --dry-run    Show what would be installed without making changes
  --skip-opencode-upgrade  Skip upgrading OpenCode CLI to latest (npm/bun)
  --uninstall  Remove Orchestra files from the selected hosts (default: all) and
               restore merged config from the backups the installers wrote.
               Combine with --cursor/--opencode/etc. to scope; add --studio to
               also tear down the Studio service.

OpenCode: upgrades CLI via scripts/ensure-opencode-latest.sh unless skipped.
          Set OPENCODE_CHANNEL=beta|dev for pre-release builds.
          Runs free-model refresh + --apply once, then installs the weekly
          schedule (systemd user timer; cron fallback if systemd missing).
          Restart the OpenCode desktop app after install (sidecar sync).

Claude Code: installs agents + hooks + skills and merges hooks into
             ~/.claude/settings.json (CLAUDE_CONFIG_DIR overrides).
Codex CLI:   installs 160 TOML agents into ~/.codex/agents (CODEX_HOME
             overrides) and shares skills under ~/.agents/skills. Codex hooks
             stay unwired because features.hooks is still gated.

No flags = --all. Restart IDE/editor after install.
HELP
      exit 0 ;;
    *) echo "Unknown option: $1 (try --help)"; exit 1 ;;
  esac
done

# Default: all
if [[ "$INSTALL_CURSOR" -eq 0 && "$INSTALL_OPENCODE" -eq 0 && "$INSTALL_QODER" -eq 0 \
      && "$INSTALL_CLAUDE" -eq 0 && "$INSTALL_CODEX" -eq 0 ]]; then
  INSTALL_CURSOR=1
  INSTALL_OPENCODE=1
  INSTALL_QODER=1
  INSTALL_CLAUDE=1
  INSTALL_CODEX=1
fi

# --- preflight: fail fast before touching any global config ----------------
# Runs only for the install path (--uninstall removes files; no node/git needed).
if [[ "$UNINSTALL" -eq 0 ]]; then
  _OS="$(uname -s 2>/dev/null || echo unknown)"
  case "$_OS" in
    Linux|Darwin) : ;;
    MINGW*|MSYS*|CYGWIN*)
      echo "ERROR: Windows shell detected ($_OS). Use the PowerShell installer:"
      echo "       powershell -ExecutionPolicy Bypass -File install.ps1"
      exit 1 ;;
    *)
      echo "ERROR: Unsupported OS '$_OS' (expected Linux or macOS; Windows uses install.ps1)."
      exit 1 ;;
  esac

  if ! command -v git >/dev/null 2>&1; then
    echo "ERROR: 'git' is required — this bundle installs from a git clone."
    exit 1
  fi

  if ! command -v node >/dev/null 2>&1; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "WARN: 'node' not found — dry run proceeds, but a real install needs Node.js 18+."
    else
      echo "ERROR: 'node' is required (Node.js 18+). Install it, then re-run."
      exit 1
    fi
  else
    _NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if [[ "$_NODE_MAJOR" -lt 18 ]]; then
      echo "ERROR: Node.js 18+ required, found $(node --version 2>/dev/null)."
      exit 1
    fi
  fi

  if [[ "$DRY_RUN" -eq 0 ]]; then
    echo "== preflight OK — OS: $_OS · git $(git --version 2>/dev/null | awk '{print $3}') · node $(node --version 2>/dev/null || echo n/a)"
    echo ""
  fi
fi

# --- bundle freshness guards ----------------------------------------------
# Derived artifacts (qoder agent tree, agent registry) are generated from
# bundle/agents. Never install a stale derivative: check, regenerate on
# drift, re-verify. Skipped for --dry-run (read-only) and without node.
if [[ "$DRY_RUN" -eq 0 && "$UNINSTALL" -eq 0 ]] && command -v node >/dev/null 2>&1; then
  echo "== bundle freshness =="
  for guard in "scripts/enrich-agent-capabilities.js" "scripts/sync-qoder-agents.js" \
      "scripts/sync-claude-agents.js" "scripts/sync-codex-agents.js" "scripts/gen-agent-registry.js"; do
    if ! (cd "$ROOT" && node "$guard" --check >/dev/null 2>&1); then
      echo "  drift in $guard -- regenerating"
      (cd "$ROOT" && node "$guard" >/dev/null) || { echo "  ERROR: $guard failed to regenerate"; exit 1; }
      (cd "$ROOT" && node "$guard" --check >/dev/null) || { echo "  ERROR: $guard still drifting after regenerate"; exit 1; }
      echo "  $guard: regenerated clean"
    else
      echo "  $guard: in sync"
    fi
  done
  echo ""
fi

if [[ "$UNINSTALL" -eq 0 ]]; then
  echo "=========================================================================="
  echo " Orchestra Installer (Cursor + OpenCode + Qoder + Claude Code + Codex)"
  echo "=========================================================================="
  echo ""
fi

###############################################################################
# Cursor installation
###############################################################################
install_cursor() {
  echo "==> Installing P-Core Orchestra to $CURSOR"

  command -v node >/dev/null 2>&1 || { echo "ERROR: 'node' required (install Node.js 18+)"; exit 1; }

  mkdir -p "$CURSOR/hooks/state" "$CURSOR/agents" "$CURSOR/skills" "$CURSOR/skills-cursor" "$CURSOR/rules"

  # Hook scripts + lib modules (replace lib entirely — cp -rf into existing dir nests lib/lib/)
  cp -f "$BUNDLE/hooks/"orchestra-*.js "$CURSOR/hooks/"
  rm -rf "$CURSOR/hooks/lib"
  cp -rf "$BUNDLE/hooks/lib" "$CURSOR/hooks/lib"

  # MCP server (if requested)
  if [[ "$INSTALL_MCP" -eq 1 ]]; then
    echo "==> Installing MCP server dependencies"
    (cd "$ROOT" && npm install --production 2>/dev/null || npm install 2>/dev/null)
    cp -f "$BUNDLE/hooks/lib/mcp-server.js" "$CURSOR/hooks/lib/"
  fi

  # Default state (don't overwrite). Source the tracked template — the
  # bundle/hooks/state copy is gitignored runtime state and absent on fresh clones.
  if [[ ! -f "$CURSOR/hooks/state/orchestra.json" ]]; then
    cp -f "$BUNDLE/opencode/state/orchestra.json" "$CURSOR/hooks/state/orchestra.json" 2>/dev/null || \
      cp -f "$BUNDLE/hooks/state/orchestra.json" "$CURSOR/hooks/state/orchestra.json" 2>/dev/null || \
      echo '{}' > "$CURSOR/hooks/state/orchestra.json"
  fi

  # Agents, rule, docs
  cp -f "$BUNDLE/agents/orchestra.md" "$CURSOR/agents/" 2>/dev/null || true
  cp -f "$BUNDLE/agents/"orchestra-*.md "$CURSOR/agents/"
  if [[ -d "$BUNDLE/agents/references" ]]; then
    mkdir -p "$CURSOR/agents/references"
    cp -f "$BUNDLE/agents/references/"*.md "$CURSOR/agents/references/" 2>/dev/null || true
  fi
  # Copy enterprise agent category directories (01-idea … 10-review)
  for agent_dir in "$BUNDLE/agents"/*/; do
    [ -d "$agent_dir" ] || continue
    dir_name=$(basename "$agent_dir")
    mkdir -p "$CURSOR/agents/$dir_name"
    cp -rf "$agent_dir"* "$CURSOR/agents/$dir_name/"
  done
  cp -f "$BUNDLE/rules/"*.mdc "$CURSOR/rules/"
  cp -f "$BUNDLE/ORCHESTRA.md" "$CURSOR/ORCHESTRA.md"

  # Copy all Cloudflare skills (orchestra-loop + cloudflare, agents-sdk, etc.)
  for skill_dir in "$BUNDLE/skills"/*/; do
    skill_name=$(basename "$skill_dir")
    rm -rf "$CURSOR/skills/$skill_name"
    mkdir -p "$CURSOR/skills/$skill_name"
    cp -rf "$skill_dir"* "$CURSOR/skills/$skill_name/"
  done

  # Copy all Cursor built-in skills
  if [ -d "$BUNDLE/skills-cursor" ]; then
    for skill_dir in "$BUNDLE/skills-cursor"/*/; do
      skill_name=$(basename "$skill_dir")
      rm -rf "$CURSOR/skills-cursor/$skill_name"
      mkdir -p "$CURSOR/skills-cursor/$skill_name"
      cp -rf "$skill_dir"* "$CURSOR/skills-cursor/$skill_name/"
    done
  fi

  # Merge hooks.json (dedup by command name)
  node - "$CURSOR" "$BUNDLE/hooks.json" <<'MERGE'
const fs = require("fs");
const path = require("path");
const cursor = process.argv[2];
const srcPath = process.argv[3];
const destPath = path.join(cursor, "hooks.json");
const src = JSON.parse(fs.readFileSync(srcPath, "utf8"));
let dest = { version: 1, hooks: {} };
if (fs.existsSync(destPath)) {
  try { dest = JSON.parse(fs.readFileSync(destPath, "utf8")); } catch {}
  dest.hooks = dest.hooks || {};
}
for (const [event, entries] of Object.entries(src.hooks || {})) {
  const existing = dest.hooks[event] || [];
  const names = new Set(existing.map((e) => e.command));
  for (const entry of entries) {
    if (!names.has(entry.command)) existing.push(entry);
  }
  dest.hooks[event] = existing;
}
fs.writeFileSync(destPath, JSON.stringify(dest, null, 2) + "\n");
console.log("  Merged hooks.json ->", destPath);
MERGE

  # Link skills for external discovery (Agent Skills compat path, host-independent #26)
  populate_agents_skills

  # Autonomy: CLI + permissions.json + sandbox.json (preserves auth/model)
  node "$ROOT/scripts/merge-autonomy-config.js" --cursor --cursor-home "$CURSOR"

  echo "  Cursor agents:    $CURSOR/agents/orchestra.md + orchestra-*.md"
  echo "  Cursor hooks:     $CURSOR/hooks/"
  echo "  Cursor skills:    $CURSOR/skills/ (orchestra-loop + intake/verify + UI + Cloudflare)"
  echo "  Cursor built-in:  $CURSOR/skills-cursor/ (17 skills)"
  echo "  Cursor autonomy:  $CURSOR/cli-config.json + permissions.json + sandbox.json"
  echo "  Agents skills:    $AGENTS_SKILLS/{orchestra-loop,prompt-intake,verification-before-completion,ui-ux-pro-max,brand,design-system,ui-styling,web-design-master}"
}

###############################################################################
# OpenCode installation
###############################################################################
install_opencode() {
  echo "==> Installing OpenCode Orchestra to $OPENCODE"

  if [[ "$SKIP_OPENCODE_UPGRADE" -eq 0 ]]; then
    bash "$ROOT/scripts/ensure-opencode-latest.sh" || {
      echo "WARN OpenCode upgrade failed — continuing with existing CLI if present"
    }
  fi

  # Free-model refresh + dynamic apply (before agent copy + autonomy merge so
  # installed files carry the current light/heavy free-pool assignment).
  echo "==> Free-model refresh + apply"
  if bash "$ROOT/scripts/update-free-models.sh" --refresh --apply; then
    echo "  Free models: global model set; agent hardcodes stripped (inherit)"
  else
    echo "WARN free-model refresh/apply failed (offline first-run?) — keeping existing model IDs"
  fi

  mkdir -p "$OPENCODE/agents" "$OPENCODE/skills" "$OPENCODE/state" "$OPENCODE/hooks" "$OPENCODE/plugins"

  # Copy OpenCode agents (conductor + core + enterprise category dirs)
  cp -f "$BUNDLE/opencode/agents/orchestra.md" "$OPENCODE/agents/" 2>/dev/null || true
  cp -f "$BUNDLE/opencode/agents/"orchestra-*.md "$OPENCODE/agents/" 2>/dev/null || true
  if [[ -d "$BUNDLE/agents/references" ]]; then
    mkdir -p "$OPENCODE/agents/references"
    cp -f "$BUNDLE/agents/references/orchestra-spawn-matrix.md" "$OPENCODE/agents/references/" 2>/dev/null || true
  fi
  for agent_dir in "$BUNDLE/opencode/agents"/*/; do
    [ -d "$agent_dir" ] || continue
    dir_name=$(basename "$agent_dir")
    mkdir -p "$OPENCODE/agents/$dir_name"
    cp -rf "$agent_dir"* "$OPENCODE/agents/$dir_name/"
  done

  # Inherit: strip agent frontmatter model: after copy so subagents use global model
  find "$OPENCODE/agents" -name '*.md' -print0 2>/dev/null | while IFS= read -r -d '' f; do
    if grep -qE '^model:[[:space:]]*opencode/' "$f" 2>/dev/null; then
      python3 - "$f" <<'PY'
import re, sys
path = sys.argv[1]
text = open(path, encoding='utf-8').read()
bom = ''
if text.startswith('﻿'):
    bom, text = '﻿', text[1:]
m = re.match(r'^---\n(.*?)\n---\n(.*)$', text, re.S)
if not m:
    sys.exit(0)
fm, rest = m.group(1), m.group(2)
new_fm, n = re.subn(r'(?m)^model:[ \t]*opencode/[A-Za-z0-9_.-]+[ \t]*\n?', '', fm)
if n:
    new_fm = re.sub(r'\n{3,}', '\n\n', new_fm)
    open(path, 'w', encoding='utf-8').write(bom + '---\n' + new_fm + '\n---\n' + rest)
PY
    fi
  done

  # Copy all OpenCode skills (orchestra-loop + Cloudflare)
  for skill_dir in "$BUNDLE/opencode/skills"/*/; do
    skill_name=$(basename "$skill_dir")
    rm -rf "$OPENCODE/skills/$skill_name"
    mkdir -p "$OPENCODE/skills/$skill_name"
    cp -rf "$skill_dir"* "$OPENCODE/skills/$skill_name/"
  done

  # Copy all OpenCode hooks + lib (not just health check)
  cp -f "$BUNDLE/opencode/hooks/"orchestra-*.js "$OPENCODE/hooks/"
  rm -rf "$OPENCODE/hooks/lib"
  cp -rf "$BUNDLE/opencode/hooks/lib" "$OPENCODE/hooks/lib"
  cp -f "$ROOT/scripts/lib/opencode-config-sanitize.js" "$ROOT/scripts/lib/opencode-v2.js" "$ROOT/scripts/lib/opencode-version.js" \
    "$OPENCODE/hooks/lib/" 2>/dev/null || true

  # Copy OpenCode plugins (ambient system-prompt policy; default-export V2)
  cp -f "$BUNDLE/opencode/plugins/"*.js "$OPENCODE/plugins/" 2>/dev/null || true

  # MCP server (if requested)
  if [[ "$INSTALL_MCP" -eq 1 ]]; then
    echo "==> Installing MCP server dependencies"
    (cd "$ROOT" && npm install --production 2>/dev/null || npm install 2>/dev/null)
    cp -f "$BUNDLE/opencode/hooks/lib/mcp-server.js" "$OPENCODE/hooks/lib/"
  fi

  # Default state (don't overwrite) — runtime reads hooks/state/orchestra.json
  mkdir -p "$OPENCODE/hooks/state"
  if [[ ! -f "$OPENCODE/hooks/state/orchestra.json" ]]; then
    cp -f "$BUNDLE/opencode/state/orchestra.json" "$OPENCODE/hooks/state/orchestra.json"
  fi

  # Global AGENTS.md (don't overwrite — user may have customized)
  if [[ ! -f "$OPENCODE/AGENTS.md" ]]; then
    cp -f "$BUNDLE/config/opencode/AGENTS.md" "$OPENCODE/AGENTS.md"
  fi

  # Link to external skills directory (host-independent copy from bundle, #26)
  populate_agents_skills

  # Autonomy: merge permission/agent into opencode.json (preserves mcp secrets)
  node "$ROOT/scripts/merge-autonomy-config.js" --opencode --opencode-home "$OPENCODE"

  # Weekly free-model schedule: systemd user timer; cron fallback if missing
  if bash "$ROOT/scripts/update-free-models.sh" --schedule; then
    echo "  Free-model schedule: weekly refresh+apply installed"
  else
    echo "WARN could not install weekly free-model schedule — add manually:"
    echo "      17 4 * * 1 bash $ROOT/scripts/update-free-models.sh --refresh --apply"
  fi

  echo "  OpenCode agents:  $OPENCODE/agents/ (core + enterprise)"
  echo "  OpenCode skills:  $OPENCODE/skills/ (orchestra-loop + intake/verify + UI + Cloudflare)"
  echo "  OpenCode state:   $OPENCODE/state/orchestra.json"
  echo "  OpenCode plugins: $OPENCODE/plugins/ (orchestra-ambient default export)"
  echo "  OpenCode autonomy:$OPENCODE/opencode.json (permission + agents; mcp preserved)"
  echo "  OpenCode CLI:     run 'opencode --version' — restart desktop app after upgrade"
}

###############################################################################
# Qoder CLI installation
###############################################################################
install_qoder() {
  echo "==> Installing Qoder Orchestra to $QODER"

  command -v node >/dev/null 2>&1 || { echo "ERROR: 'node' required (install Node.js 18+)"; exit 1; }

  mkdir -p "$QODER/hooks/state" "$QODER/agents" "$QODER/skills"

  # Hook scripts + lib modules (replace lib entirely — cp -rf into existing dir nests lib/lib/)
  cp -f "$BUNDLE/hooks/"orchestra-*.js "$QODER/hooks/"
  rm -rf "$QODER/hooks/lib"
  cp -rf "$BUNDLE/hooks/lib" "$QODER/hooks/lib"

  # Default state (don't overwrite). Source the tracked template — the
  # bundle/hooks/state copy is gitignored runtime state and absent on fresh clones.
  if [[ ! -f "$QODER/hooks/state/orchestra.json" ]]; then
    cp -f "$BUNDLE/opencode/state/orchestra.json" "$QODER/hooks/state/orchestra.json" 2>/dev/null || \
      cp -f "$BUNDLE/hooks/state/orchestra.json" "$QODER/hooks/state/orchestra.json" 2>/dev/null || \
      echo '{}' > "$QODER/hooks/state/orchestra.json"
  fi

  # Agents: generated Qoder tree (scripts/sync-qoder-agents.js) when present,
  # else fall back to the Cursor sources (Qoder tolerates extra frontmatter keys)
  if [[ -d "$BUNDLE/qoder/agents" ]]; then
    rm -rf "$QODER/agents"
    mkdir -p "$QODER/agents"
    cp -rf "$BUNDLE/qoder/agents/." "$QODER/agents/"
    # Qoder parses every *.md under agents/ as an agent config — the shared
    # references doc has no frontmatter and becomes a load error ("Operation
    # aborted" in headless). Keep it in the bundle mirror, not the install.
    rm -rf "$QODER/agents/references"
  else
    echo "WARN: bundle/qoder/agents missing — run 'node scripts/sync-qoder-agents.js' first; copying Cursor agents as fallback"
    cp -f "$BUNDLE/agents/orchestra.md" "$QODER/agents/" 2>/dev/null || true
    cp -f "$BUNDLE/agents/"orchestra-*.md "$QODER/agents/"
    for agent_dir in "$BUNDLE/agents"/*/; do
      [ -d "$agent_dir" ] || continue
      dir_name=$(basename "$agent_dir")
      [ "$dir_name" = "references" ] && continue
      mkdir -p "$QODER/agents/$dir_name"
      cp -rf "$agent_dir"* "$QODER/agents/$dir_name/"
    done
  fi

  # Skills (SKILL.md format is Qoder-compatible as-is)
  for skill_dir in "$BUNDLE/skills"/*/; do
    skill_name=$(basename "$skill_dir")
    rm -rf "$QODER/skills/$skill_name"
    mkdir -p "$QODER/skills/$skill_name"
    cp -rf "$skill_dir"* "$QODER/skills/$skill_name/"
  done

  cp -f "$BUNDLE/ORCHESTRA.md" "$QODER/ORCHESTRA.md"

  # Merge hooks into ~/.qoder/settings.json (preserves model/security/mcpServers)
  node "$ROOT/scripts/merge-qoder-settings.js" --qoder-home "$QODER"

  echo "  Qoder agents:    $QODER/agents/ (conductor + phase + specialists)"
  echo "  Qoder hooks:     $QODER/hooks/ (registered in $QODER/settings.json)"
  echo "  Qoder skills:    $QODER/skills/ (orchestra-loop + intake/verify + UI + Cloudflare)"
  echo "  Qoder spawn:     Agent tool + subagent_type (see docs/orchestra-cross-platform.md)"
}

###############################################################################
# Claude Code installation
###############################################################################
install_claude() {
  echo "==> Installing Claude Code Orchestra to $CLAUDE"

  command -v node >/dev/null 2>&1 || { echo "ERROR: 'node' required (install Node.js 18+)"; exit 1; }

  mkdir -p "$CLAUDE/hooks/state" "$CLAUDE/agents" "$CLAUDE/skills"

  # Hook scripts + lib modules (same entrypoints as Cursor; lib/io.js
  # normalizes agent_type from Claude's SubagentStop stdin)
  cp -f "$BUNDLE/hooks/"orchestra-*.js "$CLAUDE/hooks/"
  rm -rf "$CLAUDE/hooks/lib"
  cp -rf "$BUNDLE/hooks/lib" "$CLAUDE/hooks/lib"

  # Default state (don't overwrite). Tracked template — the bundle/hooks/state
  # copy is gitignored runtime state and absent on fresh clones.
  if [[ ! -f "$CLAUDE/hooks/state/orchestra.json" ]]; then
    cp -f "$BUNDLE/opencode/state/orchestra.json" "$CLAUDE/hooks/state/orchestra.json" 2>/dev/null || \
      cp -f "$BUNDLE/hooks/state/orchestra.json" "$CLAUDE/hooks/state/orchestra.json" 2>/dev/null || \
      echo '{}' > "$CLAUDE/hooks/state/orchestra.json"
  fi

  # Agents: generated flat mirror (scripts/sync-claude-agents.js). Copy over
  # existing files only — never delete user-authored Claude agents.
  if [[ -d "$BUNDLE/claude/agents" ]]; then
    cp -f "$BUNDLE/claude/agents/"*.md "$CLAUDE/agents/"
  else
    echo "WARN: bundle/claude/agents missing — run 'node scripts/sync-claude-agents.js' first"
  fi

  # Skills (Claude Code reads ~/.claude/skills/<name>/SKILL.md)
  for skill_dir in "$BUNDLE/skills"/*/; do
    skill_name=$(basename "$skill_dir")
    rm -rf "$CLAUDE/skills/$skill_name"
    mkdir -p "$CLAUDE/skills/$skill_name"
    cp -rf "$skill_dir"* "$CLAUDE/skills/$skill_name/"
  done

  cp -f "$BUNDLE/ORCHESTRA.md" "$CLAUDE/ORCHESTRA.md"

  # Merge hooks into ~/.claude/settings.json (preserves permissions/model/env/mcpServers)
  node "$ROOT/scripts/merge-claude-settings.js" --claude-home "$CLAUDE"

  # Link skills for external discovery (Agent Skills compat path, host-independent #26)
  populate_agents_skills

  echo "  Claude agents:   $CLAUDE/agents/ (conductor + phase + specialists)"
  echo "  Claude hooks:    $CLAUDE/hooks/ (registered in $CLAUDE/settings.json)"
  echo "  Claude skills:   $CLAUDE/skills/ (orchestra-loop + intake/verify + UI + Cloudflare)"
  echo "  Claude spawn:    Agent tool + subagent_type (see docs/orchestra-cross-platform.md)"
}

###############################################################################
# Codex CLI installation
###############################################################################
install_codex() {
  echo "==> Installing Codex CLI Orchestra to $CODEX"

  mkdir -p "$CODEX/agents"

  # Flat TOML agents (scripts/sync-codex-agents.js). Copy over existing files
  # only — never delete user-authored Codex agents.
  if [[ -d "$BUNDLE/codex/agents" ]]; then
    cp -f "$BUNDLE/codex/agents/"*.toml "$CODEX/agents/"
  else
    echo "WARN: bundle/codex/agents missing — run 'node scripts/sync-codex-agents.js' first"
  fi

  cp -f "$BUNDLE/ORCHESTRA.md" "$CODEX/ORCHESTRA.md"

  # Codex reads skills from ~/.agents/skills (shared with other hosts). Populate
  # it host-independently from the bundle (#26) rather than leaving it to whichever
  # host installer ran last.
  populate_agents_skills

  echo "  Codex agents:    $CODEX/agents/ (160 TOML custom agents)"
  echo "  Codex skills:    $AGENTS_SKILLS/ (shared Agent Skills path)"
  echo "  Codex spawn:     spawn_agent + agent_type (see docs/orchestra-cross-platform.md)"
  echo "  Codex hooks:     not wired (features.hooks is gated; conductor drives phases)"
}

###############################################################################
# Health checks
###############################################################################
health_cursor() {
  if [[ -f "$CURSOR/hooks/orchestra-health.js" ]]; then
    echo ""
    echo "==> Cursor health check"
    node "$CURSOR/hooks/orchestra-health.js" || true
  fi
}

health_opencode() {
  echo ""
  echo "==> OpenCode health check"
  if [[ -f "$OPENCODE/hooks/orchestra-health-opencode.js" ]]; then
    node "$OPENCODE/hooks/orchestra-health-opencode.js" || true
  else
    echo "WARN: health check script not found at $OPENCODE/hooks/orchestra-health-opencode.js"
  fi
}

health_claude() {
  echo ""
  echo "==> Claude Code health check"
  node "$ROOT/scripts/health-claude.js" --home "$CLAUDE" || true
}

health_codex() {
  echo ""
  echo "==> Codex CLI health check"
  node "$ROOT/scripts/health-codex.js" --home "$CODEX" || true
}

###############################################################################
# Project bridge
###############################################################################
# Canonical --project target (#22): an explicit --project-dir wins, else the
# caller's CWD — NOT the clone's parent, which is what the old code wrote to.
_project_target() {
  local t="${PROJECT_DIR:-$PWD}"
  [[ -d "$t" ]] && t="$(cd "$t" && pwd)"
  printf '%s' "$t"
}

install_project_bridge() {
  local target; target="$(_project_target)"
  if [[ "$target" == "$ROOT" && "$FORCE_PROJECT" -ne 1 ]]; then
    echo "REFUSING: --project target is the orchestra clone itself ($ROOT)."
    echo "  cd into the repo you want the bridge in (it lands in \$PWD/.cursor),"
    echo "  pass --project-dir <path>, or add --force-project to override."
    return 0
  fi
  echo "==> Installing project bridge to $target/.cursor"
  mkdir -p "$target/.cursor/hooks"
  cp -f "$ROOT/project-bridge/hooks.json" "$target/.cursor/hooks.json"
  cp -f "$ROOT/project-bridge/hooks/bridge.js" "$target/.cursor/hooks/bridge.js"
}

###############################################################################
# Repo scoping (cross-tool ignore files)
###############################################################################
install_scoping() {
  echo "==> Installing repo scoping (cross-tool ignore files)"

  # Install setup-repo-scoping.sh to ~/.local/bin
  mkdir -p "$HOME/.local/bin"
  if [[ -f "$ROOT/scripts/setup-repo-scoping.sh" ]]; then
    rm -f "$HOME/.local/bin/setup-repo-scoping.sh"
    cp -f "$ROOT/scripts/setup-repo-scoping.sh" "$HOME/.local/bin/setup-repo-scoping.sh"
    chmod +x "$HOME/.local/bin/setup-repo-scoping.sh"
    echo "  Global script:   ~/.local/bin/setup-repo-scoping.sh"
  fi

  # Install opencode-maintenance.sh to ~/.local/bin
  if [[ -f "$ROOT/scripts/opencode-maintenance.sh" ]]; then
    rm -f "$HOME/.local/bin/opencode-maintenance.sh"
    cp -f "$ROOT/scripts/opencode-maintenance.sh" "$HOME/.local/bin/opencode-maintenance.sh"
    chmod +x "$HOME/.local/bin/opencode-maintenance.sh"
    echo "  Maintenance:     ~/.local/bin/opencode-maintenance.sh"
  fi

  # Global gitignore — excludes common heavy dirs from all repos
  mkdir -p "$HOME/.config/git"
  local GITIGNORE="$HOME/.config/git/ignore"
  if [[ ! -f "$GITIGNORE" ]]; then
    cat > "$GITIGNORE" <<'GITEOF'
node_modules/
vendor/
dist/
build/
coverage/
.next/
.turbo/
.cache/
.ruff_cache/
.mypy_cache/
.pytest_cache/
__pycache__/
venv/
.venv/
env/
*.pyc
*.log
.DS_Store
GITEOF
    echo "  Global gitignore: $GITIGNORE"
  else
    echo "  Global gitignore: $GITIGNORE (exists, kept)"
  fi

  # Tell git to use it — but never clobber a pre-existing user setting (#15).
  # Only point core.excludesfile at the orchestra ignore when it's currently
  # unset; if the user already has their own global excludes file, leave it
  # alone and print guidance to merge manually.
  if command -v git >/dev/null 2>&1; then
    local _cur_excl
    _cur_excl="$(git config --global --get core.excludesfile 2>/dev/null || true)"
    if [[ -n "$_cur_excl" && "$_cur_excl" != "$GITIGNORE" ]]; then
      echo "  git excludesfile: kept existing user value ($_cur_excl) — not overwriting (#15)"
      echo "                    To also ignore node_modules/vendor/etc, append the lines from"
      echo "                    $GITIGNORE to your excludes file."
    else
      git config --global core.excludesfile "$GITIGNORE"
      echo "  git excludesfile: $(git config --global core.excludesfile)"
    fi
  fi

  echo "  Usage:           setup-repo-scoping.sh /path/to/any/repo"
  echo "  Auto-detects:    single-repo vs monorepo, generates .ignore + .cursorignore"
}

###############################################################################
# Studio installation
###############################################################################
install_studio() {
  echo "==> Installing Orchestra Studio"

  # Build studio
  echo "  Building Studio..."
  (cd "$ROOT/studio" && npm install --legacy-peer-deps && npm run build)
  # mkdir BOTH studio parents first (#19): `cp -rf dist/ <dest>/` only preserves a
  # `dist/` level when <dest>/ already exists; otherwise it copies dist's contents
  # up a level, landing the dashboard at ~/.cursor/studio/index.html, not .../dist/.
  mkdir -p "$OPENCODE/studio" "$CURSOR/studio"
  rm -rf "$CURSOR/studio/dist"
  rm -rf "$OPENCODE/studio/dist"
  cp -rf "$ROOT/studio/dist" "$CURSOR/studio/"
  cp -rf "$ROOT/studio/dist" "$OPENCODE/studio/"

  # Install and configure service manager
  echo "  Installing service manager..."
  local dry_run_arg=""
  [[ "$DRY_RUN" -eq 1 ]] && dry_run_arg="--dry-run"
  bash "$ROOT/scripts/studio-service.sh" install --port 3110 $dry_run_arg

  # Create shim launcher that delegates to service manager.
  # Header is unquoted so the install-time repo path is baked in; the body is
  # quoted so `$#`/`$1`/`$@` survive as runtime expansions.
  mkdir -p "$HOME/.local/bin"
  {
    cat <<HEADER
#!/usr/bin/env bash
# Orchestra Studio v2 launcher (shim)
# Delegates to studio-service.sh for service management.
# Repo recorded at install time; override with PCORE_ORCHESTRA_REPO.
SERVICE_SCRIPT="\${PCORE_ORCHESTRA_REPO:-$ROOT}/scripts/studio-service.sh"
HEADER
    cat <<'LAUNCHER'

if [[ ! -f "$SERVICE_SCRIPT" ]]; then
  echo "ERROR: Service script not found. Run 'bash install.sh --studio' first."
  exit 1
fi

# Bare invocation = start
if [[ $# -eq 0 ]]; then
  exec "$SERVICE_SCRIPT" start
fi

# Pass through subcommands
exec "$SERVICE_SCRIPT" "$@"
LAUNCHER
  } > "$HOME/.local/bin/orchestra-studio"
  chmod +x "$HOME/.local/bin/orchestra-studio"
  echo "  Launcher:        ~/.local/bin/orchestra-studio (shim -> studio-service.sh)"
  echo "  Service:         studio-service.sh install|start|stop|status|logs|uninstall"
  echo "  Studio dist:     $CURSOR/studio/dist (Cursor, reference)"
  echo "  Studio dist:     $OPENCODE/studio/dist (OpenCode, reference)"
}

###############################################################################
# Uninstall (bundle/ is the manifest of what we installed — remove only those)
###############################################################################
_LINK_SKILLS="orchestra-loop orchestra-install prompt-intake verification-before-completion ui-ux-pro-max brand design-system ui-styling web-design-master"

# Populate ~/.agents/skills from the bundle so the shared Agent Skills discovery
# dir is host-independent (#26). Previously each host installer symlinked this
# path to its OWN skills dir, so the last-installing host "owned" the links and
# removing/reinstalling it dangled them for the others. A copy from the single
# bundle source is identical regardless of install order.
populate_agents_skills() {
  mkdir -p "$AGENTS_SKILLS"
  local s
  for s in $_LINK_SKILLS; do
    if [[ -d "$BUNDLE/skills/$s" ]]; then
      rm -rf "$AGENTS_SKILLS/$s"
      cp -r "$BUNDLE/skills/$s" "$AGENTS_SKILLS/$s"
    fi
  done
}

# Restore a merged JSON file from the newest orchestra backup the installers
# wrote (`*.bak-<iso>` for settings, `*.bak.<stamp>` for autonomy). Echo + return
# 0 when restored; return 1 when no backup exists.
restore_backup() {
  local f="$1" newest=""
  [[ -f "$f" ]] || return 1
  newest="$(ls -1 "$f".bak-* "$f".bak.* 2>/dev/null | sort | tail -1 || true)"
  [[ -n "$newest" ]] || return 1
  mv -f "$newest" "$f"
  rm -f "$f".bak-* "$f".bak.* 2>/dev/null || true
  echo "  restored $(basename "$f") from backup"
  return 0
}

# No-backup fallback for Cursor hooks.json: drop hook entries whose command
# points at an orchestra-*.js script (leaves unrelated user hooks untouched).
strip_orchestra_hooks() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  command -v node >/dev/null 2>&1 || { echo "  WARN: node missing — could not strip $f"; return 1; }
  node -e '
    const fs = require("fs");
    const f = process.argv[1];
    let j; try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch { process.exit(0); }
    const orch = (c) => typeof c === "string" && /orchestra-.*\.js/.test(c);
    const hooks = j && j.hooks;
    if (hooks && typeof hooks === "object" && !Array.isArray(hooks)) {
      for (const ev of Object.keys(hooks)) {
        if (Array.isArray(hooks[ev])) {
          hooks[ev] = hooks[ev].filter((e) => !(e && orch(e.command)));
        }
      }
    }
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
  ' "$f" 2>/dev/null && echo "  stripped orchestra hooks from $(basename "$f")" || true
}

# Remove bundle-matched subdirectories/files under a host dir (only what we copied).
_rm_bundle_dirs() {
  local dest="$1" srcset="$2" d
  [ -d "$srcset" ] || return 0
  for d in "$srcset"/*/; do [ -d "$d" ] && rm -rf "$dest/$(basename "$d")"; done
}

uninstall_cursor() {
  echo "==> Uninstalling Orchestra from $CURSOR"
  rm -f "$CURSOR/hooks/"orchestra-*.js
  rm -rf "$CURSOR/hooks/lib" "$CURSOR/hooks/state"
  rm -f "$CURSOR/agents/orchestra.md" "$CURSOR/agents/"orchestra-*.md
  rm -rf "$CURSOR/agents/references"
  _rm_bundle_dirs "$CURSOR/agents" "$BUNDLE/agents"
  _rm_bundle_dirs "$CURSOR/skills" "$BUNDLE/skills"
  _rm_bundle_dirs "$CURSOR/skills-cursor" "$BUNDLE/skills-cursor"
  rm -f "$CURSOR/rules/orchestra-loop.mdc" "$CURSOR/ORCHESTRA.md"
  # shared ~/.agents/skills is device-level; torn down once by run_uninstall on
  # a full all-host uninstall (#26), never here so a scoped uninstall is safe.
  restore_backup "$CURSOR/hooks.json" || strip_orchestra_hooks "$CURSOR/hooks.json"
  for cf in cli-config.json permissions.json sandbox.json; do restore_backup "$CURSOR/$cf" || true; done
}

uninstall_opencode() {
  echo "==> Uninstalling Orchestra from $OPENCODE"
  rm -f "$OPENCODE/hooks/"orchestra-*.js
  rm -rf "$OPENCODE/hooks/lib" "$OPENCODE/hooks/state" "$OPENCODE/state"
  rm -f "$OPENCODE/agents/orchestra.md" "$OPENCODE/agents/"orchestra-*.md
  rm -rf "$OPENCODE/agents/references"
  _rm_bundle_dirs "$OPENCODE/agents" "$BUNDLE/opencode/agents"
  _rm_bundle_dirs "$OPENCODE/skills" "$BUNDLE/opencode/skills"
  rm -f "$OPENCODE/plugins/orchestra-"*.js
  # shared ~/.agents/skills is device-level; torn down once by run_uninstall on
  # a full all-host uninstall (#26), never here so a scoped uninstall is safe.
  restore_backup "$OPENCODE/opencode.json" || true
  # free-model weekly schedule (best-effort; manual fallback always printed)
  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user disable --now pcore-free-models.timer >/dev/null 2>&1 || true
    systemctl --user stop pcore-free-models.service >/dev/null 2>&1 || true
  fi
  if command -v crontab >/dev/null 2>&1; then
    crontab -l 2>/dev/null | grep -v "update-free-models.sh" | crontab - 2>/dev/null || true
  fi
  echo "  NOTE: if a free-model timer unit or cron entry remains, remove it manually."
}

uninstall_qoder() {
  echo "==> Uninstalling Orchestra from $QODER"
  rm -f "$QODER/hooks/"orchestra-*.js
  rm -rf "$QODER/hooks/lib" "$QODER/hooks/state"
  _rm_bundle_dirs "$QODER/agents" "$BUNDLE/qoder"
  rm -f "$QODER/agents/orchestra.md" "$QODER/agents/"orchestra-*.md
  _rm_bundle_dirs "$QODER/skills" "$BUNDLE/skills"
  rm -f "$QODER/ORCHESTRA.md"
  restore_backup "$QODER/settings.json" || strip_orchestra_hooks "$QODER/settings.json"
}

uninstall_claude() {
  echo "==> Uninstalling Orchestra from $CLAUDE"
  rm -f "$CLAUDE/hooks/"orchestra-*.js
  rm -rf "$CLAUDE/hooks/lib" "$CLAUDE/hooks/state"
  # remove only agents we shipped (never user-authored Claude agents)
  if [ -d "$BUNDLE/claude/agents" ]; then
    for a in "$BUNDLE/claude/agents"/*.md; do [ -f "$a" ] && rm -f "$CLAUDE/agents/$(basename "$a")"; done
  fi
  _rm_bundle_dirs "$CLAUDE/skills" "$BUNDLE/skills"
  rm -f "$CLAUDE/ORCHESTRA.md"
  # shared ~/.agents/skills is device-level; torn down once by run_uninstall on
  # a full all-host uninstall (#26), never here so a scoped uninstall is safe.
  restore_backup "$CLAUDE/settings.json" || strip_orchestra_hooks "$CLAUDE/settings.json"
}

uninstall_codex() {
  echo "==> Uninstalling Orchestra from $CODEX"
  # remove only TOML agents we shipped
  if [ -d "$BUNDLE/codex/agents" ]; then
    for a in "$BUNDLE/codex/agents"/*.toml; do [ -f "$a" ] && rm -f "$CODEX/agents/$(basename "$a")"; done
  fi
  rm -f "$CODEX/ORCHESTRA.md"
  # shared ~/.agents/skills is device-level; torn down once by run_uninstall on
  # a full all-host uninstall (#26), never here so a scoped uninstall is safe.
}

uninstall_project_bridge() {
  local target; target="$(_project_target)"
  echo "==> Removing project bridge from $target/.cursor"
  rm -f "$target/.cursor/hooks.json" "$target/.cursor/hooks/bridge.js"
}

uninstall_global_bin() {
  echo "==> Removing global helper scripts"
  rm -f "$HOME/.local/bin/setup-repo-scoping.sh" \
        "$HOME/.local/bin/opencode-maintenance.sh" \
        "$HOME/.local/bin/orchestra-studio"
  # global gitignore + excludesfile are left in place (may hold user entries).
}

run_uninstall() {
  echo "=========================================================================="
  echo " Orchestra Uninstaller"
  echo "=========================================================================="
  echo ""
  [[ "$INSTALL_CURSOR" -eq 1 ]] && uninstall_cursor
  [[ "$INSTALL_OPENCODE" -eq 1 ]] && uninstall_opencode
  [[ "$INSTALL_QODER" -eq 1 ]] && uninstall_qoder
  [[ "$INSTALL_CLAUDE" -eq 1 ]] && uninstall_claude
  [[ "$INSTALL_CODEX" -eq 1 ]] && uninstall_codex
  [[ "$INSTALL_PROJECT" -eq 1 ]] && uninstall_project_bridge
  if [[ "$INSTALL_STUDIO" -eq 1 ]]; then
    echo "==> Removing Studio service"
    bash "$ROOT/scripts/studio-service.sh" uninstall 2>/dev/null || true
  fi
  # #26: ~/.agents/skills is shared, device-level content (host-independent copy
  # from the bundle). Drop each entry only once NO remaining host install still
  # provides it, so a scoped single-host uninstall can't strand the other hosts,
  # while a full teardown still cleans up. (Codex reads the shared dir directly,
  # so it has no private skills dir to check here.)
  echo "==> Pruning shared Agent Skills no longer used by any host"
  for _sk in $_LINK_SKILLS; do
    _used=0
    for _d in "$CURSOR/skills" "$OPENCODE/skills" "$CLAUDE/skills" "$QODER/skills"; do
      [[ -d "$_d/$_sk" ]] && _used=1 && break
    done
    [[ "$_used" -eq 0 ]] && rm -rf "$AGENTS_SKILLS/$_sk"
  done
  uninstall_global_bin
  echo ""
  echo "============================================"
  echo " Orchestra uninstalled."
  echo " Restart the host app(s) to drop cached hooks/agents."
  echo "============================================"
}

###############################################################################
# Main
###############################################################################
if [[ "$UNINSTALL" -eq 1 ]]; then
  [[ "$DRY_RUN" -eq 1 ]] && echo "NOTE: --dry-run is ignored for --uninstall; changes apply now." || true
  run_uninstall
  exit 0
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "DRY RUN: Would install:"
  [[ "$INSTALL_CURSOR" -eq 1 ]] && echo "  - Cursor"
  [[ "$INSTALL_OPENCODE" -eq 1 ]] && echo "  - OpenCode"
  [[ "$INSTALL_QODER" -eq 1 ]] && echo "  - Qoder CLI"
  [[ "$INSTALL_CLAUDE" -eq 1 ]] && echo "  - Claude Code"
  [[ "$INSTALL_CODEX" -eq 1 ]] && echo "  - Codex CLI"
  [[ "$INSTALL_PROJECT" -eq 1 ]] && echo "  - Project bridge"
  [[ "$INSTALL_MCP" -eq 1 ]] && echo "  - MCP server"
  [[ "$INSTALL_STUDIO" -eq 1 ]] && echo "  - Studio dashboard"
  exit 0
fi

if [[ "$INSTALL_CURSOR" -eq 1 ]]; then
  install_cursor
fi

if [[ "$INSTALL_OPENCODE" -eq 1 ]]; then
  install_opencode
fi

if [[ "$INSTALL_QODER" -eq 1 ]]; then
  install_qoder
fi

if [[ "$INSTALL_CLAUDE" -eq 1 ]]; then
  install_claude
fi

if [[ "$INSTALL_CODEX" -eq 1 ]]; then
  install_codex
fi

if [[ "$INSTALL_PROJECT" -eq 1 ]]; then
  install_project_bridge
fi

if [[ "$INSTALL_STUDIO" -eq 1 ]]; then
  install_studio
fi

# Repo scoping (always install — benefits all tools on the device)
install_scoping

# Health checks
if [[ "$INSTALL_CURSOR" -eq 1 ]]; then
  health_cursor
fi
if [[ "$INSTALL_OPENCODE" -eq 1 ]]; then
  health_opencode
fi
if [[ "$INSTALL_CLAUDE" -eq 1 ]]; then
  health_claude
fi
if [[ "$INSTALL_CODEX" -eq 1 ]]; then
  health_codex
fi

echo ""
echo "============================================"
echo " Orchestra installed!"
echo ""
if [[ "$INSTALL_CURSOR" -eq 1 ]]; then
  echo "  Cursor global:   $CURSOR"
  echo "  Cursor hooks:    Settings → Hooks (restart Cursor IDE)"
  echo "  Cursor autonomy: permissions.json + sandbox.json + cli-config (merged)"
  echo "  Cursor Approvals: Settings → Agents → Approvals → Auto-review"
  echo "  Cursor test:     node $CURSOR/hooks/orchestra-health.js"
  echo "  Cursor status:   node $CURSOR/hooks/orchestra-enable.js status"
fi
if [[ "$INSTALL_OPENCODE" -eq 1 ]]; then
  echo "  OpenCode global: $OPENCODE"
  echo "  OpenCode tip:    opencode --auto  (session auto-approve; denies still bind)"
  echo "  OpenCode test:   node $OPENCODE/hooks/orchestra-health-opencode.js"
  echo "  Free models:     bash scripts/update-free-models.sh --refresh --apply (weekly via systemd/cron)"
fi
if [[ "$INSTALL_QODER" -eq 1 ]]; then
  echo "  Qoder global:    $QODER"
  echo "  Qoder hooks:     merged into $QODER/settings.json (SessionStart/UserPromptSubmit/SubagentStop/Stop)"
  echo "  Qoder test:      node $QODER/hooks/orchestra-enable.js status"
  echo "  Qoder tip:       qoder --agent orchestra  (conductor as session agent)"
fi
if [[ "$INSTALL_CLAUDE" -eq 1 ]]; then
  echo "  Claude global:   $CLAUDE"
  echo "  Claude hooks:    merged into $CLAUDE/settings.json (SessionStart/UserPromptSubmit/SubagentStop/Stop)"
  echo "  Claude test:     node scripts/health-claude.js --home $CLAUDE"
  echo "  Claude tip:      Agent tool with subagent_type=orchestra-planner"
fi
if [[ "$INSTALL_CODEX" -eq 1 ]]; then
  echo "  Codex global:    $CODEX"
  echo "  Codex test:      node scripts/health-codex.js --home $CODEX"
  echo "  Codex tip:       spawn_agent with agent_type=orchestra-planner"
fi
if [[ "$INSTALL_MCP" -eq 1 ]]; then
  echo "  MCP server:     @modelcontextprotocol/sdk installed; mcp-server.js in hooks/lib/"
fi
if [[ "$INSTALL_STUDIO" -eq 1 ]]; then
  echo "  Studio dashboard: ~/.local/bin/orchestra-studio (starts on http://localhost:3110)"
fi
echo "  Repo scoping:    ~/.local/bin/setup-repo-scoping.sh (run on any repo)"
echo "  Maintenance:    ~/.local/bin/opencode-maintenance.sh --apply (clean DB/logs)"
echo "  Global gitignore: ~/.config/git/ignore (node_modules, vendor, venv, caches)"
echo ""
echo "  Docs: docs/autonomous-workflow.md · docs/orchestra-cross-platform.md"
echo "  Restart the host app (Cursor, OpenCode, Qoder, Claude Code, Codex) after install."
echo "============================================"
