# Install Orchestra bundle to ~/.cursor, ~/.config/opencode, ~/.qoder,
# ~/.claude AND ~/.codex (global)
# Usage:
#   powershell -ExecutionPolicy Bypass -File install.ps1              # all five
#   powershell -ExecutionPolicy Bypass -File install.ps1 -All         # same
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Cursor      # Cursor only
#   powershell -ExecutionPolicy Bypass -File install.ps1 -OpenCode    # OpenCode only
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Qoder       # Qoder CLI only
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Claude      # Claude Code only
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Codex       # Codex CLI only
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Project     # + project bridge
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Studio      # install Studio dashboard
#   powershell -ExecutionPolicy Bypass -File install.ps1 -DryRun      # show what would be installed
param(
  [switch]$All,
  [switch]$Cursor,
  [switch]$OpenCode,
  [switch]$Qoder,
  [switch]$Claude,
  [switch]$Codex,
  [switch]$Project,
  [switch]$SkipOpenCodeUpgrade,
  [switch]$Studio,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Bundle = Join-Path $Root "bundle"
$CursorDir = if ($env:CURSOR_HOME) { $env:CURSOR_HOME } else { Join-Path $env:USERPROFILE ".cursor" }
$OpenCodeDir = if ($env:OPENCODE_CONFIG_DIR) { $env:OPENCODE_CONFIG_DIR } else { Join-Path $env:USERPROFILE ".config\opencode" }
$QoderDir = if ($env:QODER_CONFIG_DIR) { $env:QODER_CONFIG_DIR } else { Join-Path $env:USERPROFILE ".qoder" }
$ClaudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE ".claude" }
$CodexDir = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE ".codex" }
$AgentsSkills = if ($env:AGENTS_SKILLS) { $env:AGENTS_SKILLS } else { Join-Path $env:USERPROFILE ".agents\skills" }

# Default: all if no flag
if (-not $Cursor -and -not $OpenCode -and -not $Qoder -and -not $Claude -and -not $Codex) {
  $All = $true
}
if ($All) {
  $Cursor = $true
  $OpenCode = $true
  $Qoder = $true
  $Claude = $true
  $Codex = $true
}

Write-Host "=========================================================================="
Write-Host " Orchestra Installer (Cursor + OpenCode + Qoder + Claude Code + Codex)"
Write-Host "=========================================================================="
Write-Host ""

###############################################################################
# Cursor installation
###############################################################################
function Install-Cursor {
  Write-Host "==> Installing P-Core Orchestra to $CursorDir"

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
    # Fresh clones lack bundle\hooks\state\orchestra.json (gitignored runtime
    # state); fall back to the tracked template, then an empty object.
    $trackedState = Join-Path $Bundle "opencode\state\orchestra.json"
    $hooksState = Join-Path $Bundle "hooks\state\orchestra.json"
    if (Test-Path $trackedState) {
      Copy-Item $trackedState $stateDest -Force
    } elseif (Test-Path $hooksState) {
      Copy-Item $hooksState $stateDest -Force
    } else {
      Set-Content -Path $stateDest -Value '{}' -Encoding UTF8
    }
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
    "orchestra-loop", "orchestra-install", "prompt-intake", "verification-before-completion",
    "ui-ux-pro-max", "brand", "design-system", "ui-styling", "web-design-master"
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
  Write-Host "  Agents skills:   $AgentsSkills\{orchestra-loop,prompt-intake,verification-before-completion,ui-ux-pro-max,brand,design-system,ui-styling,web-design-master}"
}

###############################################################################
# OpenCode installation
###############################################################################
function Install-OpenCode {
  Write-Host "==> Installing OpenCode Orchestra to $OpenCodeDir"

  if (-not $SkipOpenCodeUpgrade) {
    & (Join-Path $Root "scripts\ensure-opencode-latest.ps1")
  }

  # Free-model refresh + dynamic apply (before agent copy + autonomy merge so
  # installed files carry the current light/heavy free-pool assignment).
  Write-Host "==> Free-model refresh + apply"
  $bashCmd = Get-Command bash -ErrorAction SilentlyContinue
  if ($bashCmd) {
    & bash (Join-Path $Root "scripts\update-free-models.sh") --refresh --apply
    if ($LASTEXITCODE -ne 0) {
      Write-Host "WARN free-model refresh/apply failed (offline first-run?) - keeping existing model IDs"
    }
  } else {
    Write-Host "WARN bash not found - skipping free-model refresh (run update-free-models.sh from Git Bash)"
  }

  @(
    (Join-Path $OpenCodeDir "hooks\state"),
    (Join-Path $OpenCodeDir "hooks\lib"),
    (Join-Path $OpenCodeDir "agents"),
    (Join-Path $OpenCodeDir "skills"),
    (Join-Path $OpenCodeDir "state"),
    (Join-Path $OpenCodeDir "plugins")
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

  # Plugins (ambient system-prompt policy; default-export V2)
  $pluginsSrc = Join-Path $Bundle "opencode\plugins"
  if (Test-Path $pluginsSrc) {
    $pluginsDest = Join-Path $OpenCodeDir "plugins"
    New-Item -ItemType Directory -Force -Path $pluginsDest | Out-Null
    Copy-Item (Join-Path $pluginsSrc "*.js") $pluginsDest -Force
  }

  # Lib modules (shared with Cursor)
  $libDest = Join-Path $OpenCodeDir "hooks\lib"
  if (Test-Path $libDest) { Remove-Item $libDest -Recurse -Force }
  Copy-Item (Join-Path $Bundle "opencode\hooks\lib") $libDest -Recurse -Force
  foreach ($libFile in @("opencode-config-sanitize.js", "opencode-v2.js", "opencode-version.js")) {
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
    "orchestra-loop", "orchestra-install", "prompt-intake", "verification-before-completion",
    "ui-ux-pro-max", "brand", "design-system", "ui-styling", "web-design-master"
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

  # Weekly free-model schedule (Windows has no systemd — schtasks Monday 04:17)
  # schtasks cannot parse a spaced repo path inside /TR ("D:/Some Spaced Dir/..." →
  # "Invalid argument/option - 'Web'"), so schedule a no-space wrapper script
  # instead. The wrapper runs the repo script via its WSL /mnt/<drive>/ path
  # (WSL bash cannot open D:\ paths directly).
  if ($bashCmd) {
    $scriptPath = (Join-Path $Root "scripts\update-free-models.sh").Replace('\', '/')
    $wrapperPath = Join-Path $env:USERPROFILE ".local\bin\pcore-free-models.sh"
    $localBinDir = Split-Path -Parent $wrapperPath
    if (-not (Test-Path $localBinDir)) { New-Item -ItemType Directory -Force -Path $localBinDir | Out-Null }

    # Windows path -> WSL mount path (D:/foo or D:\foo -> /mnt/d/foo); keep as-is otherwise
    function Convert-ToMntPath([string]$p) {
      if ($p -match '^[A-Za-z]:') {
        return "/mnt/" + $p.Substring(0,1).ToLower() + $p.Substring(2).Replace('\', '/')
      }
      return $p
    }
    $mntScript = Convert-ToMntPath $scriptPath
    $mntHome = Convert-ToMntPath ($env:USERPROFILE.Replace('\', '/'))
    $wrapperLines = @(
      '#!/usr/bin/env bash'
      "export HOME=$mntHome"
      "exec bash '$mntScript' --refresh --apply"
    )
    # LF-only + ASCII: Set-Content would emit CRLF (breaks bash args — "--apply\r"
    # -> Unknown option) and a UTF-8 BOM would break shebang parsing
    $wrapperText = ($wrapperLines -join "`n") + "`n"
    [System.IO.File]::WriteAllText($wrapperPath, $wrapperText, [System.Text.Encoding]::ASCII)

    # schtasks /TR must have no spaces; never let native stderr/EAP=Stop abort install
    $taskCmd = "bash " + (Convert-ToMntPath $wrapperPath)
    $schedExit = -1
    $prevEAP = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'SilentlyContinue'
      schtasks /Create /F /SC WEEKLY /D MON /ST 04:17 /TN "pcore-free-models" /TR "$taskCmd" | Out-Null
      $schedExit = $LASTEXITCODE
    } catch {
      $schedExit = -1
    } finally {
      $ErrorActionPreference = $prevEAP
    }
    if ($schedExit -eq 0) {
      Write-Host "  Free-model schedule: schtasks pcore-free-models (Mon 04:17)"
    } else {
      Write-Host "WARN schtasks failed - schedule manually: bash $wrapperPath --refresh --apply (weekly)"
    }
  }

  Write-Host "  OpenCode agents:  $OpenCodeDir\agents\orchestra-*.md"
  Write-Host "  OpenCode hooks:   $OpenCodeDir\hooks\"
  Write-Host "  OpenCode lib:     $OpenCodeDir\hooks\lib\ (21 modules)"
  Write-Host "  OpenCode skills:  $OpenCodeDir\skills\ (orchestra-loop + UI + Cloudflare)"
  Write-Host "  OpenCode state:   $OpenCodeDir\state\orchestra.json"
  Write-Host "  OpenCode plugins: $OpenCodeDir\plugins\ (orchestra-ambient default export)"
  Write-Host "  OpenCode autonomy:$OpenCodeDir\opencode.json (permission + agents; mcp preserved)"
  Write-Host "  OpenCode CLI:     opencode --version - restart desktop app after upgrade"
}

###############################################################################
# Qoder CLI installation
###############################################################################
function Install-Qoder {
  Write-Host "==> Installing Qoder CLI Orchestra to $QoderDir"

  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js 18+ required. Install from https://nodejs.org"
  }

  @(
    (Join-Path $QoderDir "hooks\state"),
    (Join-Path $QoderDir "agents"),
    (Join-Path $QoderDir "skills")
  ) | ForEach-Object { New-Item -ItemType Directory -Force -Path $_ | Out-Null }

  # Hooks (same orchestra-*.js entrypoints as Cursor; stdin JSON normalized
  # by lib/io.js normalizeHookInput for Qoder's agent_type field)
  Copy-Item (Join-Path $Bundle "hooks\orchestra-*.js") (Join-Path $QoderDir "hooks\") -Force
  $libDest = Join-Path $QoderDir "hooks\lib"
  if (Test-Path $libDest) { Remove-Item $libDest -Recurse -Force }
  Copy-Item (Join-Path $Bundle "hooks\lib") $libDest -Recurse -Force

  # State (fresh clones lack the gitignored runtime file; use tracked template)
  $stateDest = Join-Path $QoderDir "hooks\state\orchestra.json"
  if (-not (Test-Path $stateDest)) {
    $trackedState = Join-Path $Bundle "opencode\state\orchestra.json"
    $hooksState = Join-Path $Bundle "hooks\state\orchestra.json"
    if (Test-Path $trackedState) {
      Copy-Item $trackedState $stateDest -Force
    } elseif (Test-Path $hooksState) {
      Copy-Item $hooksState $stateDest -Force
    } else {
      Set-Content -Path $stateDest -Value '{}' -Encoding UTF8
    }
  }

  # Agents (pre-converted Qoder frontmatter tree; fall back to Cursor source)
  $agentsDest = Join-Path $QoderDir "agents"
  if (Test-Path $agentsDest) { Remove-Item $agentsDest -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $agentsDest | Out-Null
  $qoderAgentsSrc = Join-Path $Bundle "qoder\agents"
  if (Test-Path $qoderAgentsSrc) {
    $null = robocopy $qoderAgentsSrc $agentsDest /E /NDL /NJH /NJS /NP
  } else {
    Write-Host "WARN bundle\qoder\agents missing - falling back to Cursor agent source"
    Write-Host "WARN (run: node scripts\sync-qoder-agents.js to regenerate)"
    $null = robocopy (Join-Path $Bundle "agents") $agentsDest /E /NDL /NJH /NJS /NP
  }

  # Skills (Qoder reads ~/.qoder/skills/{name}/SKILL.md - same layout as Cursor)
  $skillDirs = Get-ChildItem -Path (Join-Path $Bundle "skills") -Directory
  foreach ($skillDir in $skillDirs) {
    $destDir = Join-Path (Join-Path $QoderDir "skills") $skillDir.Name
    if (Test-Path $destDir) { Remove-Item $destDir -Recurse -Force }
    $null = robocopy $skillDir.FullName $destDir /E /NDL /NJH /NJS /NP
  }

  Copy-Item (Join-Path $Bundle "ORCHESTRA.md") (Join-Path $QoderDir "ORCHESTRA.md") -Force

  # Merge hooks into settings.json (PascalCase events, absolutized commands)
  node (Join-Path $Root "scripts\merge-qoder-settings.js") --qoder-home $QoderDir

  Write-Host "  Qoder agents:  $QoderDir\agents\ (160 converted)"
  Write-Host "  Qoder hooks:   $QoderDir\hooks\ + settings.json (SessionStart/UserPromptSubmit/SubagentStop/Stop)"
  Write-Host "  Qoder skills:  $QoderDir\skills\ (orchestra-loop + UI + Cloudflare)"
  Write-Host "  Qoder CLI:     qoder --agent orchestra (restart any running sessions)"
}

###############################################################################
# Claude Code installation
###############################################################################
function Install-Claude {
  Write-Host "==> Installing Claude Code Orchestra to $ClaudeDir"

  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js 18+ required. Install from https://nodejs.org"
  }

  @(
    (Join-Path $ClaudeDir "hooks\state"),
    (Join-Path $ClaudeDir "agents"),
    (Join-Path $ClaudeDir "skills")
  ) | ForEach-Object { New-Item -ItemType Directory -Force -Path $_ | Out-Null }

  # Hooks (same entrypoints as Cursor; lib/io.js normalizes agent_type)
  Copy-Item (Join-Path $Bundle "hooks\orchestra-*.js") (Join-Path $ClaudeDir "hooks\") -Force
  $libDest = Join-Path $ClaudeDir "hooks\lib"
  if (Test-Path $libDest) { Remove-Item $libDest -Recurse -Force }
  Copy-Item (Join-Path $Bundle "hooks\lib") $libDest -Recurse -Force

  # State (fresh clones lack the gitignored runtime file; use tracked template)
  $stateDest = Join-Path $ClaudeDir "hooks\state\orchestra.json"
  if (-not (Test-Path $stateDest)) {
    $trackedState = Join-Path $Bundle "opencode\state\orchestra.json"
    $hooksState = Join-Path $Bundle "hooks\state\orchestra.json"
    if (Test-Path $trackedState) {
      Copy-Item $trackedState $stateDest -Force
    } elseif (Test-Path $hooksState) {
      Copy-Item $hooksState $stateDest -Force
    } else {
      Set-Content -Path $stateDest -Value '{}' -Encoding UTF8
    }
  }

  # Agents (flat generated mirror; never delete user-authored agents)
  $claudeAgentsSrc = Join-Path $Bundle "claude\agents"
  if (Test-Path $claudeAgentsSrc) {
    Copy-Item (Join-Path $claudeAgentsSrc "*.md") (Join-Path $ClaudeDir "agents\") -Force
  } else {
    Write-Host "WARN bundle\claude\agents missing - run: node scripts\sync-claude-agents.js"
  }

  # Skills (Claude Code reads ~/.claude/skills/{name}/SKILL.md)
  $skillDirs = Get-ChildItem -Path (Join-Path $Bundle "skills") -Directory
  foreach ($skillDir in $skillDirs) {
    $destDir = Join-Path (Join-Path $ClaudeDir "skills") $skillDir.Name
    if (Test-Path $destDir) { Remove-Item $destDir -Recurse -Force }
    $null = robocopy $skillDir.FullName $destDir /E /NDL /NJH /NJS /NP
  }

  Copy-Item (Join-Path $Bundle "ORCHESTRA.md") (Join-Path $ClaudeDir "ORCHESTRA.md") -Force

  # Merge hooks into settings.json (preserves permissions/model/env/mcpServers)
  node (Join-Path $Root "scripts\merge-claude-settings.js") --claude-home $ClaudeDir

  # Shared Agent Skills links
  New-Item -ItemType Directory -Force -Path $AgentsSkills | Out-Null
  foreach ($linkSkill in @(
    "orchestra-loop", "orchestra-install", "prompt-intake", "verification-before-completion",
    "ui-ux-pro-max", "brand", "design-system", "ui-styling", "web-design-master"
  )) {
    $srcSkill = Join-Path (Join-Path $ClaudeDir "skills") $linkSkill
    $skillLink = Join-Path $AgentsSkills $linkSkill
    if (Test-Path $srcSkill) {
      if (Test-Path $skillLink) { Remove-Item $skillLink -Force -Recurse -ErrorAction SilentlyContinue }
      New-Item -ItemType SymbolicLink -Path $skillLink -Target $srcSkill -Force -ErrorAction SilentlyContinue | Out-Null
      if (-not (Test-Path $skillLink)) {
        Copy-Item $srcSkill $skillLink -Recurse -Force
      }
    }
  }

  Write-Host "  Claude agents:  $ClaudeDir\agents\ (conductor + phase + specialists)"
  Write-Host "  Claude hooks:   $ClaudeDir\hooks\ + settings.json (SessionStart/UserPromptSubmit/SubagentStop/Stop)"
  Write-Host "  Claude skills:  $ClaudeDir\skills\ (orchestra-loop + install + UI + Cloudflare)"
  Write-Host "  Claude spawn:   Agent tool + subagent_type"
}

###############################################################################
# Codex CLI installation
###############################################################################
function Install-Codex {
  Write-Host "==> Installing Codex CLI Orchestra to $CodexDir"

  New-Item -ItemType Directory -Force -Path (Join-Path $CodexDir "agents") | Out-Null

  # Flat TOML agents (never delete user-authored agents)
  $codexAgentsSrc = Join-Path $Bundle "codex\agents"
  if (Test-Path $codexAgentsSrc) {
    Copy-Item (Join-Path $codexAgentsSrc "*.toml") (Join-Path $CodexDir "agents\") -Force
  } else {
    Write-Host "WARN bundle\codex\agents missing - run: node scripts\sync-codex-agents.js"
  }

  Copy-Item (Join-Path $Bundle "ORCHESTRA.md") (Join-Path $CodexDir "ORCHESTRA.md") -Force

  # Shared Agent Skills path; never replace what another host installer owns
  New-Item -ItemType Directory -Force -Path $AgentsSkills | Out-Null
  foreach ($linkSkill in @(
    "orchestra-loop", "orchestra-install", "prompt-intake", "verification-before-completion",
    "ui-ux-pro-max", "brand", "design-system", "ui-styling", "web-design-master"
  )) {
    $srcSkill = Join-Path (Join-Path $Bundle "skills") $linkSkill
    $skillLink = Join-Path $AgentsSkills $linkSkill
    if ((Test-Path $srcSkill) -and -not (Test-Path $skillLink)) {
      Copy-Item $srcSkill $skillLink -Recurse -Force
    }
  }

  Write-Host "  Codex agents:   $CodexDir\agents\ (160 TOML custom agents)"
  Write-Host "  Codex skills:   $AgentsSkills\ (shared Agent Skills path)"
  Write-Host "  Codex spawn:    spawn_agent + agent_type"
  Write-Host "  Codex hooks:    not wired (features.hooks is gated; conductor drives phases)"
}

###############################################################################
# Studio installation
###############################################################################
function Install-Studio {
  Write-Host "==> Installing Orchestra Studio"

  # Build studio
  Write-Host "  Building Studio..."
  Push-Location (Join-Path $Root "studio")
  npm ci
  npm run build
  Pop-Location

  # Copy dist to Cursor and OpenCode (for reference, though v2 server serves from repo)
  $cursorStudioDist = Join-Path $CursorDir "studio\dist"
  $opencodeStudioDist = Join-Path $OpenCodeDir "studio\dist"
  if (Test-Path $cursorStudioDist) { Remove-Item $cursorStudioDist -Recurse -Force }
  if (Test-Path $opencodeStudioDist) { Remove-Item $opencodeStudioDist -Recurse -Force }
  $null = robocopy (Join-Path $Root "studio\dist") $cursorStudioDist /E /NDL /NJH /NJS /NP
  $null = robocopy (Join-Path $Root "studio\dist") $opencodeStudioDist /E /NDL /NJH /NJS /NP

  # Install and configure service manager
  Write-Host "  Installing service manager..."
  $dryRunArg = if ($DryRun) { "--dry-run" } else { "" }
  $serviceScript = Join-Path $Root "scripts\studio-service.sh"
  if ($DryRun) {
    Write-Host "  DRY RUN: Would run: bash $serviceScript install --port 3110 --dry-run"
  } else {
    bash $serviceScript install --port 3110 $dryRunArg
  }

  # Create shim launcher that delegates to service manager (via WSL/Git Bash).
  # '__REPO_ROOT__' is substituted with this install's repo path so the shim is
  # not tied to one machine; PCORE_ORCHESTRA_REPO still overrides at runtime.
  $localBin = Join-Path $env:USERPROFILE ".local\bin"
  if (-not (Test-Path $localBin)) { New-Item -ItemType Directory -Force -Path $localBin | Out-Null }
  
  $launcherPath = Join-Path $localBin "orchestra-studio.ps1"
  $launcherContent = @'
#!/usr/bin/env pwsh
# Orchestra Studio v2 launcher (PowerShell shim)
# Delegates to studio-service.sh via bash (WSL/Git Bash)

$repoRoot = $env:PCORE_ORCHESTRA_REPO
if (-not $repoRoot) { $repoRoot = '__REPO_ROOT__' }
$serviceScript = Join-Path $repoRoot "scripts\studio-service.sh"

if (-not (Test-Path $serviceScript)) {
  Write-Error "ERROR: Service script not found. Run 'powershell -File install.ps1 -Studio' first."
  exit 1
}

# Bare invocation = start
if ($args.Count -eq 0) {
  bash $serviceScript start
  exit $LASTEXITCODE
}

# Pass through subcommands
bash $serviceScript $args
exit $LASTEXITCODE
'@
  $launcherContent = $launcherContent.Replace('__REPO_ROOT__', $Root)
  Set-Content -Path $launcherPath -Value $launcherContent -Encoding UTF8
  Write-Host "  Launcher:        $localBin\orchestra-studio.ps1 (shim -> studio-service.sh via bash)"
  Write-Host "  Service:         studio-service.sh install|start|stop|status|logs|uninstall"
  Write-Host "  Studio dist:     $CursorDir\studio\dist (Cursor, reference)"
  Write-Host "  Studio dist:     $OpenCodeDir\studio\dist (OpenCode, reference)"
}

###############################################################################
# Main
###############################################################################
if ($DryRun) {
  Write-Host "DRY RUN: Would install:"
  if ($Cursor) { Write-Host "  - Cursor" }
  if ($OpenCode) { Write-Host "  - OpenCode" }
  if ($Qoder) { Write-Host "  - Qoder CLI" }
  if ($Claude) { Write-Host "  - Claude Code" }
  if ($Codex) { Write-Host "  - Codex CLI" }
  if ($Project) { Write-Host "  - Project bridge" }
  if ($Studio) { Write-Host "  - Studio dashboard" }
  exit 0
}

if ($Cursor) { Install-Cursor }
if ($OpenCode) { Install-OpenCode }
if ($Qoder) { Install-Qoder }
if ($Claude) { Install-Claude }
if ($Codex) { Install-Codex }

if ($Project) {
  $RepoRoot = (Get-Location).Path
  Write-Host "==> Installing project bridge to $RepoRoot\.cursor"
  New-Item -ItemType Directory -Force -Path (Join-Path $RepoRoot ".cursor\hooks") | Out-Null
  Copy-Item (Join-Path $Root "project-bridge\hooks.json") (Join-Path $RepoRoot ".cursor\hooks.json") -Force
  Copy-Item (Join-Path $Root "project-bridge\hooks\bridge.js") (Join-Path $RepoRoot ".cursor\hooks\bridge.js") -Force
}

if ($Studio) { Install-Studio }

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
if ($Claude -and (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "==> Claude Code health check"
  node (Join-Path $Root "scripts\health-claude.js") --home $ClaudeDir
}
if ($Codex -and (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "==> Codex CLI health check"
  node (Join-Path $Root "scripts\health-codex.js") --home $CodexDir
}

Write-Host ""
Write-Host "============================================"
Write-Host " Orchestra installed!"
if ($Cursor) {
  Write-Host "  Cursor:   $CursorDir"
  Write-Host "            Restart Cursor IDE ? Settings ? Hooks"
}
if ($OpenCode) {
  Write-Host "  OpenCode: $OpenCodeDir"
  Write-Host "            Restart OpenCode; prefer: opencode --auto"
}
if ($Qoder) {
  Write-Host "  Qoder:    $QoderDir"
  Write-Host "            Restart Qoder sessions; try: qoder --agent orchestra"
}
if ($Claude) {
  Write-Host "  Claude:   $ClaudeDir"
  Write-Host "            Hooks in settings.json; use Agent + subagent_type"
}
if ($Codex) {
  Write-Host "  Codex:    $CodexDir"
  Write-Host "            Use spawn_agent + agent_type; hooks stay unwired"
}
if ($Cursor) {
  Write-Host "  Autonomy: Settings ? Agents ? Approvals ? Auto-review"
  Write-Host "            Docs: docs/autonomous-workflow.md"
}
if ($Studio) {
  Write-Host "  Studio:   $localBin\orchestra-studio.ps1 (starts on http://localhost:3110)"
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
