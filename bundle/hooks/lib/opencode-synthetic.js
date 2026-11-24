"use strict";

/**
 * OpenCode synthetic-input sender for team auto-activation.
 *
 * API contract (docs/opencode.ai/api, verified against the local
 * opencode v2.3.0 OpenAPI surface): GET /api/info returns `urls[0]`;
 * POST /api/session/{id}/synthetic takes `{"text": "..."}` and durably
 * admits synthetic session input, scheduling execution.
 *
 * Everything is fail-open: a missing server, bad URL, missing opencode
 * binary, timeout or API error returns an outcome object and never throws.
 * The runner is injectable so tests never talk to a live server.
 */

const cp = require("node:child_process");
const {
  TEAM_ACTIVATION_URL_ENV,
  TEAM_ACTIVATION_TEXT_MAX,
  TEAM_ACTIVATION_TIMEOUT_MS,
} = require("./constants.js");

/** Session ids are opaque URL path segments: reject anything else. */
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** Accept only http(s) URLs with a host; trim trailing slashes. */
function normalizeServerUrl(value) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** Default runner: the host's opencode CLI. */
function defaultRunner(args, opts) {
  return cp.execFileSync("opencode", args, {
    encoding: "utf8",
    timeout: Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : TEAM_ACTIVATION_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
}

/** Resolve the server URL: explicit override, env, else GET /api/info. */
function resolveServerUrl(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const explicit = o.serverUrl !== undefined ? o.serverUrl : process.env[TEAM_ACTIVATION_URL_ENV];
  const override = normalizeServerUrl(explicit);
  if (override) return override;
  try {
    const runner = typeof o.runner === "function" ? o.runner : defaultRunner;
    const raw = runner(["api", "get", "/api/info"], { timeoutMs: o.timeoutMs });
    const info = JSON.parse(typeof raw === "string" ? raw : String(raw || ""));
    const urls = info && Array.isArray(info.urls) ? info.urls : [];
    for (const candidate of urls) {
      const url = normalizeServerUrl(candidate);
      if (url) return url;
    }
  } catch { /* fail-open: no server available */ }
  return null;
}

/** Bound synthetic text to a finite, non-empty string. */
function clipSyntheticText(text, maxLength) {
  const cap = Number.isInteger(maxLength) && maxLength > 0 ? maxLength : TEAM_ACTIVATION_TEXT_MAX;
  const clean = String(text === undefined || text === null ? "" : text).replace(/\s+$/, "");
  if (!clean.trim()) return "";
  return clean.length <= cap ? clean : `${clean.slice(0, cap - 1)}…`;
}

/**
 * Post one synthetic message. Returns
 * `{ok:true, sessionId, serverUrl}` or `{ok:false, reason}`; never throws.
 */
function sendSynthetic(sessionId, text, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const id = String(sessionId || "");
  if (!SESSION_ID_RE.test(id)) return { ok: false, reason: "invalid-session" };
  const body = clipSyntheticText(text, o.maxLength);
  if (!body) return { ok: false, reason: "empty-text" };

  const serverUrl = o.serverUrl !== undefined && o.serverUrl !== null
    ? normalizeServerUrl(o.serverUrl)
    : resolveServerUrl(o);
  if (!serverUrl) return { ok: false, reason: "no-url" };

  const args = [
    "api", "post", `/api/session/${id}/synthetic`,
    "--data", JSON.stringify({ text: body }),
    "--server", serverUrl,
  ];
  try {
    const runner = typeof o.runner === "function" ? o.runner : defaultRunner;
    runner(args, { timeoutMs: o.timeoutMs });
    return { ok: true, sessionId: id, serverUrl };
  } catch (err) {
    return { ok: false, reason: "send-failed", detail: String((err && err.message) || err).slice(0, 200) };
  }
}

module.exports = {
  SESSION_ID_RE,
  normalizeServerUrl,
  resolveServerUrl,
  clipSyntheticText,
  sendSynthetic,
};
