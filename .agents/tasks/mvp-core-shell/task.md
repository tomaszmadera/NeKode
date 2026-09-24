---
id: mvp-core-shell
schema_version: 2
status: active
intent: feature
complexity: large
durability: recorded
current_phase: Phase 2
current_step: Phase 2.4
updated: 2026-09-24
branch: main
worktree: current
next_action: Stage 3: dispatch implementer subagent (Task terminal with session preservation: node-pty PTY per task in main, xterm.js in renderer, session preservation on task switch, session-ended/spawn-error states, app-quit PTY teardown); then gates + independent review + task-close with full verification
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
- [x] Phase 2.3 - Stage 2: Persistence services and project/task data flow
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
| Resume preflight 2026-09-24 (preflight + bramki przed edycjami) | pass | preflight exit 0 (windows-native, branch main); `pnpm run typecheck` exit 0 — blad z handoffa (app-api.test.ts) juz naprawiony, roszczenie snapshotu nieaktualne; `pnpm run test` 41/41 (9 plikow). Repo wyprzedza snapshot: backend Stage 2 kompletny (db + serwisy + ipc-validation + testy db/ipc, commit 49c439b); zostaje renderer wiring + testy serwisow |
| Stage 2 implementacja (subagent-implementer deleg_82ab91b1) + bramki koordynatora | pass | Renderer wiring (projekty/zadania, Add Project dialog, New Task, Remove Project, persistencja selekcji + stale fallback, context header name/path/runtimeLabel, region-size hydrate/persist przez state.*), testy serwisow :memory: (project/task/app-state CRUD + walidacja + cleanupSelection) i testy renderera z mocked window.app; useResizableRegion -> controlled API (carry-over Stage 1). Bramki u koordynatora: lint 0, tc 0, test 84/84 (12 plikow), build 0; bundler renderera bez `electron` (SDD §6). Diff = deklarowane pliki; package.json tylko EOL |
| Independent review Stage 2 (subagent-reviewer deleg_7eda3d78) | blocking | 1 blocking: App.tsx:256 handleRemoveProject kasuje selekcje i nadpisuje klucze selection takze przy usunieciu NIEzaznaczonego projektu (fix: czyscic selekcje tylko gdy removed == selected). 6 non-blocking -> carry-over w plan.md (w tym: brak testu usuwania niezaznaczonego projektu — wymagany w korekcie). Checklist 1-3,5,6 pass (spec, izolacja/bundle czysty, kontrakt AppApi, testy uczciwe, boundary Stage 3 dotrzymany); bramki reviewera: lint 0, tc 0, test 84/84, build 0 |
| Korekta Stage 2 (subagent-implementer deleg_c5a7c753) + bramki koordynatora | pass | handleRemoveProject czysci selekcje i klucze tylko gdy removed == selected (selectedProjectId w deps); regresyjny test usuwania niezaznaczonego projektu (A+B: usuwa B, A i t1 zostaja, state.set bez ''); opcjonalnie odizolowany refresh po remove (blad odswiezania != blad usuwania). Bramki koordynatora: lint 0, tc 0, test 85/85 (12 plikow), build 0; bundler renderera bez `electron` |
| Re-review Stage 2 runda 1 (swiezy reviewer deleg_1971f6c0) | pass | 0 blocking; fix warunkowy zamkniety (obie sciezki: selected -> fallback + wyczyszczone klucze; niezaznaczone -> selekcja nietkniona), test regresyjny uczciwy (odwraca fixa = fail), brak nowych bledow (deps kompletne, blad remove raportowany wczesnym returnem); 2 non-blocking (waski wyscig closure po await, cichy catch odswiezania) -> carry-over w plan.md; bramki reviewera: lint 0, tc 0, test 85/85, build 0 |

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
| handoff | wait | 2026-09-22T22:30:00Z | 2026-09-24T18:00:22Z |
| preflight | work | 2026-09-24T18:00:22Z | 2026-09-24T18:02:07Z |
| implement:stage2 | work | 2026-09-24T18:02:07Z | 2026-09-24T18:37:46Z |
| review:stage2 | work | 2026-09-24T18:37:46Z | 2026-09-24T18:44:51Z |
| correction:stage2 | work | 2026-09-24T18:44:51Z | 2026-09-24T18:48:44Z |
| review:stage2-rr1 | work | 2026-09-24T18:48:44Z | 2026-09-24T18:53:31Z |
| implement:stage3 | work | 2026-09-24T18:53:31Z | |

## Risks and blockers

- Stage 2 paused mid-flight (provider rate-limit HTTP 429 + user-requested pause). Snapshot: `.agents/handoffs/mvp-core-shell.md`. Pause state is a wait (handoff Timing row), not a task-level blocked status.

- Brak zatwierdzenia planu blokuje preflight i edycje produktu (workflow SDD).

## Resume instructions

Plan w `.agents/tasks/mvp-core-shell/plan.md` oczekuje na akceptacje uzytkownika. Po akceptacji: status planu -> approved, zamkniecie Phase 1.2, preflight, start Stage 1.
