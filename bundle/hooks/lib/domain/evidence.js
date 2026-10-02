"use strict";

const store = require("./store.js");

function appendEvidenceRun(input) {
  const o = input || {};
  const runId = o.runId || null;
  const records = Array.isArray(o.records) ? o.records.slice() : [];
  const event = {
    type: "evidence.run",
    entityId: runId,
    payload: {
      runId: runId,
      records: records,
    },
  };
  return store.appendEvent(event);
}

function loadEvidenceRun(runId) {
  const events = store.loadEvents();
  if (runId) {
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev && ev.type === "evidence.run" && ev.payload && ev.payload.runId === runId) {
        return ev.payload.records || [];
      }
    }
    return [];
  }
  if (events.length > 0) {
    const ev = events[events.length - 1];
    if (ev && ev.type === "evidence.run" && ev.payload) {
      return ev.payload.records || [];
    }
  }
  return [];
}

module.exports = {
  appendEvidenceRun,
  loadEvidenceRun,
};