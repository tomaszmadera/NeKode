# verify-targeted needs the cmd wrapper and //c in Git Bash

The harness scripts that spawn a command argument (`verify-targeted`, `verify-changed`) use `CreateProcess`, which cannot execute the `pnpm` shim directly: passing the command bare fails with `WinError 2`. Wrap it as `cmd /c pnpm ...`. In Git Bash, MSYS path conversion rewrites `/c` to `C:/` (the child then reports `'enderer' is not recognized`), so write `cmd //c pnpm ...`.

Evidence (2026-09-28): `python .agents/scripts/verify-targeted -- pnpm exec vitest run ...` failed with `FileNotFoundError: [WinError 2]`; the quoted-argument form with bare `/c` produced `cmd C:/`; `python .agents/scripts/verify-targeted -- cmd //c pnpm exec vitest run <paths>` exited 0. This applies to the spawned command only: interactive `pnpm <script>` calls stay direct in Git Bash.
