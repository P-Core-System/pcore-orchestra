# Global studio — repo scopes

One clone (`PCORE_ORCHESTRA_REPO`) serves every repo. Each repo gets an
isolated studio: its own state partition, its own port, its own service.

## Scope slug

```
scope = sanitize(basename(git top-level) or basename(cwd))
```

Lowercased, runs of non-`[a-z0-9]` become one `-`, trimmed, capped at 32
chars. Explicit `PCORE_REPO_SCOPE` (or `--scope`) always wins over the
derived default.

## Single clone resolution

`PCORE_ORCHESTRA_REPO` env → `/opt/pcore-orchestra` → `~/pcore-orchestra` →
`~/pcore` → script parent. Set the env var (or install the clone at
`/opt/pcore-orchestra`) and every entrypoint — service, API, listeners,
migrate — uses the same tree. Never copy the bundle per repo.

## State isolation

| Mode | State dir |
|---|---|
| unscoped (legacy) | `<global>/` (`PCORE_STATE_DIR` or `~/.config/opencode/hooks/state`) |
| scoped (`--scope S`) | `<global>/repos/<slug>/` |

Scope is opt-in: unset means byte-identical legacy behavior. The partition is
applied at three chokes, so every writer and reader follows automatically:

- `bundle/hooks/lib/safe-write.js` (`resolveStateDir`/`resolveStatePath`) —
  hook writers partition when `PCORE_REPO_SCOPE` is set;
- `server/readers.js` (`stateDir`) and `server/state-dirs.js`
  (`discoverStateDirs`) — unscoped discovers `<global>` plus every existing
  `repos/*/`; scoped pins exactly `repos/<slug>/`;
- `server/ws.js` needs no change — `studio-api.js --scope` sets
  `PCORE_REPO_SCOPE` for the process and passes the scoped dir through.

## Ports

`3110 + fnv1a(scope) % 1000`, pinned on first use in
`<global>/studio-ports.json` (linear probe on collision). The registry stays
global — it maps every scope.

| Entrypoint | Scoped port |
|---|---|
| `studio-service.sh --scope S` | allocates (writes registry) when `--port` is absent |
| `team-listen.js --scope S` | read-only resolve (registry hit or hash candidate) |
| `team-sessions.sh watch --scope S` | forwards to team-listen (repo scope, not the claim file scope) |

## Commands

```bash
# per-repo dashboard (state + port + service all namespaced)
bash scripts/studio-service.sh install --scope my-repo
bash scripts/studio-service.sh start --scope my-repo   # PCORE_REPO_SCOPE also works

# migrate existing global state into the partition (dry-run by default)
bash scripts/migrate-studio-scope.sh --scope my-repo
bash scripts/migrate-studio-scope.sh --scope my-repo --apply

# live team feed for the repo
bash scripts/team-sessions.sh watch --team Alpha --scope my-repo
node scripts/team-listen.js --team Alpha --scope my-repo
```

## Install

Studio installs global-only: one dist at
`~/.local/share/orchestra-studio/dist` (Windows: `%USERPROFILE%\.local\share\…`).
The server resolves global-share → repo `studio/dist` → legacy host copies, so
older installs keep serving until reinstalled. No per-repo copies, ever.
