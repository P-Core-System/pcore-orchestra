// Ambient Orchestra plugin — injects the orchestra-loop policy into every
// session's system prompt so any agent auto-runs plan -> implement -> verify
// -> review by spawning the orchestra phase subagents. OpenCode V2 plugin
// shape: default export { id, setup }. No external dependencies; every path
// is guarded so a failure here can never break session start.

const ORCHESTRA_POLICY = `## Ambient Orchestra Policy
For any implementation task (build, fix, refactor, implement, deploy, migrate, test, integrate, debug, continue), you MUST run the orchestra loop by spawning the phase subagents with the OpenCode \`subagent\` tool (agent name argument) — do not do the phase work yourself:
1. Spawn subagent "orchestra-planner" with the goal -> it returns a plan ending in PLAN_READY.
2. Spawn subagent "orchestra-implementer" with the goal + full plan inline -> it implements and commits, returns IMPLEMENT_DONE.
3. Spawn subagent "orchestra-verifier" -> it runs tests/lint and the git commit gate, returns VERIFY_PASS or VERIFY_FAIL.
4. Spawn subagent "orchestra-reviewer" -> final scope/quality review, returns ORCHESTRA_COMPLETE.
On VERIFY_FAIL / FIX_REQUIRED, loop back to orchestra-implementer (max 3 times), then escalate to the user.
Pass the plan text inline to every phase; phases run strictly sequentially.
If you ARE the orchestra conductor agent, follow your own agent instructions — this is a fallback for other agents.
For simple questions, explanations, or analysis with no code changes, answer directly WITHOUT spawning subagents.`;

export default {
  id: "orchestra-ambient",
  async setup(ctx) {
    try {
      if (!ctx || !ctx.session || typeof ctx.session.hook !== "function") return;
      await ctx.session.hook("context", (event) => {
        try {
          if (event && Array.isArray(event.system)) {
            event.system.push({ type: "text", text: ORCHESTRA_POLICY });
          }
        } catch {
          // A transform failure must never abort the model request.
        }
      });
    } catch {
      // A plugin failure must never break session start.
    }
  },
};
