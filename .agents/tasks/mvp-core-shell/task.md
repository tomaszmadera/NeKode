---
id: mvp-core-shell
schema_version: 2
status: active
intent: feature
complexity: large
durability: recorded
current_phase: Phase 2
current_step: Phase 2.3
updated: 2026-09-22
branch: main
worktree: current
next_action: Resume Stage 2 from handoff (.agents/handoffs/mvp-core-shell.md): fix app-api.test.ts, finish missing tests/wiring, then gates + independent review
blockers: none
---

# NeKode MVP Core: Application Shell and First Vertical Slice

## Objective

Dostarczenie pierwszej pionowej funkjonalnej calosci NeKode (Electron): powloka pieciu regionow, persystencja projektow/zadan w SQLite, terminal PTY przypisany do zadania z zachowaniem sesji przy przelaczaniu. Uzytkownik: programista na Windows 11 pracujacy z agentami CLI.

## Scope

Spec: `docs/features/mvp-core-shell/spec.md`. Plan: `.agents/tasks/mvp-core-shell/plan.md`. Zadanie pokrywa petle minimum usable loop (projekt -> zadanie -> zywy terminal). Drzewo plikow, Action Bar, bottom terminal, Kanban - kolejne zadania.

## Phase 0 - Intake

- [x] Phase 0.1 - Inspect the repository and refine the provisional classification

## Phase 1 - Specification and Plan

- [x] Phase 1.1 - Specification (docs/features/mvp-core-shell/spec.md)
- [x] Phase 1.2 - Plan approval (plan status: draft -> approved)

## Phase 2 - Preflight and Implementation

- [x] Phase 2.1 - Preflight gate
- [x] Phase 2.2 - Stage 1: Application shell and typed IPC skeleton
- [ ] Phase 2.3 - Stage 2: Persistence services and project/task data flow
- [ ] Phase 2.4 - Stage 3: Task terminal with session preservation

## Decisions

- Zgodnie z SDD.md: renderer nie posiada uprawnien OS (contextIsolation, preload bridge `window.app.*`); PTY zyje w procesie main.
- Stos z bootstrapu: Electron 34, React 19, TS 5.9, Vite/electron-vite, Tailwind 4, better-sqlite3 12 (prebuilt), node-pty 1.1 (prebuilt ConPTY).
- Klasyfikacja: intent feature, complexity large (3 etapy: shell/IPC, persystencja, terminal).

## Changed files

- `docs/features/mvp-core-shell/spec.md`
- `.agents/tasks/mvp-core-shell/task.md`
- `.agents/tasks/mvp-core-shell/plan.md`

## Verification

| Check | Result | Notes |
|---|---|---|
| `task-status --check` | pass | Rekord walidny po utworzeniu i po fazie spec/plan |
| `preflight` | pass | Windows-native env, branch main, weryfikacja skonfigurowana |
| `pnpm run test` (baseline) | pass | 1/1 bootstrap suite, przed edycjami produktu |
| Stage 1 gates (koordynator, po implementerze) | pass | lint 0, typecheck 0, test 14/14, build 0; bundler renderera bez `electron`; sandbox:true + contextIsolation + nodeIntegration:false potwierdzone w src/main/index.ts |
| Independent review Stage 1 (subagent-reviewer) | blocking | 1 blocking: useResizableRegion.ts - utracony mouseup/blur zostawia zywy listener, brak cleanup przy unmount (fix: Pointer Events + pointer capture + useEffect cleanup). 8 non-blocking zapisanych jako carry-over w plan.md (Stage 2/3) |
| Korekta Stage 1 (subagent-implementer) | pass | useResizableRegion -> Pointer Events + setPointerCapture (try/catch), listenery na elemencie, pointercancel/lostpointercapture, cleanup unmount, multi-touch guard; bramki u koordynatora: lint 0, tc 0, test 21/21, build 0 |
| Re-review Stage 1 runda 1 (swiezy reviewer) | pass | 0 blocking; root cause zamkniety (capture + cancel/lostpointercapture), unmount czysty, API kompatybilne, zakres dotrzymany; 5 non-blocking (glebokosc testow) -> carry-over w plan.md |

## Timing

| Element | Kind | Started | Ended |
|---|---|---|---|
| intake | work | 2026-09-22T18:31:30Z | 2026-09-22T18:36:00Z |
| spec | work | 2026-09-22T18:36:00Z | 2026-09-22T18:38:00Z |
| plan | work | 2026-09-22T18:38:00Z | 2026-09-22T18:39:00Z |
| approval | wait | 2026-09-22T18:39:00Z | 2026-09-22T18:42:00Z |
| preflight | work | 2026-09-22T18:42:00Z | 2026-09-22T18:46:00Z |
| implement:stage1 | work | 2026-09-22T18:46:00Z | 2026-09-22T20:52:00Z |
| review:stage1 | work | 2026-09-22T20:52:00Z | 2026-09-22T21:10:00Z |
| correction:stage1 | work | 2026-09-22T21:10:00Z | 2026-09-22T21:33:00Z |
| review:stage1-rr1 | work | 2026-09-22T21:33:00Z | 2026-09-22T21:38:00Z |
| implement:stage2 | work | 2026-09-22T21:40:00Z | 2026-09-22T22:30:00Z |
| handoff | wait | 2026-09-22T22:30:00Z | |

## Risks and blockers

- Stage 2 paused mid-flight (provider rate-limit HTTP 429 + user-requested pause). Snapshot: `.agents/handoffs/mvp-core-shell.md`. Pause state is a wait (handoff Timing row), not a task-level blocked status.

- Brak zatwierdzenia planu blokuje preflight i edycje produktu (workflow SDD).

## Resume instructions

Plan w `.agents/tasks/mvp-core-shell/plan.md` oczekuje na akceptacje uzytkownika. Po akceptacji: status planu -> approved, zamkniecie Phase 1.2, preflight, start Stage 1.
