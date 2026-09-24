---
task_id: mvp-core-shell
created: 2026-09-24T22:56:31Z
schema_version: 2
from: Main (Hermes coordinator session)
to: Main (next session)
branch: main
worktree: current
checkpoint_subject: dbbc32b77ba5887bb5fdc7e54f3dc980335b614d+sha256:37faab5d94b5daedbb3b15ff1a06cc81af818587c1c868359fd996586db5a23f
current_step: Phase 2.4
next_action: Obtain the user's manual acceptance pass (spec Acceptance criteria 1-6 plus session-ended/quit-cleanup checks) in `pnpm dev` or scripts/start.ps1 and record per-criterion results in the task record; then task-close with full verification
blockers: none
---

# Handoff: NeKode MVP Core Shell — acceptance user-gate pending after Stage 3

## Repository snapshot

Linked task record: `.agents/tasks/mvp-core-shell/task.md` (current_step: Phase 2.4, plan `.agents/tasks/mvp-core-shell/plan.md` status approved). Spec: `docs/features/mvp-core-shell/spec.md`. Transferred role: Main to Main. Reason: user-requested pause at the acceptance user-gate — all three stages are implemented, independently reviewed and committed; what remains is the manual acceptance pass (needs the user at the GUI) and the final close. A short resume session (2026-09-24T22:16Z-22:56Z) only re-verified state (preflight + tests-before-edits) and touched no product code.

### Working

- Stage 1 (five-region shell + typed IPC skeleton): accepted after one correction round + re-review (evidence in the record; work originally landed in commit 49c439b).
- Stage 2 (persistence + project/task data flow), commit `b6ba66a`: SQLite (WAL) services in main (project/task/app-state + migrations + ipc-validation), renderer wiring — real project/task lists, Add Project (native dialog in main; `projects.add()` no-arg, resolves `ProjectInfo | null`), New Task, Remove Project (selection + persisted keys cleared ONLY when the removed project is the selected one), selection persistence via `state.set` (empty string clears; `AppApi.state` has no delete), context header (name/path/runtimeLabel), region-size hydrate/persist. Service tests on `:memory:` + renderer tests with a mocked `window.app`.
- Stage 3 (task terminal with session preservation), commit `a18c3c2` (includes review corrections): lazy per-task node-pty PTY in main (PtyFactory injection; `powershell.exe -NoLogo` on win32, cwd = project dir), xterm.js + fit in renderer (`TaskTerminal`/`TaskWorkspace`), hidden-mounted session views (PTY process + scrollback survive task/project switches), session-ended state (`Session ended (exit code N)` + `Start new session`) and spawn-error state (+ Retry), respawn strictly on explicit re-selection (effect deps `[selectedTaskId, selectionNonce]` + ref lookup), eviction of session views for removed tasks with main-side PTY termination in the `projects:remove` handler (task ids captured before the FK cascade), `terminateAll` on app `before-quit`, read-only git status (`git status --porcelain=v2 --branch` via injectable runner; degrades to `{branch: null, dirty: false}`; detached HEAD -> `HEAD (detached)`) refreshed on selection change only.
- Stage-3 carry-over complete: right region as a five-region sibling (SDD §7), `TEST_ID` -> `lib/test-ids.ts`, `@electron-toolkit/preload` removed (the ONLY package.json/lock change), keyboard resize a11y (aria-valuenow/min/max, arrow nudge, preventDefault), ipc handler invocation tests, drag interaction tests, all Stage-2-review non-blocking fixes. `terminals:terminate` channel dropped deliberately (see Decisions).
- User tooling, NOT task-owned and UNCOMMITTED (`scripts/`): `start.ps1` (dev/unpacked launcher, state in `tmp/nekode-run.json`, logs in `tmp/logs/`) and `stop.ps1` (reaps the run; see Failed approaches for why plain tree-kill is insufficient). Verified live: start -> app up -> stop -> zero NeKode processes remain.

### Broken

- Nothing known. All gates green at handoff time (see Verification). The manual acceptance pass has NOT been run — that is the open user-gate, not a defect.

## Decisions

- `terminals:terminate` is intentionally absent from `IPC_CHANNEL`/`AppApi` — spec Data/API lists exactly `create/write/resize/onData/onExit`, and Behaviour 8 (quit kills all PTYs) is satisfied by `TerminalService.terminateAll` wired to app `before-quit`. Do not re-add without a spec change.
- Session model: hidden-mounted per-task terminal views (never destroyed on task/project switch); dead sessions are replaced only by explicit re-selection (`selectionNonce`); sessions of removed tasks are evicted in the renderer (dispose + unsubscribe) while their PTYs are terminated in main — the renderer owns no OS calls (SDD §6).
- Selection persistence writes `''` to clear keys; `AppStateService.cleanupSelection` owns server-side key hygiene.
- Git status: read-only, refresh on selection change only (no watchers) to protect the stage boundary.
- Workflow SDD Large: Main coordinated only; each stage ran a fresh implementer + independent reviewer subagent (same-agent reviewer is the standing default per `.agents/workflows/references/extra-session.md`); 1 correction/re-review round per stage (cap is 2).

## Failed approaches

- Do not tree-kill the dev run from the recorded root PID alone: `pnpm run dev` re-spawns through intermediate processes (pnpm.exe/cmd with foreign PPIDs) and node-pty ConPTY shells can sit outside that tree. Working attribution (see `scripts/stop.ps1`): recorded run tree + processes named node/cmd/electron/nekode whose command line mentions the repo root + transitive children of those sets; bare user shells are only ever reported, never killed.
- Do not trust snapshot claims over repository evidence — the previous snapshot's "broken typecheck" and "missing backend" were already resolved by the time work resumed.

## Verification

- `pnpm run lint`: exit 0 (Biome 2; the old ResizeHandle a11y warnings were resolved by the Stage 3 keyboard/a11y work).
- `pnpm run typecheck`: exit 0.
- `pnpm run test`: exit 0 — 138/138 tests in 17 files (vitest 5 `test.projects`: node for main/preload/shared, jsdom for renderer). Re-run at resume 2026-09-24T22:16Z: 138/138, identical baseline.
- `pnpm run build`: exit 0; renderer bundle greps clean of `electron`/`node-pty`/`child_process` (SDD §6).
- `python .agents/scripts/task-status --check .agents/tasks/mvp-core-shell/task.md`: pass (re-validated after the resume and handoff record updates).
- Resume preflight 2026-09-24T22:18Z: `python .agents/scripts/preflight` exit 0 (windows-native, Windows 11, Node 24.18.0, pnpm 12.5.1, branch main).
- Manual acceptance (spec Acceptance criteria 1-6 + `exit` -> session-ended state + quit leaves no orphaned shells): NOT RUN — pending user-gate; nothing is claimed as passed.
- Checkpoint subject hash = `git diff HEAD -- .agents/tasks/mvp-core-shell docs/features/mvp-core-shell | sha256sum` evaluated at snapshot creation (the snapshot itself is excluded from the scope); no untracked files in scope.

## Open product invariants

- `sdd-6-renderer-no-os` (renderer must not own OS capabilities): status open by design for the slice. Impact on the current result: none — re-verified after Stage 3 (bundle grep clean, everything through `window.app.*`). Evidence needed to change status: not available in this slice; keep open.

## Unresolved assumptions

- Acceptance criteria 1-6 and the PTY behaviours hold in a real GUI session (ConPTY spawn, real xterm/fit, native directory dialog are untestable in vitest/jsdom). Source: plan Stage 3 verification requires a `pnpm dev` walkthrough. Consequence: task close must wait for that walkthrough. Evidence needed: the user's pass/fail notes per criterion.
- `scripts/start.ps1` and `scripts/stop.ps1` are intentionally left uncommitted pending the user's decision to include them in git. Consequence: a fresh clone lacks the launch helpers. Evidence needed: user decision + a scoped commit.
- Known non-blocking robustness gap (recorded in `BACKLOG.md`): session eviction keyed on absence from `tasksByProject` can destroy a live view during a transient task-list race in `App.loadTasks`. Consequence: rare view/scrollback loss (the PTY survives in main). Evidence needed: a future robustness task (two-snapshot eviction or merge-not-replace task lists).

## Resume instructions

1. First action: obtain the user's acceptance pass — spec `docs/features/mvp-core-shell/spec.md` Acceptance criteria 1-6 (start with `scripts\start.ps1` or `pnpm dev`), plus two checks from the Stage 3 corrections: typing `exit` shows the session-ended state with a working "Start new session", and quitting leaves no orphaned pwsh/powershell (`scripts\stop.ps1` reports leftovers). Record pass/fail per criterion in the task record Verification table and close the `handoff` Timing row. Expected evidence: a Verification row with per-criterion notes.
2. Then activate `task-close` with final verification `full` (multi-stage task): capture the verification subject with `python .agents/skills/task-record/scripts/verification_subject.py capture --record .agents/tasks/mvp-core-shell/task.md --path <task-owned paths>`, persist the emitted `### Verification subject N` block, open the `verify` Timing row, run `python .agents/scripts/verify-full`, then close the record (check Phase 2.4, `current_step: none`, status completed). On verification failure follow the SDD correction loop (unscoped `correction` + `review` rows, then a fresh subject and one retry), never a new stage.
3. Before editing anything: read the task record, the approved plan, the spec, and this snapshot — repository evidence wins over this text. Tests-before-edits baseline: `pnpm run test` (138/138). Spec, plan, approvals and stage review evidence are complete (record Verification table).
- Next skill to load: `handoff` (this snapshot) on resume, then `task-close` after the user-gate passes.
