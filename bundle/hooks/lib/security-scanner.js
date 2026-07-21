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

function scanForSecrets(content, filename) {
  const findings = [];
  for (const rule of SECRET_PATTERNS) {
    const matches = content.match(rule.pattern);
    if (matches) {
      for (let i = 0; i < matches.length; i++) {
        findings.push({
          type: "secret",
          severity: rule.severity,
          label: rule.label,
          match: matches[i].slice(0, 50),
          file: filename,
          line: findLineNumber(content, matches[i]),
        });
      }
    }
  }
  return findings;
}

function scanForVulnerabilities(content, filename) {
  const findings = [];
  for (const rule of VULNERABLE_PATTERNS) {
    const matches = content.match(rule.pattern);
    if (matches) {
      for (let i = 0; i < Math.min(matches.length, 5); i++) {
        findings.push({
          type: "vulnerability",
          severity: rule.severity,
          label: rule.label,
          match: matches[i].slice(0, 50),
          file: filename,
          line: findLineNumber(content, matches[i]),
        });
      }
    }
  }
  return findings;
}

function scanForWeakCrypto(content, filename) {
  const findings = [];
  for (const rule of WEAK_CRYPTO) {
    const matches = content.match(rule.pattern);
    if (matches) {
      for (let i = 0; i < matches.length; i++) {
        findings.push({
          type: "crypto",
          severity: rule.severity,
          label: rule.label,
          match: matches[i].slice(0, 50),
          file: filename,
          line: findLineNumber(content, matches[i]),
        });
      }
    }
  }
  return findings;
}

function findLineNumber(content, matchStr) {
  const idx = content.indexOf(matchStr);
  if (idx === -1) return -1;
  return content.slice(0, idx).split("\n").length;
}

function scanDirectory(dirPath, fileExtensions) {
  const exts = fileExtensions || [".js", ".ts", ".jsx", ".tsx", ".py", ".go", ".rs", ".java", ".json", ".yaml", ".yml"];
  const findings = { secrets: [], vulnerabilities: [], crypto: [], summary: { critical: 0, high: 0, medium: 0, low: 0 } };

  function scanFile(filePath) {
    const ext = path.extname(filePath);
    if (!exts.includes(ext)) return;
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const relative = path.relative(dirPath, filePath);
      findings.secrets.push(...scanForSecrets(content, relative));
      findings.vulnerabilities.push(...scanForVulnerabilities(content, relative));
      findings.crypto.push(...scanForWeakCrypto(content, relative));
    } catch {}
  }

  function walk(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
          walk(full);
        } else if (entry.isFile()) {
          scanFile(full);
        }
      }
    } catch {
      /* skip unreadable dirs */
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
  SECRET_PATTERNS,
  VULNERABLE_PATTERNS,
  WEAK_CRYPTO,
  scanForSecrets,
  scanForVulnerabilities,
  scanForWeakCrypto,
  scanDirectory,
  generateSecurityReport,
  checkOwaspTop10,
};
