"use strict";

/**
 * R&D option scoring (researcher decision support).
 *
 * Pure module: no fs, no child_process, no process.env (invariants 15/19).
 * A researcher agent gathers options from official sources only (docs,
 * registry metadata, release notes — never blog hearsay) at the latest
 * stable version (never alpha/beta/rc unless the caller pins it), and
 * this module ranks them deterministically.
 *
 * `scoreOption({ maturity, maintenance, licenseOk, docs, perf, cost })`
 * scores 0..100 with documented weights: maturity 25, maintenance 20,
 * license 20 (binary gate scaled), docs 15, perf 10, cost 10. Each input
 * is 0..1 (licenseOk is boolean). Missing inputs count as 0 — an
 * unscored dimension never silently helps.
 *
 * `pickBest(options)` returns { best, ranked } with rank order and
 * margins; ties break by name for determinism. Empty input returns
 * { best: null, ranked: [] } (never throws — fail-open for the loop).
 */

const WEIGHTS = {
  maturity: 25,
  maintenance: 20,
  license: 20,
  docs: 15,
  perf: 10,
  cost: 10,
};

function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** Score one option 0..100. Pure. */
function scoreOption(opt) {
  const o = opt || {};
  const license = o.licenseOk === true ? 1 : 0;
  const total =
    clamp01(o.maturity) * WEIGHTS.maturity +
    clamp01(o.maintenance) * WEIGHTS.maintenance +
    license * WEIGHTS.license +
    clamp01(o.docs) * WEIGHTS.docs +
    clamp01(o.perf) * WEIGHTS.perf +
    clamp01(o.cost) * WEIGHTS.cost;
  return Math.round(total);
}

/**
 * Rank options deterministically (score desc, name asc).
 * @returns {{ best: object|null, ranked: Array<{name, score, margin}> }}
 */
function pickBest(options) {
  const list = Array.isArray(options) ? options : [];
  if (!list.length) return { best: null, ranked: [] };
  const scored = list.map((o) => ({
    name: String((o && o.name) || "unnamed"),
    score: scoreOption(o),
    ref: o,
  }));
  scored.sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const top = scored[0].score;
  return {
    best: scored[0].ref,
    ranked: scored.map((s) => ({ name: s.name, score: s.score, margin: top - s.score })),
  };
}

module.exports = {
  WEIGHTS,
  scoreOption,
  pickBest,
};
