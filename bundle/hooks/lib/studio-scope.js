"use strict";

/**
 * Repo-scope helpers — single JS source of truth for global-studio isolation.
 *
 * One clone (`PCORE_ORCHESTRA_REPO`) serves many repos. Each repo gets:
 *   - a scope slug:  sanitized basename of its git top-level (or cwd)
 *   - a state dir:   <global>/repos/<scope>/  (unscoped legacy = <global> itself)
 *   - a studio port: 3110 + fnv1a(scope) % 1000, pinned in <global>/studio-ports.json
 *
 * Scope is OPT-IN: when `PCORE_REPO_SCOPE` is unset/empty every helper below
 * returns the legacy unscoped value, so existing installs and tests behave
 * byte-identically. Set `PCORE_REPO_SCOPE` (or pass `--scope`) to partition.
 *
 * No dependencies — safe to require from bundle lib, server/ and scripts/.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASE_PORT = 3110;
const PORT_SPAN = 1000;
const MAX_SCOPE_LEN = 32;
const REGISTRY_FILE = "studio-ports.json";
const REPOS_SEGMENT = "repos";

/** Lowercase, runs of non [a-z0-9] become one '-', trimmed, capped. */
function sanitizeScope(raw) {
  const s = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SCOPE_LEN)
    .replace(/-+$/g, "");
  return s || "default";
}

/**
 * Derive a scope slug for a repo path: git top-level basename when inside a
 * work tree, else the basename of the path itself. Never throws.
 */
function defaultScope(repoPath) {
  const start = typeof repoPath === "string" && repoPath ? repoPath : process.cwd();
  try {
    const { execSync } = require("node:child_process");
    const top = execSync("git rev-parse --show-toplevel", {
      cwd: start,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (top) return sanitizeScope(path.basename(top));
  } catch {
    /* not a git checkout — fall through to basename */
  }
  return sanitizeScope(path.basename(path.resolve(start)));
}

/** Explicit scope from env (`PCORE_REPO_SCOPE`), sanitized, or "" when unset. */
function envScope(env) {
  const e = env || process.env;
  const raw = e && typeof e.PCORE_REPO_SCOPE === "string" ? e.PCORE_REPO_SCOPE.trim() : "";
  return raw ? sanitizeScope(raw) : "";
}

/** Global (unscoped) state dir: PCORE_STATE_DIR wins, else the shared default. */
function globalStateDir(env) {
  const e = env || process.env;
  const override = e && typeof e.PCORE_STATE_DIR === "string" ? e.PCORE_STATE_DIR : "";
  if (override && override.length > 0) return override;
  const home = (e && (e.HOME || e.USERPROFILE)) || os.homedir();
  return path.join(home, ".config", "opencode", "hooks", "state");
}

/**
 * Resolved state dir for a scope: `<global>/repos/<scope>/`, or `<global>`
 * when scope is empty (legacy unscoped layout, unchanged).
 */
function scopedStateDir(globalDir, scope) {
  const base = globalDir || globalStateDir();
  const s = scope ? sanitizeScope(scope) : "";
  if (!s) return base;
  return path.join(base, REPOS_SEGMENT, s);
}

/** Like scopedStateDir but reads scope + global from env. */
function resolveStateDirForScope(env) {
  const e = env || process.env;
  return scopedStateDir(globalStateDir(e), envScope(e));
}

/** Deterministic port candidate for a scope: 3110 + fnv1a(scope) % 1000. */
function scopePortCandidate(scope) {
  const s = sanitizeScope(scope || "default");
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return BASE_PORT + (hash % PORT_SPAN);
}

function registryPath(globalDir) {
  return path.join(globalDir || globalStateDir(), REGISTRY_FILE);
}

/** Read the port registry; corrupt/missing -> {}. Never throws. */
function loadRegistry(globalDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(registryPath(globalDir), "utf8"));
    if (raw && typeof raw === "object" && raw.scopes && typeof raw.scopes === "object") {
      const out = {};
      for (const [k, v] of Object.entries(raw.scopes)) {
        if (Number.isInteger(v) && v >= 0 && v <= 65535) out[sanitizeScope(k)] = v;
      }
      return out;
    }
  } catch {
    /* missing or corrupt — treat as empty */
  }
  return {};
}

/**
 * Allocate (and persist) a stable port for a scope. The hash candidate wins
 * when free; otherwise linear-probe upward. Persisted so restarts and every
 * client resolve the same port. Creates the global dir as needed.
 */
function allocatePort(scope, globalDir) {
  const s = sanitizeScope(scope || "default");
  const base = globalDir || globalStateDir();
  const scopes = loadRegistry(base);
  if (scopes[s]) return scopes[s];
  const taken = new Set(Object.values(scopes));
  let port = scopePortCandidate(s);
  for (let i = 0; i < PORT_SPAN && taken.has(port); i += 1) {
    port = port >= BASE_PORT + PORT_SPAN - 1 ? BASE_PORT : port + 1;
  }
  scopes[s] = port;
  try {
    fs.mkdirSync(base, { recursive: true });
    const tmp = `${registryPath(base)}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, scopes }, null, 2));
    fs.renameSync(tmp, registryPath(base));
  } catch {
    /* read-only home — caller still gets the deterministic answer */
  }
  return port;
}

/** Read-only resolution: registry hit, else the hash candidate (no write). */
function resolvePort(scope, globalDir) {
  const s = sanitizeScope(scope || "default");
  const scopes = loadRegistry(globalDir || globalStateDir());
  if (scopes[s]) return scopes[s];
  return scopePortCandidate(s);
}

module.exports = {
  BASE_PORT,
  PORT_SPAN,
  MAX_SCOPE_LEN,
  REGISTRY_FILE,
  REPOS_SEGMENT,
  sanitizeScope,
  defaultScope,
  envScope,
  globalStateDir,
  scopedStateDir,
  resolveStateDirForScope,
  scopePortCandidate,
  registryPath,
  loadRegistry,
  allocatePort,
  resolvePort,
};
