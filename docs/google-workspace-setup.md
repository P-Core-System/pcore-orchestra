# Google Workspace Connector (opt-in)

The GWS connector links a Google account for **Productivity** nav surfaces —
Tasks, Reminders, Calendar, Documents — and is itself a **Connector**
(Manage > Connectors): `gws auth status` prints a `connector` entry shaped
for the platform Connectors display.

It is **opt-in and human-gated**: nothing is installed by `install.sh`,
credentials live only in the OS-protected user dir, and every mutating
command is a dry run unless `--apply` is passed.

## Setup

```bash
bash scripts/setup-google-workspace.sh   # npm ci in the subdir, 700 creds dir
# place your OAuth client JSON at ~/.config/pcore/gws/gws-client.json
bash scripts/gws.sh auth login           # desktop loopback http://127.0.0.1
bash scripts/gws.sh auth status          # connector entry (linked/unlinked)
bash scripts/gws.sh auth revoke --apply  # unlink
```

Consumer-Gmail-compatible **External** consent flow (`access_type=offline`,
`prompt=consent`). Credentials (`gws-client*.json`, `gws-tokens.json`,
600) live ONLY in `~/.config/pcore/gws/` (override: `PCORE_GWS_CREDS_DIR`)
— never in the repo (gitignored). The CLI works on all hosts; `gws.js`
lazy-requires `googleapis` so `--help`, dry runs, and status work without
the subdir install.

## Least-privilege scopes

| Scope | Use |
|-------|-----|
| `tasks` | Tasks list/get/create/update |
| `calendar.events` + `calendar.readonly` | Timed-reminder events, calendar list/get/create |
| `calendar.calendarlist.readonly` | Calendar discovery |
| `drive.file` + `drive.readonly` | Documents list/get (app-created + read) |
| `documents` | Docs export |

## Human-gate rule

`--dry-run` is the DEFAULT: `tasks/reminders/calendar/docs` commands print
the planned action and exit 0 without network. Nothing executes without
`--apply`, and `--apply` without linked credentials refuses with
`GWS_NOT_LINKED` (exit 2) — never a silent no-op.

## Ops matrix

| Command | Dry-run default | --apply does |
|---------|-----------------|--------------|
| `tasks list\|get\|create\|update` | prints payload | executes against Tasks API |
| `reminders create --title T [--due DATE] [--timed --time RFC3333]` | prints Task (+ event) plan | creates Task, + event when timed |
| `calendar list\|get\|create` | prints payload | executes against Calendar API |
| `docs list\|get` | prints query/file plan | lists/exports via Drive API |
| `auth login` | n/a (interactive link) | opens loopback OAuth flow |
| `auth revoke` | prints target file | deletes tokens file |

## Reminders are Tasks

> A reminder is a **Task with a due date**. A *timed* reminder is that Task
> PLUS a linked Calendar event with a popup reminder.

`reminders create --title "Call buyer" --due 2026-11-20` plans one Task.
Add `--timed --time 2026-11-20T09:00:00Z` to also plan the linked event
(`reminders.overrides: [{ method: "popup", minutes: 10 }]`).

## Explicit follow-ups (NOT built here)

Recorded per the platform nav; out of scope for this connector:

- **Analytics** (Productivity > Analytics) — no reporting built.
- **Assistants / Bots** and **AI Providers** (Build nav) — no agent surfaces.
- **Contacts / Orders / Products** (Manage nav) - per-org store reverted at user direction (2026-11-13).
- **Users** (Manage > Users) and **Organizations CRUD** - not built.
- **Any UI** — CLI + status entries only; the platform renders them.
