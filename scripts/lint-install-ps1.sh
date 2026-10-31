#!/usr/bin/env bash
# Syntax + lint gate for the PowerShell installers (#28).
#
# install.ps1 (and scripts/*.ps1) can't be *executed* meaningfully in CI, but their
# structure and quality CAN be checked on any runner that has PowerShell Core (`pwsh`,
# pre-installed on GitHub-hosted ubuntu images). Two gates:
#
#   1. SYNTAX — the PowerShell AST parser (Parser::ParseFile) reports parse errors
#      WITHOUT running the script. Any parse error fails CI. This is the real
#      regression guard: it catches exactly the class of defect a hand edit introduces.
#   2. LINT   — PSScriptAnalyzer, best-effort-installed, run over the same files.
#      ERROR-severity findings fail CI; WARNINGs are reported but non-blocking
#      (stylistic backlog). If the analyzer can't be obtained (offline runner) the
#      syntax gate still ran, so we degrade to a loud skip rather than a false red.
#
# No `pwsh` on the host -> SKIP (exit 0), matching how the MCP launcher test skips
# when the SDK is absent.
set -uo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; NC='\033[0m'
PASS=0; FAIL=0
ok()   { echo "${GREEN}PASS${NC}: $1"; PASS=$((PASS+1)); }
bad()  { echo "${RED}FAIL${NC}: $1"; FAIL=$((FAIL+1)); }
warn() { echo "${YELLOW}WARN${NC}: $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if ! command -v pwsh >/dev/null 2>&1; then
  echo "SKIP: pwsh (PowerShell Core) not on PATH — nothing to lint"
  exit 0
fi

# Bound pwsh calls with coreutils `timeout` when it exists; run bare otherwise
# (macOS ships no `timeout`, and a hung PSGallery install must not stall CI).
HAVE_TIMEOUT=0
command -v timeout >/dev/null 2>&1 && HAVE_TIMEOUT=1
run_pwsh() {
  if [[ "$HAVE_TIMEOUT" -eq 1 ]]; then timeout 240 pwsh "$@"; else pwsh "$@"; fi
}

# Files to check: install.ps1 (required) plus every scripts/*.ps1 that exists.
FILES=("$ROOT/install.ps1")
for f in "$SCRIPT_DIR"/*.ps1; do
  [[ -f "$f" ]] && FILES+=("$f")
done

SETTINGS="$SCRIPT_DIR/psscriptanalyzer-settings.psd1"

echo "=== install.ps1 syntax + lint gate (#28) — pwsh: $(run_pwsh --version 2>/dev/null || echo '?') ==="

# ---------------------------------------------------------------------------
# 1. SYNTAX — AST parse, no execution
# ---------------------------------------------------------------------------
for f in "${FILES[@]}"; do
  export PS_PARSE_TARGET="$f"
  if parse_out="$(run_pwsh -NoProfile -Command '
    $ErrorActionPreference = "Stop"
    $path = $env:PS_PARSE_TARGET
    $tokens = $null; $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
    if ($errors -and $errors.Count -gt 0) {
      foreach ($e in $errors) {
        Write-Output ("  {0}:{1}  {2}" -f $e.Extent.StartLineNumber, $e.Extent.StartColumnNumber, $e.Message)
      }
      exit 1
    }
    exit 0
  ' 2>&1)"; then
    ok "syntax: $(basename "$f") parses clean"
  else
    bad "syntax: $(basename "$f") has parse errors:"
    echo "$parse_out"
  fi
done

# ---------------------------------------------------------------------------
# 2. LINT — PSScriptAnalyzer (best-effort), ERROR-severity is blocking
# ---------------------------------------------------------------------------
has_analyzer() {
  run_pwsh -NoProfile -Command 'if (Get-Module -ListAvailable -Name PSScriptAnalyzer) { "yes" } else { "no" }' 2>/dev/null
}

if [[ "$(has_analyzer)" != "yes" ]]; then
  echo "  (PSScriptAnalyzer not present — attempting a best-effort install from PSGallery)"
  run_pwsh -NoProfile -Command '
    try {
      Install-Module -Name PSScriptAnalyzer -Scope CurrentUser -Force -AllowClobber -SkipPublisherCheck -ErrorAction Stop
    } catch {
      Write-Output ("install failed: " + $_.Exception.Message)
    }
  ' >/dev/null 2>&1 || true
fi

if [[ "$(has_analyzer)" == "yes" ]]; then
  export PSSA_SETTINGS="$SETTINGS"
  export PS_TARGETS="$(printf '%s;' "${FILES[@]}")"
  analyzer_out="$(run_pwsh -NoProfile -Command '
    $ErrorActionPreference = "Stop"
    Import-Module PSScriptAnalyzer
    $settings = $env:PSSA_SETTINGS
    $paths = @($env:PS_TARGETS -split ";" | Where-Object { $_ })
    $raw = foreach ($p in $paths) {
      Invoke-ScriptAnalyzer -Path $p -Settings $settings
    }
    $findings = @($raw | Where-Object { $_ })
    $errors = @($findings | Where-Object { $_.Severity -eq "Error" })
    $warns  = @($findings | Where-Object { $_.Severity -eq "Warning" })
    foreach ($f in $findings) {
      Write-Output ("  [{0}] {1} {2}:{3} — {4}" -f $f.Severity, $f.RuleName, (Split-Path -Leaf $f.ScriptPath), $f.Line, ($f.Message -replace "`r?`n", " "))
    }
    Write-Output ("PSSA_SUMMARY errors={0} warnings={1}" -f $errors.Count, $warns.Count)
    if ($errors.Count -gt 0) { exit 1 } else { exit 0 }
  ' 2>&1)"
  analyzer_rc=$?

  summary="$(printf '%s\n' "$analyzer_out" | grep 'PSSA_SUMMARY' | tail -1)"
  ecount="$(printf '%s' "$summary" | sed -n 's/.*errors=\([0-9]*\).*/\1/p')"
  wcount="$(printf '%s' "$summary" | sed -n 's/.*warnings=\([0-9]*\).*/\1/p')"
  ecount="${ecount:-0}"; wcount="${wcount:-0}"

  if [[ "$analyzer_rc" -eq 0 ]]; then
    ok "lint: PSScriptAnalyzer clean (0 ERROR findings; ${wcount} warning(s))"
  else
    bad "lint: PSScriptAnalyzer reported ${ecount} ERROR finding(s)"
  fi
  # Show the findings (warnings included) so the backlog is visible without blocking.
  if [[ "${wcount}" -gt 0 || "${ecount}" -gt 0 ]]; then
    printf '%s\n' "$analyzer_out" | grep -v 'PSSA_SUMMARY' | sed '/^[[:space:]]*$/d'
  fi
else
  warn "lint: PSScriptAnalyzer unavailable (offline runner?) — only the syntax gate ran this run"
fi

echo ""
echo "install.ps1 syntax+lint gate: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}"
[[ "$FAIL" -eq 0 ]] || exit 1
