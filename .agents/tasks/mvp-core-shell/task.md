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
next_action: Handoff (snapshot .agents/handoffs/mvp-core-shell.md): user-gate acceptance AC1-6 (+ exit/quit checks) in pnpm dev / scripts/start.ps1 pending; after it task-close with full verification (multi-stage) + verification subject
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
| Stage 3 implementacja (subagent-implementer deleg_2d8c9100) + bramki koordynatora | pass | Lazy PTY per zadanie w main (PtyFactory + terminal-service, PowerShell win32, cwd = katalog projektu), TaskWorkspace z ukrytymi widokami (sesja + scrollback przez przelaczniki), stany session-ended/spawn-error + respawn, terminateAll na before-quit, git status read-only (porcelain=v2 --branch, degradacja brak gita), xterm + fit w TaskTerminal. Carry-over Stage 3 zrobiony w calosci (m.in. usuniecie kanalu terminals:terminate zgodne z Data/API spec, right-region sibling, TEST_ID -> lib/test-ids.ts, usuniecie @electron-toolkit/preload, a11y resize, testy handlerow IPC, drag testy, poprawki non-blocking Stage 2). Bramki koordynatora: lint 0, tc 0, test 134/134 (17 plikow), build 0; bundler renderera bez electron/node-pty; package.json/lock tylko usuwanie preload; AppApi.terminals == spec Data/API |
| Independent review Stage 3 (subagent-reviewer deleg_4a4db566) | blocking | 2 blocking w TaskWorkspace.tsx (cykl zycia PTY): (1) respawn martwych/failed sesji przy odswiezaniu danych zamiast jawnego re-selekcjonowania (efekt zalazny od tozsamosci obiektow — fix: [selectedTaskId, selectionNonce] + cwd przez lookup); (2) brak ewikcji sesji usunietych zadan — ukryte widoki z zywymi PTY/xterm/listenerami do quit (fix: ewikcja w rendererze + terminate osieroconych PTY w main przy projects:remove). 5 non-blocking (komentarze, a11y min/max, raw error fallback, fit guard) -> korekta opcjonalnie lub carry-over. Checklist 1-3,5-6 pass (spec/izolacja/kontrakt/testy/boundary); decyzja o usunieciu terminals:terminate potwierdzona jako zgodna ze specem; bramki reviewera: lint 0, tc 0, test 134/134, build 0 |
| Korekta Stage 3 (subagent-implementer deleg_e799eb0c) + bramki koordynatora | pass | (1) efekt sesji na [selectedTaskId, selectionNonce] + lookup przez ref — odswiezenie danych nigdy nie respawnuje, jawny re-selekcjonowanie tak (biome-ignore uzasadniony); (2a) ewikcja sesji bez istniejacego zadania (unmount dispose + unsubscribe); (2b) projects:remove w main terminuje PTY usunietego projektu (taskIds przed cascade), terminateAll nietkniete. Testy regresyjne: reload-resilience ended/spawn-error + respawn przy re-selekcji, ewikcja z dispose/unsubscribe, handler test (dokladnie PTY usunietego projektu, cudze sesje zyja). Caly polish (i)-(v) zrobiony. Bramki koordynatora: lint 0, tc 0, test 138/138 (17 plikow), build 0; bundler renderera czysty |
| Re-review Stage 3 runda 1 (swiezy reviewer deleg_b0b4ae6f) | pass | 0 blocking; oba fixy zamkniete (respawn scisle na jawnej re-selekcji — testy odpornosc na reload; ewikcja + terminate w main po taskIds sprzed cascade — test handlera z FakePty na dokladnym zbiorze kill), brak nowych bledow (deps kompletne, sciezki bledow typowane, fit guard nie blokuje legalnych fitow); 1 non-blocking (ewikcja po nieobecnosci w tasksByProject moze zniszczyc widok przy przejsciowym zaniku zadania — waski wyscig w App.loadTasks) -> BACKLOG.md; bramki reviewera: lint 0, tc 0, test 138/138, build 0 |

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
| implement:stage3 | work | 2026-09-24T18:53:31Z | 2026-09-24T19:37:51Z |
| review:stage3 | work | 2026-09-24T19:37:51Z | 2026-09-24T19:53:09Z |
| correction:stage3 | work | 2026-09-24T19:53:09Z | 2026-09-24T20:17:18Z |
| review:stage3-rr1 | work | 2026-09-24T20:17:18Z | 2026-09-24T20:23:41Z |
| user-gate:stage3 | wait | 2026-09-24T20:23:41Z | 2026-09-24T21:51:28Z |
| handoff | wait | 2026-09-24T21:51:28Z | |

## Risks and blockers

- Stage 2 paused mid-flight (provider rate-limit HTTP 429 + user-requested pause). Snapshot: `.agents/handoffs/mvp-core-shell.md`. Pause state is a wait (handoff Timing row), not a task-level blocked status.

- Brak zatwierdzenia planu blokuje preflight i edycje produktu (workflow SDD).

## Resume instructions

Plan w `.agents/tasks/mvp-core-shell/plan.md` oczekuje na akceptacje uzytkownika. Po akceptacji: status planu -> approved, zamkniecie Phase 1.2, preflight, start Stage 1.
