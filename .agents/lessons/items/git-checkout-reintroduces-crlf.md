# git checkout -- reintroduces CRLF on autocrlf=true

**Lesson:** After a mutation probe or any restore of a tracked text file with `git checkout -- <path>` (or `git restore`) on `core.autocrlf=true`, the worktree file is rewritten with CRLF even though the HEAD blob is LF. A later formatter (Biome) then fails the restored file while `git diff` still shows an empty content diff. Restore such files by writing the HEAD blob bytes directly (e.g. `git show HEAD:<path>` piped to the file in binary mode) instead of `git checkout --`, and verify with a byte comparison plus zero-CR check before re-running gates.

**Reason:** In this repository the 2026-09-28 review4-followups task hit this twice in one session (`package.json`, `src/main/db/migrations.ts`); the existing lesson `windows-biome-package-json-eol` covers the empty-diff/modified-status signature but not this checkout-on-touch reintroduction path, and `git status` alone does not reveal it until lint runs.
