#!/usr/bin/env node
"use strict";

/**
 * Suite for the security scanner + its evidence gate.
 *
 * Focus (audit S-13 + the security-gate scope widening):
 *   - unquoted `KEY=value` secrets in dotenv/shell files are detected
 *   - extensionless files (Dockerfile) and `.sh`/`.md`/`.toml`/`.ini`/`.conf`
 *     are scanned at all
 *   - dot-directories (`.github/...`) are walked; `.git`/`node_modules` are not
 *   - `checkOwaspTop10` is actually called (it was dead code)
 *   - finding excerpts are redacted, never raw secret material
 *   - `evidenceSecurity` runs in the CORE loop and only blocks on critical/high
 *
 * All fixtures live in os.tmpdir() and are removed afterwards.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const SCANNER = path.join(ROOT, "bundle/hooks/lib/security-scanner.js");
const RUNNER = path.join(ROOT, "bundle/hooks/lib/evidence-runner.js");
const CLI = path.join(ROOT, "scripts/scan-secrets.js");

let failures = 0;
let asserts = 0;
const tmpDirs = [];

function test(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (e) {
    failures++;
    console.error("FAIL", name, e && e.message);
  }
}

function ok(cond, msg) {
  asserts++;
  assert.ok(cond, msg);
}

function eq(a, b, msg) {
  asserts++;
  assert.strictEqual(a, b, msg);
}

/** Create a throwaway directory tree from a {relPath: body} map. */
function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestra-sec-"));
  tmpDirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}

process.on("exit", () => {
  for (const d of tmpDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

const scanner = require(SCANNER);
const runner = require(RUNNER);

// --------------------------------------------------------------- dotenv rules

test("unquoted PASSWORD=hunter2 in a .env file reports critical", () => {
  const dir = fixture({ ".env": "DB_USER=app\nPASSWORD=hunter2\nDEBUG=false\n" });
  const r = scanner.scanDirectory(dir);
  const hit = r.secrets.filter((s) => /\.env$/.test(s.file));
  ok(hit.length >= 1, "expected a secret finding in .env");
  eq(hit[0].severity, "critical", `expected critical, got ${hit[0].severity}`);
  ok(/unquoted/i.test(hit[0].label), `expected an unquoted-value rule label, got "${hit[0].label}"`);
  eq(r.summary.critical >= 1, true, "summary must count the critical secret");
});

test("unquoted secret rules fire in .sh/.yaml and on API_KEY / TOKEN / SECRET keys", () => {
  const dir = fixture({
    "deploy.sh": "#!/bin/sh\nexport STRIPE_SECRET_KEY=sk_live_51H8xQ2Kz9\n",
    "config.yaml": "token = AKIA1234567890ABCDEF\n",
    "app.ini": "[creds]\npassword = correct-horse\n",
  });
  const r = scanner.scanDirectory(dir);
  const files = new Set(r.secrets.filter((s) => s.severity === "critical").map((s) => s.file));
  for (const f of ["deploy.sh", "config.yaml", "app.ini"]) {
    ok(files.has(f), `expected a critical secret in ${f}, got ${[...files].join(", ") || "none"}`);
  }
});

test("placeholder values are not reported as secrets", () => {
  const dir = fixture({
    ".env": "PASSWORD=changeme\nAPI_KEY=your-api-key-here\nSECRET=\nTOKEN=xxx\n",
  });
  const r = scanner.scanDirectory(dir);
  eq(r.secrets.length, 0, `placeholders must not trip the scanner: ${JSON.stringify(r.secrets.map((s) => s.match))}`);
});

// -------------------------------------------------------------- file coverage

test("extensionless files (Dockerfile) are scanned", () => {
  const dir = fixture({ Dockerfile: "FROM node:20\nRUN eval('ls -la')\n" });
  const r = scanner.scanDirectory(dir);
  ok(
    r.vulnerabilities.some((v) => v.file === "Dockerfile"),
    `Dockerfile must be scanned, findings: ${JSON.stringify(r.vulnerabilities.map((v) => v.file))}`
  );
});

test(".sh/.md/.toml/.conf files are scanned", () => {
  const dir = fixture({
    "install.sh": 'export DB_PASSWORD="hunter2xyz"\n',
    "notes.md": "API_KEY=abcdef0123456789\n",
    "config.toml": 'api_key = "sk-abcdefghijklmnopqrst"\n',
    "app.conf": 'password = "hunter2xyz123"\n',
  });
  const r = scanner.scanDirectory(dir);
  const files = new Set(r.secrets.map((v) => v.file));
  for (const f of ["install.sh", "notes.md", "config.toml", "app.conf"]) {
    ok(files.has(f), `${f} must be scanned`);
  }
});

test("dot-directories are walked (.github/workflows/ci.yml)", () => {
  const dir = fixture({
    ".github/workflows/ci.yml": "jobs:\n  x:\n    steps:\n      - run: deploy.sh\n        env:\n          PASSWORD=hunter2xyz123\n",
  });
  const r = scanner.scanDirectory(dir);
  ok(
    r.secrets.some((v) => /^\.github\/workflows\/ci\.yml$/.test(v.file)),
    `.github must be walked, findings: ${JSON.stringify(r.vulnerabilities.map((v) => v.file))}`
  );
});

test(".git and node_modules are never walked", () => {
  const dir = fixture({
    ".git/config": "eval('leak')\n",
    "node_modules/pkg/index.js": "eval('leak')\n",
  });
  const r = scanner.scanDirectory(dir);
  eq(r.vulnerabilities.length, 0, `vendor/VCS trees must be skipped: ${JSON.stringify(r.vulnerabilities)}`);
});

// ------------------------------------------------------------ owasp + redaction

test("checkOwaspTop10 has at least one caller (was dead code)", () => {
  const src = fs.readFileSync(SCANNER, "utf8");
  const callers = (src.match(/checkOwaspTop10\s*\(/g) || []).length;
  // 1 = the function definition itself; anything above that is a real call.
  ok(callers >= 2, `checkOwaspTop10 must be called from the scanner (found ${callers} references)`);
});

test("OWASP results are surfaced by scanDirectory and the report", () => {
  const dir = fixture({ "vuln.js": "const q = 'SELECT * FROM t WHERE id=' + id;\n" });
  const r = scanner.scanDirectory(dir);
  ok(Array.isArray(r.owasp), "findings.owasp must be an array");
  ok(r.owasp.length >= 1, `expected an OWASP category finding, got ${JSON.stringify(r.owasp)}`);
  ok(
    r.owasp.some((o) => /A3|Injection/.test(o.category)),
    `expected an injection category, got ${JSON.stringify(r.owasp.map((o) => o.category))}`
  );
  const report = scanner.generateSecurityReport(r);
  ok(/OWASP/i.test(report), "the report must surface the OWASP section");
});

test("finding excerpts are redacted (S-13) — no raw secret material", () => {
  const dir = fixture({
    ".env": "PASSWORD=hunter2SuperSecretValue\nAWS_KEY=AKIA1234567890ABCDEF\n",
    // Quoted rules use a capture group; the OLD iteration reported the group
    // as its own finding, leaking the bare secret past redaction.
    "config.toml": 'api_key = "topsecret99"\n',
  });
  const r = scanner.scanDirectory(dir);
  const blob = JSON.stringify([...r.secrets, ...r.vulnerabilities, ...r.crypto]);
  ok(!/hunter2SuperSecretValue/.test(blob), "secret value leaked into findings");
  ok(!/AKIA1234567890ABCDEF/.test(blob), "aws key leaked into findings");
  ok(!/topsecret99/.test(blob), "quoted secret leaked as a bare capture group");
  ok(
    r.secrets.some((s) => /REDACTED/i.test(s.match)),
    `expected a redaction marker in an excerpt: ${JSON.stringify(r.secrets.map((s) => s.match))}`
  );
  ok(
    r.secrets.every((s) => !/^["']?[A-Za-z0-9+/_-]{8,}$/.test(s.match)),
    `no excerpt may be a bare secret value: ${JSON.stringify(r.secrets.map((s) => s.match))}`
  );
  const report = scanner.generateSecurityReport(r);
  ok(!/hunter2SuperSecretValue/.test(report), "secret value leaked into the report");
  ok(!/topsecret99/.test(report), "quoted secret leaked into the report");
});

// ---------------------------------------------------------------- gate wiring

test("CORE_REQUIRED_GATES contains security", () => {
  ok(Array.isArray(runner.CORE_REQUIRED_GATES), "CORE_REQUIRED_GATES must be exported");
  ok(runner.CORE_REQUIRED_GATES.includes("security"), "security must be a core-required gate");
});

test("evidenceSecurity runs in core mode and yields gate: security", () => {
  const dir = fixture({ "bundle/hooks/lib/.keep": "" });
  fs.copyFileSync(SCANNER, path.join(dir, "bundle/hooks/lib/security-scanner.js"));
  const { results } = runner.runEvidenceChecks({ loopMode: "core" }, { cwd: dir });
  const sec = results.filter((r) => r.gate === "security");
  eq(sec.length, 1, `expected exactly one security result, got ${sec.length}`);
  ok(!/^SKIPPED:/.test(sec[0].details), `security must not be skipped in core mode: ${sec[0].details}`);
});

test("SELF_SCAN_EXCLUSIONS is a documented allowlist", () => {
  ok(Array.isArray(runner.SELF_SCAN_EXCLUSIONS), "SELF_SCAN_EXCLUSIONS must be exported");
  ok(runner.SELF_SCAN_EXCLUSIONS.length >= 1, "allowlist must not be empty");
  for (const e of runner.SELF_SCAN_EXCLUSIONS) {
    eq(typeof e.id, "string", "each entry needs an id");
    ok(typeof e.reason === "string" && e.reason.length > 10, `entry ${e.id} needs a documented reason`);
    ok(e.file instanceof RegExp, `entry ${e.id} must scope itself with a file regex`);
  }
});

/** Build a workspace root shaped like an orchestra install + extra lib files. */
function gateFixture(libFiles) {
  const files = {};
  for (const [rel, body] of Object.entries(libFiles)) {
    files[`bundle/hooks/lib/${rel}`] = body;
  }
  const dir = fixture(files);
  fs.copyFileSync(SCANNER, path.join(dir, "bundle/hooks/lib/security-scanner.js"));
  return dir;
}

test("scanner self-patterns are excluded but real exec() calls are not", () => {
  const dir = gateFixture({
    "phase-outcome.js": "const m = re.exec(blob);\n",
    "shell.js": "exec('rm -rf /tmp/x');\n",
  });
  const res = runner.evidenceSecurity(dir);
  ok(!/phase-outcome/.test(res.details), `regex exec() false positive must be excluded: ${res.details}`);
  ok(/shell\.js/.test(res.details), `a real exec() call must still be reported: ${res.details}`);
});

test("critical/high blocks, medium/low is reported but non-blocking", () => {
  const critDir = gateFixture({ "secret.js": "const password = 'hunter2xyz123';\n" });
  const blocked = runner.evidenceSecurity(critDir);
  eq(blocked.gate, "security", `gate must be security, got ${blocked.gate}`);
  eq(blocked.ok, false, `critical must block: ${blocked.details}`);
  ok(/critical/i.test(blocked.details), "details must name the blocking severity");

  const medDir = gateFixture({ "weak.js": "const h = crypto.createHash('md5');\n" });
  const med = runner.evidenceSecurity(medDir);
  eq(med.ok, true, `medium must not block: ${med.details}`);
  ok(/non-blocking|advisory/i.test(med.details), `details must mark medium as non-blocking: ${med.details}`);
});

test("a clean lib tree passes the security gate", () => {
  const clean = gateFixture({ "helper.js": "module.exports = function add(a, b) { return a + b; };\n" });
  const res = runner.evidenceSecurity(clean);
  eq(res.ok, true, `clean tree must pass: ${res.details}`);
});


// ------------------------------------------------------------ scan-secrets CLI
//
// audit S-20: CI had no secret scan at all. `scripts/scan-secrets.js` is the
// blocking CLI wrapper over the same scanner the evidence gate uses, so what
// CI blocks on and what the loop blocks on can never diverge.

/** Synthetic token shapes that match the scanner rules. */
const GH_TOKEN = `ghp_${"a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"}`;
const GOOGLE_KEY = `AIza${"b".repeat(35)}`;

function runCli(args) {
  return cp.spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd: ROOT, timeout: 120000 });
}

test("scan-secrets.js exists (RED first)", () => {
  ok(fs.existsSync(CLI), "scripts/scan-secrets.js must exist");
});

test("CLI exits 1 on a high/critical finding with --fail-on=high", () => {
  const dir = fixture({ ".env": `GITHUB_TOKEN=${GH_TOKEN}\n` });
  const r = runCli(["--dir", dir, "--fail-on=high"]);
  eq(r.status, 1, `expected exit 1 on a high finding, got ${r.status}: ${r.stdout}${r.stderr}`);
  ok(/secret|ghp_/i.test(r.stdout), `the report must name the finding: ${r.stdout}`);
  ok(!/\bsecret\b.*\*{20}/.test(r.stdout), "the report must not echo raw secret material");
});

test("CLI exits 0 on a clean directory", () => {
  const dir = fixture({ "hello.js": "module.exports = function add(a, b) { return a + b; };\n" });
  const r = runCli(["--dir", dir, "--fail-on=high"]);
  eq(r.status, 0, `expected exit 0 on a clean tree, got ${r.status}: ${r.stdout}${r.stderr}`);
  ok(/PASS|no critical/i.test(r.stdout), `the report must state the verdict: ${r.stdout}`);
});

test("--json emits parseable JSON carrying the summary and the findings", () => {
  const dir = fixture({ "config.toml": `api_key = "${GOOGLE_KEY}"\n` });
  const r = runCli(["--dir", dir, "--json", "--fail-on=high"]);
  eq(r.status, 1, `expected exit 1, got ${r.status}: ${r.stderr}`);
  let parsed = null;
  let parseErr = null;
  try {
    parsed = JSON.parse(r.stdout);
  } catch (e) {
    parseErr = e;
  }
  eq(parseErr, null, `--json must emit parseable JSON on stdout: ${parseErr && parseErr.message}`);
  ok(parsed && Array.isArray(parsed.findings), "JSON must carry a findings array");
  ok(parsed && parsed.summary && parsed.summary.high >= 1, `JSON summary must count the high finding: ${JSON.stringify(parsed && parsed.summary)}`);
  eq(parsed.exitCode, 1, "JSON must report the exit code it used");
  ok(!/b{35}/.test(r.stdout), "JSON output must not echo raw secret material");
});

test("--fail-on=critical lets a high-only finding through", () => {
  const dir = fixture({ "notes.md": `Google key: ${GOOGLE_KEY}\n` });
  const r = runCli(["--dir", dir, "--json", "--fail-on=critical"]);
  eq(r.status, 0, `--fail-on=critical must not block on a high finding: ${r.stdout}${r.stderr}`);
  const parsed = JSON.parse(r.stdout);
  eq(parsed.exitCode, 0, "JSON exitCode must match the process exit code");
  ok(parsed.summary.high >= 1, "the high finding must still be reported, not hidden");
});

test("a documented .secret-scan-allow entry suppresses its finding", () => {
  const dir = fixture({ "synthetic.md": `token ${GOOGLE_KEY}\n`, ".secret-scan-allow": "# synthetic fixtures\nsynthetic.md | synthetic Google key shape used only in tests\n" });
  const r = runCli(["--dir", dir, "--json", "--fail-on=high"]);
  eq(r.status, 0, `a documented allow entry must suppress the finding: ${r.stdout}${r.stderr}`);
  const parsed = JSON.parse(r.stdout);
  eq(parsed.allowed.length, 1, `the suppressed finding must be reported as allowed: ${JSON.stringify(parsed.allowed)}`);
  eq(parsed.summary.high, 0, "an allowed finding must not count toward the summary");
});

test("an undocumented allow entry is a config error (exit 2)", () => {
  const dir = fixture({ "synthetic.md": `token ${GOOGLE_KEY}\n`, ".secret-scan-allow": "synthetic.md\n" });
  const r = runCli(["--dir", dir, "--fail-on=high"]);
  eq(r.status, 2, `an allow entry without a reason must exit 2: ${r.stdout}${r.stderr}`);
  ok(/reason/i.test(r.stderr), `the error must say a reason is required: ${r.stderr}`);
});

test("the repo itself passes the blocking scan", () => {
  const r = runCli(["--dir", ROOT, "--fail-on=high"]);
  eq(r.status, 0, `the repository must be clean at --fail-on=high: ${r.stdout}${r.stderr}`);
});

console.log(`security-scanner assertions: ${asserts}`);

if (failures > 0) {
  console.error(`${failures} FAILED`);
  process.exit(1);
}
console.log("All security-scanner tests passed");
process.exit(0);