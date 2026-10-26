# ensure-opencode-latest.ps1 - install or upgrade OpenCode CLI
#
# Targets @opencode/cli (OpenCode v2). The legacy `opencode-ai` npm package is
# the v1 line and is never installed over a v2 CLI (downgrade guard below).
param(
  [switch]$Check,
  [ValidateSet("stable", "beta", "dev")]
  [string]$Channel = $(if ($env:OPENCODE_CHANNEL) { $env:OPENCODE_CHANNEL } else { "stable" })
)

$ErrorActionPreference = "Stop"

function Get-OpenCodeVersion {
  if (-not (Get-Command opencode -ErrorAction SilentlyContinue)) { return $null }
  # A broken/missing shim writes to stderr; under EAP=Stop that would throw a
  # terminating NativeCommandError, so guard the probe and treat it as absent.
  try {
    $out = & opencode --version 2>$null
  } catch {
    return $null
  }
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

$pkg = "@opencode/cli"
$tag = Get-NpmTag $Channel
$before = Get-OpenCodeVersion
$target = $null
try { $target = (npm view "$pkg@$tag" version 2>$null) } catch { $target = $null }
if ($target) { $target = "$target".Trim() }

# Refuse auto-downgrades (e.g. npm `latest` pointing at the v1 line).
if ($before -and $target) {
  $beforeMajor = 0; $targetMajor = 0
  [void][int]::TryParse($before.Split('.')[0], [ref]$beforeMajor)
  [void][int]::TryParse($target.Split('.')[0], [ref]$targetMajor)
  if ($beforeMajor -gt $targetMajor) {
    Write-Host "WARN refusing downgrade: $before -> $target ($pkg@$tag) - keeping $before"
    Write-Host "    (v2 lives in $pkg; v1 lives in opencode-ai - check the npm tag)"
    exit 1
  }
}

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
  Write-Host "    Upgrading via bun ($pkg@$tag)..."
  bun install -g "$pkg@$tag"
  $installed = $true
}
elseif (Get-Command npm -ErrorAction SilentlyContinue) {
  Write-Host "    Upgrading via npm ($pkg@$tag)..."
  npm install -g "$pkg@$tag"
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
