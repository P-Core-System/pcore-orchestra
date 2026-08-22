# ensure-opencode-latest.ps1 — install or upgrade OpenCode CLI
param(
  [switch]$Check,
  [ValidateSet("stable", "beta", "dev")]
  [string]$Channel = $(if ($env:OPENCODE_CHANNEL) { $env:OPENCODE_CHANNEL } else { "stable" })
)

$ErrorActionPreference = "Stop"

function Get-OpenCodeVersion {
  if (-not (Get-Command opencode -ErrorAction SilentlyContinue)) { return $null }
  $out = & opencode --version 2>$null
  if ($out -match '(\d+\.\d+\.\d+)') { return $Matches[1] }
  return $null
}

function Get-NpmTag {
  param([string]$Ch)
  switch ($Ch) {
    "stable" { "latest" }
    "beta"   { "beta" }
    "dev"    { "dev" }
    default  { throw "Unknown channel: $Ch" }
  }
}

$tag = Get-NpmTag $Channel
$before = Get-OpenCodeVersion
$target = (npm view "opencode-ai@$tag" version 2>$null)

Write-Host "==> OpenCode CLI (channel: $Channel, npm tag: $tag)"
Write-Host "    Current: $(if ($before) { $before } else { '(not installed)' })"
if ($target) { Write-Host "    Target:  $target" }

if ($Check) {
  if (-not $before) {
    Write-Host "WARN OpenCode CLI not found"
    exit 1
  }
  Write-Host "OK   OpenCode CLI $before"
  exit 0
}

if ($before -and $target -and $before -eq $target) {
  Write-Host "OK   Already on $target"
  exit 0
}

$installed = $false
if (Get-Command bun -ErrorAction SilentlyContinue) {
  Write-Host "    Upgrading via bun (opencode-ai@$tag)..."
  bun install -g "opencode-ai@$tag"
  $installed = $true
}
elseif (Get-Command npm -ErrorAction SilentlyContinue) {
  Write-Host "    Upgrading via npm (opencode-ai@$tag)..."
  npm install -g "opencode-ai@$tag"
  $installed = $true
}
else {
  Write-Error "Install bun or npm, or use: irm https://opencode.ai/install | iex"
}

$after = Get-OpenCodeVersion
if ($after) {
  Write-Host "OK   OpenCode CLI now $after"
} else {
  Write-Host "WARN Could not verify opencode --version after install"
  exit 1
}

Write-Host "    Restart the OpenCode desktop app after CLI upgrade (sidecar sync)."
