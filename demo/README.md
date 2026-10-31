# README demo clip

Source for the ~30 second demo clip shown at the top of the main README: the four
orchestra stages (`orchestra-planner` → `orchestra-implementer` → `orchestra-verifier`
→ `orchestra-reviewer`) fixing a bug in a tiny sample app.

> **The clip is a replay of a real run, sped up.** A live agent run is slow and
> non-deterministic, so the stage text is scripted in `replay.sh` (it mirrors the real
> stage names and verdict tokens `PLAN_READY`, `IMPLEMENT_DONE`, `VERIFY_PASS`,
> `ORCHESTRA_COMPLETE` from `bundle/agents/orchestra-*.md`). The red → green test
> results are genuine: the script applies the fix to a temporary copy and runs the real
> `node --test` before and after.

## Files

| File | Purpose |
|------|---------|
| `app/auth.js` | Sample app, no dependencies. `login()` has one intentional bug: it accepts an empty password |
| `app/auth.test.js` | `node:test` + `node:assert` tests. The empty-password test fails as committed |
| `app/package.json` | `npm test` → `node --test` (private, no dependencies) |
| `replay.sh` | Replay of the orchestra stages; runs the real tests on a temp copy. `bash demo/replay.sh red` just runs the committed (failing) tests |
| `demo.tape` | [VHS](https://github.com/charmbracelet/vhs) script that records the clip |

The sample app stays **red on purpose**. Never commit the fix to `demo/app/auth.js`;
`replay.sh` only ever edits a throw-away temp copy.

## Render

Requires Node.js 18+, bash, and VHS (which needs `ttyd` and `ffmpeg` on your PATH).

```bash
# 1. Install VHS (pick one)
brew install vhs                                  # macOS / Linux with Homebrew
go install github.com/charmbracelet/vhs@latest    # needs Go; also install ttyd + ffmpeg

# 2. From the repo root: check the script, then render
vhs validate demo/demo.tape
mkdir -p docs/assets
vhs demo/demo.tape      # writes docs/assets/demo.gif and docs/assets/demo.mp4
```

Then embed the GIF near the top of the root `README.md`, under the title and badges:

```markdown
<p align="center"><img src="docs/assets/demo.gif" alt="P-Core Orchestra fixing a login bug: plan, implement, verify, review" width="800"></p>
```

Keep the GIF under about 5 MB. If it is bigger, lower `Set Width`/`Set Height` or
`Set Framerate` in `demo.tape`.

## Try the pieces by hand

```bash
cd demo/app && npm test          # red: "rejects an empty password" fails
cd ../..
bash demo/replay.sh red          # the same real run, shown concisely
bash demo/replay.sh              # type "fix the login bug" at the prompt
REPLAY_FAST=1 bash demo/replay.sh </dev/null   # no pauses, auto prompt (for checks)
```

## Reset the sample app

`replay.sh` never changes `demo/app`. If you edited it by hand while experimenting:

```bash
git checkout -- demo/app
```

The bug is the single line in `app/auth.js` marked `// BUG`; the expected fix is
`return password !== "" && password === expected;`.
