---
name: team-sessions
description: >-
  Team session orchestration — claim slots, discuss, wake, and report completion
  for multi-member teams. Use proactively when coordinating work across multiple
  AI sessions sharing a project repo.
---

# Team Sessions (WI-9)

Named cross-CLI team sessions for P-Core Orchestra. Each member claims a named
slot (`team/member/slug/sessionId`) and communicates via discussion messages,
wake nudges, and completion reports. All state is stored in a shared SQLite
database (`team-sessions.db`) or JSON fallback, keyed by project slug so
multiple projects can coexist on the same machine.

## When to Use

- Multiple AI sessions need to coordinate on the same project
- A team of 2+ members needs to assign work, report completion, and notify
  each other without stepping on each other's scopes
- You need a lightweight, file-based coordination layer with no external
  dependencies (SQLite optional, JSON fallback)

## When Invoked

1. Read project context (`context/` six files + `project.yaml`)
2. Claim a session slot with its OpenCode URL (so teammates can auto-activate it):
   `bash scripts/team-sessions.sh claim --member <Name> --team <Team> --scope <paths> --server-url <url>`
3. Heartbeat periodically to keep the slot alive
4. Post messages: `bash scripts/team-sessions.sh discuss post --member <Name> --team <Team> --kind m2l --to <Target> --body "..."`
5. Wake teammates: `bash scripts/team-sessions.sh wake request --member <Name> --team <Team> --to <Target> --reason "..."`
6. Report completion: `bash scripts/team-sessions.sh done report --member <Name> --team <Team> --sha <hex-SHA> --branch <branch>`

## Auto-activation on post / wake

Once a member claims with `--server-url` (or `PCORE_OPENCODE_SERVER_URL`), a
durable `discuss post` or `wake request` activates every eligible recipient
session exactly once per event: same-team live slots, explicit `--to` / `wake.to`
targets only, sender excluded by claim key and session id. Stale, sessionless
and URL-less claims are skipped; failures never break the post or wake. Audit
rows land in the `activations` table (or `team-activations.jsonl` with
`PCORE_USE_SQLITE=0`), deduped by `(eventKind, eventId, recipient, projectSlug)`.

`PCORE_TEAM_ACTIVATE=0` disables this entirely. Without a URL, keep using the
watch/WebSocket fallback (`team-sessions.sh watch` / `scripts/team-listen.js`).
Full contract and rollback: `docs/team-auto-activation.md`.

## CLI Reference

### `team-sessions.sh claim`

Create or renew a named session slot:

```bash
bash scripts/team-sessions.sh claim --member John --team Alpha --scope "bundle/hooks/lib"
```

- `--member M` — Member name (required)
- `--team T` — Team name (required)
- `--role R` — Role (e.g. leader, member; renew without `--role` keeps prior role)
- `--scope S` — Comma-separated paths this member works on (`"*"` claims whole repo)
- `--session S` — Session ID (defaults to current session)
- `--workspace W` — Workspace root (defaults to cwd)
- `--new-slot` — Hatch a parallel slot instead of renewing
- `--use-sqlite 0|1` — SQLite storage (default 1; falls back to JSON if unavailable)
- `--server-url URL` (or `PCORE_OPENCODE_SERVER_URL`) — OpenCode server stored on
  this claim; recipients are auto-activated on post/wake via
  `POST /api/session/{id}/synthetic` (kill switch: `PCORE_TEAM_ACTIVATE=0`)

Re-claims renew the member's live slot in place (same claimKey, `renewed`).
An explicit `--session` differing from the live slot's holder session mints a
fresh slot instead of rewriting it. `--new-slot` always hatches a parallel slot.

### `team-sessions.sh heartbeat` / `release` / `list` / `who` / `check` / `gc`

```bash
bash scripts/team-sessions.sh heartbeat --member John --team Alpha
bash scripts/team-sessions.sh release --member John --team Alpha
bash scripts/team-sessions.sh list --team Alpha
bash scripts/team-sessions.sh who --team Alpha
bash scripts/team-sessions.sh check --member John --team Alpha -- bundle/hooks/lib/foo.js
bash scripts/team-sessions.sh gc
```

- `heartbeat` touches the slot heartbeat (keeps the 30-min stale window alive).
- `release` drops the claim.
- `list` shows live claims (grouped); `who` shows the live roster, team-grouped.
- `check -- <files...>` is the WIP scope check — exit 1 on violation.
- `gc` prunes stale claims.

### `team-sessions.sh dispatch`

Fan out one session per member from the backlog (HOD leader push):

```bash
bash scripts/team-sessions.sh dispatch --team Alpha --dry-run
bash scripts/team-sessions.sh dispatch --team Alpha --free-only --json
bash scripts/team-sessions.sh dispatch --team Alpha --member John,Mark --session S --worktree-base /tmp/opencode
```

- `--team T` — Team name (required)
- `--member M,J...` — Comma-separated filter (dispatch subset, default all)
- `--session S` — Session ID seed for spawned slots
- `--worktree-base D` — Base dir for per-member `worktreePath/.pcore/state`
- `--dry-run` — Plan with zero side effects
- `--free-only` — Push only to members with no live claim (leader push to idle slots)
- `--json` — Machine-readable payloads (claimKey/branch per member)

Exit codes: **0** all claimed, **2** some skipped on `SCOPE_CONFLICT`, **1** error.
Conflicts skip and continue instead of aborting. `discuss post` renews the
author slot first under the same lifecycle — a `SCOPE_CONFLICT` there is a
SKIP (exit 2), like dispatch.

### `team-sessions.sh supervise`

HOD autonomous sweep — grants FIFO requests first, pushes backlog to free members:

```bash
bash scripts/team-sessions.sh supervise --team Alpha --dry-run
bash scripts/team-sessions.sh supervise --team Alpha --json
```

Same `--member/--session/--worktree-base/--dry-run` flags as dispatch.
Claims each scope in order, `mkdir`s the per-member `worktreePath/.pcore/state`,
emits spawn payloads; `SCOPE_CONFLICT` skips (exit 2 partial like dispatch).

### `team-sessions.sh queue`

FIFO durable work-request intake:

```bash
bash scripts/team-sessions.sh queue enqueue --member John --team Alpha --topic persistence --json
bash scripts/team-sessions.sh queue list --team Alpha --json
bash scripts/team-sessions.sh queue list --team Alpha --all --json
bash scripts/team-sessions.sh queue grant --member John --json
```

- `enqueue --member M [--team T] --topic T` — Request work (FIFO durable)
- `list [--team T] [--all]` — Pending requests first (FIFO); `--all` keeps granted
- `grant --member M` — Grant the oldest pending request for the member

### `team-sessions.sh request`

Member pull — next backlog item when free:

```bash
bash scripts/team-sessions.sh request --member John --team Alpha --json
```

Exit **2** when the member is busy or the backlog is empty; exit 0 carries the
granted item plus `claimKey`/`branch` when free.

### `team-sessions.sh discuss`

Post, list, react, or resolve discussion messages (`--kind` is one of
`m2m|l2m|m2l|l2l|group`):

```bash
# Post a message to a member
bash scripts/team-sessions.sh discuss post --member Hod --team Alpha --kind m2l --to John --body "Scope bundle/hooks/lib, ready for tasks" --topic persistence

# List messages for a member
bash scripts/team-sessions.sh discuss list --member John --team Alpha

# List with topology filter + include resolved
bash scripts/team-sessions.sh discuss list --team Alpha --kind m2l --topology star --all

# React to a message
bash scripts/team-sessions.sh discuss react --id <msg-id> --emoji 👍 --member John --team Alpha

# Resolve a message
bash scripts/team-sessions.sh discuss resolve --id <msg-id> --member John --team Alpha
```

- `post --member M [--team T] --kind K --body B [--to X] [--topic T]` — claims/renews the author slot first (claim lifecycle)
- `list [--team T] [--kind K] [--topology 2way|star|group|all] [--member M] [--all]`
- `react --id ID --emoji E --member M [--team T]`
- `resolve --id ID --member M [--team T]`

### `team-sessions.sh wake`

Send a nudge to a teammate:

```bash
bash scripts/team-sessions.sh wake request --member Hod --team Alpha --to John --reason "Please review Mark's QA PR" --topic kickoff --json
bash scripts/team-sessions.sh wake request --member Hod --team Alpha --to John --reason "See thread" --thread persistence --message m_123 --topology star --json
bash scripts/team-sessions.sh wake list --team Alpha
bash scripts/team-sessions.sh wake ack --id w_xxx --member John --team Alpha
```

- `request --member M --to N [--team T] [--reason R] [--topic T] [--thread REF] [--message ID] [--topology X] [--json]`
- `list [--member M] [--team T] [--topic T] [--thread REF] [--all] [--json]`
- `ack --id ID --member M [--team T] [--json]` — only the target slot holder can ack

Exits 2 on deny (cross-scope, no live claim, throttled, wrong acker).

### `team-sessions.sh done`

Report task completion (commit first, then report the SHA):

```bash
bash scripts/team-sessions.sh done report --member John --team Alpha --sha abc1234def5678 --branch member/alpha/john --summary "Gateway PR ready for QA"
bash scripts/team-sessions.sh done list --team Alpha
```

- `report --member M [--team T] --sha SHA [--branch B] [--summary S]` — SHA must be hex (`isHexSha` gate; e.g. `abc1234` alone fails, use a full hex SHA)
- `list [--team T] [--json]` — Latest report per member

### `team-sessions.sh learning`

Record session learnings, distill candidates, human-gate approval (never auto-applies):

```bash
bash scripts/team-sessions.sh learning record --member John --team Alpha --lessons "Fixtures stay green when prod 401s without a key" --outcome fixed --thread persistence --json
bash scripts/team-sessions.sh learning distill --json
bash scripts/team-sessions.sh learning approve --id <candidate-id> --decision approved --by Hod --json
```

- `record --member M [--team T] --lessons L [--outcome O] [--thread REF] [--json]`
- `distill [--json]`
- `approve --id ID --decision approved|rejected --by NAME [--json]` — exits 2 without a human decision+by

## WS Live Feed

Team members communicate over a live WebSocket stream instead of polling.
Start the WS server once per machine, then each member listens:

```bash
node server/studio-api.js --port 3110   # binds 127.0.0.1 only
node scripts/team-listen.js --member John --team Alpha --port 3110
# or via the wrapper:
bash scripts/team-sessions.sh watch --member John --team Alpha --port 3110
```

```bash
# Filter event kinds, print N events then exit, or skip the backlog snapshot:
bash scripts/team-sessions.sh watch --team Alpha --types discussion.posted,wake.delivered,done.reported --once 5 --no-snapshot
# Dial a repo scope's registry port instead of --port:
bash scripts/team-sessions.sh watch --team Alpha --member John --scope my-scope
```

- `--team T [--member M] [--types T1,T2] [--port N] [--scope S] [--once N] [--no-snapshot]`
- `--types` filters event kinds; `--once N` prints N events then exits (tests);
  `--no-snapshot` reads live events only.
- `--scope` is the repo scope: dials the scope's registry port and reads the
  scope partition (`--port` overrides). Elsewhere `--scope` is the claim file
  scope and is unchanged.

WS events are keyed by team — same-team `m2l`/`l2m` star legs and `group`
broadcasts are visible to member-filtered lists; `m2m`/`l2l` stay pairwise
private. A member filter without a team never leaks another team's star legs.

### HOD fan-out / assign (l2m star push)

```bash
bash scripts/team-sessions.sh discuss post --member Hod --team Alpha --kind l2m --to John --body "Scope bundle/hooks/lib, ready for tasks" --topic persistence
```

### Member report back (m2l star pull leg)

```bash
bash scripts/team-sessions.sh discuss post --member John --team Alpha --kind m2l --to Hod --body "SHA abc1234def5678 gates PASS" --topic persistence
```

### Member-to-member peer pair (2way)

```bash
bash scripts/team-sessions.sh discuss post --member John --team Alpha --kind m2m --to Mark --body "Gateway PR ready for QA" --topic persistence
```

### Team broadcast (group)

```bash
bash scripts/team-sessions.sh discuss post --member Hod --team Alpha --kind group --body "Fill-list set, stand by for assignments" --topic kickoff
```

### See all team activity

```bash
bash scripts/team-sessions.sh discuss list --team Alpha       # live messages
bash scripts/team-sessions.sh wake list --team Alpha           # pending wakes
bash scripts/team-sessions.sh done list --team Alpha           # SHA reports
bash scripts/team-sessions.sh who --team Alpha                 # live roster
```

## HOD (Head of Department) Workflow

1. **Claim HOD slot:**
   ```bash
   bash scripts/team-sessions.sh claim --member Hod --team Alpha --scope "handoffs"
   ```

2. **Fan out work:**
   ```bash
   bash scripts/team-sessions.sh dispatch --team Alpha --free-only --json
   ```

3. **Monitor team:**
   ```bash
   bash scripts/team-sessions.sh who --team Alpha
   bash scripts/team-sessions.sh done list --team Alpha
   bash scripts/team-sessions.sh discuss list --team Alpha
   ```

## Storage

All data is stored in `PCORE_STATE_DIR` (default: `~/.config/opencode/hooks/state/`):

- `team-sessions.db` — SQLite database (if available)
- Falls back to `team-sessions.json` JSON file

Data is partitioned by project slug, so multiple projects can coexist on the same machine.

## Example Workflow

```bash
# 1. HOD claims slot
bash scripts/team-sessions.sh claim --member Hod --team Alpha --scope "handoffs"

# 2. HOD assigns work
bash scripts/team-sessions.sh dispatch --team Alpha --free-only --json

# 3. Member claims slot
bash scripts/team-sessions.sh claim --member John --team Alpha --scope "bundle/hooks/lib"

# 4. Member does work, commits on per-member branch
git checkout member/alpha/john
git add bundle/hooks/lib/session-claims.js
git commit -m "feat: persistence gateway implementation"

# 5. Member reports completion
bash scripts/team-sessions.sh done report --member John --team Alpha --sha abc1234def5678 --branch member/alpha/john --summary "Persistence gateway implemented"

# 6. HOD reviews
bash scripts/team-sessions.sh done list --team Alpha
bash scripts/team-sessions.sh discuss list --team Alpha
```

## Rules

- Claims auto-expire after 30 minutes of inactivity (heartbeat)
- A member can only claim one live slot per team per project
- Overlapping scopes block conflicting claims (`SCOPE_CONFLICT`)
- Claims are per-project-slug; different projects are isolated
- Commit-discipline (invariant 26): commit claimed scope on the per-member
  branch/worktree first, then report the commit SHA — never report done with
  uncommitted work
- Env identity: `PCORE_MEMBER_NAME` / `PCORE_TEAM_NAME` / `PCORE_MEMBER_ROLE`
  set identity via env; `PCORE_WORKTREE` selects worktree-isolated state
