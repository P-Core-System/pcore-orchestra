#!/usr/bin/env bash
# Static parity test for install.ps1 (Windows installer).
#
# install.ps1 cannot execute on Linux/macOS CI (no pwsh), so this test asserts — by
# source inspection — that the two installer parity fixes stay in place, plus that
# install.sh keeps the matching behavior it is mirroring:
#
#   #17 — install.ps1 strips Qoder agents\references after copying the agent tree
#         (Qoder parses every *.md under agents/ as a config; the references doc has
#         no frontmatter and becomes a load error). install.sh does the same.
#   #22 — install.ps1 resolves the -Project bridge target from -ProjectDir/CWD and
#         REFUSES to write into the orchestra clone itself unless -ForceProject,
#         mirroring install.sh _project_target()/--force-project.
set -uo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
PASS=0; FAIL=0
ok()  { echo "${GREEN}PASS${NC}: $1"; PASS=$((PASS+1)); }
bad() { echo "${RED}FAIL${NC}: $1"; FAIL=$((FAIL+1)); }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PS1="$ROOT/install.ps1"
SH="$ROOT/install.sh"

[[ -f "$PS1" ]] || { echo "FAIL: install.ps1 not found at $PS1"; exit 1; }
[[ -f "$SH"  ]] || { echo "FAIL: install.sh not found at $SH"; exit 1; }

# has <file> <fixed-string> — literal substring present
has()  { grep -qF -- "$2" "$1"; }
# lacks <file> <fixed-string> — literal substring absent
lacks(){ ! grep -qF -- "$2" "$1"; }

echo "=== install.ps1 parity test (#17 Qoder references, #22 project target) ==="

# ---------------------------------------------------------------------------
# #17 — Qoder agents/references stripped after copy
# ---------------------------------------------------------------------------
has "$PS1" '$qoderRefsDest = Join-Path $agentsDest "references"' \
  && ok "#17 ps1: builds agents\\references path from the Qoder agents dest" \
  || bad "#17 ps1: missing agents\\references path construction"

has "$PS1" 'if (Test-Path $qoderRefsDest) { Remove-Item $qoderRefsDest -Recurse -Force }' \
  && ok "#17 ps1: removes agents\\references after the agent copy" \
  || bad "#17 ps1: missing Remove-Item of agents\\references"

# The removal must live inside the Qoder installer (after the robocopy that would
# bring references in) — prove ordering, not just coexistence.
qoder_fn="$(awk '/^function Install-Qoder/{f=1} f{print} f&&/^}/{exit}' "$PS1")"
printf '%s' "$qoder_fn" | grep -qF 'robocopy' \
  && printf '%s' "$qoder_fn" | grep -qF '$qoderRefsDest' \
  && ok "#17 ps1: references strip is scoped inside Install-Qoder (after robocopy)" \
  || bad "#17 ps1: references strip is NOT inside Install-Qoder"

# install.sh keeps the mirrored behavior
has "$SH" 'rm -rf "$QODER/agents/references"' \
  && ok "#17 sh: install.sh strips \$QODER/agents/references (parity anchor)" \
  || bad "#17 sh: install.sh lost its references strip"

# ---------------------------------------------------------------------------
# #22 — project target resolution + clone refusal
# ---------------------------------------------------------------------------
has "$PS1" '[string]$ProjectDir,' \
  && ok "#22 ps1: -ProjectDir parameter declared" \
  || bad "#22 ps1: -ProjectDir parameter missing"

has "$PS1" '[switch]$ForceProject,' \
  && ok "#22 ps1: -ForceProject parameter declared" \
  || bad "#22 ps1: -ForceProject parameter missing"

has "$PS1" 'if ($ProjectDir -or $ForceProject) { $Project = $true }' \
  && ok "#22 ps1: -ProjectDir/-ForceProject imply -Project" \
  || bad "#22 ps1: -ProjectDir/-ForceProject do not imply -Project"

has "$PS1" 'function Resolve-ProjectTarget' \
  && ok "#22 ps1: Resolve-ProjectTarget helper defined" \
  || bad "#22 ps1: Resolve-ProjectTarget helper missing"

has "$PS1" '$t = if ($ProjectDir) { $ProjectDir } else { (Get-Location).Path }' \
  && ok "#22 ps1: target resolves from -ProjectDir, else CWD" \
  || bad "#22 ps1: target does not prefer -ProjectDir over CWD"

# The refusal branch: target == clone root, unless forced
has "$PS1" '$rootCanonical = $Root.TrimEnd(' \
  && ok "#22 ps1: canonicalizes the clone root for comparison" \
  || bad "#22 ps1: clone root not canonicalized"

has "$PS1" 'if ($target -ieq $rootCanonical -and -not $ForceProject) {' \
  && ok "#22 ps1: refuses when target == clone root and not forced" \
  || bad "#22 ps1: clone-root refusal guard missing"

has "$PS1" 'REFUSING: -Project target is the orchestra clone itself' \
  && ok "#22 ps1: prints a REFUSING message on the clone-root case" \
  || bad "#22 ps1: no REFUSING message"

has "$PS1" '-ForceProject to override' \
  && ok "#22 ps1: refusal message points at -ForceProject" \
  || bad "#22 ps1: refusal message does not mention -ForceProject"

# Bridge copies must land in $target (the resolved dir), not a hardcoded location,
# and the old bug — writing into the clone's own dir via Get-Location only — is gone.
proj_block="$(awk '/^if \(\$Project\) \{/{f=1} f{print} f&&/^\}/{exit}' "$PS1")"
printf '%s' "$proj_block" | grep -qF 'Copy-Item (Join-Path $Root "project-bridge\hooks.json") (Join-Path $target' \
  && ok "#22 ps1: bridge copies hooks.json into \$target" \
  || bad "#22 ps1: bridge does not copy into \$target"

printf '%s' "$proj_block" | grep -qE '\$RepoRoot' \
  && bad "#22 ps1: -Project block still uses the old \$RepoRoot (clone-parent) target" \
  || ok "#22 ps1: old \$RepoRoot clone-parent target is gone"

# install.sh keeps the mirrored behavior
for tok in '_project_target()' '--project-dir' '--force-project' 'REFUSING: --project target is the orchestra clone itself'; do
  has "$SH" "$tok" \
    && ok "#22 sh: install.sh contains '$tok' (parity anchor)" \
    || bad "#22 sh: install.sh missing '$tok'"
done

echo ""
echo "install.ps1 parity test: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}"
[[ "$FAIL" -eq 0 ]] || exit 1
