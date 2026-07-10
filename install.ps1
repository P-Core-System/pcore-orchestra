# Install Cursor Orchestra bundle to %USERPROFILE%\.cursor (global)
# Usage:
#   powershell -ExecutionPolicy Bypass -File cursor-orchestra/install.ps1
#   powershell -ExecutionPolicy Bypass -File cursor-orchestra/install.ps1 -Project
param(
  [switch]$Project
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Bundle = Join-Path $Root "bundle"
$Cursor = if ($env:CURSOR_HOME) { $env:CURSOR_HOME } else { Join-Path $env:USERPROFILE ".cursor" }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js 18+ required. Install from https://nodejs.org"
}

Write-Host "==> Installing Cursor Orchestra to $Cursor"

@(
  (Join-Path $Cursor "hooks\state"),
  (Join-Path $Cursor "agents"),
  (Join-Path $Cursor "skills\orchestra-loop"),
  (Join-Path $Cursor "rules")
) | ForEach-Object { New-Item -ItemType Directory -Force -Path $_ | Out-Null }

Copy-Item (Join-Path $Bundle "hooks\orchestra-*.js") (Join-Path $Cursor "hooks\") -Force
$stateDest = Join-Path $Cursor "hooks\state\orchestra.json"
if (-not (Test-Path $stateDest)) {
  Copy-Item (Join-Path $Bundle "hooks\state\orchestra.json") $stateDest -Force
}
Copy-Item (Join-Path $Bundle "agents\orchestra-*.md") (Join-Path $Cursor "agents\") -Force
Copy-Item (Join-Path $Bundle "skills\orchestra-loop\SKILL.md") (Join-Path $Cursor "skills\orchestra-loop\") -Force
Copy-Item (Join-Path $Bundle "rules\orchestra-loop.mdc") (Join-Path $Cursor "rules\") -Force
Copy-Item (Join-Path $Bundle "ORCHESTRA.md") (Join-Path $Cursor "ORCHESTRA.md") -Force

$agentsSkills = if ($env:AGENTS_SKILLS) { $env:AGENTS_SKILLS } else { Join-Path $env:USERPROFILE ".agents\skills" }
New-Item -ItemType Directory -Force -Path $agentsSkills | Out-Null
$skillLink = Join-Path $agentsSkills "orchestra-loop"
if (-not (Test-Path $skillLink)) {
  Copy-Item (Join-Path $Cursor "skills\orchestra-loop") $skillLink -Recurse -Force
}

# Merge hooks.json via node
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
console.log("Merged hooks.json ->", destPath);
'@
$mergeFile = Join-Path $env:TEMP "orchestra-merge-hooks.js"
Set-Content -Path $mergeFile -Value $mergeJs -Encoding UTF8
node $mergeFile $Cursor (Join-Path $Bundle "hooks.json")

if ($Project) {
  $RepoRoot = (Get-Location).Path
  Write-Host "==> Installing project bridge to $RepoRoot\.cursor"
  New-Item -ItemType Directory -Force -Path (Join-Path $RepoRoot ".cursor\hooks") | Out-Null
  Copy-Item (Join-Path $Root "project-bridge\hooks.json") (Join-Path $RepoRoot ".cursor\hooks.json") -Force
  Copy-Item (Join-Path $Root "project-bridge\hooks\bridge.js") (Join-Path $RepoRoot ".cursor\hooks\bridge.js") -Force
}

Write-Host ""
Write-Host "==> Health check"
node (Join-Path $Cursor "hooks\orchestra-health.js")

Write-Host ""
Write-Host "============================================"
Write-Host " Cursor Orchestra installed!"
Write-Host "  Global:  $Cursor"
Write-Host "  Restart Cursor IDE → Settings → Hooks"
Write-Host "  Test:    node $Cursor\hooks\orchestra-health.js"
Write-Host "  Bootstrap context: powershell -File $Root\scripts\init-context.ps1 -Target C:\path\to\project"
Write-Host "============================================"
