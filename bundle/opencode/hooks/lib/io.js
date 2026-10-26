"use strict";

// Qoder CLI sends agent_type/agent_id on SubagentStop; Cursor sends
// subagent_type. Cursor tool/lifecycle events carry conversation_id while
// sessionStart/sessionEnd carry session_id — accept both at the IO boundary
// so hooks stay host-agnostic.
function normalizeHookInput(input) {
  if (input && typeof input === "object") {
    if (!input.subagent_type && !input.subagentType) {
      if (input.agent_type) input.subagent_type = input.agent_type;
      else if (input.agentType) input.subagent_type = input.agentType;
    }
    if (
      !process.env.PCORE_SESSION_ID &&
      !process.env.OPENCODE_SESSION_ID &&
      !process.env.CLAUDE_CODE_SESSION_ID &&
      !process.env.CLAUDE_SESSION_ID &&
      !process.env.CURSOR_TRACE_ID
    ) {
      const sid =
        input.session_id ||
        input.sessionId ||
        input.conversation_id ||
        input.conversationId;
      if (sid) process.env.PCORE_SESSION_ID = String(sid);
    }
  }
  return input;
}

function readStdinJson() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      try {
        resolve(normalizeHookInput(data ? JSON.parse(data) : {}));
      } catch {
        resolve({});
      }
    });
  });
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

module.exports = { readStdinJson, emit, normalizeHookInput };
