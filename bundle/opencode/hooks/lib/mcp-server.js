"use strict";

/**
 * MCP Read-only Server for Orchestra.
 * 
 * Exposes run/status/gates/history via read-only resources and tools.
 * Reads from worktree-partitioned state (conductor-runs, domain-events).
 * Never mutates state.
 */

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// Import state readers
const { listRuns, readRun, getConductorBaseDir } = require("./conductor-state.js");
const { loadEvents } = require("./domain/store.js");
const { loadIndex } = require("./memory-index.js");

class McpServer {
  constructor() {
    this.server = new Server(
      {
        name: "pcore-orchestra-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );
    this.transport = null;
    this._resources = [];
    this._tools = [];
    this.setupHandlers();
  }

  setupHandlers() {
    // List resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const resources = [];
      
      // Add run resources
      try {
        const runs = listRuns({});
        for (const run of runs) {
          const runId = run.workspaceSlug + "/" + run.sessionId + "/" + run.taskId;
          resources.push({
            uri: "run://" + runId,
            name: "Run: " + run.goal,
            description: "Orchestra run " + runId + " - " + run.phase + " (" + run.status + ")",
            mimeType: "application/json",
          });
          resources.push({
            uri: "run://" + runId + "/gates",
            name: "Gates for " + runId,
            description: "Quality gate results for run " + runId,
            mimeType: "application/json",
          });
          resources.push({
            uri: "run://" + runId + "/evidence",
            name: "Evidence for " + runId,
            description: "Evidence records for run " + runId,
            mimeType: "application/json",
          });
          resources.push({
            uri: "run://" + runId + "/handoff",
            name: "Handoff for " + runId,
            description: "Handoff text for run " + runId,
            mimeType: "text/plain",
          });
        }
      } catch (e) {}
      
      this._resources = resources;
      return { resources };
    });

    // Read resource
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      
      // Parse run://<runId>/<resource>
      const match = uri.match(/^run:\/\/([^/]+)\/(.+)$/);
      if (!match) {
        throw new Error("Invalid resource URI: " + uri);
      }
      
      const runId = match[1];
      const resource = match[2];
      
      const run = readRun(runId);
      if (!run) {
        throw new Error("Run not found: " + runId);
      }
      
      switch (resource) {
        case "status":
          return {
            contents: [{
              uri: uri,
              mimeType: "application/json",
              text: JSON.stringify({
                runId: runId,
                goal: run.goal,
                phase: run.phase,
                status: run.status,
                startedAt: run.startedAt,
                lastHeartbeat: run.lastHeartbeat,
                completedAt: run.completedAt,
                failReason: run.failReason,
              }, null, 2),
            }],
          };
        case "gates":
          return {
            contents: [{
              uri: uri,
              mimeType: "application/json",
              text: JSON.stringify({
                runId: runId,
                phaseResults: run.phaseResults || {},
                qualityGates: run.qualityGates || { passed: [], failed: [], skipped: [] },
              }, null, 2),
            }],
          };
        case "evidence":
          // Read evidence from domain events
          let evidence = [];
          try {
            const events = loadEvents(run.worktreePath);
            const evidenceRuns = events.filter(function(e) { return e.type === "evidence.run"; });
            if (evidenceRuns.length > 0) {
              evidence = evidenceRuns[evidenceRuns.length - 1].payload?.records || [];
            }
          } catch (e) {}
          return {
            contents: [{
              uri: uri,
              mimeType: "application/json",
              text: JSON.stringify({ runId: runId, evidence: evidence }, null, 2),
            }],
          };
        case "handoff":
          // Generate handoff text from run state
          const handoff = this.generateHandoff(run);
          return {
            contents: [{
              uri: uri,
              mimeType: "text/plain",
              text: handoff,
            }],
          };
        default:
          throw new Error("Unknown resource: " + resource);
      }
    });

    // List tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = [
        {
          name: "get_run_status",
          description: "Get the status of an orchestra run",
          inputSchema: {
            type: "object",
            properties: {
              runId: { type: "string", description: "Run ID (workspaceSlug/sessionId/taskId)" },
            },
            required: ["runId"],
          },
        },
        {
          name: "get_gate_results",
          description: "Get quality gate results for a run",
          inputSchema: {
            type: "object",
            properties: {
              runId: { type: "string", description: "Run ID" },
            },
            required: ["runId"],
          },
        },
        {
          name: "get_evidence",
          description: "Get evidence records for a run",
          inputSchema: {
            type: "object",
            properties: {
              runId: { type: "string", description: "Run ID" },
            },
            required: ["runId"],
          },
        },
        {
          name: "list_runs",
          description: "List all orchestra runs",
          inputSchema: {
            type: "object",
            properties: {
              workspace: { type: "string", description: "Optional workspace filter" },
              status: { type: "string", description: "Optional status filter" },
            },
          },
        },
      ];
      this._tools = tools;
      return { tools };
    });

    // Call tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const name = request.params.name;
      const args = request.params.arguments;
      
      switch (name) {
        case "get_run_status": {
          const run = readRun(args.runId);
          if (!run) {
            return {
              content: [{ type: "text", text: "Run not found: " + args.runId }],
              isError: true,
            };
          }
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                runId: args.runId,
                goal: run.goal,
                phase: run.phase,
                status: run.status,
                startedAt: run.startedAt,
                lastHeartbeat: run.lastHeartbeat,
                completedAt: run.completedAt,
                failReason: run.failReason,
              }, null, 2),
            }],
          };
        }
        case "get_gate_results": {
          const run = readRun(args.runId);
          if (!run) {
            return {
              content: [{ type: "text", text: "Run not found: " + args.runId }],
              isError: true,
            };
          }
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                runId: args.runId,
                phaseResults: run.phaseResults || {},
                qualityGates: run.qualityGates || { passed: [], failed: [], skipped: [] },
              }, null, 2),
            }],
          };
        }
        case "get_evidence": {
          const run = readRun(args.runId);
          if (!run) {
            return {
              content: [{ type: "text", text: "Run not found: " + args.runId }],
              isError: true,
            };
          }
          let evidence = [];
          try {
            const events = loadEvents(run.worktreePath);
            const evidenceRuns = events.filter(function(e) { return e.type === "evidence.run"; });
            if (evidenceRuns.length > 0) {
              evidence = evidenceRuns[evidenceRuns.length - 1].payload?.records || [];
            }
          } catch (e) {}
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ runId: args.runId, evidence: evidence }, null, 2),
            }],
          };
        }
        case "list_runs": {
          const runs = listRuns({
            workspace: args.workspace,
            status: args.status,
          });
          return {
            content: [{
              type: "text",
              text: JSON.stringify(runs.map(function(r) {
                return {
                  runId: r.workspaceSlug + "/" + r.sessionId + "/" + r.taskId,
                  goal: r.goal,
                  phase: r.phase,
                  status: r.status,
                  startedAt: r.startedAt,
                  lastHeartbeat: r.lastHeartbeat,
                };
              }), null, 2),
            }],
          };
        }
        default:
          throw new Error("Unknown tool: " + name);
      }
    });
  }

  generateHandoff(run) {
    const lines = [
      "Orchestra Run Handoff",
      "=====================",
      "Run ID: " + run.workspaceSlug + "/" + run.sessionId + "/" + run.taskId,
      "Goal: " + (run.goal || "(none)"),
      "Phase: " + run.phase,
      "Status: " + run.status,
      "Started: " + run.startedAt,
      "Last Heartbeat: " + run.lastHeartbeat,
      run.completedAt ? "Completed: " + run.completedAt : "",
      run.failReason ? "Fail Reason: " + run.failReason : "",
    ].filter(Boolean);
    
    if (run.phaseResults) {
      lines.push("", "Phase Results:");
      for (const phase of Object.keys(run.phaseResults)) {
        lines.push("  " + phase + ": " + JSON.stringify(run.phaseResults[phase]));
      }
    }
    
    return lines.join("\n");
  }

  /**
   * Start the MCP server.
   * @param {object} config - Configuration object
   * @param {number} [config.port] - Port for stdio transport (not used, stdio is fixed)
   * @returns {Promise<{port: number, close: Function}>}
   */
  async start(config) {
    config = config || {};
    this.transport = new StdioServerTransport();
    await this.server.connect(this.transport);
    
    // Return a server-like object with close method
    return {
      port: 0, // stdio transport doesn't use a port
      close: async () => {
        await this.server.close();
      },
      getResources: () => this.listResources(),
      getTools: () => this.listTools(),
    };
  }

  /**
   * List all registered resources.
   * @returns {Promise<Array>}
   */
  async listResources() {
    return this._resources || [];
  }

  /**
   * List all registered tools.
   * @returns {Promise<Array>}
   */
  async listTools() {
    return this._tools || [];
  }

  /**
   * Get conductor runs (for worktree-partitioned state reading).
   * @returns {Promise<Array>}
   */
  async getConductorRuns() {
    return listRuns({});
  }

  /**
   * Get domain events (for worktree-partitioned state reading).
   * @param {string} [worktreePath] - Optional worktree path
   * @returns {Promise<Array>}
   */
  async getDomainEvents(worktreePath) {
    return loadEvents(worktreePath);
  }

  /**
   * Stop the MCP server.
   */
  async stop() {
    if (this.server) {
      await this.server.close();
    }
  }
}

// Map to track MCP server instances per runId
const mcpServerInstances = new Map();

/**
 * Start the MCP server for a specific run.
 * @param {object} config - Configuration
 * @param {string} config.runId - Run ID for tracking
 * @param {number} [config.port] - Port for stdio transport (not used, stdio is fixed)
 * @param {string} [config.worktreePath] - Worktree path for state reading
 * @returns {Promise<object>} Server instance with port and close method
 */
async function start(config) {
  config = config || {};
  const runId = config.runId || `run-${Date.now()}`;
  
  // If instance already exists for this runId, return it
  if (mcpServerInstances.has(runId)) {
    return mcpServerInstances.get(runId);
  }
  
  const instance = new McpServer();
  const server = await instance.start(config);
  
  // Store instance with runId
  mcpServerInstances.set(runId, { instance, server, runId, worktreePath: config.worktreePath });
  
  return server;
}

/**
 * Stop the MCP server for a specific run.
 * @param {string} runId - Run ID to stop
 * @returns {Promise<void>}
 */
async function stop(runId) {
  if (!runId) return;
  const entry = mcpServerInstances.get(runId);
  if (entry) {
    await entry.instance.stop();
    mcpServerInstances.delete(runId);
  }
}

/**
 * Stop all MCP servers (for process exit cleanup).
 * @returns {Promise<void>}
 */
async function stopAll() {
  for (const [runId, entry] of mcpServerInstances.entries()) {
    try {
      await entry.instance.stop();
    } catch {}
  }
  mcpServerInstances.clear();
}

// Handle process exit and SIGTERM for cleanup
process.on("exit", () => {
  stopAll();
});

process.on("SIGTERM", () => {
  stopAll();
  process.exit(0);
});

process.on("SIGINT", () => {
  stopAll();
  process.exit(0);
});

module.exports = {
  McpServer: McpServer,
  start: start,
  stop: stop,
  stopAll: stopAll,
};
