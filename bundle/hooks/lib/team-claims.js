urn claimsJson.findLiveSlot(o);
}
function heartbeatClaim(opts) {
  const o = opts || {};
  if (store.isAvailable()) {
    const db = store.initDb();
    if (db) {
      const key = o.claimKey || claimKeyStr(o.team, o.member, o.workspaceSlug, o.sessionId);
      const row = db.prepare("SELECT * FROM claims WHERE claim_key = ?").get(key);
      if (!row) return null;
      const now2 = now();
      db.prepare("UPDATE claims SET heartbeat_at = ?, updated_at = ? WHERE claim_key = ?").run(now2, now2, key);
      return rowToClaim(Object.assign({}, row, { heartbeat_at: now2, updated_at: now2 }));
    }
  }
  return claimsJson.heartbeatClaim(o);
}
function releaseClaim(opts) {
  const o = opts || {};
  if (store.isAvailable()) {
    const db = store.initDb();
    if (db) {
      const key = o.claimKey || claimKeyStr(o.team, o.member, o.workspaceSlug, o.sessionId);
      const row = db.prepare("SELECT * FROM claims WHERE claim_key = ?").get(key);
      if (!row) return false;
      db.prepare("DELETE FROM claims WHERE claim_key = ?").run(key);
      return true;
    }
  }
  return claimsJson.releaseClaim(o);
}
function getClaims(opts) {
  const o = opts || {};
  if (store.isAvailable()) {
    const db = store.initDb();
    if (db) {
      const projectSlug = o.projectSlug || null;
      const rows = db.prepare("SELECT * FROM claims WHERE project_slug IS NOT NULL AND project_slug = ?").all(projectSlug);
      return rows.map(r => rowToClaim(r));
    }
  }
  const all = Object.values(claimsJson.readAll(o.worktreePath));
  const now = Date.now(); const thresh = Number.isFinite(o.staleMs) ? o.staleMs : STALE_MS;
  return all.filter(c => !isStaleClaim(c, now, thresh));
}
function gcClaims(opts) {
  const o = opts || {};
  if (store.isAvailable()) {
    const db = store.initDb();
    if (db) {
      const projectSlug = o.projectSlug || null;
      const now = Date.now(); const thresh = Number.isFinite(o.staleMs) ? o.staleMs : STALE_MS;
      const rows = db.prepare("SELECT * FROM claims WHERE project_slug IS NOT NULL AND project_slug = ?").all(projectSlug);
      const pruned = [];
      for (const r of rows) {
        const c = rowToClaim(r);
        if (isStaleClaim(c, now, thresh)) {
          db.prepare("DELETE FROM claims WHERE id = ?").run(r.id);
          pruned.push(r.claim_key);
        }
      }
      return pruned;
    }
  }
  return claimsJson.gcClaims(o);
}
function findClaim(opts) {
  const o = opts || {};
  if (o.claimKey) {
    if (store.isAvailable()) {
      const db = store.initDb();
      if (db) { const row = db.prepare("SELECT * FROM claims WHERE claim_key = ?").get(o.claimKey); return rowToClaim(row); }
    }
    return claimsJson.getClaim(o.claimKey, o.worktreePath);
  }
  return findLiveSlot(o);
}
function listClaims(opts) {
  const o = opts || {};
  if (store.isAvailable()) {
    const db = store.initDb();
    if (db) {
      const projectSlug = o.projectSlug || null;
      const rows = db.prepare("SELECT * FROM claims WHERE project_slug IS NOT NULL AND project_slug = ?").all(projectSlug);
      const now = Date.now(); const thresh = Number.isFinite(o.staleMs) ? o.staleMs : STALE_MS;
      return rows.map(r => rowToClaim(r)).filter(c => !isStaleClaim(c, now, thresh)).sort((a, b) => String(a.claimKey).localeCompare(String(b.claimKey)));
    }
  }
  return claimsJson.listClaims(o);
}
function groupByTeam(claims) {
  const groups = {};
  for (const c of Array.isArray(claims) ? claims : []) {
    if (!c || typeof c !== "object") continue;
    const id = (c.teamId || c.team || "solo") && sanitizeName(c.teamId || c.team);
    const gid = id || "solo";
    if (!groups[gid]) groups[gid] = { teamId: gid, teamDisplay: c.team ? capName(sanitizeName(c.team)) : "Solo", members: [] };
    groups[gid].members.push(c);
  }
  return groups;
}
module.exports = {
  CLAIMS_FILE, STALE_MS, claimsDir, claimsFile,
  claimSession, findLiveSlot, heartbeatClaim, releaseClaim,
  getClaim: (k, w) => {
    if (store.isAvailable()) { const db = store.initDb(); if (db) { const r = db.prepare("SELECT * FROM claims WHERE claim_key = ?").get(k); return rowToClaim(r); } }
    return claimsJson.getClaim(k, w);
  },
  findClaim, listClaims, gcClaims, groupByTeam,
  normalizeScope, scopesOverlap,
  memberBranch: (p) => `member/${sanitizeName(p.team) || "solo"}/${sanitizeName(p.member) || "unknown"}`,
  sanitizeName, capName, displayFor, resolveProjectSlug, isStaleClaim,
};
