# ci commit -f: pass all paths in one flag occurrence

`ci.py commit -f A -f B -f C` commits ONLY `C`. The argparse definition uses
`-f/--files` with `nargs="+"` but no `action="append"` (`.agents/skills/ci/scripts/ci.py:45`),
so each repeated `-f` replaces the previous list and the earlier paths are
silently dropped; the tool then reports success for a partial commit.

Pass all paths in ONE occurrence: `ci.py commit -m "..." -f A B C` (verified
2026-10-01 after three partial commits during the 0.4.9 publication). Verify
with `git show <hash> --stat` after every scoped commit. Two related traps in
the same flow: `bump` counts untracked files as dirty (dry-run does not), and
`git add` alone can look like a partial-commit cure while the real cause is
the dropped arguments.
