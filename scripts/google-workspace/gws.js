"use strict";

/**
 * gws.js — opt-in Google Workspace connector (human-gated, zero hook changes).
 *
 * Surfaces (Manage > Productivity nav): Tasks, Reminders, Calendar, Documents.
 * This connector is itself a Connector (Manage > Connectors): `auth status`
 * prints a `connector` entry shaped for the platform Connectors display.
 *
 * Reminders are Tasks: a reminder is a Task with a due date; a timed
 * reminder is a Task PLUS a linked Calendar event with a popup reminder.
 *
 * Human gate: --dry-run is the DEFAULT. Nothing touches Google without
 * --apply. Credentials live ONLY in the OS-protected user dir
 * (~/.config/pcore/gws/) — never in the repo. Zero network unless --apply
 * with linked credentials; the test suite runs credential-less with no HTTP.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CONNECTOR_ID = "google-workspace";
const CONNECTOR_NAME = "Google Workspace";
const CONNECTOR_CATEGORY = "connectors";

/** Least-privilege scopes (consumer-Gmail-compatible External consent flow). */
const SCOPES = [
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/documents",
];

const DEFAULT_TIME_ZONE = "UTC";
const REMINDER_POPUP_MINUTES = 10;

function credsDir() {
  const base = process.env.PCORE_GWS_CREDS_DIR;
  if (base && typeof base === "string" && base.length > 0) return base;
  return path.join(os.homedir(), ".config", "pcore", "gws");
}

function clientFile() {
  return path.join(credsDir(), "gws-client.json");
}

function tokensFile() {
  return path.join(credsDir(), "gws-tokens.json");
}

function readJsonQuiet(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function loadClient() {
  return readJsonQuiet(clientFile());
}

function loadTokens() {
  return readJsonQuiet(tokensFile());
}

function isLinked() {
  const t = loadTokens();
  return Boolean(t && (t.access_token || t.refresh_token));
}

/**
 * Connector entry for Manage > Connectors display: stable shape the
 * platform can render without knowing GWS internals.
 */
function connectorStatus() {
  const linked = isLinked();
  const client = loadClient();
  return {
    connector: {
      id: CONNECTOR_ID,
      name: CONNECTOR_NAME,
      category: CONNECTOR_CATEGORY,
      status: linked ? "linked" : "unlinked",
      scopes: SCOPES.slice(),
      clientConfigured: Boolean(client && client.client_id),
      updatedAt: new Date().toISOString(),
    },
  };
}

/** Pure: Task body for a reminder (Reminders are Tasks with a due date). */
function buildTaskBody(f) {
  const fields = f || {};
  const title = String(fields.title || "").trim();
  if (!title) throw new Error("reminder needs a title");
  const body = { title };
  if (fields.dueDate) body.due = String(fields.dueDate);
  if (fields.notes) body.notes = String(fields.notes);
  return body;
}

/** Pure: Calendar event body for the timed half of a reminder. */
function buildEventBody(f) {
  const fields = f || {};
  const title = String(fields.title || "").trim();
  if (!title) throw new Error("reminder needs a title");
  if (!fields.dateTime) throw new Error("timed reminder needs a dateTime");
  return {
    summary: title,
    description: fields.notes ? String(fields.notes) : "Timed reminder (linked Task)",
    start: { dateTime: String(fields.dateTime), timeZone: fields.timeZone || DEFAULT_TIME_ZONE },
    end: { dateTime: String(fields.dateTime), timeZone: fields.timeZone || DEFAULT_TIME_ZONE },
    reminders: {
      useDefault: false,
      overrides: [{ method: "popup", minutes: REMINDER_POPUP_MINUTES }],
    },
  };
}

/**
 * Pure: plan a reminder — always a Task; timed adds a linked Calendar event.
 * { title, dueDate (RFC3333 date), dateTime (RFC3333), timed, timeZone, notes }
 */
function buildReminderPlan(f) {
  const fields = f || {};
  const task = buildTaskBody({ title: fields.title, dueDate: fields.dueDate, notes: fields.notes });
  let event = null;
  if (fields.timed) event = buildEventBody({ title: fields.title, dateTime: fields.dateTime, notes: fields.notes, timeZone: fields.timeZone });
  return { task, event };
}

function formatDryRun(action, payload) {
  return { dryRun: true, action, payload: payload || {}, hint: "re-run with --apply to execute" };
}

function needGoogle() {
  try {
    return require("googleapis");
  } catch {
    return null;
  }
}

function notInstalled() {
  return { ok: false, code: "GWS_NOT_INSTALLED", detail: "run scripts/setup-google-workspace.sh first" };
}

function notLinked() {
  return { ok: false, code: "GWS_NOT_LINKED", detail: "run gws auth login first" };
}

function authedClient() {
  const google = needGoogle();
  if (!google) return { error: notInstalled() };
  const client = loadClient();
  const tokens = loadTokens();
  if (!client || !tokens) return { error: notLinked() };
  const auth = new google.auth.OAuth2(client.client_id, client.client_secret, client.redirect_uri);
  auth.setCredentials(tokens);
  return { google, auth };
}

function parseArgs(argv) {
  const args = (argv || []).slice();
  const out = { command: null, sub: null, positional: [], flags: {}, apply: false, json: false };
  let i = 0;
  for (; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--apply") { out.apply = true; continue; }
    if (a === "--json") { out.json = true; continue; }
    if (a === "--") { out.positional.push(...args.slice(i + 1)); break; }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq === -1) {
        const key = a.slice(2);
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith("--")) { out.flags[key] = next; i += 1; }
        else out.flags[key] = true;
      } else {
        out.flags[a.slice(2, eq)] = a.slice(eq + 1);
      }
      continue;
    }
    if (!out.command) out.command = a;
    else if (!out.sub) out.sub = a;
    else out.positional.push(a);
  }
  return out;
}

function emit(parsed, obj, text) {
  if (parsed.json) console.log(JSON.stringify(obj));
  else console.log(text !== undefined ? text : JSON.stringify(obj, null, 2));
}

function authLogin(parsed) {
  const google = needGoogle();
  if (!google) { emit(parsed, notInstalled(), "GWS not installed — run scripts/setup-google-workspace.sh"); process.exitCode = 2; return; }
  const client = loadClient();
  if (!client || !client.client_id) {
    emit(parsed, { ok: false, code: "GWS_NO_CLIENT", detail: "place OAuth client at " + clientFile() }, "Missing OAuth client at " + clientFile());
    process.exitCode = 2;
    return;
  }
  const http = require("node:http");
  const url = require("node:url");
  const oauth = new google.auth.OAuth2(client.client_id, client.client_secret, "http://127.0.0.1");
  const authUrl = oauth.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES });
  const server = http.createServer((req, res) => {
    const q = url.parse(req.url || "", true).query;
    if (!q || !q.code) { res.statusCode = 400; res.end("Missing code"); return; }
    oauth.getToken(String(q.code)).then((r) => {
      fs.mkdirSync(credsDir(), { recursive: true, mode: 0o700 });
      fs.writeFileSync(tokensFile(), JSON.stringify(r.tokens, null, 2), { mode: 0o600 });
      try { fs.chmodSync(tokensFile(), 0o600); } catch { /* best effort */ }
      res.end("Linked. You may close this tab.");
      server.close();
      emit(parsed, { ok: true, connector: connectorStatus().connector }, "OK linked " + CONNECTOR_ID);
    }).catch((err) => {
      res.statusCode = 500;
      res.end("Token exchange failed");
      emit(parsed, { ok: false, code: "GWS_AUTH_FAILED", detail: String(err && err.message || err) }, "Auth failed");
      process.exitCode = 1;
      server.close();
    });
  });
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    oauth.redirectUri = "http://127.0.0.1:" + port;
    const finalUrl = oauth.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES });
    emit(parsed, { ok: true, pending: true, url: finalUrl }, "Open this URL to link:\n" + finalUrl);
    void authUrl;
  });
}

function authStatus(parsed) {
  const st = connectorStatus();
  emit(parsed, st, st.connector.id + " [" + st.connector.status + "] scopes=" + st.connector.scopes.length);
}

function authRevoke(parsed) {
  if (!parsed.apply) {
    emit(parsed, formatDryRun("auth.revoke", { file: tokensFile() }), "DRY-RUN auth revoke " + tokensFile() + " (re-run with --apply)");
    return;
  }
  try { fs.unlinkSync(tokensFile()); } catch { /* already unlinked */ }
  emit(parsed, { ok: true, revoked: true }, "OK revoked " + CONNECTOR_ID);
}

function tasksOp(parsed) {
  const sub = parsed.sub || "list";
  if (sub === "list") {
    const payload = { tasklist: parsed.flags.tasklist || "@default", maxResults: parsed.flags.limit || 20 };
    if (!parsed.apply) { emit(parsed, formatDryRun("tasks.list", payload), "DRY-RUN tasks list " + JSON.stringify(payload)); return; }
    const c = authedClient();
    if (c.error) { emit(parsed, c.error, "DENIED " + c.error.code); process.exitCode = 2; return; }
    c.google.tasks({ version: "v1", auth: c.auth }).tasks.list({ tasklist: payload.tasklist, maxResults: Number(payload.maxResults) }).then((r) => {
      emit(parsed, { ok: true, items: (r.data && r.data.items) || [] }, JSON.stringify((r.data && r.data.items) || [], null, 2));
    }).catch((err) => { emit(parsed, { ok: false, code: "GWS_API_ERROR", detail: String(err.message || err) }, "API error"); process.exitCode = 1; });
    return;
  }
  if (sub === "get" || sub === "create" || sub === "update") {
    const body = {};
    if (parsed.flags.title) body.title = parsed.flags.title;
    if (parsed.flags.notes) body.notes = parsed.flags.notes;
    if (parsed.flags.due) body.due = parsed.flags.due;
    if (parsed.flags.status) body.status = parsed.flags.status;
    const payload = { tasklist: parsed.flags.tasklist || "@default", id: parsed.positional[0] || parsed.flags.id, body };
    if (!parsed.apply) { emit(parsed, formatDryRun("tasks." + sub, payload), "DRY-RUN tasks " + sub + " " + JSON.stringify(payload)); return; }
    const c = authedClient();
    if (c.error) { emit(parsed, c.error, "DENIED " + c.error.code); process.exitCode = 2; return; }
    const api = c.google.tasks({ version: "v1", auth: c.auth }).tasks;
    const p = sub === "create"
      ? api.insert({ tasklist: payload.tasklist, requestBody: body })
      : sub === "get"
        ? api.get({ tasklist: payload.tasklist, task: payload.id })
        : api.patch({ tasklist: payload.tasklist, task: payload.id, requestBody: body });
    p.then((r) => { emit(parsed, { ok: true, item: r.data }, JSON.stringify(r.data, null, 2)); })
      .catch((err) => { emit(parsed, { ok: false, code: "GWS_API_ERROR", detail: String(err.message || err) }, "API error"); process.exitCode = 1; });
    return;
  }
  emit(parsed, { ok: false, code: "GWS_USAGE", detail: "tasks list|get|create|update" }, "usage: tasks list|get|create|update");
  process.exitCode = 2;
}

function remindersOp(parsed) {
  if ((parsed.sub || "create") !== "create") {
    emit(parsed, { ok: false, code: "GWS_USAGE", detail: "reminders create --title T [--due DATE] [--timed --time RFC3333]" }, "usage: reminders create");
    process.exitCode = 2;
    return;
  }
  let plan;
  try {
    plan = buildReminderPlan({
      title: parsed.flags.title,
      dueDate: parsed.flags.due,
      timed: Boolean(parsed.flags.timed || parsed.flags.time),
      dateTime: parsed.flags.time,
      timeZone: parsed.flags.tz,
      notes: parsed.flags.notes,
    });
  } catch (err) {
    emit(parsed, { ok: false, code: "GWS_USAGE", detail: String(err.message || err) }, "usage: reminders create --title T [--due DATE] [--timed --time RFC3333]");
    process.exitCode = 2;
    return;
  }
  const payload = { tasklist: parsed.flags.tasklist || "@default", calendarId: parsed.flags.calendar || "primary", plan };
  if (!parsed.apply) { emit(parsed, formatDryRun("reminders.create", payload), "DRY-RUN reminder Task" + (plan.event ? " + Calendar event" : "") + " " + JSON.stringify(plan)); return; }
  const c = authedClient();
  if (c.error) { emit(parsed, c.error, "DENIED " + c.error.code); process.exitCode = 2; return; }
  const tasksApi = c.google.tasks({ version: "v1", auth: c.auth }).tasks;
  tasksApi.insert({ tasklist: payload.tasklist, requestBody: plan.task }).then((r) => {
    const created = r.data;
    if (!plan.event) { emit(parsed, { ok: true, task: created }, JSON.stringify(created, null, 2)); return; }
    c.google.calendar({ version: "v3", auth: c.auth }).events.insert({
      calendarId: payload.calendarId,
      requestBody: Object.assign({}, plan.event, { description: "Linked Task: " + (created.id || "") }),
    }).then((e) => { emit(parsed, { ok: true, task: created, event: e.data }, JSON.stringify({ task: created, event: e.data }, null, 2)); })
      .catch((err) => { emit(parsed, { ok: false, code: "GWS_API_ERROR", detail: String(err.message || err) }, "API error"); process.exitCode = 1; });
  }).catch((err) => { emit(parsed, { ok: false, code: "GWS_API_ERROR", detail: String(err.message || err) }, "API error"); process.exitCode = 1; });
}

function calendarOp(parsed) {
  const sub = parsed.sub || "list";
  if (sub === "list") {
    const payload = { calendarId: parsed.flags.calendar || "primary", maxResults: parsed.flags.limit || 10 };
    if (!parsed.apply) { emit(parsed, formatDryRun("calendar.list", payload), "DRY-RUN calendar list " + JSON.stringify(payload)); return; }
    const c = authedClient();
    if (c.error) { emit(parsed, c.error, "DENIED " + c.error.code); process.exitCode = 2; return; }
    c.google.calendar({ version: "v3", auth: c.auth }).events.list({ calendarId: payload.calendarId, maxResults: Number(payload.maxResults), singleEvents: true, orderBy: "startTime", timeMin: new Date().toISOString() }).then((r) => {
      emit(parsed, { ok: true, items: (r.data && r.data.items) || [] }, JSON.stringify((r.data && r.data.items) || [], null, 2));
    }).catch((err) => { emit(parsed, { ok: false, code: "GWS_API_ERROR", detail: String(err.message || err) }, "API error"); process.exitCode = 1; });
    return;
  }
  if (sub === "get" || sub === "create") {
    const payload = { calendarId: parsed.flags.calendar || "primary", id: parsed.positional[0] || parsed.flags.id, body: parsed.flags.title ? buildEventBody({ title: parsed.flags.title, dateTime: parsed.flags.time, notes: parsed.flags.notes, timeZone: parsed.flags.tz }) : {} };
    if (!parsed.apply) { emit(parsed, formatDryRun("calendar." + sub, payload), "DRY-RUN calendar " + sub + " " + JSON.stringify(payload)); return; }
    const c = authedClient();
    if (c.error) { emit(parsed, c.error, "DENIED " + c.error.code); process.exitCode = 2; return; }
    const api = c.google.calendar({ version: "v3", auth: c.auth }).events;
    const p = sub === "create" ? api.insert({ calendarId: payload.calendarId, requestBody: payload.body }) : api.get({ calendarId: payload.calendarId, eventId: payload.id });
    p.then((r) => { emit(parsed, { ok: true, item: r.data }, JSON.stringify(r.data, null, 2)); })
      .catch((err) => { emit(parsed, { ok: false, code: "GWS_API_ERROR", detail: String(err.message || err) }, "API error"); process.exitCode = 1; });
    return;
  }
  emit(parsed, { ok: false, code: "GWS_USAGE", detail: "calendar list|get|create" }, "usage: calendar list|get|create");
  process.exitCode = 2;
}

function docsOp(parsed) {
  const sub = parsed.sub || "list";
  if (sub === "list") {
    const payload = { query: parsed.flags.query || "mimeType='application/vnd.google-apps.document'", maxResults: parsed.flags.limit || 10 };
    if (!parsed.apply) { emit(parsed, formatDryRun("docs.list", payload), "DRY-RUN docs list " + JSON.stringify(payload)); return; }
    const c = authedClient();
    if (c.error) { emit(parsed, c.error, "DENIED " + c.error.code); process.exitCode = 2; return; }
    c.google.drive({ version: "v3", auth: c.auth }).files.list({ q: payload.query, pageSize: Number(payload.maxResults), fields: "files(id,name,mimeType,modifiedTime)" }).then((r) => {
      emit(parsed, { ok: true, items: (r.data && r.data.files) || [] }, JSON.stringify((r.data && r.data.files) || [], null, 2));
    }).catch((err) => { emit(parsed, { ok: false, code: "GWS_API_ERROR", detail: String(err.message || err) }, "API error"); process.exitCode = 1; });
    return;
  }
  if (sub === "get") {
    const id = parsed.positional[0] || parsed.flags.id;
    if (!id) { emit(parsed, { ok: false, code: "GWS_USAGE", detail: "docs get <file-id>" }, "usage: docs get <file-id>"); process.exitCode = 2; return; }
    const payload = { fileId: id, mimeType: parsed.flags.mime || "text/plain" };
    if (!parsed.apply) { emit(parsed, formatDryRun("docs.get", payload), "DRY-RUN docs get " + JSON.stringify(payload)); return; }
    const c = authedClient();
    if (c.error) { emit(parsed, c.error, "DENIED " + c.error.code); process.exitCode = 2; return; }
    c.google.drive({ version: "v3", auth: c.auth }).files.export({ fileId: id, mimeType: payload.mimeType }).then((r) => {
      emit(parsed, { ok: true, body: r.data }, String(r.data).slice(0, 4000));
    }).catch((err) => { emit(parsed, { ok: false, code: "GWS_API_ERROR", detail: String(err.message || err) }, "API error"); process.exitCode = 1; });
    return;
  }
  emit(parsed, { ok: false, code: "GWS_USAGE", detail: "docs list|get" }, "usage: docs list|get");
  process.exitCode = 2;
}

/** People API helpers for org contact sync (SKIP when unlinked). */
function peopleConnections() {
  const c = authedClient();
  if (c.error) return Promise.resolve(c.error);
  return c.google.people({ version: "v1", auth: c.auth }).people.connections.list({
    resourceName: "people/me", pageSize: 50, personFields: "names,emailAddresses,phoneNumbers",
  }).then((r) => ({ ok: true, connections: ((r.data && r.data.connections) || []) }))
    .catch((err) => ({ ok: false, code: "GWS_API_ERROR", detail: String(err.message || err) }));
}

function peopleCreateContact(f) {
  const c = authedClient();
  if (c.error) return Promise.resolve(c.error);
  return c.google.people({ version: "v1", auth: c.auth }).people.createContact({
    requestBody: {
      names: [{ givenName: String((f && f.name) || "") }],
      emailAddresses: (f && f.email) ? [{ value: String(f.email) }] : [],
      phoneNumbers: (f && f.phone) ? [{ value: String(f.phone) }] : [],
    },
  }).then((r) => ({ ok: true, resourceName: r.data && r.data.resourceName }))
    .catch((err) => ({ ok: false, code: "GWS_API_ERROR", detail: String(err.message || err) }));
}

function printHelp(parsed) {
  const help = [
    "gws — opt-in Google Workspace connector (default DRY-RUN; --apply executes)",
    "",
    "  auth login|status|revoke     link / connector status / unlink",
    "  tasks list|get|create|update [--tasklist ID] [--title T] [--due DATE] [--notes N]",
    "  reminders create --title T [--due DATE] [--timed --time RFC3333] [--notes N]",
    "  calendar list|get|create [--calendar ID] [--title T --time RFC3333]",
    "  docs list|get [--query Q] [<file-id>]",
    "",
    "Reminders are Tasks: a reminder is a Task with a due date; --timed adds",
    "a linked Calendar event with a popup. Flags: --apply --json.",
  ].join("\n");
  emit(parsed, { ok: true, help: true, scopes: SCOPES }, help);
}

function main(argv) {
  const parsed = parseArgs(argv);
  if (!parsed.command || parsed.command === "help" || parsed.flags.h || parsed.flags.help) { printHelp(parsed); return; }
  if (parsed.command === "auth") {
    if (parsed.sub === "login") { authLogin(parsed); return; }
    if (!parsed.sub || parsed.sub === "status") { authStatus(parsed); return; }
    if (parsed.sub === "revoke") { authRevoke(parsed); return; }
  }
  if (parsed.command === "tasks") { tasksOp(parsed); return; }
  if (parsed.command === "reminders") { remindersOp(parsed); return; }
  if (parsed.command === "calendar") { calendarOp(parsed); return; }
  if (parsed.command === "docs") { docsOp(parsed); return; }
  emit(parsed, { ok: false, code: "GWS_USAGE", detail: "unknown command " + parsed.command }, "unknown command: " + parsed.command);
  process.exitCode = 2;
}

module.exports = {
  CONNECTOR_ID,
  CONNECTOR_NAME,
  CONNECTOR_CATEGORY,
  SCOPES,
  DEFAULT_TIME_ZONE,
  REMINDER_POPUP_MINUTES,
  credsDir,
  clientFile,
  tokensFile,
  loadTokens,
  isLinked,
  connectorStatus,
  buildTaskBody,
  buildEventBody,
  buildReminderPlan,
  formatDryRun,
  parseArgs,
  peopleConnections,
  peopleCreateContact,
  main,
};

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error("gws: " + String((err && err.message) || err));
    process.exit(1);
  }
}
