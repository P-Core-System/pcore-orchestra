"use strict";

const { detectProjectYamlInWorkspaces } = require("./context-detector.js");
const { loadProjectIdentity } = require("./project-identity.js");
const { extractOrchestraFromIdentity } = require("./orchestra-config.js");
const { syncProjectIdentity, syncIdentityToFile, saveState } = require("./state-manager.js");

/**
 * Sync global orchestra state project identity from the active workspace.
 * When idle: full identity + orchestraConfig refresh from project.yaml.
 * When active: update identityFile path only (do not swap project mid-run).
 *
 * @returns {{ identity, pyMeta, synced: boolean, reason: string } | null}
 */
function syncWorkspaceIdentity(state, input, options = {}) {
  const pyMeta = detectProjectYamlInWorkspaces(input);
  if (!pyMeta) return null;

  const identity = loadProjectIdentity(pyMeta.root);
  if (!identity?.project?.slug) return null;

  const workspaceSlug = identity.project.slug;
  const currentSlug = state.project?.slug || "";
  const stale = currentSlug && currentSlug !== workspaceSlug;

  syncIdentityToFile(state, identity, pyMeta.root);

  if (state.active) {
    saveState(state);
    return {
      identity,
      pyMeta,
      synced: false,
      reason: stale ? "active_run_identity_file_only" : "active_run",
    };
  }

  syncProjectIdentity(state, identity);
  const orchestraConfig = extractOrchestraFromIdentity(identity);
  if (orchestraConfig) state.orchestraConfig = orchestraConfig;
  saveState(state);

  return {
    identity,
    pyMeta,
    synced: true,
    reason: stale ? "stale_slug_refreshed" : "idle_workspace_sync",
  };
}

function buildIdentitySyncNotice(result) {
  if (!result?.synced) return "";
  const name = result.identity.project.display_name || result.identity.project.name;
  if (result.reason === "stale_slug_refreshed") {
    return `Project identity refreshed from workspace: **${name}** (${result.identity.project.slug}).`;
  }
  return `Project identity synced: **${name}** (${result.identity.project.slug}).`;
}

module.exports = {
  syncWorkspaceIdentity,
  buildIdentitySyncNotice,
};
