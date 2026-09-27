---
id: bottom-auxiliary-terminal
schema_version: 2
status: active
intent: feature
complexity: large
durability: recorded
current_phase: Phase 2
current_step: Phase 2.2
updated: 2026-09-27
branch: main
worktree: current
next_action: Resume from handoff and run independent review of Stage 1 before Stage 2
blockers: none
---

# Bottom auxiliary terminal

## Objective

Dolny panel pomocniczy na całą szerokość okna, nad paskiem statusu: kilka zakładek terminala, których sesje żyją po ukryciu panelu. Programista na Windows 11 może odpalić test, log albo skrypt bez przerywania terminala aktywnego czatu. To samo zadanie odblokowuje tryb akcji `bottom-terminal`.

## Scope

Spec: `docs/features/bottom-auxiliary-terminal/spec.md`. Plan: `.agents/tasks/bottom-auxiliary-terminal/plan.md`.

Panel (skrót, fokus, wysokość, trwałość układu), wiele zakładek terminali oraz wykonanie akcji projektu w tym panelu. Poza zakresem: prawy panel, encja Task, Kanban, edycja plików.

## Phase 0 - Intake

- [x] Phase 0.1 - Inspect the repository and refine the provisional classification (branch main; large stands: panel with tabs and the action mode are separate demonstrable stages)

## Phase 1 - Specification and Plan

- [x] Phase 1.1 - Specification (docs/features/bottom-auxiliary-terminal/spec.md)
- [x] Phase 1.2 - Plan approval (plan status: draft -> approved; zatwierdzony przez użytkownika 2026-09-27)

## Phase 2 - Preflight and Implementation

- [x] Phase 2.1 - Preflight gate
- [ ] Phase 2.2 - Stage 1: Bottom panel and terminal tabs (implementer)

## Decisions

- 2026-09-27 użytkownik: dolny panel ma wiele zakładek terminali, nie jeden terminal. Mechanika panelu zostaje z SDD #19 i UX-UI (przełącznik, fokus, wysokość, sesja żyje po ukryciu).
- Reguły zakładek, rozwiązane z kontraktu czatu i z istniejącego regionu dolnego: należą do projektu aktywnego w chwili utworzenia, nie są czatami i nie wchodzą do drzewka, nazwa to nazwa shella, duplikaty dozwolone, lista żyje tylko do zamknięcia aplikacji. Wysokość zostaje przy obecnym limicie 160-560 px, domyślnie 220. Otwarcie panelu to nowy klucz `region.bottom.open`.
- `Ctrl + `` przy ukrytym panelu i braku zakładek projektu tworzy jedną zakładkę. Przy istniejących zakładkach tylko pokazuje panel.
- Tryb `bottom-terminal` zawsze tworzy nową zakładkę. Nie wpisuje polecenia do już otwartego terminala i nie zmienia zaznaczonego czatu.
- Etapy: 1 panel i zakładki, 2 tryb akcji. Plan zatwierdzony przez użytkownika 2026-09-27.
- Identyfikator zakładki dolnej to `bottom:<projectId>:<uuid>`. To nie jest id czatu. `terminals:terminate` przyjmuje tylko taki id. Quit woła `terminateAll` i nie usuwa czatów.
- Nazwa shella przychodzi z `terminals:shellName`. Renderer nie tworzy czatu, żeby ją poznać.
- Aktywny projekt zakładek to projekt paska (`filesProjectId ?? selectedProjectId`).
- Dolny terminal używa `ChatTerminal`, więc kontrakt Ctrl+D / Ctrl+U zostaje. Akord `Ctrl + Backquote` jest połykany i nie idzie do PTY.
- Uchwyt wysokości jest górną krawędzią regionu dolnego. Limity 160, 220 i 560 zostają.

## Changed files

- `docs/features/bottom-auxiliary-terminal/spec.md`
- `.agents/tasks/bottom-auxiliary-terminal/plan.md`
- `.agents/tasks/bottom-auxiliary-terminal/task.md`
- `.agents/handoffs/bottom-auxiliary-terminal.md`
- `src/shared/bottom-tab-id.ts`
- `src/shared/ipc-contract.ts`
- `src/main/services/terminal/terminal-service.ts`
- `src/main/services/terminal/terminal-service.test.ts`
- `src/main/services/create-services.ts`
- `src/main/ipc/service-registry.ts`
- `src/main/ipc/ipc-validation.ts`
- `src/main/ipc/ipc-validation.test.ts`
- `src/main/ipc/ipc-handlers.ts`
- `src/main/ipc/ipc-handlers.test.ts`
- `src/preload/app-api.ts`
- `src/preload/app-api.test.ts`
- `src/renderer/src/App.tsx`
- `src/renderer/src/App.test.tsx`
- `src/renderer/src/BottomPanel.test.tsx`
- `src/renderer/src/components/terminal/BottomPanel.tsx`
- `src/renderer/src/components/terminal/bottom-tabs.ts`
- `src/renderer/src/components/terminal/bottom-panel-chord.ts`
- `src/renderer/src/components/terminal/ChatTerminal.tsx`
- `src/renderer/src/lib/test-ids.ts`
- `src/renderer/src/test/xterm-mock.ts`
- stuby `AppApi` w testach renderera: `ChatTerminal`, `ChatWorkspace`, `CenterTabs`, `ProjectFiles`, `StatusBar`, `useResizableRegion`

## Verification

| Check | Result | Notes |
|---|---|---|
| repository inspection | pass | branch main, clean worktree at intake; bottom region already exists and is hidden (`App.tsx`), height key `region.bottom.height` already persists (default 220, min 160, max 560) |
| product tests | not run | plan is draft; preflight and product edits wait for approval |
| `python .agents/scripts/preflight` | pass | exit 0; Python 3.13.5; windows-native; branch main; no upstream; untracked 2 (this task's spec and record) |
| `pnpm run test` | pass | exit 0; 296/296 in 23 files; baseline before Stage 1 |
| `pnpm run typecheck` | pass | exit 0; baseline before Stage 1 |
| `pnpm run typecheck` | pass | exit 0; coordinator recount 2026-09-27T21:00:01Z after Stage 1 |
| `pnpm run test` | pass | exit 0; 314/314 in 24 files; coordinator recount 2026-09-27T21:00:01Z |
| `pnpm run lint` | fail | exit 1; only `package.json` CRLF in the worktree (63 CR). HEAD blob has 0 CR and 63 LF. `git status` does not list `package.json`. Known lesson `windows-biome-package-json-eol`. Not a Stage 1 diff |
| `pnpm run build` | not rerun | implementer reported exit 0; coordinator did not rerun build |

## Timing

| Element | Kind | Started | Ended |
|---|---|---|---|
| intake | work | 2026-09-27T20:03:57Z | 2026-09-27T20:09:59Z |
| spec | work | 2026-09-27T20:09:59Z | 2026-09-27T20:09:59Z |
| plan | work | 2026-09-27T20:09:59Z | 2026-09-27T20:09:59Z |
| approval | wait | 2026-09-27T20:09:59Z | 2026-09-27T20:21:26Z |
| preflight | work | 2026-09-27T20:21:26Z | 2026-09-27T20:23:13Z |
| implement:1 | work | 2026-09-27T20:23:13Z | 2026-09-27T21:00:01Z |
| handoff | wait | 2026-09-27T21:00:01Z | |

## Risks and blockers

- Ukrycie panelu nie może zabić PTY. Identyfikatory zakładek dolnych nie są identyfikatorami czatów.
- Migracja `run_mode` jest nową wersją. Stary wpis tabeli `actions` nie jest edytowany.

## Resume instructions

Wznów z `.agents/handoffs/bottom-auxiliary-terminal.md`. Pierwsza akcja: niezależny review etapu 1 (`code-review`), nie Stage 2. Nie powtarzaj implementacji etapu 1 bez nowej usterki. Nie commituj `package.json` z powodu CRLF.
