"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { QUALITY_GATES } = require("./constants.js");
const { EXCERPT_MAX, DETAILS_MAX, buildEvidenceRecord, clampDetails } = require("./evidence-record.js");

const CORE_REQUIRED_GATES = [
  "build",
  "tests",
  "lint",
  "security",
  "reviewer-approval",
  "docs-updated",
  "memory-updated",
  "production-checklist",
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
  const startedAt = new Date().toISOString();
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
    // Provenance: the persisted evidence record must name what was run
    // (invariant 21), so the command travels with the result.
    command,
    args: Array.isArray(args) ? args.slice() : [],
    startedAt,
    stdout,
    stderr,
    stdoutExcerpt: truncate(stdout),
    stderrExcerpt: truncate(stderr),
    error: r.error ? r.error.message : null,
    durationMs,
  };
}

/**
 * The result shape every evidence verdict shares, so `buildEvidenceRecord` can
 * emit the documented record (invariant 21) from any of them.
 *
 * `r` is the `runCmd` result that produced the verdict, or null when the verdict
 * came from no single command (a SKIP, or a verdict derived from git OUTPUT —
 * `git diff` exiting 0 does not mean the docs gate passed).
 */
function verdictFields(gate, ok, details, r) {
  return {
    gate,
    ok: !!ok,
    details: clampDetails(details),
    command: (r && r.command) || null,
    args: r && Array.isArray(r.args) ? r.args.slice() : [],
    exitCode: r && r.exitCode !== undefined ? r.exitCode : null,
    durationMs: r && typeof r.durationMs === "number" && r.durationMs >= 0 ? r.durationMs : 0,
    startedAt: (r && r.startedAt) || new Date().toISOString(),
    stdout: (r && r.stdout) || "",
    stderr: (r && r.stderr) || "",
  };
}

/** A verdict whose ok/fail IS the command's exit status (build, tests, lint). */
function ran(gate, r, details) {
  return verdictFields(gate, r && r.ok, details, r);
}

/** A verdict derived from a command's OUTPUT — the gate decides, not the exit code. */
function derived(gate, r, ok, details) {
  return verdictFields(gate, ok, details, r);
}

/**
 * An evidence verdict produced WITHOUT a command (a SKIP, or a pure-logic
 * verdict). `command`/`args` stay null/empty — the record must not claim a
 * command that never ran.
 */
function verdict(gate, ok, details) {
  return verdictFields(gate, ok, details, null);
}

function detectWorkspaceRoot(state) {
  if (state?.worktreePath) {
    return state.worktreePath;
  }
  if (state?.project?.identityFile) {
    return path.dirname(state.project.identityFile);
  }
  return process.cwd();
}

/** Full sha of `HEAD`, or null (no repo, no commits yet, or git unusable). */
function currentHeadCommit(root) {
  const r = runCmd("git", ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], root);
  if (!r.ok) return null;
  const sha = r.stdout.trim();
  return /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
}

/**
 * Record the commit this run starts from as its diff base.
 *
 * WHY (review B5): the docs-updated gate used to default its base to `"HEAD"`,
 * so `merge-base HEAD HEAD` produced the EMPTY range `HEAD...HEAD` and the
 * only source of changed files left was the UNCOMMITTED worktree. Nothing in
 * production wrote `state.baseCommit`, so an implementer who COMMITTED their
 * docs — what `orchestra-subagent-stop` explicitly instructs — was blocked at
 * verify AND review. The gate's own parameter default failed closed on success.
 *
 * Recording the base at RUN START (not at gate time) is what makes the gate
 * work for a committed docs change, and it is also what Phase 5 worktrees need:
 * `detectWorkspaceRoot` resolves a per-PROJECT root, so two worktree runs would
 * otherwise gate against the same tree. Persisted on the session as
 * `state.diffBase` (stamp + run id for auditability); `evidenceDocsUpdated`
 * consumes it.
 *
 * Best-effort by construction: returns null and leaves `state.diffBase` unset
 * outside a git workspace, and the caller wraps the call in try/catch
 * (invariant 19) so a run can never fail to start because of this.
 *
 * @param {object} state session state (mutated with `state.diffBase`)
 * @param {string} [root] workspace root; defaults to `detectWorkspaceRoot(state)`
 * @returns {{commit:string, root:string, at:string, runId:string|null, by:string}|null}
 */
function recordRunDiffBase(state, root) {
  if (!state || typeof state !== "object") return null;
  const resolvedRoot = root || detectWorkspaceRoot(state);
  const commit = currentHeadCommit(resolvedRoot);
  if (!commit) return null;
  state.diffBase = {
    commit,
    root: path.resolve(resolvedRoot),
    at: new Date().toISOString(),
    runId: (state.tokens && state.tokens.run_id) || null,
    by: "run-start",
  };
  return state.diffBase;
}

function evidenceBuild(root) {
  const pkg = path.join(root, "package.json");
  if (fs.existsSync(pkg)) {
    try {
      const json = JSON.parse(fs.readFileSync(pkg, "utf8"));
      if (json.scripts?.build) {
        const r = runCmd("npm", ["run", "build", "--silent"], root);
        return ran("build", r, r.ok ? "npm run build OK" : `npm run build failed: ${r.stderr || r.stdout || r.error}`);
      }
    } catch (e) {
      return verdict("build", false, `package.json parse error: ${e.message}`);
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
        return ran("build", r, `node --check failed: ${path.relative(root, f)} ${r.stderr || r.error}`);
      }
    }
    return verdict("build", true, `node --check OK (${Math.min(files.length, 40)} hook files)`);
  }

  return verdict("build", true, "SKIPPED: no build script or bundle/hooks — treated as N/A pass");
}

function evidenceTests(root) {
  const adaptive = path.join(root, "scripts", "test-adaptive-loop.js");
  if (fs.existsSync(adaptive)) {
    const r = runCmd(process.execPath, [adaptive], root);
    return ran("tests", r, r.ok ? "test-adaptive-loop.js PASS" : `tests failed: ${r.stderr || r.stdout || r.error}`);
  }
  const pkg = path.join(root, "package.json");
  if (fs.existsSync(pkg)) {
    try {
      const json = JSON.parse(fs.readFileSync(pkg, "utf8"));
      if (json.scripts?.test) {
        const r = runCmd("npm", ["test", "--silent"], root);
        return ran("tests", r, r.ok ? "npm test OK" : `npm test failed: ${r.stderr || r.stdout || r.error}`);
      }
    } catch (e) {
      return verdict("tests", false, e.message);
    }
  }
  return verdict("tests", true, "SKIPPED: no test runner — N/A");
}

function evidenceLint(root) {
  const adaptive = path.join(root, "scripts", "test-adaptive-loop.js");
  // Prefer health check as lint/smoke for orchestra installs
  const health = path.join(root, "bundle", "hooks", "orchestra-health.js");
  if (fs.existsSync(health)) {
    const r = runCmd(process.execPath, [health], root);
    // health prints warnings but exits 0 on pass
    return ran("lint", r, r.ok ? "orchestra-health.js OK" : `health failed: ${r.stderr || r.stdout || r.error}`);
  }
  if (fs.existsSync(adaptive)) {
    return verdict("lint", true, "SKIPPED: no dedicated linter — deferred to tests/health");
  }
  return verdict("lint", true, "SKIPPED: no linter");
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
    return verdict("security", true, "SKIPPED: no security-scanner");
  }
  try {
    const { scanDirectory, generateSecurityReport, loadSecretScanAllow, isAllowedFinding, ALLOW_FILE } =
      require(scanner);

    const allow = loadSecretScanAllow(path.join(root, ALLOW_FILE));
    if (allow.error) {
      return verdict(
        "security",
        false,
        `allowlist error: ${allow.error} — an undocumented false positive is a rule that quietly rots`
      );
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
      return verdict(
        "security",
        true,
        `security scan: PASS — 0 critical/high; ${advisory.length} medium/low finding(s) reported non-blocking${owaspNote}${allowedNote}`
      );
    }

    const report = generateSecurityReport({
      ...findings,
      secrets,
      vulnerabilities,
      crypto,
      owasp,
      summary,
    });
    return verdict(
      "security",
      false,
      `security scan FAIL: ${blocking.length} critical/high finding(s) — ${report}` +
        (advisory.length > 0 ? `\n(${advisory.length} medium/low finding(s) reported non-blocking)` : "") +
        allowedNote
    );
  } catch (e) {
    return verdict("security", false, `scanner error: ${e.message}`);
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
 * The diff base for the docs gate, in precedence order:
 *   1. `state.baseCommit`        — explicit caller contract. Unresolvable ⇒ the
 *      caller FAILS closed with `git-error`: a base the caller named and git
 *      cannot resolve is a config error, not drift.
 *   2. `state.diffBase.commit`   — recorded when the run started (review B5).
 *   3. `"HEAD"`                  — nothing recorded (legacy session state, or a
 *      workspace that is not a git repo at all).
 * @returns {{base:string, via:string, explicit:boolean}}
 */
function resolveDocsBase(state) {
  const explicit = state && typeof state.baseCommit === "string" ? state.baseCommit.trim() : "";
  if (explicit) return { base: explicit, via: "state.baseCommit", explicit: true };
  const recorded = state && state.diffBase && typeof state.diffBase.commit === "string"
    ? state.diffBase.commit.trim()
    : "";
  if (/^[0-9a-f]{7,40}$/i.test(recorded)) return { base: recorded, via: "run-start", explicit: false };
  return { base: "HEAD", via: "default", explicit: false };
}

/**
 * Files changed by the LAST commit (`HEAD~1..HEAD`), or null when there is no
 * parent commit (a single-commit repo) or the range is unusable.
 *
 * This is the fallback for a session that never recorded a run base: with base
 * `HEAD` the committed range is empty BY CONSTRUCTION, so an implementer who
 * committed their docs would otherwise always be blocked. Never turns a git
 * failure into a verdict — a null return just means "no last-commit evidence".
 */function lastCommitDiff(root) {
  const parent = runCmd("git", ["rev-parse", "--verify", "--quiet", "HEAD~1^{commit}"], root);
  if (!parent.ok || !parent.stdout.trim()) return null;
  const base = parent.stdout.trim();
  const diff = runCmd("git", ["diff", "--name-only", `${base}..HEAD`], root);
  if (!diff.ok) return null; // the primary range already proved git works here
  return { range: `${base}..HEAD`, base, via: "last-commit", names: diff.stdout };
}

/**
 * Derive the `docs-updated` verdict from the real git diff (audit S-19).
 *
 * Sources of truth, in order:
 *   1. `git diff --name-only <base>…HEAD` — committed changes since the base,
 *      where `base` is `state.baseCommit`, else the run-start `state.diffBase`,
 *      else `HEAD` plus the last commit (`HEAD~1..HEAD`)
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
 *   diff base, `state.diffBase` is the per-run base recorded at run start
 */
function evidenceDocsUpdated(root, state) {
  const chosen = resolveDocsBase(state);
  const hasGitDir = fs.existsSync(path.join(root, ".git"));

  const version = runCmd("git", ["--version"], root);
  if (version.error) {
    if (hasGitDir) {
      return Object.assign(verdict("docs-updated", false, `git-error: git binary unavailable (${version.error}) but ${root}/.git exists — docs evidence unverifiable, failing closed`), {
        reason: "git-error",
        files: [],
      });
    }
    return Object.assign(verdict("docs-updated", true, `SKIPPED: no git binary and ${root} is not a git workspace — docs-updated not verifiable here`), {
      reason: "skip-no-git",
      files: [],
    });
  }

  const inWorkTree = runCmd("git", ["rev-parse", "--is-inside-work-tree"], root);
  if (!inWorkTree.ok || inWorkTree.stdout.trim() !== "true") {
    if (hasGitDir) {
      return Object.assign(verdict("docs-updated", false, `git-error: ${root}/.git exists but git reports this is not a work tree (${inWorkTree.stderr || inWorkTree.stdout || "no output"}) — failing closed`), {
        reason: "git-error",
        files: [],
      });
    }
    return Object.assign(verdict("docs-updated", true, `SKIPPED: ${root} is not a git repository — docs-updated not verifiable here`), {
      reason: "skip-no-git",
      files: [],
    });
  }

  let resolved = resolveDiffRange(root, chosen.base);
  let baseNote = `${chosen.base} via ${chosen.via}`;
  if (!resolved && !chosen.explicit) {
    // A run base recorded in another tree (Phase 5 worktrees, a rebased branch)
    // is session drift, not a git failure: re-derive from HEAD instead of
    // blocking the run on a stale sha. An EXPLICIT base still fails closed below.
    resolved = resolveDiffRange(root, "HEAD");
    baseNote = `${chosen.base} via ${chosen.via} (not resolvable here) → HEAD`;
  }
  if (!resolved) {
    return Object.assign(verdict("docs-updated", false, `git-error: cannot diff against base ${chosen.base} — failing closed`), {
      reason: "git-error",
      files: [],
    });
  }

  const status = runCmd("git", ["status", "--porcelain", "-uall"], root);
  if (!status.ok) {
    return Object.assign(verdict("docs-updated", false, `git-error: git status --porcelain failed (${status.stderr || status.error}) — failing closed`), {
      reason: "git-error",
      files: [],
    });
  }

  const committed = [];
  const sources = [resolved.via];
  // A session with no recorded run base gates against HEAD, whose committed
  // range is empty BY CONSTRUCTION, so the only committed evidence it has is
  // the last commit. Reading it is what lets an implementer who COMMITTED their
  // docs go green (review B5) — the alternative is a gate that can never clear
  // for any committed run. Not conditioned on a clean worktree on purpose: the
  // harness's own state file, an editor temp file or a stale artifact would
  // otherwise disable it and re-block the run. A session that DID record a run
  // base never reaches this branch, so a real run never borrows the previous
  // commit's docs as its own evidence.
  if (chosen.via === "default") {
    const last = lastCommitDiff(root);
    if (last) {
      committed.push(...(last.names || "").split("\n").map((l) => l.trim()).filter(Boolean));
      sources.push(`${last.via} ${last.base.slice(0, 12)}`);
    }
  }

  const primary = runCmd("git", ["diff", "--name-only", resolved.range], root);
  if (!primary.ok) {
    return Object.assign(derived("docs-updated", primary, false, `git-error: git diff --name-only ${resolved.range} failed (${primary.stderr || primary.error}) — failing closed`), {
      reason: "git-error",
      files: [],
    });
  }
  committed.push(...primary.stdout.split("\n").map((l) => l.trim()).filter(Boolean));

  const dirty = status.stdout ? status.stdout.split("\n").map(porcelainPath).filter(Boolean) : [];
  const changed = [...new Set([...committed, ...dirty])];
  const docFiles = changed.filter((f) => DOC_EVIDENCE_PATTERNS.some((re) => re.test(f)));
  const label = `${baseNote}${sources.length > 1 ? " + " + sources.slice(1).join(" + ") : ""}`;

  if (docFiles.length > 0) {
    return Object.assign(derived("docs-updated", primary, true, `docs evidence from git (base ${label}): ${docFiles.slice(0, 10).join(", ")}`), {
      reason: "docs-touched",
      files: docFiles,
      changedCount: changed.length,
    });
  }

  return Object.assign(derived("docs-updated", primary, false, `no documentation changed (base ${label}; ${changed.length} file(s) changed, none matching progress-tracker.md / context/*.md / docs/ / README.md) — update docs and commit`), {
    reason: "no-doc-changes",
    files: [],
    changedCount: changed.length,
  });
}

function evidenceGitClean(root) {
  const r = runCmd("git", ["status", "--porcelain"], root);
  // Dirty tree is not a gate failure for docs; just report. The docs-updated
  // verdict is owned by evidenceDocsUpdated (fail-closed, diff-derived).
  if (r.error) {
    return verdict("git-status", true, "git unavailable in this workspace");
  }
  // `derived`, not `ran`: a non-zero exit (not a git repository) is reported,
  // never turned into a FAIL verdict — git-status is advisory and is skipped
  // when the gates are applied.
  return derived(
    "git-status",
    r,
    true,
    r.stdout ? `dirty:\n${r.stdout.split("\n").slice(0, 20).join("\n")}` : "clean"
  );
}

/**
 * Run evidence checks appropriate for the loop mode.
 *
 * `options.includeSecurity === false` SKIPS the workspace scan. The verify hook
 * (`orchestra-subagent-stop.js`) asks for that: it has already run the scan for
 * the verify preflight report, and paying ~1.1s again for the same unscoped
 * walk on every verify bought nothing. The review hook passes no such option, so
 * the security gate is still decided there before `ORCHESTRA_COMPLETE`.
 *
 * @returns {{ results: object[], report: string }}
 */
function runEvidenceChecks(state, options) {
  const opts = options || {};
  const root = opts.cwd || detectWorkspaceRoot(state);
  const mode = state?.loopMode || "core";
  const results = [];

  results.push(evidenceBuild(root));
  results.push(evidenceTests(root));
  results.push(evidenceLint(root));
  // Security runs in EVERY mode, not just enterprise: a critical secret in the
  // workspace must block the core loop too.
  if (opts.includeSecurity !== false) results.push(evidenceSecurity(root));

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
    // The persisted record is built by `buildEvidenceRecord` — the builder
    // invariant 21 documents — so the live shape and the documented shape
    // cannot drift again (review B6). `details` was already clamped at the
    // source by ran()/verdict(); clamped again here so ANY future result that
    // skips those helpers still cannot persist an unbounded string.
    const rec = buildEvidenceRecord({
      gate: r.gate,
      command: r.command,
      args: r.args,
      exitCode: r.exitCode,
      durationMs: r.durationMs,
      ok: r.ok,
      stdout: r.stdout,
      stderr: r.stderr,
      startedAt: r.startedAt,
    });
    rec.details = clampDetails(r.details);
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
  DETAILS_MAX,
  ran,
  derived,
  verdict,
  verdictFields,
  recordRunDiffBase,
  resolveDocsBase,
  detectWorkspaceRoot,
};
