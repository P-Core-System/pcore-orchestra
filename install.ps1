# Install Orchestra bundle to ~/.cursor AND ~/.config/opencode (global)
# Usage:
#   powershell -ExecutionPolicy Bypass -File install.ps1              # both
#   powershell -ExecutionPolicy Bypass -File install.ps1 -All         # same
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Cursor      # Cursor only
#   powershell -ExecutionPolicy Bypass -File install.ps1 -OpenCode    # OpenCode only
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Project     # + project bridge
param(
  [switch]$All,
  [switch]$Cursor,
  [switch]$OpenCode,
  [switch]$Project,
  [switch]$SkipOpenCodeUpgrade
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Bundle = Join-Path $Root "bundle"
$CursorDir = if ($env:CURSOR_HOME) { $env:CURSOR_HOME } else { Join-Path $env:USERPROFILE ".cursor" }
$OpenCodeDir = if ($env:OPENCODE_CONFIG_DIR) { $env:OPENCODE_CONFIG_DIR } else { Join-Path $env:USERPROFILE ".config\opencode" }
$AgentsSkills = if ($env:AGENTS_SKILLS) { $env:AGENTS_SKILLS } else { Join-Path $env:USERPROFILE ".agents\skills" }

# Default: both if no flag
if (-not $Cursor -and -not $OpenCode) {
  $All = $true
}
if ($All) {
  $Cursor = $true
  $OpenCode = $true
}

Write-Host "============================================"
Write-Host " Orchestra Installer (Cursor + OpenCode)"
Write-Host "============================================"
Write-Host ""

###############################################################################
# Cursor installation
###############################################################################
function Install-Cursor {
  Write-Host "==> Installing Cursor Orchestra to $CursorDir"

  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js 18+ required. Install from https://nodejs.org"
  }

  @(
    (Join-Path $CursorDir "hooks\state"),
    (Join-Path $CursorDir "agents"),
    (Join-Path $CursorDir "skills"),
    (Join-Path $CursorDir "skills-cursor"),
    (Join-Path $CursorDir "rules")
  ) | ForEach-Object { New-Item -ItemType Directory -Force -Path $_ | Out-Null }

  Copy-Item (Join-Path $Bundle "hooks\orchestra-*.js") (Join-Path $CursorDir "hooks\") -Force
  $libDest = Join-Path $CursorDir "hooks\lib"
  if (Test-Path $libDest) { Remove-Item $libDest -Recurse -Force }
  Copy-Item (Join-Path $Bundle "hooks\lib") $libDest -Recurse -Force
  $stateDest = Join-Path $CursorDir "hooks\state\orchestra.json"
  if (-not (Test-Path $stateDest)) {
    Copy-Item (Join-Path $Bundle "hooks\state\orchestra.json") $stateDest -Force
  }
  Copy-Item (Join-Path $Bundle "agents\orchestra.md") (Join-Path $CursorDir "agents\") -Force -ErrorAction SilentlyContinue
  Copy-Item (Join-Path $Bundle "agents\orchestra-*.md") (Join-Path $CursorDir "agents\") -Force
  $refSrc = Join-Path $Bundle "agents\references"
  if (Test-Path $refSrc) {
    $refDest = Join-Path (Join-Path $CursorDir "agents") "references"
    New-Item -ItemType Directory -Force -Path $refDest | Out-Null
    Copy-Item (Join-Path $refSrc "*.md") $refDest -Force -ErrorAction SilentlyContinue
  }
  # Copy all enterprise agent directories (01-idea through 10-review)
  $agentDirs = Get-ChildItem -Path (Join-Path $Bundle "agents") -Directory
  foreach ($agentDir in $agentDirs) {
    $destDir = Join-Path (Join-Path $CursorDir "agents") $agentDir.Name
    $null = robocopy $agentDir.FullName $destDir /E /NDL /NJH /NJS /NP
  }
  Copy-Item (Join-Path $Bundle "rules\orchestra-loop.mdc") (Join-Path $CursorDir "rules\") -Force
  Copy-Item (Join-Path $Bundle "ORCHESTRA.md") (Join-Path $CursorDir "ORCHESTRA.md") -Force

  # Copy all Cloudflare skills (orchestra-loop + cloudflare, agents-sdk, etc.)
  $skillDirs = Get-ChildItem -Path (Join-Path $Bundle "skills") -Directory
  foreach ($skillDir in $skillDirs) {
    $destDir = Join-Path (Join-Path $CursorDir "skills") $skillDir.Name
    if (Test-Path $destDir) { Remove-Item $destDir -Recurse -Force }
    $null = robocopy $skillDir.FullName $destDir /E /NDL /NJH /NJS /NP
  }

  # Copy all Cursor built-in skills
  $scBundle = Join-Path $Bundle "skills-cursor"
  if (Test-Path $scBundle) {
    $scDirs = Get-ChildItem -Path $scBundle -Directory
    foreach ($scDir in $scDirs) {
      $destDir = Join-Path (Join-Path $CursorDir "skills-cursor") $scDir.Name
      if (Test-Path $destDir) { Remove-Item $destDir -Recurse -Force }
      $null = robocopy $scDir.FullName $destDir /E /NDL /NJH /NJS /NP
    }
  }

  New-Item -ItemType Directory -Force -Path $AgentsSkills | Out-Null
  foreach ($linkSkill in @(
    "orchestra-loop", "prompt-intake", "verification-before-completion",
    "ui-ux-pro-max", "brand", "design-system", "ui-styling"
  )) {
    $srcSkill = Join-Path (Join-Path $CursorDir "skills") $linkSkill
    $skillLink = Join-Path $AgentsSkills $linkSkill
    if (Test-Path $srcSkill) {
      if (Test-Path $skillLink) { Remove-Item $skillLink -Force -Recurse -ErrorAction SilentlyContinue }
      New-Item -ItemType SymbolicLink -Path $skillLink -Target $srcSkill -Force -ErrorAction SilentlyContinue | Out-Null
      if (-not (Test-Path $skillLink)) {
        Copy-Item $srcSkill $skillLink -Recurse -Force
      }
    }
  }

  # Merge hooks.json
  $mergeJs = @'
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
'@
  $mergeFile = Join-Path $env:TEMP "orchestra-merge-hooks.js"
  Set-Content -Path $mergeFile -Value $mergeJs -Encoding UTF8
  node $mergeFile $CursorDir (Join-Path $Bundle "hooks.json")

  # Autonomy: CLI + permissions.json + sandbox.json (preserves auth/model)
  node (Join-Path $Root "scripts\merge-autonomy-config.js") --cursor --cursor-home $CursorDir

  Write-Host "  Cursor agents:   $CursorDir\agents\orchestra-*.md"
  Write-Host "  Cursor hooks:    $CursorDir\hooks\"
  Write-Host "  Cursor skills:   $CursorDir\skills\ (orchestra-loop + UI + Cloudflare)"
  Write-Host "  Cursor built-in: $CursorDir\skills-cursor\ (17 skills)"
  Write-Host "  Cursor autonomy: $CursorDir\cli-config.json + permissions.json + sandbox.json"
  Write-Host "  Agents skills:   $AgentsSkills\{orchestra-loop,prompt-intake,verification-before-completion,ui-ux-pro-max,brand,design-system,ui-styling}"
}

###############################################################################
# OpenCode installation
###############################################################################
function Install-OpenCode {
  Write-Host "==> Installing OpenCode Orchestra to $OpenCodeDir"

  if (-not $SkipOpenCodeUpgrade) {
    & (Join-Path $Root "scripts\ensure-opencode-latest.ps1")
  }

  @(
    (Join-Path $OpenCodeDir "hooks\state"),
    (Join-Path $OpenCodeDir "hooks\lib"),
    (Join-Path $OpenCodeDir "agents"),
    (Join-Path $OpenCodeDir "skills"),
    (Join-Path $OpenCodeDir "state")
  ) | ForEach-Object { New-Item -ItemType Directory -Force -Path $_ | Out-Null }

  # Agents (orchestra core + enterprise)
  Copy-Item (Join-Path $Bundle "opencode\agents\orchestra.md") (Join-Path $OpenCodeDir "agents\") -Force
  Copy-Item (Join-Path $Bundle "opencode\agents\orchestra-*.md") (Join-Path $OpenCodeDir "agents\") -Force
  $refSrc = Join-Path $Bundle "agents\references\orchestra-spawn-matrix.md"
  if (Test-Path $refSrc) {
    $refDest = Join-Path (Join-Path $OpenCodeDir "agents") "references"
    New-Item -ItemType Directory -Force -Path $refDest | Out-Null
    Copy-Item $refSrc (Join-Path $refDest "orchestra-spawn-matrix.md") -Force
  }
  $ocAgentDirs = Get-ChildItem -Path (Join-Path $Bundle "opencode\agents") -Directory -ErrorAction SilentlyContinue
  foreach ($agentDir in $ocAgentDirs) {
    $destDir = Join-Path (Join-Path $OpenCodeDir "agents") $agentDir.Name
    $null = robocopy $agentDir.FullName $destDir /E /NDL /NJH /NJS /NP
  }

  # Skills (orchestra-loop + Cloudflare)
  $ocSkillDirs = Get-ChildItem -Path (Join-Path $Bundle "opencode\skills") -Directory
  foreach ($ocSkillDir in $ocSkillDirs) {
    $destDir = Join-Path (Join-Path $OpenCodeDir "skills") $ocSkillDir.Name
    $null = robocopy $ocSkillDir.FullName $destDir /E /NDL /NJH /NJS /NP
  }

  # Hooks (all orchestra-*.js)
  Copy-Item (Join-Path $Bundle "opencode\hooks\orchestra-*.js") (Join-Path $OpenCodeDir "hooks\") -Force

  # Lib modules (shared with Cursor)
  $libDest = Join-Path $OpenCodeDir "hooks\lib"
  if (Test-Path $libDest) { Remove-Item $libDest -Recurse -Force }
  Copy-Item (Join-Path $Bundle "opencode\hooks\lib") $libDest -Recurse -Force
  foreach ($libFile in @("opencode-config-sanitize.js", "opencode-version.js")) {
    $src = Join-Path (Join-Path $Root "scripts\lib") $libFile
    if (Test-Path $src) {
      Copy-Item $src (Join-Path $libDest $libFile) -Force
    }
  }

  # State files
  Copy-Item (Join-Path $Bundle "opencode\hooks\state\orchestra-memory.json") (Join-Path $OpenCodeDir "hooks\state\") -Force
  $stateDest = Join-Path $OpenCodeDir "state\orchestra.json"
  if (-not (Test-Path $stateDest)) {
    Copy-Item (Join-Path $Bundle "opencode\state\orchestra.json") $stateDest -Force
  }

  # External skill symlinks (Agent Skills compat path)
  New-Item -ItemType Directory -Force -Path $AgentsSkills | Out-Null
  foreach ($linkSkill in @(
    "orchestra-loop", "prompt-intake", "verification-before-completion",
    "ui-ux-pro-max", "brand", "design-system", "ui-styling"
  )) {
    $srcSkill = Join-Path (Join-Path $OpenCodeDir "skills") $linkSkill
    $skillLink = Join-Path $AgentsSkills $linkSkill
    if (Test-Path $srcSkill) {
      if (Test-Path $skillLink) { Remove-Item $skillLink -Force -Recurse -ErrorAction SilentlyContinue }
      New-Item -ItemType SymbolicLink -Path $skillLink -Target $srcSkill -Force -ErrorAction SilentlyContinue | Out-Null
      if (-not (Test-Path $skillLink)) {
        Copy-Item $srcSkill $skillLink -Recurse -Force
      }
    }
  }

  # Autonomy: merge permission/agent into opencode.json (preserves mcp secrets)
  node (Join-Path $Root "scripts\merge-autonomy-config.js") --opencode --opencode-home $OpenCodeDir

  Write-Host "  OpenCode agents:  $OpenCodeDir\agents\orchestra-*.md"
  Write-Host "  OpenCode hooks:   $OpenCodeDir\hooks\"
  Write-Host "  OpenCode lib:     $OpenCodeDir\hooks\lib\ (21 modules)"
  Write-Host "  OpenCode skills:  $OpenCodeDir\skills\ (orchestra-loop + UI + Cloudflare)"
  Write-Host "  OpenCode state:   $OpenCodeDir\state\orchestra.json"
  Write-Host "  OpenCode autonomy:$OpenCodeDir\opencode.json (permission + agents; mcp preserved)"
  Write-Host "  OpenCode CLI:     opencode --version — restart desktop app after upgrade"
}

###############################################################################
# Main
###############################################################################
if ($Cursor) { Install-Cursor }
if ($OpenCode) { Install-OpenCode }

if ($Project) {
  $RepoRoot = (Get-Location).Path
  Write-Host "==> Installing project bridge to $RepoRoot\.cursor"
  New-Item -ItemType Directory -Force -Path (Join-Path $RepoRoot ".cursor\hooks") | Out-Null
  Copy-Item (Join-Path $Root "project-bridge\hooks.json") (Join-Path $RepoRoot ".cursor\hooks.json") -Force
  Copy-Item (Join-Path $Root "project-bridge\hooks\bridge.js") (Join-Path $RepoRoot ".cursor\hooks\bridge.js") -Force
}

# Health checks
Write-Host ""
if ($Cursor -and (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "==> Cursor health check"
  node (Join-Path $CursorDir "hooks\orchestra-health.js")
}
if ($OpenCode -and (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "==> OpenCode health check"
  node (Join-Path $OpenCodeDir "hooks\orchestra-health-opencode.js")
}

Write-Host ""
Write-Host "============================================"
Write-Host " Orchestra installed!"
if ($Cursor) {
  Write-Host "  Cursor:   $CursorDir"
  Write-Host "            Restart Cursor IDE → Settings → Hooks"
}
if ($OpenCode) {
  Write-Host "  OpenCode: $OpenCodeDir"
  Write-Host "            Restart OpenCode; prefer: opencode --auto"
}
if ($Cursor) {
  Write-Host "  Autonomy: Settings → Agents → Approvals → Auto-review"
  Write-Host "            Docs: docs/autonomous-workflow.md"
}

# Repo scoping (cross-tool ignore files)
Write-Host "==> Installing repo scoping (cross-tool ignore files)"
$LocalBin = Join-Path $env:USERPROFILE ".local\bin"
if (-not (Test-Path $LocalBin)) { New-Item -ItemType Directory -Force -Path $LocalBin | Out-Null }
if (Test-Path (Join-Path $Root "scripts\setup-repo-scoping.sh")) {
  Copy-Item (Join-Path $Root "scripts\setup-repo-scoping.sh") (Join-Path $LocalBin "setup-repo-scoping.sh") -Force
  Write-Host "  Script:  $LocalBin\setup-repo-scoping.sh"
}
if (Test-Path (Join-Path $Root "scripts\opencode-maintenance.sh")) {
  Copy-Item (Join-Path $Root "scripts\opencode-maintenance.sh") (Join-Path $LocalBin "opencode-maintenance.sh") -Force
  Write-Host "  Maint:   $LocalBin\opencode-maintenance.sh"
}
Write-Host "  Usage:   bash setup-repo-scoping.sh /path/to/any/repo"
Write-Host "============================================"
