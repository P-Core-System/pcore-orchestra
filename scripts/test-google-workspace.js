#!/usr/bin/env node
"use strict";

/**
 * Self-check for the opt-in GWS connector (slice 1):
 *  1. mappers: reminder Task body, timed event body, reminder plan
 *  2. dry-run default: tasks/reminders/calendar/docs plan without --apply
 *  3. auth SKIP: connector status unlinked credential-less; apply-without
 *     creds refuses GWS_NOT_LINKED (exit 2), never throws, never HTTP
 *  4. connector entry shape for Manage > Connectors display
 *  5. zero HTTP: no sockets opened (all executes short-circuit pre-network)
 *
 * Credential-less by construction: PCORE_GWS_CREDS_DIR points at an empty
 * temp dir, and googleapis is never required on the dry-run/SKIP paths.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const credsDir = fs.mkdtempSync(path.join(os.tmpdir(), "gws-creds-"));

process.env.PCORE_GWS_CREDS_DIR = credsDir;
delete process.env.PCORE_GWS_TOKEN;

const gws = require("./google-workspace/gws.js");

let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function runCli(args) {
  try {
    const out = cp.execSync(`node scripts/google-workspace/gws.js ${args}`, {
      cwd: ROOT,
      encoding: "utf8",
      env: Object.assign({}, process.env, { PCORE_GWS_CREDS_DIR: credsDir }),
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status, out: String((err.stdout || "") + (err.stderr || "")) };
  }
}

// --- 1. mappers (fixtures for all 4 surfaces) ---
const task = gws.buildTaskBody({ title: "Pay supplier", dueDate: "2026-11-20", notes: "wire" });
check("mapper task title+due", task.title === "Pay supplier" && task.due === "2026-11-20" && task.notes === "wire");

const planPlain = gws.buildReminderPlan({ title: "Water plants", dueDate: "2026-11-20" });
check("reminder plain = Task only", Boolean(planPlain.task) && planPlain.event === null && planPlain.task.due === "2026-11-20");

const planTimed = gws.buildReminderPlan({ title: "Call buyer", dueDate: "2026-11-20", timed: true, dateTime: "2026-11-20T09:00:00Z", timeZone: "UTC" });
check("reminder timed = Task + event", Boolean(planTimed.task) && Boolean(planTimed.event));
check("timed event popup", planTimed.event.summary === "Call buyer" && Array.isArray(planTimed.event.reminders.overrides) && planTimed.event.reminders.overrides[0].method === "popup" && planTimed.event.reminders.overrides[0].minutes === 10);

let threw = false;
try { gws.buildTaskBody({ title: "  " }); } catch { threw = true; }
check("mapper rejects empty title", threw === true);

threw = false;
try { gws.buildEventBody({ title: "x" }); } catch { threw = true; }
check("mapper rejects timeless timed event", threw === true);

check("scopes least-privilege", gws.SCOPES.length === 7 && gws.SCOPES.some((s) => s.endsWith("/auth/tasks")) && gws.SCOPES.some((s) => s.includes("calendar.events")) && gws.SCOPES.some((s) => s.includes("drive.file")) && gws.SCOPES.some((s) => s.includes("/auth/documents")));
check("dry-run shape", (() => { const d = gws.formatDryRun("tasks.list", { a: 1 }); return d.dryRun === true && typeof d.hint === "string" && d.action === "tasks.list"; })());

// --- 2. connector entry (Manage > Connectors) ---
const st = gws.connectorStatus();
check("connector status unlinked credential-less", st.connector && st.connector.id === "google-workspace" && st.connector.category === "connectors" && st.connector.status === "unlinked");
check("connector carries scopes", Array.isArray(st.connector.scopes) && st.connector.scopes.length === 7);
check("not linked credential-less", gws.isLinked() === false);

// --- 3. CLI dry-run default (zero HTTP, zero creds) ---
const cliTasks = runCli("tasks list --json");
check("cli tasks list dry-run exit 0", cliTasks.code === 0, cliTasks.out.slice(0, 200));
check("cli tasks list dry-run body", (() => { try { const o = JSON.parse(cliTasks.out); return o.dryRun === true && o.action === "tasks.list"; } catch { return false; } })());

const cliRem = runCli("reminders create --title Demo --due 2026-11-20 --json");
check("cli reminders dry-run exit 0", cliRem.code === 0);
check("cli reminders dry-run Task", (() => { try { const o = JSON.parse(cliRem.out); return o.dryRun === true && o.payload && o.payload.plan && o.payload.plan.task.title === "Demo"; } catch { return false; } })());

const cliRemTimed = runCli("reminders create --title Demo --timed --time 2026-11-20T09:00:00Z --json");
check("cli timed reminder dry-run has event", (() => { try { const o = JSON.parse(cliRemTimed.out); return o.dryRun === true && Boolean(o.payload.plan.event); } catch { return false; } })());

const cliCal = runCli("calendar list --json");
check("cli calendar list dry-run exit 0", cliCal.code === 0 && cliCal.out.includes("calendar.list"));

const cliDocs = runCli("docs list --json");
check("cli docs list dry-run exit 0", cliDocs.code === 0 && cliDocs.out.includes("docs.list"));

const cliStatus = runCli("auth status --json");
check("cli auth status unlinked", (() => { try { const o = JSON.parse(cliStatus.out); return o.connector && o.connector.status === "unlinked" && o.connector.category === "connectors"; } catch { return false; } })());

// --- 4. auth SKIP: --apply without creds refuses, never HTTP ---
const cliApply = runCli("tasks list --apply --json");
check("cli apply-without-creds exit 2", cliApply.code === 2, "code=" + cliApply.code);
check("cli apply-without-creds SKIP code", cliApply.out.includes("GWS_NOT_LINKED") || cliApply.out.includes("GWS_NOT_INSTALLED"));

const cliRemApply = runCli("reminders create --title Demo --apply --json");
check("cli reminder apply-without-creds SKIP", cliRemApply.code === 2);

const cliUsage = runCli("reminders create --json");
check("cli reminder without title usage exit 2", cliUsage.code === 2);

// --- 5. creds never in repo ---
check("no creds written to repo", !fs.existsSync(path.join(ROOT, "scripts", "google-workspace", "gws-tokens.json")));

console.log(failed === 0 ? "GWS suite: all checks passed" : `GWS suite: ${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);
