---
task_id: mvp-core-shell
spec: docs/features/mvp-core-shell/spec.md
status: approved
---

# Plan: NeKode MVP Core Shell — first vertical slice

This file is the execution strategy for one task. It is not live progress and must not replace the task record. Do not put checkboxes here. Link the spec; do not copy it.

`status` is `draft` until the user approves the plan, then `approved`. A Standard plan has exactly one stage. A Large plan has two or more stages. Do not run tests-and-preflight or product code while status is `draft`.

## Goal of this iteration

Deliver the spec's vertical slice: shell + persistence + chat terminal with session preservation and chat closing on terminal exit, verified against the acceptance criteria.

## Spec

`docs/features/mvp-core-shell/spec.md`

## Out of scope

Everything in the spec's Non-goals: file tree/preview, Action Bar, bottom terminal panel, Kanban, git operations UI, agent protocols, multi-terminal/split panes, task entity and progress tracking (post-MVP).

## Stages

### Stage 1 - Application shell and typed IPC skeleton

- Outcome: five-region shell renders (placeholder top bar, left nav with empty Projects list + Add Project affordance, center header + Welcome surface, hidden right/bottom), resizable left/bottom regions, dark theme, English UI; preload bridge exists with typed channel stubs; Electron hardening flags set (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`).
- Boundary: no database, no PTY, no real data — stubs return fixed values; app starts and shows the empty state.
- Verification: `pnpm run lint && pnpm run typecheck && pnpm run test` (renderer smoke: regions render, empty state) + `pnpm run build` + manual `pnpm dev` showing the default state.
- Expected evidence: task record Verification rows; screenshot/observation note of default state.
- Likely files: `src/renderer/src/**` (App, shell components), `src/preload/index.ts`, `src/main/index.ts`, new `src/main/ipc/*`.

### Stage 2 - Persistence services and project/task data flow

- Outcome: SQLite (better-sqlite3, WAL) at `userData/nekode.db`; migrations; projects/tasks/app_state services in main; working Add Project (native dialog), New Task, project removal, selection persistence with stale-state cleanup; left navigation lists real data; context header shows name/path/runtime label.
- Boundary: real data flows end-to-end, but the center surface still shows a placeholder (no terminal yet); git status not yet wired.
- Verification: unit tests for services (CRUD, unique constraints, cascade, stale keys) + IPC validation tests; manual add/remove/selection flow in `pnpm dev`.
- Expected evidence: task record Verification rows; test output; manual flow notes.
- Likely files: `src/main/db/*`, `src/main/services/*`, `src/main/ipc/*`, `src/preload/index.ts`, `src/renderer/src/**` (nav components).

### Stage 3 - Task terminal with session preservation

- Outcome: selecting a task opens the Task workspace; one PTY (PowerShell, cwd = project dir) per task spawned lazily via node-pty in main; xterm.js + fit addon in renderer; terminal write/resize/data channels keyed by taskId; switching tasks preserves processes and scrollback; session-ended and spawn-error states; app quit terminates all PTYs.
- Boundary: completes the slice; git status in the header may land here (read-only `git.getStatus`) or is cut explicitly if it risks the stage boundary.
- Verification: unit tests (terminal service with a fake PTY, git status parser fixtures) + full acceptance pass 1–6 on `pnpm dev` + final gate `verify-full` (lint, typecheck, test, build).
- Expected evidence: task record Verification rows; test output; acceptance-criteria walkthrough notes; final verification subject.
- Likely files: `src/main/services/terminal/*`, `src/main/ipc/terminals/*`, `src/preload/index.ts`, `src/renderer/src/**` (task workspace, terminal components).

### Stage 4 - Chat entity and terminal-exit chat closing (acceptance-gate correction)

- Outcome: the tree entity is the chat (Projects -> Chats) across DB, IPC, and UI (`tasks` -> `chats`, `window.app.chats.*`, drop the `status` column via migration); exiting a chat terminal (`exit`, `Ctrl+D` at an empty prompt, shell crash) closes the chat - terminal view disposed, chat removed from tree and database, next chat of the project auto-selected (previous one if the closed chat was last), otherwise a "Start new chat" empty state; the "session ended"/"Start new session" state is removed entirely (spawn-error + retry state stays); application quit never deletes chats and the restart restore is unchanged.
- Boundary: no bottom terminal panel, no task entity, no kanban; the bottom region stays hidden.
- Verification: unit tests (chat service CRUD + migration, quit-suppression of chat removal, `projects:remove` PTY termination) + renderer tests (terminal exit -> dispose + chat removal + next-chat selection / "Start new chat" empty state; quit does not remove chats) + `pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build` + manual re-test of acceptance criteria 1-6 and 9 on `pnpm dev`.
- Expected evidence: task record Verification rows; test output; acceptance re-test notes per criterion.
- Likely files: `src/main/db/*`, `src/main/services/*`, `src/main/ipc/*`, `src/preload/*`, `src/renderer/src/**`, tests.

## Preflight before edits

- Skill: `preflight`
- Preflight command: `python .agents/scripts/preflight`
- Existing tests before product edits: `pnpm run test` (bootstrap sanity suite), results recorded in the task record Verification table.

## Risks

- xterm.js + React 19 render quirks (fit/addon lifecycle) — mitigated by a thin terminal component and manual check per stage.
- node-pty ConPTY session preservation semantics — verified early in Stage 3 with the long-running-command scenario before building UI state around it.
- better-sqlite3 in the packaged main process needs `electron-builder install-app-deps` (script `rebuild:native` already exists) — applies only when packaging, not to `pnpm dev`.
- Git status polling frequency — keep it explicit (refresh on selection, no watchers) to protect the boundary.

## Review carry-over (non-blocking findings, owner stages)

- Stage 2: payload validation layer in main IPC handlers + tests (spec requires it before real services); persist region sizes via `state.set` (drops dead `ResizableRegionOptions`/`initialSize` and unused `bottomRegion.size`).
- Stage 3: `terminals:terminate` channel — expose in `AppApi` and annotate as the app-quit PTY teardown path, or remove until needed (spec contract is authoritative).
- Stage 3 (or earlier if touched): move `right` region div out of the center column to a real five-region sibling (SDD §7); move `TEST_ID` constants from `App.tsx` to `lib/test-ids.ts` to break App↔component import cycle; remove `@electron-toolkit/preload` from devDependencies; keyboard resize support (`role=separator` a11y) + `preventDefault` on handle mousedown; replace deprecated `environmentMatchGlobs` in vitest config; extend ipc-stubs tests to invoke handlers (payload slicing uncovered) and add a drag interaction test for resize.
- Stage 3 (from Stage 2 review, non-blocking): `App.tsx` persistSelection/resize-end handlers swallow `state.set` rejections with bare `.catch(() => undefined)` — surface to the notice banner or console (spec Errors); `useResizableRegion` endDrag fires `onResizeEnd` even when the size never changed (zero-move click, multi-touch guard, unmount) — only fire when the size actually changed; `NewTaskForm` clears its input after `await` with no unmount guard; a pending `loadTasks(projectId)` resolving after that project's removal re-populates `tasksByProject` with an orphaned entry — drop results for projects no longer present.
- Test depth (from re-review, Stage 2/3 when touching tests): first y-axis move assertion in useResizableRegion.test.tsx is a no-op (delta equals initialSize — strengthen or drop); unmount test is a smoke test, not a regression discriminator (jsdom limitation — note in test); multi-touch/isPrimary/button guard has no coverage (firePointer always sends primary button); lostpointercapture is tested with a manual Event (covers endDrag logic, not real capture retargeting — impossible in jsdom, already commented).

- Stage 4 (re-review rr1 2026-09-25, non-blocking): `App.tsx:72` — selectionRef pisany w ciele renderu (side effect na ref) — synchronizuj z committed state w useEffect (zapisy synchroniczne w handleChatClosed zostawic). `App.tsx:469` — po failed load utworzenie i zamkniecie czatu pokazuje Welcome zamiast 'Start new chat' (chatsLoaded=false) — oznaczaj projekt jako zaladowany po successful chats.create albo retry loadChats. `App.tsx:188` — loadChats nadpisuje caly wpis i moze wskrzesic wiersz usuniety przez rownolegly close flow (pre-existing; wiazane z wpisem BACKLOG o ewikcji) — zamiast nadpisania uzgodnij (reconcile).
- Stage 4 (review 2026-09-25, non-blocking): `LeftNavigation.tsx` — auto-focus inputu New Chat przy kazdym pozniejszym wyborze projektu po jednym bump `newChatFocusNonce` (efekt focusu z deps [focusNonce], NewChatForm remount per projekt) — skupiaj tylko gdy nonce faktycznie rosnal (lastSeenNonceRef). `ChatWorkspace.tsx` — auto-wybor nastepcy moze retryowac failed spawn bez jawnej re-selekcji — potwierdzone jako zamierzone (decyzja w rekordzie), nie wymaga zmiany.

## Approval

Standard and Large: do not run tests-and-preflight or product code until the user approves this plan.
