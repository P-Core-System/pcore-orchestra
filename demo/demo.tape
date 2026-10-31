# demo/demo.tape — VHS script for the README demo clip (~30 s).
# Render from the repo root:  vhs demo/demo.tape   (see demo/README.md)
#
# NOTE: outputs are written relative to where you run vhs (the repo root).
# They are intentionally NOT committed on this branch; render them when you are ready:
Output docs/assets/demo.gif
Output docs/assets/demo.mp4

# NOTE: the agent stages come from demo/replay.sh, a REPLAY of a real run, sped up.
# The red -> green test results are genuine: replay.sh applies the fix to a temp copy of
# demo/app and runs the real `node --test` before and after. Captions say "replay".

Require bash
Require node

Set Shell bash
Set FontSize 18
Set Width 1200
Set Height 700
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms
Set PlaybackSpeed 1
Set WindowBar Colorful
Set WindowBarSize 40
Set BorderRadius 8

# --- hidden setup: short prompt, clean screen ---------------------------------
Hide
Type "export PS1='\[\e[1;32m\]$\[\e[0m\] '"
Enter
Type "clear"
Enter
Show

# --- 0-3 s: the failing test (real run of the committed demo/app, red) --------
Type "bash demo/replay.sh red"
Sleep 400ms
Enter
Sleep 2s

# --- 3-6 s: type the prompt ---------------------------------------------------
Hide
Type "clear"
Enter
Show
Type "bash demo/replay.sh"
Sleep 300ms
Enter
Sleep 1s
Type "fix the login bug"
Sleep 500ms
Enter

# --- 6-24 s: planner -> implementer -> verifier (red -> green) -> reviewer ----
# replay.sh prints each stage (~17 s in total, replay of a real run, sped up).
Sleep 17s

# --- 24-30 s: closing card (install one-liner + repo link, printed by replay.sh)
Sleep 6s
