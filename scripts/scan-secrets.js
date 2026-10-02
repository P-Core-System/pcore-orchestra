#!/usr/bin/env node
"use strict";

/**
 * Blocking secret scan for CI (audit S-20: "CI has no secret-scan/SAST;
 * shellcheck non-blocking").
 *
 * Thin CLI wrapper over `bundle/hooks/lib/security-scanner.js` — the SAME
 * scanner the in-loop security gate uses (`evidence-runner.js`), so CI and the
 * core loop can never disagree about what counts as a leaked secret.
 *
 * Usage:
 *   node scripts/scan-secrets.js [--dir <path>] [--json] [--fail-on=<level>]
 *                                 [--allow <file>]
 *
 *   --dir <path>       tree to scan (default: cwd)
 *   --json             machine-readable JSON on stdout (nothing else printed)
 *   --fail-on=<level>  blocking severity: critical | high | medium | low | never
 *                      (default: high)
 *   --allow <file>     allowlist (default: <dir>/.secret-scan-allow)
 *
 * Exit codes:
 *   0  no finding at or above --fail-on
 *   1  at least one finding at or above --fail-on
 *   2  usage error, missing directory, or an undocumented allowlist entry
 *
 * Findings inside the allowlist itself are reported under a separate
 * "allowlist self-scan" section and never block: the file is documentation
 * about patterns, so it quotes them by definition.
 *
 * `.secret-scan-allow` — one entry per line: `<pattern> | <reason>`. The
 * pattern matches (case-insensitively) against the finding's file path or its
 * label; `#` starts a comment. A line without a reason is a hard error (exit
 * 2): a false positive that nobody documented is a rule that quietly rots.
 */

const fs = require("node:fs");
const path = require("node:path");

const scanner = require(path.join(__dirname, "..", "bundle", "hooks", "lib", "security-scanner.js"));

const SEVERITY_RANK = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1 });
const LEVELS = Object.keys(SEVERITY_RANK);
const DEFAULT_FAIL_ON = "high";
const ALLOW_FILE = ".secret-scan-allow";

function usage() {
  return [
    "Usage: node scripts/scan-secrets.js [--dir <path>] [--json] [--fail-on=<level>] [--allow <file>]",
    "",
    `  --dir <path>       tree to scan (default: current directory)`,
    "  --json             machine-readable JSON on stdout",
    `  --fail-on=<level>  critical | high | medium | low | never (default: ${DEFAULT_FAIL_ON})`,
    `  --allow <file>     allowlist (default: <dir>/${ALLOW_FILE})`,
  ].join("\n");
}

/** @returns {{opts:object, error:string|null}} */
function parseArgs(argv) {
  const opts = { dir: process.cwd(), json: false, failOn: DEFAULT_FAIL_ON, allow: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") opts.json = true;
    else if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg.startsWith("--dir=")) opts.dir = arg.slice("--dir=".length);
    else if (arg === "--dir") opts.dir = argv[++i];
    else if (arg.startsWith("--fail-on=")) opts.failOn = arg.slice("--fail-on=".length);
    else if (arg === "--fail-on") opts.failOn = argv[++i];
    else if (arg.startsWith("--allow=")) opts.allow = arg.slice("--allow=".length);
    else if (arg === "--allow") opts.allow = argv[++i];
    else return { opts, error: `Unknown argument: ${arg}` };
  }
  if (!opts.dir) return { opts, error: "--dir requires a path" };
  if (opts.failOn !== "never" && !LEVELS.includes(opts.failOn)) {
    return { opts, error: `--fail-on must be one of ${LEVELS.join(" | ")} | never (got "${opts.failOn}")` };
  }
  return { opts, error: null };
}

/**
 * Read the allowlist. Every entry must carry a reason.
 * @returns {{entries:{pattern:string, reason:string}[], error:string|null, file:string|null}}
 */
function loadAllow(allowPath) {
  if (!allowPath || !fs.existsSync(allowPath)) return { entries: [], error: null, file: allowPath || null };
  let raw;
  try {
    raw = fs.readFileSync(allowPath, "utf8");
  } catch (err) {
    return { entries: [], error: `${allowPath}: ${err.message}`, file: allowPath };
  }
  const entries = [];
  raw.split("\n").forEach((line, idx) => {
    const withoutComment = line.split("#")[0].trim();
    if (withoutComment.length === 0) return;
    const sep = withoutComment.indexOf("|");
    const pattern = (sep === -1 ? withoutComment : withoutComment.slice(0, sep)).trim();
    const reason = (sep === -1 ? "" : withoutComment.slice(sep + 1)).trim();
    if (pattern.length === 0) return;
    if (reason.length === 0) {
      entries.push({ pattern, reason: "", file: allowPath, line: idx + 1 });
      return;
    }
    entries.push({ pattern, reason, file: allowPath, line: idx + 1 });
  });
  const undocumented = entries.find((e) => e.reason.length === 0);
  if (undocumented) {
    return {
      entries,
      error: `${allowPath}:${undocumented.line} — allow entry "${undocumented.pattern}" needs a reason (\`pattern | why it is safe\`)`,
      file: allowPath,
    };
  }
  return { entries, error: null, file: allowPath };
}

function normalizePath(p) {
  return String(p || "").split(path.sep).join("/");
}

/** Does an allowlist entry cover this finding (by file path or by label)? */
function isAllowed(finding, entries) {
  const file = normalizePath(finding.file).toLowerCase();
  const label = String(finding.label || "").toLowerCase();
  return entries.some((entry) => {
    const pattern = entry.pattern.toLowerCase();
    return file.includes(pattern) || label.includes(pattern);
  });
}

/**
 * Synchronous stdout write. `process.stdout.write` on a pipe is async, so the
 * following `process.exit()` truncated large reports mid-JSON.
 */
function writeOut(text) {
  fs.writeSync(1, text);
}

function rankOf(severity) {
  return SEVERITY_RANK[severity] || 0;
}

function tally(findings) {
  const summary = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    if (summary[f.severity] === undefined) summary[f.severity] = 0;
    summary[f.severity] += 1;
  }
  return summary;
}

function main(argv) {
  const { opts, error } = parseArgs(argv);
  if (opts.help) {
    writeOut(`${usage()}\n`);
    return 0;
  }
  if (error) {
    process.stderr.write(`scan-secrets: ${error}\n${usage()}\n`);
    return 2;
  }
  const dir = path.resolve(opts.dir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    process.stderr.write(`scan-secrets: --dir is not a directory: ${dir}\n`);
    return 2;
  }

  const allowPath = opts.allow ? path.resolve(opts.allow) : path.join(dir, ALLOW_FILE);
  const allow = loadAllow(allowPath);
  if (allow.error) {
    process.stderr.write(`scan-secrets: ${allow.error}\n`);
    return 2;
  }

  const allowFileAbs = allow.file ? path.resolve(allow.file) : null;
  const isAllowFile = (f) => allowFileAbs !== null && path.resolve(dir, normalizePath(f.file)) === allowFileAbs;

  const scanned = scanner.scanDirectory(dir);
  const all = [...scanned.secrets, ...scanned.vulnerabilities, ...scanned.crypto];
  const selfScan = all.filter(isAllowFile);
  const allowed = all.filter((f) => !isAllowFile(f) && isAllowed(f, allow.entries));
  const findings = all.filter((f) => !isAllowFile(f) && !isAllowed(f, allow.entries));
  const summary = tally(findings);
  const threshold = opts.failOn === "never" ? 99 : rankOf(opts.failOn);
  const blocking = findings.filter((f) => rankOf(f.severity) >= threshold);
  const exitCode = blocking.length > 0 ? 1 : 0;

  if (opts.json) {
    writeOut(
      `${JSON.stringify(
        {
          dir,
          failOn: opts.failOn,
          allowFile: allow.file,
          summary,
          exitCode,
          findings,
          allowed: allowed.map((f) => ({ severity: f.severity, label: f.label, file: f.file, line: f.line })),
          allowlistSelfScan: selfScan.map((f) => ({ severity: f.severity, label: f.label, file: f.file, line: f.line })),
          owasp: (scanned.owasp || []).length,
        },
        null,
        2
      )}\n`
    );
    return exitCode;
  }

  const report = scanner.generateSecurityReport({
    secrets: findings.filter((f) => f.type === "secret"),
    vulnerabilities: findings.filter((f) => f.type === "vulnerability"),
    crypto: findings.filter((f) => f.type === "crypto"),
    owasp: scanned.owasp || [],
    summary,
  });
  const lines = [report, "", `**Blocking threshold:** ${opts.failOn} (exit ${exitCode})`];
  if (allow.entries.length > 0) {
    lines.push("", `## Allowed findings (${allowed.length}) — documented in ${normalizePath(path.relative(process.cwd(), allow.file) || allow.file)}`);
    for (const f of allowed) lines.push(`- [${f.severity}] ${f.label} in ${f.file}:${f.line}`);
  }
  if (selfScan.length > 0) {
    lines.push("", `## Allowlist self-scan (${selfScan.length}) — non-blocking: the allowlist quotes the patterns it documents`);
    for (const f of selfScan) lines.push(`- [${f.severity}] ${f.label} in ${f.file}:${f.line}`);
  }
  writeOut(`${lines.join("\n")}\n`);
  return exitCode;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { parseArgs, loadAllow, isAllowed, tally, rankOf, main, SEVERITY_RANK, ALLOW_FILE };