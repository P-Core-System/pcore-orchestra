# Team auto-activation (discussion post / wake → OpenCode session)

Team auto-activation turns a durable team event into a synthetic prompt for
each recipient teammate's OpenCode session. It is the automatic alternative to
watching the WebSocket feed with `team-sessions.sh watch` / `team-listen.js`.

## Contract

1. A durable `discuss post` or `wake request` is written first; activation runs
   only after the store write succeeds. A failed activation never rolls back
   the message and never breaks the CLI.
2. **Group posts/wakes** activate every live, same-team slot. **Targeted**
   events (`--to` claim key or member token, `wake.to`) activate only that
   teammate, still within the same team.
3. The sender is excluded by **both** claim key and session id, so a parallel
   slot on the sender's own session never receives a self-activation.
4. Stale claims, claims without a session id, and claims without a usable
   server URL are skipped. A missing target is audited as skipped. Nothing
   throws; every failure is fail-open.
5. Dedupe is enforced **before** the send: the key
   `(eventKind, eventId, recipientClaimKey, projectSlug)` is inserted with
   `INSERT OR IGNORE` into the `activations` table (or the JSONL fallback).
   Replaying the same post/wake therefore cannot send twice.
6. Every sent/skipped/failed decision is audited in `activations` (SQLite) or
   `<PCORE_STATE_DIR>/team-activations.jsonl` (JSON fallback), capped at 500
   rows, oldest trimmed first. Failed rows release their dedupe key so a
   later event may retry.
7. The synthetic input is posted to
   `POST /api/session/{sessionId}/synthetic` with `{"text": "..."}`. Text is
   capped at 2000 characters and carries the event kind, id, sender and
   topic/reason.

## Configuration

| Variable | Effect |
|---|---|
| `PCORE_OPENCODE_SERVER_URL` | Server URL captured on claim and used as the send override. Example: `http://127.0.0.1:4096`. |
| `--server-url URL` | Per-claim equivalent, stored on the claim row (`server_url`). Wins over the env var when present. |
| `PCORE_TEAM_ACTIVATE=0` | Kill switch: no planning, no sends, no audit writes. |
| `PCORE_USE_SQLITE=0` | Force the safe-write JSON fallback for claims and activation audit. |

The sender resolves the URL in this order: claim `serverUrl`, explicit
override, `PCORE_OPENCODE_SERVER_URL`, then `opencode api get /api/info`
(`urls[0]`). A missing or malformed URL is a skipped activation, not an error.

```bash
PCORE_OPENCODE_SERVER_URL=http://127.0.0.1:4096 \
  bash scripts/team-sessions.sh claim --member John --team Alpha \
  --scope "apps/api" --json
# or per claim:
bash scripts/team-sessions.sh claim --member John --team Alpha \
  --server-url http://127.0.0.1:4096 --json
```

## Auto-trigger vs watch fallback

- **Auto-trigger (default):** claim with a server URL; posts and wakes call
  the synthetic endpoint directly. No listener process is required. This is
  the path for unattended teammates.
- **Watch fallback:** when no recipient has a server URL (or activation is
  disabled), teammates keep using `team-sessions.sh watch --team Alpha` /
  `scripts/team-listen.js` to observe `discussion.posted` and `wake.delivered`
  over WebSocket. The message store and event stream are unchanged, so this
  remains a fully supported manual mode.
- Both modes can coexist: a member with a URL is activated automatically while
  another follows the live feed.

## Rollback

Set `PCORE_TEAM_ACTIVATE=0` in the environment of the CLI/session to disable
activation immediately; durable posts and wakes continue to store and stream
exactly as before. No config file or state migration is required to roll back.
Existing `activations` rows are inert audit data and may be ignored or removed
(`<PCORE_STATE_DIR>/team-sessions.db` table `activations`, or delete
`team-activations.jsonl` in JSON fallback). To stop capturing URLs, omit
`--server-url` / `PCORE_OPENCODE_SERVER_URL` on new claims.

## Verification

```bash
node scripts/test-team-activation.js   # injected sender/runner; no live server
node scripts/test-mirror-sync.js       # hook lib mirrors byte-identical
```
