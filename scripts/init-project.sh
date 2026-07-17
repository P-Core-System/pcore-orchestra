#!/usr/bin/env bash
# Bootstrap a new project with full P-Core Orchestra context.
#
# Usage:
#   bash scripts/init-project.sh                          # interactive guided setup (recommended)
#   bash scripts/init-project.sh /path/to/project         # interactive at target
#   bash scripts/init-project.sh /path/to/project --type web --name "My App"   # silent
#   bash scripts/init-project.sh --type api --name "API"  # silent (cwd)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATES="$ROOT/templates"
ARCH_DIR="$TEMPLATES/architectures"
CONTEXT_DIR="$TEMPLATES/context"
TARGET=""
FORCE=false
PROJECT_TYPE=""
PROJECT_NAME=""
PROJECT_SLUG=""
ARCH=""
INTERACTIVE=false

# ─── Parse arguments ──────────────────────────────────────────────────────────

POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force|-f) FORCE=true; shift ;;
    --type|-t) PROJECT_TYPE="$2"; shift 2 ;;
    --name|-n) PROJECT_NAME="$2"; shift 2 ;;
    --slug|-s) PROJECT_SLUG="$2"; shift 2 ;;
    --arch|-a) ARCH="$2"; shift 2 ;;
    --interactive|-i) INTERACTIVE=true; shift ;;
    --help|-h) echo "Usage: bash scripts/init-project.sh [target] [--type TYPE] [--name NAME] [--slug SLUG] [--arch FILE] [--force] [--interactive]"; exit 0 ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done

TARGET="${POSITIONAL[0]:-.}"
TARGET="$(cd "$TARGET" 2>/dev/null && pwd || echo "$TARGET")"

# Auto-interactive if no type/name/arch flags given
if [[ -z "$PROJECT_TYPE" && -z "$PROJECT_NAME" && -z "$ARCH" && "$INTERACTIVE" == false ]]; then
  INTERACTIVE=true
fi

# ─── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; NC='\033[0m'
prompt()  { printf "${CYAN}❯ ${NC}%s " "$1"; }
info()    { printf "${GREEN}==>${NC} %s\n" "$1"; }
warn()    { printf "${YELLOW}==>${NC} %s\n" "$1"; }
error()   { printf "${RED}==>${NC} %s\n" "$1"; }

# ─── Helpers ──────────────────────────────────────────────────────────────────

slugify() { echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//'; }

ask() {
  local var="$1" msg="$2" default="${3:-}"
  if [[ -n "$default" ]]; then
    prompt "$msg [$default]"
  else
    prompt "$msg"
  fi
  read -r val
  if [[ -z "$val" && -n "$default" ]]; then val="$default"; fi
  printf -v "$var" "%s" "$val"
}

ask_required() {
  local var="$1" msg="$2" default="${3:-}"
  while true; do
    ask "$var" "$msg" "$default"
    local val="${!var}"
    if [[ -n "$val" ]]; then break; fi
    warn "This field is required."
  done
}

ask_select() {
  local var="$1" msg="$2"; shift 2
  local options=("$@")
  prompt "$msg"
  for i in "${!options[@]}"; do
    echo "  $((i+1)). ${options[$i]}"
  done
  while true; do
    prompt "(1-${#options[@]})"
    read -r sel
    if [[ "$sel" =~ ^[0-9]+$ ]] && (( sel >= 1 && sel <= ${#options[@]} )); then
      printf -v "$var" "%s" "${options[$((sel-1))]}"
      break
    fi
  done
}

ask_multi() {
  local var="$1" msg="$2"; shift 2
  local options=("$@")
  echo "  $msg (space-separated numbers, e.g. '1 3 5', or 0 for none):"
  for i in "${!options[@]}"; do
    echo "    $((i+1)). ${options[$i]}"
  done
  local result=()
  while true; do
    prompt ""
    read -r sel_line
    local selections=($sel_line)
    if [[ " ${selections[*]} " == *" 0 "* ]]; then
      result=()
      break
    fi
    local valid=true
    result=()
    for s in "${selections[@]}"; do
      if [[ "$s" =~ ^[0-9]+$ ]] && (( s >= 1 && s <= ${#options[@]} )); then
        result+=("${options[$((s-1))]}")
      else
        valid=false; break
      fi
    done
    if [[ "$valid" == true && "${#result[@]}" -gt 0 ]]; then break; fi
  done
  printf -v "$var" "%s" "${result[*]}"
}

# ─── Interactive mode ─────────────────────────────────────────────────────────

if [[ "$INTERACTIVE" == true ]]; then
  echo ""
  info "P-Core Orchestra — Interactive Project Init"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "We'll ask a series of questions to set up your project."
  echo "Press Enter to accept defaults (shown in brackets)."
  echo ""

  # ── Project Basics ────────────────────────────────────────────────────────
  info "Step 1: Project Basics"
  ask_required PROJECT_NAME "Project name?" "My Project"
  PROJECT_SLUG="$(slugify "$PROJECT_NAME")"
  ask PROJECT_SLUG "Project slug (used in IDs, paths)?" "$PROJECT_SLUG"

  ask_select PROJECT_TYPE "Project type?" \
    "web" "mobile" "api" "ai" "devops" "library" "saas" "internal-tool" "oss" "cli" "game" "data"

  # ── Description ───────────────────────────────────────────────────────────
  echo ""
  info "Step 2: Description & Goals"
  ask PROJECT_DESC "One-line description of what this project does?" "A $PROJECT_TYPE application"
  ask PROJECT_PROBLEM "What problem does it solve?" ""
  ask PROJECT_AUDIENCE "Who is it for?" ""
  ask PROJECT_GOAL1 "Goal #1?" "Build and ship the MVP"
  ask PROJECT_GOAL2 "Goal #2?" ""
  ask PROJECT_GOAL3 "Goal #3?" ""

  # ── Features ──────────────────────────────────────────────────────────────
  echo ""
  info "Step 3: Features & Scope"
  ask PROJECT_FEATURES "Key features (comma-separated)?" ""
  ask PROJECT_SCOPE_IN "In scope (comma-separated)?" ""
  ask PROJECT_SCOPE_OUT "Out of scope (comma-separated)?" ""

  # ── Team ──────────────────────────────────────────────────────────────────
  echo ""
  info "Step 4: Team"
  ask PROJECT_LEAD "Project lead name?" ""
  ask PROJECT_TEAM "Team members (comma-separated names)?" ""

  # ── Stack ─────────────────────────────────────────────────────────────────
  echo ""
  info "Step 5: Technology Stack"
  ask_select PROJECT_LANG "Primary language?" \
    "TypeScript" "JavaScript" "Python" "Go" "Rust" "PHP" "Kotlin" "Swift" "C#" "Zig"
  ask_select PROJECT_RUNTIME "Runtime?" \
    "Node.js" "Bun" "Deno" "Python" "Go" "Rust" "PHP"
  ask_select PROJECT_PKG "Package manager?" \
    "pnpm" "npm" "yarn" "bun" "pip" "cargo" "composer" "go-mod"

  ask_multi PROJECT_FRAMEWORKS "Frameworks?" \
    "React" "Next.js" "Hono" "Express" "Fastify" "NestJS" "Django" "Laravel" "Vue" "Svelte" "Astro" "Tauri"
  ask_multi PROJECT_DATABASES "Databases?" \
    "PostgreSQL" "MySQL" "SQLite" "MongoDB" "Redis" "D1" "PlanetScale" "Supabase"
  ask_multi PROJECT_INFRA "Infrastructure?" \
    "Cloudflare" "AWS" "GCP" "Azure" "Docker" "Kubernetes" "Vercel" "Netlify"

  # ── Architecture ──────────────────────────────────────────────────────────
  echo ""
  info "Step 6: Architecture"
  echo "  Available templates:"
  local arch_files=()
  local arch_opt=("None (skip)")
  for f in "$ARCH_DIR"/*.md; do
    local base="$(basename "$f")"
    arch_files+=("$base")
    local label="${base#??-}"; label="${label%.md}"
    echo "    $(( ${#arch_files[@]} )). $label"
    arch_opt+=("$base")
  done
  ask_select ARCH "${#arch_files[@]} architecture templates available. Pick one (or 1 for None)?" "${arch_opt[@]}"

  # ── Environments ──────────────────────────────────────────────────────────
  echo ""
  info "Step 7: Environments"
  ask PROJECT_URL_DEV "Dev URL?" "http://localhost:3000"
  ask PROJECT_URL_STAGING "Staging URL?" ""
  ask PROJECT_URL_PROD "Production URL?" ""

  # ── Security & Auth ───────────────────────────────────────────────────────
  echo ""
  info "Step 8: Security"
  ask_select PROJECT_AUTH "Authentication provider?" \
    "None (skip)" "neon-auth" "clerk" "auth0" "supabase" "better-auth" "custom"
  if [[ "$PROJECT_AUTH" != "None (skip)" ]]; then
    ask_select PROJECT_AUTHZ "Authorization?" "rbac" "abac" "none"
  fi
  ask_select PROJECT_COMPLIANCE "Compliance standard?" \
    "None" "SOC2" "HIPAA" "GDPR" "PCI-DSS" "Multiple"

  # ── Deployment ────────────────────────────────────────────────────────────
  echo ""
  info "Step 9: Deployment"
  ask_select PROJECT_CI "CI/CD?" "GitHub Actions" "GitLab CI" "Jenkins" "CircleCI" "None"
  ask_select PROJECT_HOST "Hosting?" \
    "Cloudflare" "Vercel" "AWS" "GCP" "Azure" "Self-hosted"

  # ── Observability ─────────────────────────────────────────────────────────
  echo ""
  info "Step 10: Observability"
  ask_select PROJECT_MONITORING "Monitoring?" "None" "Datadog" "Grafana" "Sentry" "Cloudflare"
  ask_select PROJECT_LOGGING "Logging?" "None" "Cloudflare" "Datadog" "ELK" "Loki"

  # ── Timeline ──────────────────────────────────────────────────────────────
  echo ""
  info "Step 11: Timeline"
  ask PROJECT_START_DATE "Start date?" "$(date +%Y-%m-%d)"
  ask PROJECT_MILESTONE1 "Major milestone #1?" "MVP launch"

  info "All questions answered. Generating project..."
  echo ""
fi

# ─── Create target directory ──────────────────────────────────────────────────

mkdir -p "$TARGET"
info "Target: $TARGET"

# ─── 1. Bootstrap context files (init-context) ────────────────────────────────
info "Step 1/3: Bootstrapping context files..."
bash "$ROOT/scripts/init-context.sh" "$TARGET" $([[ "$FORCE" == true ]] && echo "--force")

# ─── 2. Bootstrap project.yaml ────────────────────────────────────────────────
info "Step 2/3: Bootstrapping project.yaml..."
DEST="$TARGET/project.yaml"
if [[ -f "$DEST" && "$FORCE" != true ]]; then
  warn "skip (exists): $DEST   (use --force to overwrite)"
else
  cp "$TEMPLATES/project.yaml" "$DEST"
  info "wrote: $DEST"
fi

# ─── 3. Fill in gathered data ─────────────────────────────────────────────────
info "Step 3/3: Filling in project data..."

if [[ "$INTERACTIVE" == true ]]; then
  # Build comma-separated strings from multi-select arrays
  FRAMEWORKS_LIST="$PROJECT_FRAMEWORKS"
  DATABASES_LIST="$PROJECT_DATABASES"
  INFRA_LIST="$PROJECT_INFRA"

  # ── Fill project.yaml ────────────────────────────────────────────────────
  if command -v node &>/dev/null; then
    node -e "
    const fs = require('fs');
    const path = require('path');
    let yaml = fs.readFileSync('$DEST', 'utf8');
    const now = '$PROJECT_START_DATE';
    const slug = '$PROJECT_SLUG';
    const name = '$PROJECT_NAME';

    const subs = [
      ['<project-slug>', slug],
      ['<Human-Readable Project Name>', name],
      ['<name or team>', '$PROJECT_LEAD'],
      ['<category>', ''],
      ['<YYYY-MM-DD>', now],
      ['<git remote url>', 'https://github.com/username/' + slug],
      ['<http://localhost:PORT>', '$PROJECT_URL_DEV'],
      ['<https://staging.example.com>', '$PROJECT_URL_STAGING'],
      ['<https://example.com>', '$PROJECT_URL_PROD'],
      ['<provider>', '$PROJECT_HOST'],
      ['<tool>', '$PROJECT_MONITORING'],
    ];
    for (const [k, v] of subs) yaml = yaml.split(k).join(v);

    // Type
    yaml = yaml.replace(/^(\s*)type: web\s+# web/, '\$1type: $PROJECT_TYPE  # $PROJECT_TYPE');

    // Language
    yaml = yaml.replace(/^(\s*languages:\s*\n\s*)- <language>/, '\$1- ${process.argv[1].toLowerCase()}');
    // Runtime
    yaml = yaml.replace(/^(\s*)runtime: node/, '\$1runtime: ${process.argv[2].toLowerCase()}');
    // Package manager
    yaml = yaml.replace(/^(\s*)package_manager: pnpm/, '\$1package_manager: ${process.argv[3].toLowerCase()}');

    // Frameworks
    const frameworks = process.argv[4].split(', ').filter(Boolean);
    if (frameworks.length) {
      yaml = yaml.replace(/^(\s*)frameworks:\s*\n\s*- <framework>/, '\$1frameworks:\n' + frameworks.map(f => '\$1  - ' + f).join('\n'));
    }
    // Databases
    const databases = process.argv[5].split(', ').filter(Boolean);
    if (databases.length) {
      yaml = yaml.replace(/^(\s*)databases:\s*\n\s*- <database>/, '\$1databases:\n' + databases.map(d => '\$1  - ' + d).join('\n'));
    }
    // Infrastructure
    const infra = process.argv[6].split(', ').filter(Boolean);
    if (infra.length) {
      yaml = yaml.replace(/^(\s*)infrastructure:\s*\n\s*- <infra>/, '\$1infrastructure:\n' + infra.map(i => '\$1  - ' + i).join('\n'));
    }

    // Team
    const teamNames = '${PROJECT_TEAM}'.split(', ').filter(Boolean);
    if (teamNames.length) {
      yaml = yaml.replace(/^(\s*)members:\s*\n\s*- name: <name>\s*\n\s*role: <role>/, '\$1members:\n' + teamNames.map(t => '\$1  - name: ' + t + '\n\$1    role: developer').join('\n'));
    }

    // CI/CD
    yaml = yaml.replace(/ci_cd: github-actions/, 'ci_cd: ${process.argv[7].toLowerCase().replace(/ /g, '-')}');

    // Compliance
    const compliance = '${PROJECT_COMPLIANCE}';
    if (compliance !== 'None' && compliance !== '') {
      yaml = yaml.replace(/^(\s*)standards: \[\]/, '\$1standards:\n\$1  - ' + compliance.toLowerCase());
    }

    // Auth
    const auth = '${PROJECT_AUTH}';
    if (auth !== 'None (skip)' && auth !== '') {
      yaml = yaml.replace(/^(\s*)authentication: <provider>/, '\$1authentication: ' + auth);
    }

    fs.writeFileSync('$DEST', yaml);
    " "$PROJECT_LANG" "$PROJECT_RUNTIME" "$PROJECT_PKG" "$FRAMEWORKS_LIST" "$DATABASES_LIST" "$INFRA_LIST" "$PROJECT_CI" 2>/dev/null || true
  fi

  # ── Description from multi-line input ─────────────────────────────────────
  DESC_LINE="$PROJECT_DESC"
  if [[ -n "$PROJECT_PROBLEM" ]]; then
    DESC_LINE="$DESC_LINE It solves: $PROJECT_PROBLEM."
  fi
  if [[ -n "$PROJECT_AUDIENCE" ]]; then
    DESC_LINE="$DESC_LINE For: $PROJECT_AUDIENCE."
  fi

  # ── Fill project-overview.md ──────────────────────────────────────────────
  OVERVIEW="$TARGET/context/project-overview.md"
  if [[ -f "$OVERVIEW" ]]; then
    sed -i "s/\\[Project Name\\]/$PROJECT_NAME/g" "$OVERVIEW"
    sed -i "s/\\[One paragraph describing what this application does, who it's for, and what problem it solves.\\]/$DESC_LINE/g" "$OVERVIEW"

    # Goals
    GOALS=""
    if [[ -n "$PROJECT_GOAL1" ]]; then GOALS="$GOALS\n1. $PROJECT_GOAL1"; fi
    if [[ -n "$PROJECT_GOAL2" ]]; then GOALS="$GOALS\n1. $PROJECT_GOAL2"; else GOALS="$GOALS\n1. "; fi
    if [[ -n "$PROJECT_GOAL3" ]]; then GOALS="$GOALS\n1. $PROJECT_GOAL3"; else GOALS="$GOALS\n1. "; fi

    # Features
    if [[ -n "$PROJECT_FEATURES" ]]; then
      IFS=',' read -ra FEATS <<< "$PROJECT_FEATURES"
      FEAT_LIST=""
      for f in "${FEATS[@]}"; do
        f_trimmed="$(echo "$f" | xargs)"
        FEAT_LIST="$FEAT_LIST\n- $f_trimmed"
      done
    fi

    # Scope
    if [[ -n "$PROJECT_SCOPE_IN" ]]; then
      IFS=',' read -ra IN_SCOPE <<< "$PROJECT_SCOPE_IN"
      IN_LIST=""
      for s in "${IN_SCOPE[@]}"; do
        s_trimmed="$(echo "$s" | xargs)"
        IN_LIST="$IN_LIST\n- $s_trimmed"
      done
    fi
    if [[ -n "$PROJECT_SCOPE_OUT" ]]; then
      IFS=',' read -ra OUT_SCOPE <<< "$PROJECT_SCOPE_OUT"
      OUT_LIST=""
      for s in "${OUT_SCOPE[@]}"; do
        s_trimmed="$(echo "$s" | xargs)"
        OUT_LIST="$OUT_LIST\n- $s_trimmed"
      done
    fi
  fi

  # ── Fill architecture.md ──────────────────────────────────────────────────
  ARCH_FILE="$TARGET/context/architecture.md"
  if [[ -f "$ARCH_FILE" && -n "$PROJECT_LANG" ]]; then
    sed -i "s/\\[language\\]/$PROJECT_LANG/g" "$ARCH_FILE"
    sed -i "s/\\[framework\\]/$(echo $PROJECT_FRAMEWORKS | cut -d' ' -f1)/g" "$ARCH_FILE"
    sed -i "s/\\[database\\]/$(echo $PROJECT_DATABASES | cut -d' ' -f1)/g" "$ARCH_FILE"
  fi

  # ── Seed progress-tracker.md ──────────────────────────────────────────────
  TRACKER="$TARGET/context/progress-tracker.md"
  if [[ -f "$TRACKER" ]]; then
    cat > "$TRACKER" << TRACKEREOF
# Progress Tracker

## Current Phase

- Idea / initial setup

## Current Goal

- $PROJECT_GOAL1

## Completed

- Project scaffolded with P-Core Orchestra context
- Identity and lifecycle initialized via project.yaml

## Next Up

1. Fill in architecture details
2. Set up development environment
3. Start $PROJECT_GOAL1

## Open Questions

- (none yet)

## Architecture Decisions

- (none yet — record key decisions here as they're made)
TRACKEREOF
  fi

  # ── Seed AGENTS.md with project name ──────────────────────────────────────
  AGENTS_FILE="$TARGET/AGENTS.md"
  if [[ -f "$AGENTS_FILE" ]]; then
    echo "" >> "$AGENTS_FILE"
    echo "# $PROJECT_NAME" >> "$AGENTS_FILE"
    echo "" >> "$AGENTS_FILE"
    echo "Project initialized on $PROJECT_START_DATE." >> "$AGENTS_FILE"
    echo "Type: $PROJECT_TYPE | Stack: $PROJECT_LANG / $PROJECT_RUNTIME" >> "$AGENTS_FILE"
  fi

  # ── Scaffold architecture template ────────────────────────────────────────
  if [[ -n "$ARCH" && "$ARCH" != "None (skip)" ]]; then
    ARCH_SRC="$ARCH_DIR/$ARCH"
    if [[ -f "$ARCH_SRC" ]]; then
      mkdir -p "$TARGET/docs/architecture"
      cp "$ARCH_SRC" "$TARGET/docs/architecture/"
      info "wrote architecture: docs/architecture/$ARCH"
    fi
  fi

  # ── Create daily plan seed ────────────────────────────────────────────────
  mkdir -p "$TARGET/docs"
  cat > "$TARGET/docs/daily-plan.md" << DAILYEOF
# Daily Plan — $PROJECT_NAME

## $(date +%Y-%m-%d) — Kickoff

### Today's Goals
- [ ] Set up development environment
- [ ] Review project identity in project.yaml
- [ ] Begin $PROJECT_GOAL1

### Blockers
- (none)

### Notes
- Project scaffolded via P-Core Orchestra interactive init
DAILYEOF
  info "wrote: docs/daily-plan.md"

  echo ""
  info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  info "Project '$PROJECT_NAME' initialized at:"
  info "  $TARGET"
  echo ""
  info "Next steps:"
  echo "  1. Review and edit project.yaml"
  echo "  2. Review context/*.md files"
  echo "  3. cd $TARGET && git init && git add -A && git commit -m 'Initial scaffold'"
  echo "  4. Start building!"
  echo ""
  info "P-Core Orchestra will auto-detect project.yaml and context/ on your next session."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

else
  # ── Silent mode (existing behavior + enhancements) ────────────────────────

  # Apply --type / --name / --slug if provided
  if [[ -n "$PROJECT_TYPE" || -n "$PROJECT_NAME" || -n "$PROJECT_SLUG" ]]; then
    if command -v node &>/dev/null; then
      node -e "
      const fs = require('fs');
      let yaml = fs.readFileSync('$DEST', 'utf8');
      const now = (new Date()).toISOString().split('T')[0];
      const isoNow = (new Date()).toISOString();
      if ('$PROJECT_NAME') yaml = yaml.split('<Human-Readable Project Name>').join('$PROJECT_NAME');
      if ('$PROJECT_SLUG') yaml = yaml.split('<project-slug>').join('$PROJECT_SLUG');
      if ('$PROJECT_TYPE') yaml = yaml.replace(/^(\s*)type: web\s+# web/, '\$1type: $PROJECT_TYPE  # $PROJECT_TYPE');
      yaml = yaml.replace(/started: <YYYY-MM-DD>/, 'started: ' + now);
      yaml = yaml.replace(/updated: <YYYY-MM-DD>/, 'updated: ' + now);
      yaml = yaml.replace(/initialized: <YYYY-MM-DDTHH:MM:SSZ>/, 'initialized: ' + isoNow);
      fs.writeFileSync('$DEST', yaml);
      " 2>/dev/null || true
      info "applied --type/--name/--slug to project.yaml"
    fi
  fi

  # Scaffold architecture template(s) if --arch provided or inferrable from --type
  if [[ -n "$ARCH" || -n "$PROJECT_TYPE" ]]; then
    ARCH_TARGET="${ARCH:-}"
    if [[ -z "$ARCH_TARGET" ]]; then
      if command -v node &>/dev/null; then
        ARCH_TARGET="$(node -e "
          const { suggestArchitectureTemplate } = require('$ROOT/bundle/hooks/lib/project-identity.js');
          console.log(suggestArchitectureTemplate('$PROJECT_TYPE'));
        " 2>/dev/null)" || ARCH_TARGET=""
      fi
    fi
    if [[ -n "$ARCH_TARGET" && -f "$ARCH_DIR/$ARCH_TARGET" ]]; then
      mkdir -p "$TARGET/docs/architecture"
      cp "$ARCH_DIR/$ARCH_TARGET" "$TARGET/docs/architecture/"
      info "wrote architecture: docs/architecture/$ARCH_TARGET"
    fi
  fi

  echo ""
  echo "==> Done. Edit $DEST to fill in your project details."
  echo "    Template guide: $TEMPLATES/project.yaml"
  echo "    Init context:   bash $ROOT/scripts/init-context.sh $TARGET"
fi
