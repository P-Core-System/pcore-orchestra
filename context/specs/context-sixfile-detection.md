# Spec: context-sixfile-detection

## Goal

When a workspace has a `context/` directory with six Markdown files, the orchestra automatically detects and injects the read order into every agent's context at session start and prompt time.

## Context

- Related overview/architecture sections: `context/architecture.md` (System boundaries → `context-detector.js`, Storage model → Target project context), `context/ai-workflow-rules.md` (Six-file integration rules, Repo-type scoping)
- Out of scope: Writing context files (that's `init-context.sh`), editing user's filled context, detecting non-six-file formats

## Requirements

1. Detect six-file context in workspace roots at `sessionStart` hook
2. Detect six-file context in workspace roots at `beforeSubmitPrompt` hook
3. Inject fixed read order: project-overview → architecture → code-standards → ui-context → ai-workflow-rules → progress-tracker
4. Reference paths relative to workspace root (not absolute machine paths)
5. Also detect `project.yaml` / `project.json` alongside six-file context
6. Must not break when context files are missing (note missing files, continue)
7. Must not overwrite existing user context in target projects (invariant: `init-context` no `--force`)

## Acceptance criteria

- [ ] `detectFullWorkspaceContext(input)` returns structured object with `hasSixFileContext`, `hasProjectYaml`, `missingFiles`
- [ ] `buildContextInjection()` produces injection string with relative paths in correct read order
- [ ] `detectProjectYamlInWorkspaces(input)` finds `project.yaml`/`project.json` in workspace roots
- [ ] `buildProjectYamlInjection(projectIdentity)` produces human-readable summary
- [ ] Session start hook injects context when workspace has six files
- [ ] Prompt hook injects context when workspace has six files
- [ ] Missing files are noted in injection (e.g., "Missing: ui-context.md")
- [ ] Paths in injection are workspace-relative (e.g., `context/architecture.md`)

## Done when (verifiable)

- Command: `node bundle/hooks/orchestra-health.js` → health check passes (includes context detection test)
- Command: `node -e "const c=require('./bundle/hooks/lib/context-detector.js'); console.log(c.detectFullWorkspaceContext({workspaceFolders:['/tmp/test']}))"` on a temp dir with six files → returns `{ hasSixFileContext: true, missingFiles: [] }`
- Command: same on empty dir → returns `{ hasSixFileContext: false, missingFiles: [...] }`

## Files (expected)

- `bundle/hooks/lib/context-detector.js` — detection + injection logic
- `bundle/hooks/orchestra-session.js` — sessionStart injection
- `bundle/hooks/orchestra-prompt.js` — beforeSubmitPrompt injection
- `bundle/opencode/hooks/lib/context-detector.js` — OpenCode mirror
- `bundle/opencode/hooks/orchestra-prompt.js` — OpenCode prompt injection

## Risks

- False positives if directory named `context/` exists but isn't the six-file set
- Monorepo: must detect per workspace folder, not just first folder
- Absolute paths leaking into injection (violates invariant #6 in architecture.md)