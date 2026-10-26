# P-Core Orchestra — Master Engineering, Agentic Execution, TDD & Verification Prompt

You are the principal software architect and senior software engineer responsible for completing and hardening the existing `pcore-orchestra` repository.

Your job is **NOT to merely document ideas**.

Your job is to:

1. Inspect the existing repository.
2. Understand what already exists.
3. Identify architectural inconsistencies and missing functionality.
4. Implement the required functionality in the actual codebase.
5. Test it using TDD and multiple verification layers.
6. Verify that the implementation works logically and technically.
7. Preserve existing Cursor/OpenCode compatibility.
8. Avoid unnecessary rewrites.
9. Produce evidence for every important completion claim.
10. Leave clear extension points for the future P-Core Orchestra UI, MCP, cloud sync, PWA, and live execution visualization.

The final system must distinguish between:

> **Agent says it is done**

and

> **The system has objectively verified that it is done.**

Never treat agent prose alone as proof of completion.

---

# 1. PRIMARY OBJECTIVE

Transform the current `pcore-orchestra` into a reliable Agentic Engineering orchestration core.

The target lifecycle is:

```text
User
  ↓
Ticket
  ↓
Conductor
  ↓
Plan
  ↓
Task Graph
  ↓
Agent Selection
  ↓
Agent Execution
  ↓
Events
  ↓
Artifacts / Code Changes
  ↓
Automated Tests
  ↓
Quality Gates
  ↓
Evidence
  ↓
Verification
  ↓
Optional Human Review
  ↓
Completion
```

The system must support:

```text
Ticket
Task
Plan
Session
AgentRun
Event
Artifact
Evidence
Verification
Review
Memory
Checkpoint
```

The system must be designed so that the future live UI can display:

```text
Ticket
  │
  ├── Planner
  │      │
  │      └── Implementer
  │               │
  │               ├── Tester
  │               ├── Security
  │               └── Verifier
  │
  └── Reviewer
```

as a **real execution graph**, not an animation or fake visualization.

---

# 2. FIRST RULE — AUDIT BEFORE MODIFYING

Before changing code:

1. Inspect the complete repository.
2. Identify:
   - source directories
   - scripts
   - hooks
   - agents
   - skills
   - configuration
   - tests
   - state handling
   - Cursor integration
   - OpenCode integration
   - documentation
   - existing CLI/runtime behavior
3. Determine what is:
   - implemented
   - partially implemented
   - documented only
   - dead code
   - duplicated
   - inconsistent
   - broken
4. Run the existing test/build/lint/type-check commands before modification.
5. Record the baseline.

Do NOT assume documentation accurately describes implementation.

The repository itself is the source of truth.

---

# 3. CURRENT KNOWN PROBLEMS TO INVESTIGATE AND FIX

The previous audit identified these areas. Verify them against the actual repository before implementation.

## Agent registry

There are many specialist agents but inconsistent inventories between:

- actual agent files
- documentation
- conductor allowlists
- hook matchers
- autonomy configuration
- agent-selector
- spawn matrix

Create a **single source of truth for agent metadata**.

Each agent should have structured metadata such as:

```yaml
id:
name:
category:
description:
phase:
capabilities:
platforms:
read:
write:
network:
shell:
risk_level:
requires_human_review:
enabled:
hidden:
completion_token:
```

Do not manually duplicate agent inventories across multiple files.

Generate derived configuration where practical.

---

# 4. FIX AGENT HANDSHAKE CONTRACTS

Audit all agent communication tokens.

For example, detect inconsistencies such as:

```text
TEAM_SELECTED
vs
AGENTS_SELECTED
```

and:

```text
WORKFLOW_PLAN_READY
vs
WORKFLOW_ORCHESTRATED
```

Define canonical protocol messages.

Create a versioned internal contract.

Example:

```text
ORCHESTRA/1
TEAM_SELECTED
PLAN_READY
TASK_STARTED
TASK_COMPLETED
TASK_FAILED
VERIFICATION_STARTED
VERIFICATION_PASSED
VERIFICATION_FAILED
REVIEW_REQUESTED
REVIEW_APPROVED
REVIEW_CHANGES_REQUESTED
RUN_COMPLETED
RUN_FAILED
```

Agents must not invent arbitrary completion tokens.

---

# 5. TICKET SYSTEM

Implement a proper ticket model.

A ticket represents a user-level engineering objective.

Example:

```text
Ticket
├── id
├── title
├── description
├── priority
├── status
├── acceptanceCriteria
├── doneWhen
├── riskLevel
├── createdAt
├── updatedAt
├── projectId
└── sessionId
```

Ticket status should not be controlled directly by an agent's natural-language response.

Recommended lifecycle:

```text
DRAFT
READY
PLANNED
IN_PROGRESS
VERIFYING
REVIEW_PENDING
COMPLETED
FAILED
BLOCKED
CANCELLED
```

However, completion must be derived from verification state.

---

# 6. DONEWHEN SYSTEM

Implement a formal `DoneWhen` system.

Every meaningful ticket should be able to define objective completion conditions.

Example:

```json
{
  "doneWhen": [
    {
      "id": "dw-1",
      "description": "API endpoint exists",
      "type": "file_exists",
      "target": "src/api/users.ts"
    },
    {
      "id": "dw-2",
      "description": "Unit tests pass",
      "type": "test",
      "command": "pnpm test"
    },
    {
      "id": "dw-3",
      "description": "TypeScript compiles",
      "type": "typecheck",
      "command": "pnpm typecheck"
    },
    {
      "id": "dw-4",
      "description": "Production build succeeds",
      "type": "build",
      "command": "pnpm build"
    }
  ]
}
```

Supported criteria should eventually include:

```text
file_exists
file_contains
file_not_contains
command
test
typecheck
lint
build
api_check
http_check
schema_check
database_check
git_diff
git_status
security_check
dependency_check
custom
```

Every criterion must produce evidence.

---

# 7. CLAIMED DONE VS VERIFIED DONE

Create separate concepts:

```text
agent_status
verification_status
review_status
ticket_status
```

Example:

```text
agent_status:
  working
  claimed_done
  failed

verification_status:
  not_run
  running
  passed
  failed

review_status:
  not_required
  optional
  pending
  approved
  changes_requested

ticket_status:
  in_progress
  verifying
  completed
```

An agent saying:

```text
"Done"
```

must only produce:

```text
agent_status = claimed_done
```

It must NOT automatically produce:

```text
ticket_status = completed
```

The system must independently verify the work.

---

# 8. HUMAN REVIEW IS OPTIONAL

Human review must NOT be mandatory for every ticket.

Support:

```text
humanReview.required = false
```

by default for normal low-risk engineering tasks.

Human review may be:

```text
NOT_REQUIRED
OPTIONAL
REQUIRED
```

Recommended policy:

### No human review required

Examples:

- documentation
- unit tests
- formatting
- refactoring with no behavior change
- local development changes
- low-risk internal improvements

### Optional

Examples:

- UI changes
- architectural improvements
- non-critical configuration
- performance optimization

### Required

Examples:

- production deployment
- destructive database migration
- deleting production data
- security/authentication changes
- permission model changes
- secret rotation
- financial/external side effects
- irreversible operations

Even when human review is not required, automated verification remains mandatory.

---

# 9. HUMAN REVIEW MUST NEVER REPLACE AUTOMATED VERIFICATION

A human clicking:

```text
Approve
```

must not override failed technical checks unless an explicit waiver mechanism exists.

Correct model:

```text
Automated Verification
        +
Optional Human Review
        ↓
Completion Decision
```

Not:

```text
Human says okay
        ↓
Everything is considered valid
```

---

# 10. REVIEW INVALIDATION

If a human approves a change and the code subsequently changes:

```text
approved
```

must automatically become:

```text
stale
```

or:

```text
changes_requested
```

The approval must be associated with:

```text
commit
diff hash
artifact version
timestamp
reviewer
```

Therefore:

```text
approved at commit A
code changed to commit B
→ previous approval is no longer valid
```

---

# 11. TDD-FIRST DEVELOPMENT

Use Test-Driven Development wherever practical.

For every new behavior:

```text
RED
↓
Write failing test
↓
GREEN
↓
Implement minimum behavior
↓
REFACTOR
↓
Run complete verification
```

Do not implement large features first and add superficial tests afterward.

For each significant feature:

1. Define expected behavior.
2. Write tests.
3. Confirm tests fail for the right reason.
4. Implement.
5. Make tests pass.
6. Refactor.
7. Run regression tests.

Record test evidence.

---

# 12. TESTING PYRAMID

Implement multiple test levels.

## Unit tests

Test:

- state transitions
- ticket lifecycle
- DoneWhen evaluation
- agent selection
- registry loading
- token protocol
- handoff creation
- permission decisions
- risk classification
- event creation
- verification logic
- review logic
- checkpoint logic

## Integration tests

Test:

```text
Conductor → Planner
Planner → Implementer
Implementer → Verifier
Verifier → Reviewer
```

and:

```text
Agent
→ Event
→ State
→ Evidence
→ Verification
```

## End-to-end tests

Test realistic workflows:

```text
Create ticket
→ Plan
→ Execute
→ Modify files
→ Run tests
→ Verify
→ Complete
```

## Regression tests

Every bug discovered during implementation must result in a regression test.

---

# 13. LOGICAL VERIFICATION

Automated verification must determine whether the system logically satisfies the requested behavior.

Examples:

If ticket says:

```text
Create login API
```

verification should not only check:

```text
file exists
```

It should check:

```text
route exists
request schema exists
validation exists
authentication behavior exists
tests exist
tests pass
build passes
```

Do not confuse:

```text
implementation exists
```

with:

```text
implementation works
```

---

# 14. TECHNICAL VERIFICATION

Create a verification pipeline.

Recommended sequence:

```text
1. Repository integrity
2. Formatting
3. Type checking
4. Lint
5. Unit tests
6. Integration tests
7. E2E tests
8. Build
9. Dependency audit
10. Security checks
11. DoneWhen evaluation
12. Git/diff verification
```

Not every project will have every command.

The verifier must detect available tooling rather than blindly running nonexistent commands.

For example:

```text
package.json
pyproject.toml
Cargo.toml
go.mod
Makefile
```

should influence detected checks.

---

# 15. VERIFICATION MUST BE ADAPTIVE

Create a verification profile.

Example:

```json
{
  "language": "typescript",
  "packageManager": "pnpm",
  "checks": [
    "typecheck",
    "lint",
    "unit",
    "integration",
    "build"
  ]
}
```

For another repository:

```json
{
  "language": "python",
  "checks": [
    "ruff",
    "mypy",
    "pytest"
  ]
}
```

Do not hard-code one technology stack into Orchestra.

---

# 16. QUALITY GATE SYSTEM

Replace inconsistent quality-gate definitions with a canonical implementation.

Each gate should have:

```text
id
name
description
command
timeout
required
risk
failureBehavior
evidenceType
```

Example:

```text
QUALITY_GATE_TYPECHECK
QUALITY_GATE_LINT
QUALITY_GATE_UNIT
QUALITY_GATE_INTEGRATION
QUALITY_GATE_E2E
QUALITY_GATE_BUILD
QUALITY_GATE_SECURITY
QUALITY_GATE_DONEWHEN
```

The implementation and documentation must use the same gate registry.

---

# 17. EVIDENCE SYSTEM

Every verification result should produce evidence.

Example:

```json
{
  "id": "evidence-123",
  "type": "test_result",
  "command": "pnpm test",
  "exitCode": 0,
  "startedAt": "...",
  "finishedAt": "...",
  "durationMs": 1234,
  "commit": "...",
  "changedFiles": [],
  "stdout": "...",
  "stderr": "...",
  "status": "passed"
}
```

Evidence types:

```text
command_result
test_result
build_result
lint_result
typecheck_result
security_result
file_change
git_diff
api_response
screenshot
log
verification_result
review_result
```

Never claim verification without evidence.

---

# 18. EVIDENCE PROVENANCE

Evidence should identify:

```text
what ran
where it ran
when it ran
which commit
which files changed
exit code
result
duration
```

Where practical:

```text
machine_id
session_id
run_id
task_id
agent_id
```

Sensitive information must never be persisted as evidence.

Redact:

```text
API keys
tokens
passwords
private keys
.env values
credentials
```

---

# 19. EVENT-DRIVEN ORCHESTRATION

Introduce a canonical event model.

Example events:

```text
ticket.created
ticket.updated

plan.created
plan.updated

task.created
task.started
task.completed
task.failed
task.blocked

agent.selected
agent.started
agent.message
agent.tool_started
agent.tool_completed
agent.claimed_done
agent.failed

file.created
file.modified
file.deleted

command.started
command.completed

test.started
test.passed
test.failed

verification.started
verification.passed
verification.failed

evidence.created

review.requested
review.approved
review.changes_requested
review.stale

checkpoint.created

run.started
run.paused
run.resumed
run.completed
run.failed
run.cancelled
```

Events must be structured.

Example:

```json
{
  "id": "event-123",
  "type": "agent.started",
  "timestamp": "...",
  "projectId": "...",
  "ticketId": "...",
  "taskId": "...",
  "runId": "...",
  "agentId": "implementer",
  "payload": {}
}
```

---

# 20. EVENT BUS

Create an internal event bus abstraction.

The first implementation may be local/in-process.

Design it so it can later support:

```text
Local Event Bus
        ↓
WebSocket
        ↓
P-Core Cloud
        ↓
Multi-device clients
```

Do not implement cloud infrastructure yet unless already required by the repository.

---

# 21. LIVE EXECUTION STATE

Create a normalized runtime state.

Example:

```text
ORCHESTRA_IDLE
PLANNING
EXECUTING
VERIFYING
REVIEWING
COMPLETING
COMPLETED
FAILED
PAUSED
```

Each agent should expose:

```text
idle
queued
starting
running
waiting
completed
failed
blocked
```

---

# 22. LIVE AGENT RUNNING LIGHT

The future UI must be able to show a real running indicator while an agent is executing.

Do NOT fake this with a timer.

Use real events.

Example:

```text
agent.started
    ↓
agent.heartbeat
    ↓
agent.tool_started
    ↓
agent.tool_completed
    ↓
agent.heartbeat
    ↓
agent.completed
```

Runtime state:

```json
{
  "agentId": "implementer",
  "status": "running",
  "lastHeartbeat": "...",
  "startedAt": "...",
  "currentTaskId": "...",
  "currentAction": "running tests"
}
```

The UI can then display:

```text
● IMPLEMENTER
  Running
```

or a pulsing/running light.

When the agent stops:

```text
agent.completed
```

the running indicator must turn off.

If heartbeat timeout occurs:

```text
running
→ stale
```

Do not leave a node permanently showing as active.

---

# 23. LIVE NODE CONNECTIONS

The future graph must show real connections between active nodes.

Example:

```text
Conductor
    │
    ├──── Planner
    │
    └──── Implementer
              │
              ├──── Tester
              │
              └──── Verifier
```

Connections should be derived from actual relationships/events.

Example:

```text
agent.selected
agent.started
task.assigned
agent.completed
task.completed
```

Do NOT generate fake animated connections merely for visual effect.

Define graph state independently from UI.

Example:

```json
{
  "nodes": [
    {
      "id": "agent:implementer",
      "type": "agent",
      "status": "running"
    }
  ],
  "edges": [
    {
      "id": "task:123->agent:implementer",
      "source": "task:123",
      "target": "agent:implementer",
      "status": "active"
    }
  ]
}
```

This allows a future React Flow/XYFlow interface to consume the same state.

---

# 24. NEXT TURN / ACTIVE EXECUTION INDICATOR

Support a concept of:

```text
currentTurn
nextTurn
activeAgent
queuedAgents
```

Example:

```text
Current:
Implementer

Next:
Tester

Then:
Verifier
```

The UI can display:

```text
● Implementer — RUNNING
○ Tester — NEXT
○ Verifier — QUEUED
```

This must be derived from actual orchestration state.

---

# 25. PARALLEL EXECUTION

Do not falsely claim parallel execution.

First implement reliable sequential execution.

Then introduce explicit task dependencies:

```text
Task A
Task B
Task C
```

If:

```text
A ──→ C
B ──→ C
```

then A and B may execute concurrently.

Represent:

```text
dependsOn
blocks
parallelGroup
```

The scheduler must only run a task when its dependencies are satisfied.

If parallel execution is implemented, test it explicitly.

Do not simply spawn multiple agents and call that orchestration.

---

# 26. STATE MACHINE

Implement explicit state transitions.

Example:

```text
Ticket:

DRAFT
 ↓
READY
 ↓
PLANNED
 ↓
IN_PROGRESS
 ↓
VERIFYING
 ↓
COMPLETED
```

Invalid transitions must be rejected.

Example:

```text
COMPLETED → IN_PROGRESS
```

must not happen without an explicit reopen operation.

Every transition should produce an event.

---

# 27. SESSION MODEL

A session represents one execution context.

Example:

```text
Project
 └── Ticket
      └── Session
           ├── Plan
           ├── Tasks
           ├── AgentRuns
           ├── Events
           ├── Evidence
           └── Verification
```

Sessions must support:

```text
start
pause
resume
cancel
complete
fail
checkpoint
```

---

# 28. CHECKPOINT / RESUME

Create checkpoints containing enough state to resume safely.

Example:

```json
{
  "sessionId": "...",
  "ticketId": "...",
  "completedTasks": [],
  "runningTasks": [],
  "pendingTasks": [],
  "lastEventId": "...",
  "lastVerifiedCommit": "...",
  "createdAt": "..."
}
```

Do not store only a text summary.

---

# 29. LOCAL-FIRST STATE

Prefer a coherent local persistence layer over scattered JSON state files.

Evaluate whether SQLite is appropriate for the current repository.

Possible model:

```text
SQLite
 ├── projects
 ├── tickets
 ├── plans
 ├── tasks
 ├── sessions
 ├── agent_runs
 ├── events
 ├── evidence
 ├── verifications
 ├── reviews
 ├── memories
 └── checkpoints
```

Do not perform a massive migration if it would destabilize the existing system.

Provide compatibility with existing Cursor/OpenCode state where required.

---

# 30. MEMORY

Implement clear memory scopes.

```text
session
ticket
project
workspace
machine
```

Rules:

- session memory is temporary
- ticket memory belongs to the ticket
- project memory is reusable
- machine state stays local
- secrets never enter shared memory

Do not automatically promote arbitrary agent conversation into project memory.

---

# 31. HANDOFF SYSTEM

Improve existing handoffs.

Current handoffs should not lose important context.

A handoff should contain structured references:

```text
ticketId
taskId
planId
sessionId
runId
previousAgent
nextAgent
goal
acceptanceCriteria
doneWhen
currentState
artifacts
evidenceIds
failures
warnings
changedFiles
commit
nextAction
```

Avoid putting huge logs directly into handoff messages.

Reference evidence instead.

---

# 32. AGENT CAPABILITY MODEL

Agents should declare capabilities.

Examples:

```text
research
planning
coding
testing
security
database
devops
frontend
backend
architecture
documentation
review
```

Also declare risk:

```text
LOW
MEDIUM
HIGH
CRITICAL
```

Agent selection should consider:

```text
task type
required capability
risk
platform
permissions
availability
phase
```

---

# 33. PERMISSION HARDENING

Audit current permissions carefully.

Avoid:

```text
unrestricted shell
unrestricted filesystem
unrestricted network
```

Prefer least privilege.

Define permission scopes:

```text
read
write
delete
shell
network
git
docker
database
deployment
secrets
```

High-risk capabilities should trigger stronger verification and potentially human review.

Never silently weaken security for convenience.

---

# 34. SECURITY VERIFICATION

Improve security checks beyond regex-only scanning.

Where appropriate, detect available tools such as:

```text
dependency audit
secret scanning
static analysis
package vulnerability checks
```

But never assume a particular external security tool exists.

Create an abstraction:

```text
SecurityVerifier
```

with adapters.

Security verification should produce evidence.

---

# 35. GIT INTEGRATION

Track:

```text
branch
commit
changed files
diff
working tree status
```

Before and after execution.

A verification result should identify the code version it verified.

Example:

```text
Verified commit:
abc123
```

If the working tree changes afterward, previous verification may become stale.

---

# 36. VERIFICATION INVALIDATION

Any significant source change after verification must invalidate relevant evidence.

Example:

```text
commit A
↓
tests pass
↓
verified
↓
file changed
↓
verification stale
```

Do not continue displaying stale green verification as current.

---

# 37. FAILURE HANDLING

Failures must be first-class state.

Example:

```text
TEST_FAILED
BUILD_FAILED
TYPECHECK_FAILED
AGENT_FAILED
TIMEOUT
PERMISSION_DENIED
DEPENDENCY_FAILURE
VERIFICATION_FAILED
```

Record:

```text
failure reason
agent
task
command
exit code
evidence
timestamp
```

Then allow:

```text
retry
resume
change agent
modify plan
request human input
abort
```

---

# 38. RETRY POLICY

Do not blindly retry failures forever.

Define:

```text
maxRetries
retryable
backoff
failureClass
```

Example:

```text
network timeout → retry
syntax error → agent correction
permission denied → do not automatically retry forever
destructive operation → stop
```

---

# 39. OBSERVABILITY

Every execution should produce structured logs and metrics.

At minimum:

```text
run duration
agent duration
task duration
verification duration
number of retries
test count
failed tests
files changed
commands executed
```

Future UI should be able to show:

```text
Execution Timeline
Agent Activity
Task Progress
Verification
Failures
Evidence
```

---

# 40. FUTURE LIVE UI CONTRACT

Do not build the entire UI now unless already present.

Instead create stable APIs/interfaces for future UI consumption.

The future architecture should be:

```text
Orchestra Core
      ↓
Event Bus
      ↓
State Store
      ↓
Realtime Adapter
      ↓
WebSocket / SSE
      ↓
Next.js / React UI
      ↓
React Flow / XYFlow
```

The future UI can display:

```text
┌───────────────────────────────────────────────┐
│ Orchestra                                     │
│ ● Running    Ticket #123                      │
├───────────────────────┬───────────────────────┤
│                       │                       │
│      LIVE GRAPH       │      DETAILS          │
│                       │                       │
│  ● Conductor          │ Task: Implement API  │
│       │               │ Agent: Implementer   │
│       ├─● Planner     │ Status: Running      │
│       │               │                       │
│       └─● Implementer │ Tests: 14/14         │
│             │         │ Build: Passing       │
│             ├─○ Test  │ Verification: ...    │
│             └─○ Verify│                       │
│                       │                       │
├───────────────────────┴───────────────────────┤
│ Timeline                                      │
│ ✓ Plan created                                │
│ ● Implementer running                         │
│ ○ Tests queued                                │
└───────────────────────────────────────────────┘
```

The backend/core must provide the data required for this.

---

# 41. MCP — FUTURE EXTENSION POINT

Do not build a giant MCP server unless needed now.

Define interfaces so MCP can later expose:

```text
ticket.list
ticket.get
ticket.create
ticket.update

plan.get

task.list
task.get

session.get

run.get

evidence.list

verification.get

review.submit

memory.search
memory.add

events.subscribe

sync.status
```

MCP should be a thin adapter over Orchestra Core rather than a second business-logic implementation.

---

# 42. CURSOR + OPENCODE COMPATIBILITY

Do not break existing execution environments.

Audit:

```text
Cursor agents
OpenCode agents
hooks
permissions
state
handoffs
skills
CLI commands
```

Where platform behavior differs, use adapters.

Core logic must not become tightly coupled to one agent platform.

Conceptually:

```text
              Orchestra Core
                    │
          ┌─────────┴─────────┐
          │                   │
    Cursor Adapter       OpenCode Adapter
          │                   │
       Cursor              OpenCode
```

---

# 43. DEAD CODE AND MISMATCH CLEANUP

Find and fix:

- undeclared variables
- dead model-selection functions
- unreachable code
- stale configuration
- duplicated registries
- outdated documentation
- unused imports
- invalid references
- inconsistent naming
- obsolete hooks

Do not delete functionality merely because it is currently unused.

Determine whether it is intended future functionality first.

---

# 44. DOCUMENTATION

After implementation, update:

```text
README
ARCHITECTURE
AGENTS
VERIFICATION
TESTING
SECURITY
ROADMAP
```

Documentation must describe actual implementation.

Never document something as implemented when it only exists as a future design.

Clearly separate:

```text
Implemented
Partially implemented
Planned
```

---

# 45. FUTURE ROADMAP — DO NOT OVERBUILD NOW

Design extension points for:

```text
P-Core AI Gateway
MCP server
Next.js dashboard
PWA
React Flow graph
WebSocket
SSE
Cloud sync
Cross-device resume
3D visualization
Remote agents
Cloud execution
```

But do not build all of them now unless required for the current repository.

The immediate goal is:

> Make the Orchestra core reliable, testable, verifiable, observable, and extensible.

---

# 46. REQUIRED TEST SCENARIOS

Create automated tests for at least these scenarios.

## Scenario A — Successful ticket

```text
Create ticket
→ plan
→ task
→ agent runs
→ code changes
→ tests pass
→ verification passes
→ DoneWhen passes
→ ticket completed
```

## Scenario B — Agent falsely claims done

```text
Agent says done
→ verification fails
→ ticket remains incomplete
```

## Scenario C — Test failure

```text
Agent completes
→ tests fail
→ verification failed
→ ticket not completed
```

## Scenario D — Build failure

```text
tests pass
→ build fails
→ verification failed
→ ticket not completed
```

## Scenario E — DoneWhen failure

```text
implementation exists
→ acceptance criterion missing
→ ticket not completed
```

## Scenario F — Optional human review

```text
automated verification passes
→ review optional
→ no human review
→ ticket can complete
```

## Scenario G — Required human review

```text
verification passes
→ human review required
→ ticket remains pending
→ reviewer approves
→ ticket completes
```

## Scenario H — Review becomes stale

```text
verification passes
→ human approves
→ source changes
→ approval invalidated
→ verification reruns
```

## Scenario I — Agent failure

```text
agent starts
→ agent fails
→ evidence recorded
→ task failed
→ retry policy evaluated
```

## Scenario J — Resume

```text
session starts
→ checkpoint
→ process stops
→ session resumes
→ execution continues
```

## Scenario K — Running indicator

```text
agent.started
→ status = running
→ heartbeat updates
→ UI state = active
→ agent.completed
→ status = completed
→ running indicator off
```

## Scenario L — Node connection

```text
task assigned
→ task → agent edge becomes active
→ agent executes
→ edge updates
→ agent completes
→ edge becomes completed/inactive
```

## Scenario M — Parallel tasks

```text
Task A ─┐
        ├── Task C
Task B ─┘

A and B may execute concurrently.
C cannot start until both are complete.
```

---

# 47. TEST THE TEST SYSTEM

Do not only test application functionality.

Test the verification engine itself.

Examples:

```text
DoneWhen evaluator
Quality gate runner
State machine
Event bus
Evidence recorder
Review engine
Permission engine
Agent registry
Scheduler
Checkpoint loader
```

A verification system that itself contains untested logic is not trustworthy.

---

# 48. FINAL VERIFICATION COMMAND

At the end of implementation, execute the repository's appropriate verification suite.

Detect the correct commands from the repository.

Potential examples:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```

Do not run commands that do not exist.

If one check cannot be run, clearly report:

```text
NOT RUN
Reason:
```

Never convert "not run" into "passed".

---

# 49. FINAL COMPLETION MODEL

A ticket can only become:

```text
COMPLETED
```

when:

```text
required DoneWhen criteria = PASS
AND
required automated quality gates = PASS
AND
verification = PASS
AND
no verification has become stale
AND
required human review = APPROVED
```

If human review is:

```text
NOT_REQUIRED
```

then approval is not needed.

If human review is:

```text
OPTIONAL
```

the ticket may complete without it after automated verification passes.

---

# 50. NO FAKE SUCCESS

Never report:

```text
implemented
```

when only files were created.

Never report:

```text
tested
```

when tests were not executed.

Never report:

```text
verified
```

when verification was skipped.

Never report:

```text
production ready
```

without appropriate evidence.

Use precise states:

```text
IMPLEMENTED
TESTED
VERIFIED
PARTIALLY_VERIFIED
NOT_VERIFIED
BLOCKED
FAILED
PLANNED
```

---

# 51. IMPLEMENTATION ORDER

Follow this order unless repository inspection shows a better dependency order.

## Phase 0 — Baseline

- audit
- run existing tests
- run build
- run lint
- run typecheck
- document current state

## Phase 1 — Stabilize Orchestra

- agent registry
- handshake protocol
- state handling
- handoffs
- hooks
- quality gates
- permissions
- Cursor/OpenCode compatibility

## Phase 2 — Core Domain Model

Implement:

```text
Project
Ticket
Plan
Task
Session
AgentRun
Event
Evidence
Verification
Review
Checkpoint
Memory
```

## Phase 3 — DoneWhen

Implement:

```text
acceptance criteria
DoneWhen evaluator
objective completion
verification state
stale verification
```

## Phase 4 — TDD / Verification

Implement:

```text
unit tests
integration tests
E2E tests
regression tests
adaptive quality gates
evidence
```

## Phase 5 — Event System

Implement:

```text
events
event bus
runtime state
agent heartbeats
task events
verification events
review events
```

## Phase 6 — Live Execution Contract

Implement backend/state support for:

```text
running agents
active nodes
node connections
current turn
next turn
execution timeline
```

Do NOT build a large UI yet.

## Phase 7 — Hardening

- security
- permissions
- error handling
- retry policy
- checkpoint/resume
- regression tests
- documentation

## Phase 8 — Final Audit

Perform another complete repository audit.

Compare:

```text
initial baseline
vs
final implementation
```

---

# 52. DEFINITION OF DONE FOR THIS DEVELOPMENT TASK

This work itself is complete only when:

### Architecture

- [ ] Core domain model exists.
- [ ] Agent registry is coherent.
- [ ] State machine is explicit.
- [ ] Event model exists.
- [ ] Evidence model exists.
- [ ] Verification model exists.
- [ ] Optional human review exists.
- [ ] DoneWhen exists.
- [ ] Future live graph contract exists.

### Engineering

- [ ] Existing code remains compatible where required.
- [ ] No unnecessary rewrite.
- [ ] Dead/broken code is addressed.
- [ ] Permissions are reviewed.
- [ ] Error handling is robust.

### Testing

- [ ] Unit tests pass.
- [ ] Integration tests pass.
- [ ] Relevant E2E tests pass.
- [ ] Regression tests exist for discovered bugs.
- [ ] Verification engine itself is tested.

### Verification

- [ ] Typecheck passes.
- [ ] Lint passes.
- [ ] Tests pass.
- [ ] Build passes.
- [ ] Security checks run where available.
- [ ] DoneWhen evaluation works.
- [ ] Evidence is produced.
- [ ] Stale verification is detected.

### Runtime

- [ ] Agent running state works.
- [ ] Heartbeat/state timeout works.
- [ ] Current/next execution state works.
- [ ] Node relationships are represented.
- [ ] Event stream accurately reflects execution.

### Human review

- [ ] Not mandatory for normal tasks.
- [ ] Optional review works.
- [ ] Required review works for configured high-risk operations.
- [ ] Review approval is tied to the verified code state.
- [ ] Code changes invalidate previous approval.

---

# 53. REQUIRED FINAL REPORT

At the end, produce a concise engineering report.

Use:

```text
# P-Core Orchestra Implementation Report

## 1. Baseline
What existed before changes.

## 2. Implemented
Concrete code/features added.

## 3. Fixed
Bugs/inconsistencies corrected.

## 4. TDD
Tests added and why.

## 5. Verification
Commands executed and results.

## 6. Evidence
Important verification evidence produced.

## 7. Human Review
What is optional vs required.

## 8. Runtime Events
Events implemented.

## 9. Live Execution
Running state, heartbeat, current turn, next turn, and node connections.

## 10. Security
Permission/security changes.

## 11. Not Implemented
Features intentionally deferred.

## 12. Remaining Risks
Known technical limitations.

## 13. Recommended Next Step
Only the next highest-value implementation step.
```

For every claim, distinguish:

```text
IMPLEMENTED
VERIFIED
PARTIALLY VERIFIED
NOT VERIFIED
DEFERRED
```

---

# 54. MOST IMPORTANT ENGINEERING PRINCIPLE

Build Orchestra as a **verification-driven execution system**, not simply an agent prompt collection.

The fundamental relationship should become:

```text
Intent
  ↓
Ticket
  ↓
Plan
  ↓
Task
  ↓
Agent
  ↓
Execution
  ↓
Events
  ↓
Artifacts
  ↓
Tests
  ↓
Evidence
  ↓
Verification
  ↓
Optional Human Review
  ↓
Completion
```

And for live visualization:

```text
REAL EXECUTION
      ↓
REAL EVENTS
      ↓
REAL STATE
      ↓
REAL NODE STATUS
      ↓
REAL CONNECTIONS
      ↓
LIVE UI
```

Never reverse this relationship by creating a UI animation and pretending it represents execution.

---

# 55. EXECUTION INSTRUCTION

Now begin.

Do not ask me to manually explain the repository if you can inspect it yourself.

Do not stop after producing an architecture document.

Do not create placeholder implementations merely to make the feature appear complete.

Do not rewrite the entire repository unnecessarily.

Do not build future PWA/cloud/3D functionality prematurely.

Instead:

```text
AUDIT
→ BASELINE
→ PLAN
→ TEST
→ IMPLEMENT
→ TEST
→ VERIFY
→ FIX
→ REGRESSION TEST
→ FINAL VERIFY
→ REPORT
```

Work incrementally.

After each major phase:

1. Run relevant tests.
2. Check types.
3. Check lint.
4. Check build where applicable.
5. Inspect the diff.
6. Verify that no unrelated behavior was broken.

The final result must be **actually executable, testable, verifiable, and ready for future live Orchestra visualization**, not merely well documented.