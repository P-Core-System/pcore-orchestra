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
  "security",
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

/**
 * Labels of the findings that are provably self-matches inside
 * `security-scanner.js` itself.
 *
 * The scanner file is the SOURCE of the rules, so it matches them twice over:
 *   1. it holds the private-key header literals its rules search for, and
 *   2. every rule LABEL carries the very call-site text its rule searches for
 *      (the label of the code-injection rule ends in a parenthesised opening
 *      call, the XSS rule's ends in a document-write call, and so on).
 *
 * The pattern is written from the label SUFFIXES on purpose. Spelling the
 * labels out in full would re-introduce the same literals into THIS file,
 * which would then need its own exclusion — an allowlist that documents the
 * rules it silences must not quote them.
 *
 * Scope: these labels ONLY. A planted secret, a real call site or any other
 * rule in `security-scanner.js` still blocks.
 */
const SELF_SCAN_RULE_LITERAL_LABELS = /\((?:command|code) injection risk\)$|\bXSS risk\)$|^SSH private key$|^RSA private key$|non-crypto purposes\)$/;

/**
 * Findings the scanner is allowed to ignore, each with a written reason.
 *
 * The scanner matches its own rule source (RSA/SSH header literals, the eval /
 * new-Function / exec call sites in its pattern list), so without this
 * allowlist every scan self-reports a critical and the gate could never clear.
 * This replaces the old inline `security-scanner\.js$` filter, which was an
 * undocumented one-liner that also missed the `phase-outcome.js` RegExp-exec
 * false positive.
 *
 * NOTE: the reasons below deliberately spell rule names without their
 * opening parenthesis — writing them literally would make THIS file trip the
 * very rules they justify (and it is not on the allowlist).
 *
 * Scope rule (audit finding B3): EVERY entry carries a rule/label constraint.
 * A file-only entry silences every rule at every severity in that file, which
 * is how a planted GitHub token in `security-scanner.js` stayed invisible.
 * A new exclusion needs a matching false positive that is provable from the
 * finding alone — never a whole directory, never a rule that could mask a
 * real defect elsewhere.
 */
const SELF_SCAN_EXCLUSIONS = [
  {
    id: "scanner-rule-source-literals",
    file: /(^|\/)security-scanner\.js$/,
    label: SELF_SCAN_RULE_LITERAL_LABELS,
    reason:
      "the scanner file is the source of its own rules: it holds the private-key header literals, and each rule label ends with the same call-site text its rule searches for. Narrowed to those labels so a planted secret or a real call site in this file still blocks.",
  },
  {
    id: "regex-exec-not-shell-exec",
    file: /(^|\/)phase-outcome\.js$/,
    label: /^exec\(\) call/,
    reason:
      "a RegExp#exec on a blob is not child_process exec; the rule targets shell exec. Scoped to this one file so a real shell exec anywhere else still blocks.",
  },
];

/** True when `finding` matches a documented self-scan exclusion. */
function isSelfScanExcluded(finding) {
  const file = (finding && finding.file) || "";
  const label = (finding && finding.label) || "";
  return SELF_SCAN_EXCLUSIONS.some(
    (e) => e.file.test(file) && e.label instanceof RegExp && !!label && e.label.test(label)
  );
}

/**
 * Secret scan for the in-loop `security` gate.
 *
 * Scope: the WORKSPACE ROOT — the same tree `scripts/scan-secrets.js` scans in
 * CI (`--dir .`). It used to scan only `bundle/hooks/lib`, so a `ghp_` token in
 * `scripts/` was CI-blocking and loop-silent: invariant 24 ("CI and the core
 * loop can never disagree") was false.
 *
 * Allowlist: `<root>/.secret-scan-allow`, read through the SAME
 * `security-scanner.js` helpers the CLI uses, so the two cannot drift. A
 * reasonless entry is a config error and fails the gate (CI exits 2 on it).
 * Findings inside the allowlist file itself are advisory, never blocking — that
 * file documents patterns, so it quotes them by definition.
 *
 * Two filters apply to every finding: `SELF_SCAN_EXCLUSIONS` (this harness's own
 * rule-source self-matches, each label-scoped) and the allowlist.
 */
function evidenceSecurity(root) {
  const scanner = path.join(root, "bundle", "hooks", "lib", "security-scanner.js");
  if (!fs.existsSync(scanner)) {
    return { gate: "security", ok: true, details: "SKIPPED: no security-scanner" };
  }
  try {
    const { scanDirectory, generateSecurityReport, loadSecretScanAllow, isAllowedFinding, ALLOW_FILE } =
      require(scanner);

    const allow = loadSecretScanAllow(path.join(root, ALLOW_FILE));
    if (allow.error) {
      return {
        gate: "security",
        ok: false,
        details: `allowlist error: ${allow.error} — an undocumented false positive is a rule that quietly rots`,
      };
    }

    const findings = scanDirectory(root);
    const allowAbs = allow.file ? path.resolve(allow.file) : null;
    const isAllowFile = (f) =>
      allowAbs !== null && path.resolve(root, String(f.file || "")) === allowAbs;

    const keep = (list) =>
      (list || []).filter(
        (f) => !isAllowFile(f) && !isSelfScanExcluded(f) && !isAllowedFinding(f, allow.entries)
      );
    const secrets = keep(findings.secrets);
    const vulnerabilities = keep(findings.vulnerabilities);
    const crypto = keep(findings.crypto);
    const owasp = keep(findings.owasp);
    const allowSelfScan = (findings.secrets || [])
      .concat(findings.vulnerabilities || [], findings.crypto || [])
      .filter(isAllowFile).length;

    const summary = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const f of [...secrets, ...vulnerabilities, ...crypto]) {
      if (summary[f.severity] === undefined) continue;
      summary[f.severity] += 1;
    }
    const blocking = [...secrets, ...vulnerabilities, ...crypto].filter(
      (f) => f.severity === "critical" || f.severity === "high"
    );
    const advisory = [...secrets, ...vulnerabilities, ...crypto].filter(
      (f) => f.severity === "medium" || f.severity === "low"
    );
    const allowedNote =
      allow.entries.length > 0
        ? `; ${allow.entries.length} allowlist entr${allow.entries.length === 1 ? "y" : "ies"} applied${allowSelfScan > 0 ? ` (${allowSelfScan} non-blocking self-scan hit(s))` : ""}`
        : "";
    const owaspNote = owasp.length > 0 ? `; ${owasp.length} OWASP category hit(s) advisory` : "";

    if (blocking.length === 0) {
      return {
        gate: "security",
        ok: true,
        details:
          `security scan: PASS — 0 critical/high; ${advisory.length} medium/low finding(s) reported non-blocking${owaspNote}${allowedNote}`,
      };
    }

    const report = generateSecurityReport({
      ...findings,
      secrets,
      vulnerabilities,
      crypto,
      owasp,
      summary,
    });
    return {
      gate: "security",
      ok: false,
      details:
        `security scan FAIL: ${blocking.length} critical/high finding(s) — ${report}` +
        (advisory.length > 0 ? `\n(${advisory.length} medium/low finding(s) reported non-blocking)` : "") +
        allowedNote,
    };
  } catch (e) {
    return { gate: "security", ok: false, details: `scanner error: ${e.message}` };
  }
}

/**
 * Files whose presence in the diff counts as "documentation was updated".
 * Deliberately narrow: source changes are not doc evidence.
 */
const DOC_EVIDENCE_PATTERNS = [
  /progress-tracker\.md$/i,
  /context\/.*\.md$/i,
  /^docs\//i,
  /^README\.md$/i,
];

/** Strip the 3-char porcelain status prefix (and rename arrows) from a line. */
function porcelainPath(line) {
  let p = line.slice(3).trim();
  const arrow = p.lastIndexOf(" -> ");
  if (arrow !== -1) p = p.slice(arrow + 4).trim();
  return p;
}

/**
 * Resolve the diff range for the docs gate.
 * Prefers an explicit merge-base (`<mb>...HEAD`); falls back to the raw
 * three-dot range, then the two-dot range. Returns null when git cannot
 * produce any usable range (caller fails the gate closed).
 * Note: the three-dot range is ASCII `...` — git does not accept U+2026.
 */
function resolveDiffRange(root, base) {
  const mb = runCmd("git", ["merge-base", base, "HEAD"], root);
  if (mb.ok && mb.stdout) {
    return { range: `${mb.stdout}...HEAD`, base, via: "merge-base" };
  }
  const threeDot = runCmd("git", ["diff", "--name-only", `${base}...HEAD`], root);
  if (threeDot.ok) return { range: `${base}...HEAD`, base, via: "three-dot" };
  const twoDot = runCmd("git", ["diff", "--name-only", base, "HEAD"], root);
  if (twoDot.ok) return { range: `${base}..HEAD`, base, via: "two-dot" };
  return null;
}

/**
 * Derive the `docs-updated` verdict from the real git diff (audit S-19).
 *
 * Sources of truth, in order:
 *   1. `git diff --name-only <base>…HEAD` — committed changes since the base
 *   2. `git status --porcelain -uall`     — the current worktree
 *
 * Failure policy — fail closed:
 *   - git present but erroring, or absent while `.git` exists ⇒ FAIL `git-error`
 *   - git entirely absent outside a git workspace ⇒ SKIP with an explicit reason
 * There is no "no summary text ⇒ pass" path left; the old
 * `evidenceGitClean` always returned `ok:true`.
 *
 * @param {string} root workspace root
 * @param {object} [state] orchestrator state; `state.baseCommit` overrides the
 *   diff base (defaults to `HEAD`, i.e. uncommitted worktree changes only)
 */
function evidenceDocsUpdated(root, state) {
  const base = (state && state.baseCommit) || "HEAD";
  const hasGitDir = fs.existsSync(path.join(root, ".git"));

  const version = runCmd("git", ["--version"], root);
  if (version.error) {
    if (hasGitDir) {
      return {
        gate: "docs-updated",
        ok: false,
        reason: "git-error",
        details: `git-error: git binary unavailable (${version.error}) but ${root}/.git exists — docs evidence unverifiable, failing closed`,
        files: [],
      };
    }
    return {
      gate: "docs-updated",
      ok: true,
      reason: "skip-no-git",
      details: `SKIPPED: no git binary and ${root} is not a git workspace — docs-updated not verifiable here`,
      files: [],
    };
  }

  const inWorkTree = runCmd("git", ["rev-parse", "--is-inside-work-tree"], root);
  if (!inWorkTree.ok || inWorkTree.stdout.trim() !== "true") {
    if (hasGitDir) {
      return {
        gate: "docs-updated",
        ok: false,
        reason: "git-error",
        details: `git-error: ${root}/.git exists but git reports this is not a work tree (${inWorkTree.stderr || inWorkTree.stdout || "no output"}) — failing closed`,
        files: [],
      };
    }
    return {
      gate: "docs-updated",
      ok: true,
      reason: "skip-no-git",
      details: `SKIPPED: ${root} is not a git repository — docs-updated not verifiable here`,
      files: [],
    };
  }

  const resolved = resolveDiffRange(root, base);
  if (!resolved) {
    return {
      gate: "docs-updated",
      ok: false,
      reason: "git-error",
      details: `git-error: cannot diff against base ${base} — failing closed`,
      files: [],
    };
  }

  const diff = runCmd("git", ["diff", "--name-only", resolved.range], root);
  if (!diff.ok) {
    return {
      gate: "docs-updated",
      ok: false,
      reason: "git-error",
      details: `git-error: git diff --name-only ${resolved.range} failed (${diff.stderr || diff.error}) — failing closed`,
      files: [],
    };
  }
  const status = runCmd("git", ["status", "--porcelain", "-uall"], root);
  if (!status.ok) {
    return {
      gate: "docs-updated",
      ok: false,
      reason: "git-error",
      details: `git-error: git status --porcelain failed (${status.stderr || status.error}) — failing closed`,
      files: [],
    };
  }

  const committed = diff.stdout ? diff.stdout.split("\n").map((l) => l.trim()).filter(Boolean) : [];
  const dirty = status.stdout ? status.stdout.split("\n").map(porcelainPath).filter(Boolean) : [];
  const changed = [...new Set([...committed, ...dirty])];
  const docFiles = changed.filter((f) => DOC_EVIDENCE_PATTERNS.some((re) => re.test(f)));

  if (docFiles.length > 0) {
    return {
      gate: "docs-updated",
      ok: true,
      reason: "docs-touched",
      details: `docs evidence from git (base ${base} via ${resolved.via}): ${docFiles.slice(0, 10).join(", ")}`,
      files: docFiles,
      changedCount: changed.length,
    };
  }

  return {
    gate: "docs-updated",
    ok: false,
    reason: "no-doc-changes",
    details: `no documentation changed (base ${base} via ${resolved.via}; ${changed.length} file(s) changed, none matching progress-tracker.md / context/*.md / docs/ / README.md) — update docs and commit`,
    files: [],
    changedCount: changed.length,
  };
}

function evidenceGitClean(root) {
  const r = runCmd("git", ["status", "--porcelain"], root);
  // Dirty tree is not a gate failure for docs; just report. The docs-updated
  // verdict is owned by evidenceDocsUpdated (fail-closed, diff-derived).
  if (r.error) {
    return { gate: "git-status", ok: true, details: "git unavailable in this workspace" };
  }
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
  // Security runs in EVERY mode, not just enterprise: a critical secret in the
  // workspace must block the core loop too.
  results.push(evidenceSecurity(root));

  results.push(evidenceGitClean(root));
  results.push(evidenceDocsUpdated(root, state));

  const lines = ["## Evidence checks", `Root: ${root}`, `Mode: ${mode}`, ""];
  for (const r of results) {
    lines.push(`- ${r.ok ? "PASS" : "FAIL"} **${r.gate}**: ${r.details}`);
  }
  return { results, report: lines.join("\n"), root };
}

function requiredGatesForMode(mode) {
  return mode === "enterprise" ? QUALITY_GATES : CORE_REQUIRED_GATES;
}

function applyEvidenceToGates(state, passGate, failGate, skipGate, options) {
  const opts = options || {};
  const { results, report } = runEvidenceChecks(state, opts);
  const mode = state && state.loopMode || "core";
  const records = [];

  for (const r of results) {
    const rec = {
      gate: r.gate,
      ok: !!r.ok,
      details: r.details,
      exitCode: r.exitCode === undefined ? (r.status === undefined ? null : r.status) : r.exitCode,
    };
    records.push(rec);
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
        ...(state && state.qualityGates && state.qualityGates.passed || []).map((x) => x.id),
        ...(state && state.qualityGates && state.qualityGates.failed || []).map((x) => x.id),
        ...(state && state.qualityGates && state.qualityGates.skipped || []).map((x) => x.id),
      ]);
      if (!attempted.has(g)) skipGate(state, g, "not produced this run — skip");
    }
  }

  try {
    if (typeof opts.onEvidence === "function") {
      opts.onEvidence({ runId: state && state.runId ? state.runId : null, records });
    }
  } catch (e) {
    // fail-open
  }

  return { results, report, records };
}

module.exports = {
  CORE_REQUIRED_GATES,
  DOC_EVIDENCE_PATTERNS,
  SELF_SCAN_EXCLUSIONS,
  isSelfScanExcluded,
  runCmd,
  runEvidenceChecks,
  applyEvidenceToGates,
  requiredGatesForMode,
  evidenceBuild,
  evidenceTests,
  evidenceLint,
  evidenceSecurity,
  evidenceDocsUpdated,
};
