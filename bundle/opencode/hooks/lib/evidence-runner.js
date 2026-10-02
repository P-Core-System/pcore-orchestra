"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { QUALITY_GATES } = require("./constants.js");
const { EXCERPT_MAX } = require("./evidence-record.js");

const CORE_REQUIRED_GATES = [
  "build",
  "tests",
  "lint",
  "reviewer-approval",
  "docs-updated",
  "memory-updated",
];

const ENTERPRISE_SKIP_DEFAULT = [
  "coverage",
  "roadmap-updated",
  "release-notes-updated",
  "daily-journal-updated",
  "tech-debt-recorded",
  "changelog-updated",
  "version-updated",
];

function truncate(s) {
  if (s === null || s === undefined) return "";
  const str = String(s);
  if (str.length <= EXCERPT_MAX) return str;
  return str.slice(0, EXCERPT_MAX);
}

function runCmd(command, args, cwd) {
  const started = process.hrtime.bigint();
  const r = spawnSync(command, args, {
    cwd: cwd || process.cwd(),
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 2 * 1024 * 1024,
  });
  const ended = process.hrtime.bigint();
  let durationMs = 0;
  try {
    durationMs = Number((ended - started) / 1000000n);
  } catch (e) {
    durationMs = 0;
  }
  if (!Number.isFinite(durationMs) || durationMs < 0) durationMs = 0;
  const stdout = (r.stdout || "").trim();
  const stderr = (r.stderr || "").trim();
  return {
    ok: r.status === 0,
    status: r.status,
    exitCode: r.status,
    stdout,
    stderr,
    stdoutExcerpt: truncate(stdout),
    stderrExcerpt: truncate(stderr),
    error: r.error ? r.error.message : null,
    durationMs,
  };
}

function detectWorkspaceRoot(state) {
  if (state?.project?.identityFile) {
    return path.dirname(state.project.identityFile);
  }
  return process.cwd();
}

function evidenceBuild(root) {
  const pkg = path.join(root, "package.json");
  if (fs.existsSync(pkg)) {
    try {
      const json = JSON.parse(fs.readFileSync(pkg, "utf8"));
      if (json.scripts?.build) {
        const r = runCmd("npm", ["run", "build", "--silent"], root);
        return {
          gate: "build",
          ok: r.ok,
          details: r.ok ? "npm run build OK" : `npm run build failed: ${r.stderr || r.stdout || r.error}`,
        };
      }
    } catch (e) {
      return { gate: "build", ok: false, details: `package.json parse error: ${e.message}` };
    }
  }

  // Orchestra repo / hook projects: syntax-check hook JS
  const hooksDir = path.join(root, "bundle", "hooks");
  if (fs.existsSync(hooksDir)) {
    const files = [];
    function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else if (e.name.endsWith(".js")) files.push(f);
      }
    }
    walk(hooksDir);
    for (const f of files.slice(0, 40)) {
      const r = runCmd(process.execPath, ["--check", f], root);
      if (!r.ok) {
        return {
          gate: "build",
          ok: false,
          details: `node --check failed: ${path.relative(root, f)} ${r.stderr || r.error}`,
        };
      }
    }
    return { gate: "build", ok: true, details: `node --check OK (${Math.min(files.length, 40)} hook files)` };
  }

  return { gate: "build", ok: true, details: "SKIPPED: no build script or bundle/hooks — treated as N/A pass" };
}

function evidenceTests(root) {
  const adaptive = path.join(root, "scripts", "test-adaptive-loop.js");
  if (fs.existsSync(adaptive)) {
    const r = runCmd(process.execPath, [adaptive], root);
    return {
      gate: "tests",
      ok: r.ok,
      details: r.ok ? "test-adaptive-loop.js PASS" : `tests failed: ${r.stderr || r.stdout || r.error}`,
    };
  }
  const pkg = path.join(root, "package.json");
  if (fs.existsSync(pkg)) {
    try {
      const json = JSON.parse(fs.readFileSync(pkg, "utf8"));
      if (json.scripts?.test) {
        const r = runCmd("npm", ["test", "--silent"], root);
        return {
          gate: "tests",
          ok: r.ok,
          details: r.ok ? "npm test OK" : `npm test failed: ${r.stderr || r.stdout || r.error}`,
        };
      }
    } catch (e) {
      return { gate: "tests", ok: false, details: e.message };
    }
  }
  return { gate: "tests", ok: true, details: "SKIPPED: no test runner — N/A" };
}

function evidenceLint(root) {
  const adaptive = path.join(root, "scripts", "test-adaptive-loop.js");
  // Prefer health check as lint/smoke for orchestra installs
  const health = path.join(root, "bundle", "hooks", "orchestra-health.js");
  if (fs.existsSync(health)) {
    const r = runCmd(process.execPath, [health], root);
    // health prints warnings but exits 0 on pass
    return {
      gate: "lint",
      ok: r.ok,
      details: r.ok ? "orchestra-health.js OK" : `health failed: ${r.stderr || r.stdout || r.error}`,
    };
  }
  if (fs.existsSync(adaptive)) {
    return { gate: "lint", ok: true, details: "SKIPPED: no dedicated linter — deferred to tests/health" };
  }
  return { gate: "lint", ok: true, details: "SKIPPED: no linter" };
}

function evidenceSecurity(root) {
  const scanner = path.join(root, "bundle", "hooks", "lib", "security-scanner.js");
  if (!fs.existsSync(scanner)) {
    return { gate: "security", ok: true, details: "SKIPPED: no security-scanner" };
  }
  try {
    const { scanDirectory, generateSecurityReport } = require(scanner);
    const target = fs.existsSync(path.join(root, "bundle", "hooks", "lib"))
      ? path.join(root, "bundle", "hooks", "lib")
      : root;
    const findings = scanDirectory(target);
    // Ignore self-pattern false positives in security-scanner.js itself
    const secrets = (findings.secrets || []).filter((s) => !/security-scanner\.js$/.test(s.file));
    const vulns = (findings.vulnerabilities || []).filter((v) => !/security-scanner\.js$/.test(v.file));
    const critical = [...secrets, ...vulns].filter((f) => f.severity === "critical" || f.severity === "high");
    return {
      gate: "security",
      ok: critical.length === 0,
      details:
        critical.length === 0
          ? "security scan: no critical/high outside scanner patterns"
          : `security scan FAIL: ${critical.length} critical/high — ${generateSecurityReport({ ...findings, secrets, vulnerabilities: vulns, crypto: findings.crypto || [], summary: findings.summary })}`,
    };
  } catch (e) {
    return { gate: "security", ok: false, details: `scanner error: ${e.message}` };
  }
}

function evidenceGitClean(root) {
  const r = runCmd("git", ["status", "--porcelain"], root);
  if (r.error) return { gate: "docs-updated", ok: true, details: "SKIPPED: not a git repo" };
  // Dirty tree is not a gate failure for docs; just report
  return {
    gate: "git-status",
    ok: true,
    details: r.stdout ? `dirty:\n${r.stdout.split("\n").slice(0, 20).join("\n")}` : "clean",
  };
}

/**
 * Run evidence checks appropriate for the loop mode.
 * @returns {{ results: object[], report: string }}
 */
function runEvidenceChecks(state, options) {
  const root = options?.cwd || detectWorkspaceRoot(state);
  const mode = state?.loopMode || "core";
  const results = [];

  results.push(evidenceBuild(root));
  results.push(evidenceTests(root));
  results.push(evidenceLint(root));

  if (mode === "enterprise" || options?.includeSecurity) {
    results.push(evidenceSecurity(root));
  }

  results.push(evidenceGitClean(root));

  const lines = ["## Evidence checks", `Root: ${root}`, `Mode: ${mode}`, ""];
  for (const r of results) {
    lines.push(`- ${r.ok ? "PASS" : "FAIL"} **${r.gate}**: ${r.details}`);
  }
  return { results, report: lines.join("\n"), root };
}

function requiredGatesForMode(mode) {
  return mode === "enterprise" ? QUALITY_GATES : CORE_REQUIRED_GATES;
}

function applyEvidenceToGates(state, passGate, failGate, skipGate) {
  const { results, report } = runEvidenceChecks(state);
  const mode = state.loopMode || "core";

  for (const r of results) {
    if (r.gate === "git-status") continue;
    if (/^SKIPPED:/.test(r.details) && r.ok) {
      skipGate(state, r.gate, r.details);
    } else if (r.ok) {
      passGate(state, r.gate, r.details);
    } else {
      failGate(state, r.gate, r.details);
    }
  }

  // Skip enterprise-only gates in core mode so allRequiredPassed can clear
  if (mode !== "enterprise") {
    for (const g of QUALITY_GATES) {
      if (!CORE_REQUIRED_GATES.includes(g)) {
        skipGate(state, g, "core loop — enterprise gate N/A");
      }
    }
  } else {
    for (const g of ENTERPRISE_SKIP_DEFAULT) {
      const attempted = new Set([
        ...(state.qualityGates?.passed || []).map((x) => x.id),
        ...(state.qualityGates?.failed || []).map((x) => x.id),
        ...(state.qualityGates?.skipped || []).map((x) => x.id),
      ]);
      if (!attempted.has(g)) skipGate(state, g, "not produced this run — skip");
    }
  }

  return { results, report };
}

module.exports = {
  CORE_REQUIRED_GATES,
  runCmd,
  runEvidenceChecks,
  applyEvidenceToGates,
  requiredGatesForMode,
  evidenceBuild,
  evidenceTests,
  evidenceLint,
  evidenceSecurity,
};
