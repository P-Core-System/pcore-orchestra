#!/usr/bin/env node
"use strict";

/**
 * CLI: start the MCP knowledge server over Streamable HTTP so remote
 * connectors (ChatGPT developer mode, Claude.ai, any HTTP MCP client) can
 * reach this project's docs/context/knowledge.
 *
 * Usage:
 *   node scripts/mcp-knowledge-server.js [--port 8765] [--host 127.0.0.1]
 *       [--root PATH] [--token SECRET] [--stdio]
 *
 * Defaults: host 127.0.0.1, port 8765, root = current directory.
 * Binding a non-loopback host requires a token (PCORE_MCP_TOKEN or --token),
 * because the read tools serve project files.
 * To expose to ChatGPT, front the loopback port with a tunnel
 * (e.g. `cloudflared tunnel --url http://localhost:8765`) and register the
 * public /mcp URL in the ChatGPT connectors settings.
 */

const { startHttp, start: startStdio } = require("../bundle/hooks/lib/mcp-server.js");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--stdio") out.transport = "stdio";
    else if (a === "--port") out.port = Number(argv[++i]);
    else if (a === "--host") out.host = argv[++i];
    else if (a === "--root") out.root = argv[++i];
    else if (a === "--token") out.token = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      [
        "Usage: node scripts/mcp-knowledge-server.js [--port 8765] [--host 127.0.0.1] [--root PATH] [--token SECRET] [--stdio]",
        "",
        "  --port   HTTP port (default 8765)",
        "  --host   bind address (default 127.0.0.1; non-loopback requires a token)",
        "  --root   project root served by the knowledge tools (default cwd)",
        "  --token  bearer token, overrides PCORE_MCP_TOKEN",
        "  --stdio  serve on stdin/stdout instead of HTTP",
        "",
      ].join("\n")
    );
    return;
  }
  if (args.root) process.env.PCORE_MCP_ROOT = args.root;

  if (args.transport === "stdio") {
    await startStdio({ runId: "knowledge-cli" });
    process.stderr.write("mcp knowledge server on stdio (root=" + (args.root || process.cwd()) + ")\n");
    return;
  }

  const server = await startHttp({
    host: args.host,
    port: args.port,
    token: args.token,
    log: (msg) => process.stderr.write(msg + "\n"),
  });
  process.stderr.write(
    "mcp knowledge server → http://" + server.host + ":" + server.port + server.path +
    " (root=" + (process.env.PCORE_MCP_ROOT || process.cwd()) + ", auth=" + (args.token || process.env.PCORE_MCP_TOKEN ? "bearer" : "loopback") + ")\n"
  );

  const shutdown = () => {
    server.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  process.stderr.write("fatal: " + e.message + "\n");
  process.exit(1);
});
