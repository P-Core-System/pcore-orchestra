# Bootstrap Six-File Context in a target project (JavaScript Mastery methodology).
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/init-context.ps1 -Target C:\path\to\project
#   powershell -ExecutionPolicy Bypass -File scripts/init-context.ps1 -Target . -Bridge
param(
  [string]$Target = ".",
  [switch]$Bridge,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Templates = Join-Path $Root "templates"
$Target = (Resolve-Path $Target).Path
$Ctx = Join-Path $Target "context"

Write-Host "==> Six-File Context bootstrap"
Write-Host "    Target: $Target"
New-Item -ItemType Directory -Force -Path $Ctx | Out-Null

function Copy-IfMissing($Src, $Dest) {
  if ((Test-Path $Dest) -and -not $Force) {
    Write-Host "    skip (exists): $Dest"
    return
  }
  Copy-Item $Src $Dest -Force
  Write-Host "    wrote: $Dest"
}

@(
  "project-overview.md", "architecture.md", "code-standards.md",
  "ai-workflow-rules.md", "ui-context.md", "progress-tracker.md"
) | ForEach-Object {
  Copy-IfMissing (Join-Path $Templates "context\$_") (Join-Path $Ctx $_)
}

Copy-IfMissing (Join-Path $Templates "AGENTS.md") (Join-Path $Target "AGENTS.md")

if ($Bridge) {
  Write-Host "==> Installing project bridge"
  New-Item -ItemType Directory -Force -Path (Join-Path $Target ".cursor\hooks") | Out-Null
  Copy-Item (Join-Path $Root "project-bridge\hooks.json") (Join-Path $Target ".cursor\hooks.json") -Force
  Copy-Item (Join-Path $Root "project-bridge\hooks\bridge.js") (Join-Path $Target ".cursor\hooks\bridge.js") -Force
  Write-Host "    wrote: $Target\.cursor\hooks.json"
}

Write-Host ""
Write-Host "==> Done. Fill in context/*.md using your planning conversation."
Write-Host "    Entry point: $Target\AGENTS.md"
Write-Host "    Install global orchestra: powershell -File $Root\install.ps1"
