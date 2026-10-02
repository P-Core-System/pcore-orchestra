"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SECRET_PATTERNS = [
  { pattern: /(?:api[_-]?key|api[_-]?secret|access[_-]?token|secret[_-]?key)["']?\s*[:=]\s*["']([^"']{8,})["']/i, severity: "critical", label: "Hardcoded API key/secret" },
  { pattern: /(?:password|passwd|pwd)["']?\s*[:=]\s*["']([^"']{6,})["']/i, severity: "critical", label: "Hardcoded password" },
  { pattern: /(?:sk-|pk-)[a-zA-Z0-9]{20,}/g, severity: "critical", label: "Stripe key pattern" },
  { pattern: /ghp_[a-zA-Z0-9]{36}/g, severity: "critical", label: "GitHub personal access token" },
  { pattern: /AIza[0-9A-Za-z_-]{35}/g, severity: "high", label: "Google API key" },
  { pattern: /-----BEGIN RSA PRIVATE KEY-----/, severity: "critical", label: "RSA private key" },
  { pattern: /-----BEGIN OPENSSH PRIVATE KEY-----/, severity: "critical", label: "SSH private key" },
  { pattern: /AKIA[0-9A-Z]{16}/g, severity: "critical", label: "AWS access key" },
  { pattern: /xox[abpors]-[0-9A-Za-z-]{10,}/g, severity: "high", label: "Slack token" },
  { pattern: /ghr_[0-9a-zA-Z]{36}/g, severity: "high", label: "GitHub refresh token" },
  { pattern: /(?:SG\.|sendgrid)[a-zA-Z0-9._-]{20,}/i, severity: "high", label: "SendGrid API key" },
  { pattern: /pk\.[a-zA-Z0-9]{40,}/g, severity: "high", label: "Pulumi access token" },
  { pattern: /s3cr3t/i, severity: "medium", label: "Suspicious hardcoded secret pattern" },
];

/**
 * Unquoted `KEY=value` secrets (dotenv files, shell exports, ini/toml).
 * The existing rules above all require quotes around the value, which is why a
 * plain `.env` with `PASSWORD=hunter2` slipped through entirely.
 * The value group must be unquoted, >= 6 chars, and not a placeholder.
 */
const UNQUOTED_SECRET_PATTERNS = [
  {
    pattern: /^[ \t]*(?:export[ \t]+)?[A-Za-z0-9_.-]*(?:password|passwd|secret|token|api_?key|private_?key|access_?key|credential)[A-Za-z0-9_.-]*[ \t]*=[ \t]*([^\s'"#][^\s'"#]{5,})[ \t]*(?:#.*)?$/gim,
    severity: "critical",
    label: "Unquoted secret in KEY=value form",
    placeholderSafe: true,
  },
];

/** Values that look like secrets but are documentation noise. */
const SECRET_PLACEHOLDERS =
  /^(?:changeme|change[-_]?me|placeholder|example|sample|dummy|redacted|password|secret|token|none|null|nil|undefined|true|false|your[-_].*|my[-_].*|<[^>]*>|\{\{.*\}\}|\$\{[^}]*\}|\*{3,}|x{3,}|\.{3,})$/i;

const REDACTED = "***REDACTED***";

/** Max excerpt length kept in a finding (bounds persisted evidence records). */
const EXCERPT_MAX = 120;

/**
 * Mask secret material out of a finding excerpt (audit S-13). Findings are
 * persisted into evidence records and rendered into reports, so an excerpt
 * must never carry the raw credential that triggered it.
 */
function redact(text) {
  if (text === null || text === undefined) return "";
  let out = String(text);
  out = out.replace(
    /((?:[A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential|passphrase)[A-Za-z0-9_.-]*[ \t]*[:=][ \t]*))(["']?)([^\s"',;)]{3,})/gi,
    (_m, key, quote) => `${key}${quote}${REDACTED}`
  );
  out = out.replace(/[A-Za-z0-9+/_-]{20,}/g, (m) => (m === REDACTED ? m : REDACTED));
  return out.length > EXCERPT_MAX ? `${out.slice(0, EXCERPT_MAX)}…` : out;
}

/** Value part of a `KEY=value` line, used for the placeholder filter. */
function valuePartOf(matchText) {
  const eq = String(matchText).indexOf("=");
  return eq === -1 ? String(matchText) : String(matchText).slice(eq + 1).trim();
}

/** Finding-array name -> the `type` value carried by each finding. */
const FINDING_TYPES = { secrets: "secret", vulnerabilities: "vulnerability", crypto: "crypto" };

/**
 * Shared finding constructor: skips placeholders, clamps the excerpt to
 * EXCERPT_MAX and redacts it.
 * @param {object} findings accumulator (secrets/vulnerabilities/crypto)
 * @param {string} bucket which array to push into
 */
function pushFinding(findings, bucket, rule, matchText, filename, content) {
  if (rule.placeholderSafe && SECRET_PLACEHOLDERS.test(valuePartOf(matchText))) return;
  findings[bucket].push({
    type: FINDING_TYPES[bucket],
    severity: rule.severity,
    label: rule.label,
    match: redact(matchText.slice(0, EXCERPT_MAX + 1)),
    file: filename,
    line: findLineNumber(content, matchText),
  });
}

const VULNERABLE_PATTERNS = [
  { pattern: /eval\s*\(/g, severity: "high", label: "eval() usage (code injection risk)" },
  { pattern: /innerHTML\s*=/g, severity: "high", label: "innerHTML assignment (XSS risk)" },
  { pattern: /document\.write\s*\(/g, severity: "high", label: "document.write() (XSS risk)" },
  { pattern: /new Function\s*\(/g, severity: "high", label: "new Function() (code injection risk)" },
  { pattern: /exec\s*\(/g, severity: "high", label: "exec() call (command injection risk)" },
  { pattern: /spawn\s*\(/g, severity: "medium", label: "spawn() call (command injection risk)" },
  { pattern: /child_process/g, severity: "medium", label: "child_process usage (command injection risk)" },
  { pattern: /\.sql\s*=\s*["']/g, severity: "critical", label: "Raw SQL string concatenation (SQL injection risk)" },
  { pattern: /\.\.\/\.\.\//g, severity: "medium", label: "Path traversal (directory traversal risk)" },
  { pattern: /\$\{.*\}.*\/.*\//g, severity: "medium", label: "Possible template injection" },
];

const WEAK_CRYPTO = [
  { pattern: /crypto\.createHash\s*\(\s*["']md5["']/gi, severity: "medium", label: "Weak hash algorithm: MD5" },
  { pattern: /crypto\.createHash\s*\(\s*["']sha1["']/gi, severity: "medium", label: "Weak hash algorithm: SHA1" },
  { pattern: /crypto\.createCipher\s*\(/g, severity: "high", label: "Deprecated cipher API (use createCipheriv)" },
  { pattern: /Math\.random\s*\(/g, severity: "low", label: "Math.random() for non-crypto purposes" },
];

/**
 * Full matches for one rule.
 *
 * `String.match` on a NON-global regex returns `[full, group1, group2, ...]`,
 * so iterating its result reports every capture group as its own finding —
 * and for a quoted-secret rule the capture group IS the bare secret, which
 * would then bypass excerpt redaction. `String.matchAll` yields only full
 * matches but returns nothing for a non-global regex, so non-global rules get
 * a global clone first. A finding excerpt is therefore always the whole
 * `key = "value"` context that redaction can mask.
 */
function fullMatches(content, rule) {
  const re = rule.pattern.global
    ? rule.pattern
    : new RegExp(rule.pattern.source, `${rule.pattern.flags.replace(/[gy]/g, "")}g`);
  return [...content.matchAll(re)].map((m) => m[0]);
}

function scanForSecrets(content, filename) {
  const findings = { secrets: [], vulnerabilities: [], crypto: [] };
  for (const rule of [...SECRET_PATTERNS, ...UNQUOTED_SECRET_PATTERNS]) {
    for (const text of fullMatches(content, rule)) {
      pushFinding(findings, "secrets", rule, text, filename, content);
    }
  }
  return findings.secrets;
}

function scanForVulnerabilities(content, filename) {
  const findings = { secrets: [], vulnerabilities: [], crypto: [] };
  for (const rule of VULNERABLE_PATTERNS) {
    for (const text of fullMatches(content, rule).slice(0, 5)) {
      pushFinding(findings, "vulnerabilities", rule, text, filename, content);
    }
  }
  return findings.vulnerabilities;
}

function scanForWeakCrypto(content, filename) {
  const findings = { secrets: [], vulnerabilities: [], crypto: [] };
  for (const rule of WEAK_CRYPTO) {
    for (const text of fullMatches(content, rule)) {
      pushFinding(findings, "crypto", rule, text, filename, content);
    }
  }
  return findings.crypto;
}

function findLineNumber(content, matchStr) {
  const idx = content.indexOf(matchStr);
  if (idx === -1) return -1;
  return content.slice(0, idx).split("\n").length;
}

/**
 * Files scanned by extension. The dotenv/shell/doc/config entries close the
 * blind spots where real secrets usually live (`.env`, `install.sh`,
 * `config.toml`, CI YAML); extensionless files (`Dockerfile`, `Makefile`,
 * `.env`) are scanned too via {@link SCAN_EXTENSIONLESS}.
 */
const SCAN_EXTENSIONS = [
  ".js", ".ts", ".jsx", ".tsx", ".py", ".go", ".rs", ".java", ".json",
  ".yaml", ".yml", ".env", ".sh", ".md", ".toml", ".ini", ".conf",
];

/** Also scan files with no extension at all (`Dockerfile`, `.env`, `LICENSE`). */
const SCAN_EXTENSIONLESS = true;

/** Directories never walked — VCS internals, vendored dependencies, and build artifacts. */
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build"]);

/** Skip files larger than this (logs, fixtures, minified bundles). */
const MAX_FILE_BYTES = 512 * 1024;

/**
 * The binary marker, as an ESCAPE.
 *
 * This constant must stay the six characters backslash-u-0-0-0-0 and never a
 * literal 0x00 byte: a source file that holds a raw NUL is binary to
 * {@link scanDirectory}, so writing the byte literally once made the scanner
 * skip its own source file — and therefore every secret planted in it.
 * Regression coverage: scripts/test-security-scanner.js.
 */
const NUL_BYTE = "\u0000";

/** Allowlist filename, resolved from the scan root by both consumers. */
const ALLOW_FILE = ".secret-scan-allow";

/**
 * Parse one allowlist pattern.
 *
 * Two forms:
 *   `<substring>`                          legacy — matches the finding's file
 *                                           path OR its rule label (substring,
 *                                           case-insensitive)
 *   `file:<substr> + label:<substr>`       narrow  — the finding must match
 *                                           BOTH, so one rule in one file can be
 *                                           documented without silencing that
 *                                           file's other rules (a directory entry
 *                                           over executable trees is how a real
 *                                           secret becomes silently allowed).
 *
 * @returns {{file: string|null, label: string|null, any: string|null}}
 */
function parseAllowPattern(raw) {
  const terms = String(raw == null ? "" : raw)
    .split("+")
    .map((t) => t.trim())
    .filter(Boolean);
  let file = null;
  let label = null;
  let any = null;
  for (const term of terms) {
    const m = /^(file|label)\s*:\s*(.+)$/i.exec(term);
    if (m) {
      const value = m[2].trim().toLowerCase();
      if (m[1].toLowerCase() === "file") file = value;
      else label = value;
    } else {
      any = term.toLowerCase();
    }
  }
  return { file, label, any };
}

/** Findings report `path.relative(root, file)`; normalise separators. */
function normalizeScanPath(p) {
  return String(p || "").split(path.sep).join("/");
}

/** Does an allowlist entry (parsed or raw) cover this finding? */
function isAllowedFinding(finding, entries) {
  const file = normalizeScanPath(finding && finding.file).toLowerCase();
  const label = String((finding && finding.label) || "").toLowerCase();
  return (entries || []).some((entry) => {
    const p =
      entry && typeof entry === "object" && entry.file !== undefined
        ? entry
        : parseAllowPattern(entry && entry.pattern !== undefined ? entry.pattern : entry);
    if (p.any) return file.includes(p.any) || label.includes(p.any);
    if (p.file === null && p.label === null) return false;
    const fileOk = p.file === null ? true : file.includes(p.file);
    const labelOk = p.label === null ? true : label.includes(p.label);
    return fileOk && labelOk;
  });
}

/**
 * Read `<root>/.secret-scan-allow` (or an explicit path).
 *
 * One entry per line: `<pattern> | <reason>`; `#` starts a comment. An entry
 * without a reason is a config error (exit 2) — a false positive that nobody
 * documented is a rule that quietly rots.
 *
 * SHARED with `scripts/scan-secrets.js` and the in-loop `evidenceSecurity`
 * gate, so CI and the core loop can never disagree about what is allowed.
 *
 * @returns {{entries: object[], error: string|null, file: string|null}}
 */
function loadSecretScanAllow(allowPath) {
  if (!allowPath || !fs.existsSync(allowPath)) {
    return { entries: [], error: null, file: allowPath || null };
  }
  let raw;
  try {
    raw = fs.readFileSync(allowPath, "utf8");
  } catch (err) {
    return { entries: [], error: `${allowPath}: ${err.message}`, file: allowPath };
  }
  const entries = [];
  let missingReason = null;
  raw.split("\n").forEach((line, idx) => {
    const withoutComment = line.split("#")[0].trim();
    if (withoutComment.length === 0) return;
    const sep = withoutComment.indexOf("|");
    const pattern = (sep === -1 ? withoutComment : withoutComment.slice(0, sep)).trim();
    const reason = (sep === -1 ? "" : withoutComment.slice(sep + 1)).trim();
    if (pattern.length === 0) return;
    if (reason.length === 0 && !missingReason) {
      missingReason = { pattern, line: idx + 1 };
    }
    entries.push(Object.assign(parseAllowPattern(pattern), { pattern, reason, allowFile: allowPath, line: idx + 1 }));
  });
  if (missingReason) {
    return {
      entries,
      error: `${allowPath}:${missingReason.line} — allow entry "${missingReason.pattern}" needs a reason (\`pattern | why it is safe\`)`,
      file: allowPath,
    };
  }
  return { entries, error: null, file: allowPath };
}

function scanDirectory(dirPath, fileExtensions) {
  const exts = fileExtensions || SCAN_EXTENSIONS;
  const findings = { secrets: [], vulnerabilities: [], crypto: [], owasp: [], summary: { critical: 0, high: 0, medium: 0, low: 0 } };

  function scanFile(filePath) {
    const ext = path.extname(filePath);
    if (ext === "" ? !SCAN_EXTENSIONLESS : !exts.includes(ext)) return;
    let content;
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_FILE_BYTES) return;
      content = fs.readFileSync(filePath, "utf8");
      // NUL byte => binary, not reviewable source. The NUL is written as an
      // ESCAPE on purpose: embedding the raw 0x00 byte here made the scanner's
      // own source binary, so scanDirectory silently skipped itself and a
      // secret planted in security-scanner.js was invisible.
      if (content.indexOf(NUL_BYTE) !== -1) return;
    } catch {
      return;
    }
    const relative = path.relative(dirPath, filePath);
    findings.secrets.push(...scanForSecrets(content, relative));
    findings.vulnerabilities.push(...scanForVulnerabilities(content, relative));
    findings.crypto.push(...scanForWeakCrypto(content, relative));
    // checkOwaspTop10 used to be dead code; its categories are surfaced in the
    // report as ADVISORY only (see generateSecurityReport) — they are far too
    // broad to block on, but they must not stay invisible either.
    for (const o of checkOwaspTop10(content, relative)) {
      findings.owasp.push({ ...o, line: 1 });
    }
  }

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; /* skip unreadable dirs */
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Dot-directories ARE scanned (.github/workflows is a real leak
        // surface); only VCS/vendor internals are skipped.
        if (!SKIP_DIRS.has(entry.name)) walk(full);
      } else if (entry.isFile()) {
        // One unreadable/odd file must not abort the rest of the directory —
        // a swallowed error here would silently zero out its findings.
        try {
          scanFile(full);
        } catch {
          /* skip unreadable files */
        }
      }
    }
  }

  walk(dirPath);

  for (const f of findings.secrets) findings.summary[f.severity] = (findings.summary[f.severity] || 0) + 1;
  for (const f of findings.vulnerabilities) findings.summary[f.severity] = (findings.summary[f.severity] || 0) + 1;
  for (const f of findings.crypto) findings.summary[f.severity] = (findings.summary[f.severity] || 0) + 1;

  return findings;
}

function generateSecurityReport(findings) {
  const lines = ["## Security Scan Report\n"];

  const total = findings.secrets.length + findings.vulnerabilities.length + findings.crypto.length;
  lines.push(`**Total findings:** ${total}`);
  lines.push(`**Critical:** ${findings.summary.critical || 0}`);
  lines.push(`**High:** ${findings.summary.high || 0}`);
  lines.push(`**Medium:** ${findings.summary.medium || 0}`);
  lines.push(`**Low:** ${findings.summary.low || 0}`);

  if (findings.secrets.length > 0) {
    lines.push(`\n### Secrets Found (${findings.secrets.length})`);
    for (const s of findings.secrets) {
      lines.push(`- [${s.severity}] ${s.label} in ${s.file}:${s.line}`);
    }
  }

  if (findings.vulnerabilities.length > 0) {
    lines.push(`\n### Vulnerabilities (${findings.vulnerabilities.length})`);
    for (const v of findings.vulnerabilities) {
      lines.push(`- [${v.severity}] ${v.label} in ${v.file}:${v.line}`);
    }
  }

  if (findings.crypto.length > 0) {
    lines.push(`\n### Cryptographic Issues (${findings.crypto.length})`);
    for (const c of findings.crypto) {
      lines.push(`- [${c.severity}] ${c.label} in ${c.file}:${c.line}`);
    }
  }

  // Advisory only — surfaced so the categories stop being invisible, never
  // used to block (each category is a broad heuristic, not a proven defect).
  const owasp = findings.owasp || [];
  if (owasp.length > 0) {
    const byCategory = new Map();
    for (const o of owasp) {
      if (!byCategory.has(o.category)) byCategory.set(o.category, 0);
      byCategory.set(o.category, byCategory.get(o.category) + 1);
    }
    lines.push(`\n### OWASP Top 10 categories (${owasp.length} — advisory, non-blocking)`);
    for (const [category, n] of [...byCategory.entries()].sort()) {
      lines.push(`- ${category}: ${n} occurrence(s)`);
    }
  }

  const criticalHigh = (findings.summary.critical || 0) + (findings.summary.high || 0);
  lines.push(`\n**Verdict:** ${criticalHigh > 0 ? "FAIL — Critical/high issues found" : "PASS — No critical or high issues"}`);
  return lines.join("\n");
}

function checkOwaspTop10(content, filename) {
  const owaspFindings = [];

  if (/<script>|onerror|onload|onclick|javascript:/i.test(content)) {
    owaspFindings.push({ category: "A1: XSS", severity: "high", file: filename });
  }
  if (/process\.env|\.env|environ/i.test(content) && /password|secret|key|token/i.test(content)) {
    owaspFindings.push({ category: "A2: Crypt Failure", severity: "high", file: filename });
  }
  if (/SELECT.*FROM|INSERT INTO|UPDATE.*SET|DELETE FROM/i.test(content) && /\+|concat|\$\{/i.test(content)) {
    owaspFindings.push({ category: "A3: Injection", severity: "critical", file: filename });
  }
  if (/deserialize|unserialize|pickle\.load/i.test(content)) {
    owaspFindings.push({ category: "A8: Deserialization", severity: "high", file: filename });
  }
  if (/console\.log|print|fmt\.Print/i.test(content) && /password|secret|key|token|credit|ssn/i.test(content)) {
    owaspFindings.push({ category: "A5: Sensitive Data Exposure", severity: "high", file: filename });
  }

  return owaspFindings;
}

module.exports = {
  ALLOW_FILE,
  parseAllowPattern,
  normalizeScanPath,
  isAllowedFinding,
  loadSecretScanAllow,
  NUL_BYTE,
  SECRET_PATTERNS,
  UNQUOTED_SECRET_PATTERNS,
  SECRET_PLACEHOLDERS,
  VULNERABLE_PATTERNS,
  WEAK_CRYPTO,
  SCAN_EXTENSIONS,
  SCAN_EXTENSIONLESS,
  SKIP_DIRS,
  MAX_FILE_BYTES,
  EXCERPT_MAX,
  REDACTED,
  redact,
  fullMatches,
  scanForSecrets,
  scanForVulnerabilities,
  scanForWeakCrypto,
  scanDirectory,
  generateSecurityReport,
  checkOwaspTop10,
};
