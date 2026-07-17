# Bootstrap a new project with full P-Core Orchestra context.
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/init-project.ps1                     # interactive
#   powershell -ExecutionPolicy Bypass -File scripts/init-project.ps1 -Target .           # interactive
#   powershell -ExecutionPolicy Bypass -File scripts/init-project.ps1 -Target . -Type web -Name "My App"   # silent
param(
  [string]$Target = ".",
  [switch]$Force,
  [string]$Type = "",
  [string]$Name = "",
  [string]$Slug = "",
  [string]$Arch = "",
  [switch]$Interactive
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Templates = Join-Path $Root "templates"
$ArchDir = Join-Path $Templates "architectures"
$Target = (Resolve-Path $Target -ErrorAction SilentlyContinue).Path
if (-not $Target) { $Target = (Resolve-Path ".").Path }

# Auto-interactive if no flags
if (-not $Type -and -not $Name -and -not $Arch -and -not $Interactive) {
  $Interactive = $true
}

# ─── Colors ───────────────────────────────────────────────────────────────────
function Write-Info($msg)  { Write-Host "==> $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "==> $msg" -ForegroundColor Yellow }
function Write-Error($msg) { Write-Host "==> $msg" -ForegroundColor Red }

# ─── Helpers ──────────────────────────────────────────────────────────────────
function Slugify($s) { return ($s.ToLower() -replace '[^a-z0-9-]','-') -replace '-+','-' }

function Ask($msg, $default) {
  if ($default) { $p = "❯ $msg [$default]: " } else { $p = "❯ $msg: " }
  $val = Read-Host -Prompt $p
  if (-not $val -and $default) { return $default }
  return $val
}

function Ask-Required($msg, $default) {
  do { $val = Ask $msg $default } while (-not $val)
  return $val
}

function Ask-Select($msg, $options) {
  Write-Host "❯ $msg"
  for ($i = 0; $i -lt $options.Count; $i++) {
    Write-Host "    $($i+1). $($options[$i])"
  }
  do {
    $sel = Read-Host -Prompt "  (1-$($options.Count))"
    $num = 0; [int]::TryParse($sel, [ref]$num) | Out-Null
  } while ($num -lt 1 -or $num -gt $options.Count)
  return $options[$num-1]
}

function Ask-Multi($msg, $options) {
  Write-Host "❯ $msg (space-separated numbers, e.g. '1 3 5', or 0 for none):"
  for ($i = 0; $i -lt $options.Count; $i++) {
    Write-Host "    $($i+1). $($options[$i])"
  }
  do {
    $line = Read-Host -Prompt "  "
    $parts = $line -split '\s+' | Where-Object { $_ }
    if ($parts -contains '0') { return @() }
    $valid = $true
    $result = @()
    foreach ($p in $parts) {
      $num = 0; [int]::TryParse($p, [ref]$num) | Out-Null
      if ($num -ge 1 -and $num -le $options.Count) { $result += $options[$num-1] }
      else { $valid = $false; break }
    }
  } while (-not $valid -or $result.Count -eq 0)
  return $result
}

# ─── Interactive mode ─────────────────────────────────────────────────────────

if ($Interactive) {
  Write-Host ""
  Write-Info "P-Core Orchestra — Interactive Project Init"
  Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  Write-Host ""
  Write-Host "We'll ask a series of questions to set up your project."
  Write-Host ""

  # Step 1: Project Basics
  Write-Info "Step 1: Project Basics"
  $PROJECT_NAME = Ask-Required "Project name" "My Project"
  $PROJECT_SLUG = Slugify $PROJECT_NAME
  $PROJECT_SLUG = Ask "Project slug" $PROJECT_SLUG

  $PROJECT_TYPE = Ask-Select "Project type" @(
    "web", "mobile", "api", "ai", "devops", "library",
    "saas", "internal-tool", "oss", "cli", "game", "data"
  )

  # Step 2: Description
  Write-Host ""; Write-Info "Step 2: Description & Goals"
  $PROJECT_DESC = Ask "One-line description" "A $PROJECT_TYPE application"
  $PROJECT_PROBLEM = Ask "What problem does it solve" ""
  $PROJECT_AUDIENCE = Ask "Who is it for" ""
  $PROJECT_GOAL1 = Ask-Required "Goal #1" "Build and ship the MVP"
  $PROJECT_GOAL2 = Ask "Goal #2" ""
  $PROJECT_GOAL3 = Ask "Goal #3" ""

  # Step 3: Features
  Write-Host ""; Write-Info "Step 3: Features & Scope"
  $PROJECT_FEATURES = Ask "Key features (comma-separated)" ""
  $PROJECT_SCOPE_IN = Ask "In scope (comma-separated)" ""
  $PROJECT_SCOPE_OUT = Ask "Out of scope (comma-separated)" ""

  # Step 4: Team
  Write-Host ""; Write-Info "Step 4: Team"
  $PROJECT_LEAD = Ask "Project lead" ""
  $PROJECT_TEAM = Ask "Team members (comma-separated)" ""

  # Step 5: Stack
  Write-Host ""; Write-Info "Step 5: Technology Stack"
  $PROJECT_LANG = Ask-Select "Primary language" @("TypeScript","JavaScript","Python","Go","Rust","PHP","Kotlin","Swift","C#","Zig")
  $PROJECT_RUNTIME = Ask-Select "Runtime" @("Node.js","Bun","Deno","Python","Go","Rust","PHP")
  $PROJECT_PKG = Ask-Select "Package manager" @("pnpm","npm","yarn","bun","pip","cargo","composer","go-mod")

  $PROJECT_FRAMEWORKS = Ask-Multi "Frameworks" @("React","Next.js","Hono","Express","Fastify","NestJS","Django","Laravel","Vue","Svelte","Astro","Tauri")
  $PROJECT_DATABASES = Ask-Multi "Databases" @("PostgreSQL","MySQL","SQLite","MongoDB","Redis","D1","PlanetScale","Supabase")
  $PROJECT_INFRA = Ask-Multi "Infrastructure" @("Cloudflare","AWS","GCP","Azure","Docker","Kubernetes","Vercel","Netlify")

  # Step 6: Architecture
  Write-Host ""; Write-Info "Step 6: Architecture"
  $archFiles = @("None (skip)")
  Get-ChildItem "$ArchDir\*.md" -Name | ForEach-Object {
    $label = $_ -replace '^\d+-','' -replace '\.md$',''
    Write-Host "    $($archFiles.Count). $label"
    $archFiles += $_
  }
  $PROJECT_ARCH = $archFiles | Select-Object -Index ( [int](Read-Host -Prompt "  (1-$($archFiles.Count))") - 1 )

  # Step 7: Environments
  Write-Host ""; Write-Info "Step 7: Environments"
  $PROJECT_URL_DEV = Ask "Dev URL" "http://localhost:3000"
  $PROJECT_URL_STAGING = Ask "Staging URL" ""
  $PROJECT_URL_PROD = Ask "Production URL" ""

  # Step 8: Security
  Write-Host ""; Write-Info "Step 8: Security"
  $PROJECT_AUTH = Ask-Select "Authentication" @("None (skip)","neon-auth","clerk","auth0","supabase","better-auth","custom")
  if ($PROJECT_AUTH -ne "None (skip)") {
    $PROJECT_AUTHZ = Ask-Select "Authorization" @("rbac","abac","none")
  }
  $PROJECT_COMPLIANCE = Ask-Select "Compliance" @("None","SOC2","HIPAA","GDPR","PCI-DSS")

  # Step 9: Deployment
  Write-Host ""; Write-Info "Step 9: Deployment"
  $PROJECT_CI = Ask-Select "CI/CD" @("GitHub Actions","GitLab CI","Jenkins","CircleCI","None")
  $PROJECT_HOST = Ask-Select "Hosting" @("Cloudflare","Vercel","AWS","GCP","Azure","Self-hosted")

  # Step 10: Observability
  Write-Host ""; Write-Info "Step 10: Observability"
  $PROJECT_MONITORING = Ask-Select "Monitoring" @("None","Datadog","Grafana","Sentry","Cloudflare")

  # Step 11: Timeline
  Write-Host ""; Write-Info "Step 11: Timeline"
  $PROJECT_START_DATE = Ask "Start date" (Get-Date -Format "yyyy-MM-dd")
  $PROJECT_MILESTONE1 = Ask "Major milestone #1" "MVP launch"

  Write-Info "All questions answered. Generating project..."
  Write-Host ""
}

# ─── Create target directory ──────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $Target | Out-Null
Write-Info "Target: $Target"

# ─── 1. Bootstrap context files ───────────────────────────────────────────────
Write-Info "Step 1/3: Bootstrapping context files..."
$ctxArgs = @("-Target", $Target)
if ($Force) { $ctxArgs += "-Force" }
& (Join-Path $Root "scripts\init-context.ps1") @ctxArgs

# ─── 2. Bootstrap project.yaml ────────────────────────────────────────────────
Write-Info "Step 2/3: Bootstrapping project.yaml..."
$Dest = Join-Path $Target "project.yaml"
if ((Test-Path $Dest) -and -not $Force) {
  Write-Warn "skip (exists): $Dest   (use -Force to overwrite)"
} else {
  Copy-Item (Join-Path $Templates "project.yaml") $Dest -Force
  Write-Info "wrote: $Dest"
}

# ─── 3. Fill in gathered data ─────────────────────────────────────────────────
Write-Info "Step 3/3: Filling in project data..."

if ($Interactive) {
  $now = $PROJECT_START_DATE
  $slug = $PROJECT_SLUG
  $name = $PROJECT_NAME

  # ── Fill project.yaml ────────────────────────────────────────────────────
  $yaml = Get-Content $Dest -Raw
  $yaml = $yaml -replace '<project-slug>', $slug
  $yaml = $yaml -replace '<Human-Readable Project Name>', $name
  $yaml = $yaml -replace '<name or team>', $PROJECT_LEAD
  $yaml = $yaml -replace '<category>', ''
  $yaml = $yaml -replace '<YYYY-MM-DD>', $now
  $yaml = $yaml -replace '<git remote url>', "https://github.com/username/$slug"
  $yaml = $yaml -replace '<http://localhost:PORT>', $PROJECT_URL_DEV
  $yaml = $yaml -replace '<https://staging.example.com>', $PROJECT_URL_STAGING
  $yaml = $yaml -replace '<https://example.com>', $PROJECT_URL_PROD
  $yaml = $yaml -replace '<provider>', $PROJECT_HOST
  $yaml = $yaml -replace '<tool>', $PROJECT_MONITORING
  $yaml = $yaml -replace "type: web\s+# web", "type: $PROJECT_TYPE  # $PROJECT_TYPE"
  $yaml = $yaml -replace "runtime: node", "runtime: $($PROJECT_RUNTIME.ToLower())"
  $yaml = $yaml -replace "package_manager: pnpm", "package_manager: $($PROJECT_PKG.ToLower())"
  $yaml = $yaml -replace 'ci_cd: github-actions', "ci_cd: $($PROJECT_CI.ToLower() -replace ' ','-')"

  # Language
  $yaml = $yaml -replace '(?<=languages:\r?\n\s*)- <language>', "- $($PROJECT_LANG.ToLower())"

  # Frameworks
  if ($PROJECT_FRAMEWORKS.Count -gt 0) {
    $repl = "frameworks:`n" + ($PROJECT_FRAMEWORKS | ForEach-Object { "    - $_" }) -join "`n"
    $yaml = $yaml -replace '(?s)frameworks:\r?\n\s*- <framework>', $repl
  }

  # Databases
  if ($PROJECT_DATABASES.Count -gt 0) {
    $repl = "databases:`n" + ($PROJECT_DATABASES | ForEach-Object { "    - $_" }) -join "`n"
    $yaml = $yaml -replace '(?s)databases:\r?\n\s*- <database>', $repl
  }

  # Infrastructure
  if ($PROJECT_INFRA.Count -gt 0) {
    $repl = "infrastructure:`n" + ($PROJECT_INFRA | ForEach-Object { "    - $_" }) -join "`n"
    $yaml = $yaml -replace '(?s)infrastructure:\r?\n\s*- <infra>', $repl
  }

  # Team
  if ($PROJECT_TEAM) {
    $teamMembers = $PROJECT_TEAM -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    if ($teamMembers.Count -gt 0) {
      $repl = "members:`n" + ($teamMembers | ForEach-Object { "    - name: $_`n      role: developer" }) -join "`n"
      $yaml = $yaml -replace '(?s)members:\r?\n\s*- name: <name>\r?\n\s*role: <role>', $repl
    }
  }

  # Auth
  if ($PROJECT_AUTH -and $PROJECT_AUTH -ne "None (skip)") {
    $yaml = $yaml -replace 'authentication: <provider>', "authentication: $PROJECT_AUTH"
  }

  # Compliance
  if ($PROJECT_COMPLIANCE -and $PROJECT_COMPLIANCE -ne "None") {
    $yaml = $yaml -replace 'standards: \[\]', "standards:`n  - $($PROJECT_COMPLIANCE.ToLower())"
  }

  Set-Content $Dest $yaml

  # ── Fill project-overview.md ──────────────────────────────────────────────
  $Overview = Join-Path $Target "context\project-overview.md"
  if (Test-Path $Overview) {
    $overviewContent = Get-Content $Overview -Raw
    $descLine = $PROJECT_DESC
    if ($PROJECT_PROBLEM) { $descLine += " It solves: $PROJECT_PROBLEM." }
    if ($PROJECT_AUDIENCE) { $descLine += " For: $PROJECT_AUDIENCE." }
    $overviewContent = $overviewContent -replace '\[Project Name\]', $name
    $overviewContent = $overviewContent -replace '\[One paragraph describing what this application does[^\]]*\]', $descLine

    if ($PROJECT_GOAL1) { $overviewContent = $overviewContent -replace '(?s)1\. \[Goal one[^\]]*\]', "1. $PROJECT_GOAL1" }
    if ($PROJECT_GOAL2) { $overviewContent = $overviewContent -replace '(?s)2\. \[Goal two[^\]]*\]', "2. $PROJECT_GOAL2" } else { $overviewContent = $overviewContent -replace '(?s)2\. \[Goal two[^\]]*\]', '2. ' }
    if ($PROJECT_GOAL3) { $overviewContent = $overviewContent -replace '(?s)3\. \[Goal three[^\]]*\]', "3. $PROJECT_GOAL3" } else { $overviewContent = $overviewContent -replace '(?s)3\. \[Goal three[^\]]*\]', '3. ' }

    # Features
    if ($PROJECT_FEATURES) {
      $feats = ($PROJECT_FEATURES -split ',' | ForEach-Object { "- $($_.Trim())" }) -join "`n"
      $overviewContent = $overviewContent -replace '(?s)### \[Feature Category One\].*?(?=###|$)', "### Features`n`n$feats"
    }

    # Scope
    if ($PROJECT_SCOPE_IN) {
      $inScope = ($PROJECT_SCOPE_IN -split ',' | ForEach-Object { "- $($_.Trim())" }) -join "`n"
      $overviewContent = $overviewContent -replace '(?s)- \[What you are building\]', $inScope
    }
    if ($PROJECT_SCOPE_OUT) {
      $outScope = ($PROJECT_SCOPE_OUT -split ',' | ForEach-Object { "- $($_.Trim())" }) -join "`n"
      $overviewContent = $overviewContent -replace '(?s)- \[What you are explicitly not building\]', $outScope
    }

    Set-Content $Overview $overviewContent
  }

  # ── Seed progress-tracker.md ──────────────────────────────────────────────
  $Tracker = Join-Path $Target "context\progress-tracker.md"
  @"
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
"@ | Set-Content $Tracker

  # ── Seed AGENTS.md with project identity ──────────────────────────────────
  $AgentsFile = Join-Path $Target "AGENTS.md"
  if (Test-Path $AgentsFile) {
    Add-Content $AgentsFile "`n# $name`n`nProject initialized on $PROJECT_START_DATE.`nType: $PROJECT_TYPE | Stack: $PROJECT_LANG / $PROJECT_RUNTIME`n"
  }

  # ── Scaffold architecture template ────────────────────────────────────────
  if ($PROJECT_ARCH -and $PROJECT_ARCH -ne "None (skip)") {
    $ArchSrc = Join-Path $ArchDir $PROJECT_ARCH
    if (Test-Path $ArchSrc) {
      $ArchDest = Join-Path $Target "docs\architecture"
      New-Item -ItemType Directory -Force -Path $ArchDest | Out-Null
      Copy-Item $ArchSrc (Join-Path $ArchDest $PROJECT_ARCH) -Force
      Write-Info "wrote architecture: docs\architecture\$PROJECT_ARCH"
    }
  }

  # ── Create daily plan seed ────────────────────────────────────────────────
  $DailyPlan = Join-Path $Target "docs\daily-plan.md"
  $today = Get-Date -Format "yyyy-MM-dd"
  @"
# Daily Plan — $name

## $today — Kickoff

### Today's Goals
- [ ] Set up development environment
- [ ] Review project identity in project.yaml
- [ ] Begin $PROJECT_GOAL1

### Blockers
- (none)

### Notes
- Project scaffolded via P-Core Orchestra interactive init
"@ | Set-Content $DailyPlan
  Write-Info "wrote: docs\daily-plan.md"

  Write-Host ""
  Write-Info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  Write-Info "Project '$name' initialized at:"
  Write-Info "  $Target"
  Write-Host ""
  Write-Info "Next steps:"
  Write-Host "  1. Review and edit project.yaml"
  Write-Host "  2. Review context/*.md files"
  Write-Host "  3. cd $Target; git init; git add -A; git commit -m 'Initial scaffold'"
  Write-Host "  4. Start building!"
  Write-Host ""
  Write-Info "P-Core Orchestra will auto-detect project.yaml and context/ on your next session."
  Write-Info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  Write-Host ""

} else {
  # ── Silent mode ───────────────────────────────────────────────────────────
  $now = Get-Date -Format "yyyy-MM-dd"
  $isoNow = Get-Date -Format "o"

  if ($Type -or $Name -or $Slug) {
    $yaml = Get-Content $Dest -Raw
    if ($Name)  { $yaml = $yaml -replace 'display_name: <Human-Readable Project Name>', "display_name: $Name"; $yaml = $yaml -replace 'name: <project-slug>', "name: $(Slugify $Name)" }
    if ($Slug)  { $yaml = $yaml -replace 'name: <project-slug>', "name: $Slug" }
    if ($Type)  { $yaml = $yaml -replace "type: web\s+# web", "type: $Type  # $Type" }
    $yaml = $yaml -replace 'started: <YYYY-MM-DD>', "started: $now"
    $yaml = $yaml -replace 'updated: <YYYY-MM-DD>', "updated: $now"
    $yaml = $yaml -replace 'initialized: <YYYY-MM-DDTHH:MM:SSZ>', "initialized: $isoNow"
    Set-Content $Dest $yaml
    Write-Info "applied Type/Name/Slug to project.yaml"
  }

  # Architecture
  if ($Arch -or $Type) {
    $ArchTarget = if ($Arch) { $Arch } else { "21-next-hono-prisma-query.md" }
    if (-not $Arch -and $Type) {
      $map = @{ "web"="21-next-hono-prisma-query.md"; "mobile"="01-monorepo.md"; "api"="11-microservices.md"; "ai"="17-serverless.md"; "saas"="12-event-driven.md" }
      if ($map.ContainsKey($Type)) { $ArchTarget = $map[$Type] }
    }
    $ArchDest = Join-Path $Target "docs\architecture"
    New-Item -ItemType Directory -Force -Path $ArchDest | Out-Null
    $ArchFile = Join-Path $ArchDir $ArchTarget
    if (Test-Path $ArchFile) {
      Copy-Item $ArchFile (Join-Path $ArchDest $ArchTarget) -Force
      Write-Info "wrote architecture: docs\architecture\$ArchTarget"
    }
  }

  Write-Host ""
  Write-Host "==> Done."
  Write-Host "    Edit $Dest to fill in your project details."
  Write-Host "    Init context: powershell $Root\scripts\init-context.ps1 -Target $Target"
}
