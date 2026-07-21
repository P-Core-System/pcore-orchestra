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
  [switch]$Project
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
  Copy-Item (Join-Path $Bundle "agents\orchestra-*.md") (Join-Path $CursorDir "agents\") -Force
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
  foreach ($linkSkill in @("orchestra-loop", "prompt-intake", "verification-before-completion")) {
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

  Write-Host "  Cursor agents:   $CursorDir\agents\orchestra-*.md"
  Write-Host "  Cursor hooks:    $CursorDir\hooks\"
  Write-Host "  Cursor skills:   $CursorDir\skills\ (orchestra-loop + Cloudflare)"
  Write-Host "  Cursor built-in: $CursorDir\skills-cursor\ (17 skills)"
}

###############################################################################
# OpenCode installation
###############################################################################
function Install-OpenCode {
  Write-Host "==> Installing OpenCode Orchestra to $OpenCodeDir"

  New-Item -ItemType Directory -Force -Path (Join-Path $OpenCodeDir "skills") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $OpenCodeDir "state") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $OpenCodeDir "hooks") | Out-Null

  New-Item -ItemType Directory -Force -Path (Join-Path $OpenCodeDir "agents") | Out-Null
  Copy-Item (Join-Path $Bundle "opencode\agents\orchestra-*.md") (Join-Path $OpenCodeDir "agents\") -Force
  $ocAgentDirs = Get-ChildItem -Path (Join-Path $Bundle "opencode\agents") -Directory -ErrorAction SilentlyContinue
  foreach ($agentDir in $ocAgentDirs) {
    $destDir = Join-Path (Join-Path $OpenCodeDir "agents") $agentDir.Name
    $null = robocopy $agentDir.FullName $destDir /E /NDL /NJH /NJS /NP
  }

  # Copy all OpenCode skills (orchestra-loop + Cloudflare)
  $ocSkillDirs = Get-ChildItem -Path (Join-Path $Bundle "opencode\skills") -Directory
  foreach ($ocSkillDir in $ocSkillDirs) {
    $destDir = Join-Path (Join-Path $OpenCodeDir "skills") $ocSkillDir.Name
    $null = robocopy $ocSkillDir.FullName $destDir /E /NDL /NJH /NJS /NP
  }

  Copy-Item (Join-Path $Bundle "opencode\hooks\orchestra-health-opencode.js") (Join-Path $OpenCodeDir "hooks\") -Force

  $stateDest = Join-Path $OpenCodeDir "state\orchestra.json"
  if (-not (Test-Path $stateDest)) {
    Copy-Item (Join-Path $Bundle "opencode\state\orchestra.json") $stateDest -Force
  }

  New-Item -ItemType Directory -Force -Path $AgentsSkills | Out-Null
  $skillLink = Join-Path $AgentsSkills "orchestra-loop"
  if (Test-Path $skillLink) { Remove-Item $skillLink -Force -Recurse -ErrorAction SilentlyContinue }
  New-Item -ItemType SymbolicLink -Path $skillLink -Target (Join-Path $OpenCodeDir "skills\orchestra-loop") -Force -ErrorAction SilentlyContinue
  if (-not (Test-Path $skillLink)) {
    Copy-Item (Join-Path $OpenCodeDir "skills\orchestra-loop") $skillLink -Recurse -Force
  }

  Write-Host "  OpenCode agents:  $OpenCodeDir\agents\orchestra-*.md"
  Write-Host "  OpenCode skills:  $OpenCodeDir\skills\ (orchestra-loop + Cloudflare)"
  Write-Host "  OpenCode state:   $OpenCodeDir\state\orchestra.json"
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
  Write-Host "            Restart OpenCode for agents/skill to load"
}
Write-Host "============================================"
