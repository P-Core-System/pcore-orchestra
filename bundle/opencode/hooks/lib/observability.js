"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { MAX_METRICS_POINTS, MAX_SLOS, MAX_INCIDENTS } = require("./constants.js");

const METRICS_PATH = path.join(__dirname, "..", "state", "orchestra-metrics.json");

const DEFAULT_METRICS_STATE = {
  version: 1,
  metrics: [],
  slos: [],
  incidents: [],
};

function loadMetricsState() {
  try {
    if (!fs.existsSync(METRICS_PATH)) return { ...DEFAULT_METRICS_STATE, metrics: [], slos: [], incidents: [] };
    const raw = JSON.parse(fs.readFileSync(METRICS_PATH, "utf8"));
    return { ...DEFAULT_METRICS_STATE, ...raw };
  } catch {
    return { ...DEFAULT_METRICS_STATE, metrics: [], slos: [], incidents: [] };
  }
}

function saveMetricsState(ms) {
  fs.mkdirSync(path.dirname(METRICS_PATH), { recursive: true });
  if (ms.metrics.length > MAX_METRICS_POINTS) ms.metrics = ms.metrics.slice(-MAX_METRICS_POINTS);
  if (ms.slos.length > MAX_SLOS) ms.slos = ms.slos.slice(-MAX_SLOS);
  if (ms.incidents.length > MAX_INCIDENTS) ms.incidents = ms.incidents.slice(-MAX_INCIDENTS);
  fs.writeFileSync(METRICS_PATH, JSON.stringify(ms, null, 2));
}

function recordMetric(ms, { name, value, unit, labels }) {
  const point = {
    name,
    value,
    unit: unit || "count",
    labels: labels || {},
    timestamp: new Date().toISOString(),
  };
  ms.metrics.push(point);
  saveMetricsState(ms);
  return point;
}

function defineSlo(ms, { name, target, measurement, description }) {
  const slo = {
    id: "slo-" + Date.now().toString(36),
    name,
    target,
    measurement: measurement || "availability",
    description: description || "",
    createdAt: new Date().toISOString(),
    currentValue: null,
    lastUpdated: null,
    violations: [],
  };
  ms.slos.push(slo);
  saveMetricsState(ms);
  return slo;
}

function updateSloValue(ms, sloId, value) {
  const slo = ms.slos.find(s => s.id === sloId);
  if (!slo) return null;
  slo.currentValue = value;
  slo.lastUpdated = new Date().toISOString();
  if (value < slo.target) {
    slo.violations.push({
      value,
      target: slo.target,
      timestamp: slo.lastUpdated,
    });
  }
  saveMetricsState(ms);
  return slo;
}

function recordIncident(ms, { severity, title, description, duration, affected }) {
  const incident = {
    id: "inc-" + Date.now().toString(36),
    severity: severity || "minor",
    title,
    description: description || "",
    duration: duration || 0,
    affected: affected || [],
    detectedAt: new Date().toISOString(),
    resolvedAt: null,
    status: "detected",
  };
  ms.incidents.push(incident);
  saveMetricsState(ms);
  return incident;
}

function resolveIncident(ms, incidentId) {
  const inc = ms.incidents.find(i => i.id === incidentId);
  if (!inc) return null;
  inc.status = "resolved";
  inc.resolvedAt = new Date().toISOString();
  saveMetricsState(ms);
  return inc;
}

function calculateAvailability(metricsPoints, windowMs) {
  const cutoff = Date.now() - (windowMs || 86400000);
  const recent = metricsPoints.filter(m =>
    m.name === "uptime" && new Date(m.timestamp).getTime() > cutoff
  );
  if (recent.length === 0) return 1;
  const up = recent.filter(m => m.value === 1).length;
  return up / recent.length;
}

function generateHealthReport(ms) {
  const lines = ["## Health Report\n"];
  const availability24h = calculateAvailability(ms.metrics, 86400000);
  const availability7d = calculateAvailability(ms.metrics, 604800000);

  lines.push(`**Availability (24h):** ${(availability24h * 100).toFixed(2)}%`);
  lines.push(`**Availability (7d):** ${(availability7d * 100).toFixed(2)}%`);

  lines.push(`\n**SLOs:**`);
  for (const slo of ms.slos) {
    const status = slo.currentValue !== null && slo.currentValue < slo.target ? "VIOLATED" : "OK";
    lines.push(`- ${slo.name}: target=${slo.target}, current=${slo.currentValue ?? "N/A"} [${status}]`);
  }

  const activeIncidents = ms.incidents.filter(i => i.status === "detected");
  lines.push(`\n**Incidents:** ${ms.incidents.length} total, ${activeIncidents.length} active`);
  for (const inc of activeIncidents) {
    lines.push(`- [${inc.severity}] ${inc.title} (detected ${inc.detectedAt})`);
  }

  const latestMetrics = ms.metrics.slice(-50);
  lines.push(`\n**Recent Metrics (last 50 points):**`);
  const grouped = {};
  for (const m of latestMetrics) {
    if (!grouped[m.name]) grouped[m.name] = [];
    grouped[m.name].push(m.value);
  }
  for (const [name, values] of Object.entries(grouped)) {
    const sum = values.reduce((a, b) => a + b, 0);
    lines.push(`- ${name}: count=${values.length}, avg=${(sum / values.length).toFixed(2)}`);
  }

  return lines.join("\n");
}

module.exports = {
  METRICS_PATH,
  DEFAULT_METRICS_STATE,
  loadMetricsState,
  saveMetricsState,
  recordMetric,
  defineSlo,
  updateSloValue,
  recordIncident,
  resolveIncident,
  calculateAvailability,
  generateHealthReport,
};
