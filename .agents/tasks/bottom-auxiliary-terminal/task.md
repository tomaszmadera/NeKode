---
id: bottom-auxiliary-terminal
schema_version: 2
status: completed
intent: feature
complexity: large
durability: recorded
current_phase: Phase 3
current_step: none
updated: 2026-09-28
branch: main
worktree: current
next_action: none
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
- [x] Phase 2.2 - Stage 1: Bottom panel and terminal tabs (implementer)
- [x] Phase 2.3 - Stage 2: Action mode `bottom-terminal` (implementer)

## Phase 3 - Retro, Final Verification and Close

- [x] Phase 3.1 - Retro (no qualifying lesson; review:4 non-blocking suggestions recorded in BACKLOG.md)
- [x] Phase 3.2 - Final verification `full` (verify-full subject 2, attempt 2, pass 2026-09-28; review:4 suggestions deferred-by-decision to BACKLOG.md)

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
| `python .agents/scripts/preflight` | pass | exit 0; 2026-09-27T21:17:01Z resume; Python 3.13.5; windows-native; branch main; unstaged 2 (handoff and this record) |
| hook reproduction | diagnosed | `Read 2 skills [hooks: 4 ok, 4 failed]` is two skill reads, four hooks each. Shell is pwsh (`GROK_SHELL` unset). OK twice each, exit 0, stdout `{}`: `.grok/hooks/quota.json` PreToolUse `python3 "$(git rev-parse --show-toplevel)/.agents/hooks/dispatch.py" --event pretool --agent grok` and `.grok/hooks/task-report.json` PostToolUse `--event task-report --agent grok`. FAIL twice each, exit 1: `.claude/settings.json` PreToolUse and PostToolUse. The command is the bash one-liner starting `PY="$(command -v python3 || command -v python || echo py -3)"`. pwsh ParserError: unexpected token `"$DIR/.agents/hooks/dispatch.py"`. Not `.agents/hooks.json` and not `dispatch.py`. The original session did not store stderr. Green `Skill handoff [hooks: 2/2]` is the two Grok hooks only. |
| review:1 | blocking | 2026-09-27T21:36:53Z. Independent subagent, implementation gate, base `d84c2a2`, exit 0. Two warnings: `App.tsx:467` removed-project guard is after the first await, so a bottom tab awaiting `shellName` can spawn after `terminateProjectBottom` and unmount without killing the PTY (`ChatTerminal.tsx:339`). `App.tsx:836` hide restores focus when the node is merely connected, so a chat textarea under `display: none` does not yield to the center surface. |
| correction:1 | returned | 2026-09-27T22:01:53Z. Paths: `src/renderer/src/App.tsx`, `src/renderer/src/BottomPanel.test.tsx`. Red before the fix, exit 1: `BottomPanel.test.tsx` focus case (`document.activeElement` stayed the hidden terminal canvas) and the shell-name race (two PowerShell tabs while `projects.remove` was pending). A third red run caught a failed removal clearing the tombstone. Green after the fix: `cmd /c pnpm exec vitest run src/renderer/src/BottomPanel.test.tsx src/renderer/src/App.test.tsx` 69 passed; later `BottomPanel.test.tsx` 17 passed. Biome on those two files: no fixes. Coordinator recount `cmd /c pnpm run typecheck:web` exit 0. `pnpm run typecheck` (node) not run. |
| review:2 | interrupted | 2026-09-27T22:10:21Z. Re-review of the correction started and was stopped before findings returned. Not a pass. |
| resume preflight | pass | 2026-09-27T22:23Z. `python .agents/scripts/preflight` exit 0; branch main; worktree clean. Handoff snapshot claims confirmed against the repository; no discrepancies. |
| resume red tests | pass | 2026-09-27T22:24Z. `cmd /c pnpm exec vitest run src/renderer/src/BottomPanel.test.tsx src/renderer/src/App.test.tsx` exit 0; 69 passed (2 files) before any edits this session. |
| review:3 | pass | 2026-09-27T22:40:59Z. Independent subagent re-review of the correction diff `587dcc7..93a507a` (`App.tsx`, `BottomPanel.test.tsx`), implementation gate. Verdict: `No significant issues found.` Both review:1 warnings confirmed fixed: removed-project guard set before the first await with tombstone checks at entry, after `shellName` resolves, on rejection, and in the `setBottomTabs` updater (`App.tsx:467-476`, `:805`, `:817`, `:823`, `:839-844`); hide restores focus only for rendered elements, otherwise center surface (`App.tsx:889-901`). Spot-checked line references against the working tree. |
| implement:2 | returned | 2026-09-27T23:33Z. Subagent implementer, Stage 2 `bottom-terminal`. RED before implementation: `cmd /c pnpm exec vitest run src/main/db/db.test.ts src/main/services/action-service.test.ts src/main/ipc/ipc-validation.test.ts` exit 1 (10 failed, 25 passed of 35) and `cmd /c pnpm exec vitest run src/renderer/src/App.test.tsx` exit 1 (4 failed, 52 passed of 56); all 14 failures are the new Stage 2 contracts. Discriminating-test proof: CR-byte mutation (`\r` -> `\n`) in the delivery write killed exactly the byte test, source restored byte-exact. Incident during mutation restore: `git checkout --` reverted the uncommitted `App.tsx` together with the mutation; all five App.tsx edits were re-applied and verified by full diff review, typecheck, and the green suite. Migration 5 rebuilds `actions` with widened `run_mode` CHECK; v4 untouched. Coordinator spot-check: `git diff --stat` matches the 16 reported product/doc paths plus this record. |
| coordinator recount (stage 2 gates) | pass | 2026-09-27T23:34:46Z. `cmd /c pnpm run test` exit 0, 327/327 in 24 files. `cmd /c pnpm run typecheck` exit 0 (node + web). `cmd /c pnpm run build` exit 0. `cmd /c pnpm run lint` exit 1 only on CRLF `package.json` (lesson `windows-biome-package-json-eol`; single Biome finding is that file's format; zero findings in changed files). |
| review:4 | pass | 2026-09-28T00:02:24Z. Independent subagent, implementation gate, uncommitted Stage 2 diff vs `93a507a`. Verdict: `No significant issues found.` Stage 1 App.tsx fixes verified intact (guard before first await, tombstone checks, isRenderedElement focus fallback). Migration 5 verified against v4 byte-for-byte (append-only, transactional, index recreated). Delivery path verified: command + 0x0D once, no chat, no PTY from execute path, cancel/missing-project/missing-cwd create nothing. 5 non-blocking suggestions (not defects): leak of pendingBottomCommandsRef entries on tab close/exit/spawn-error paths; focusBeforeOpenRef not captured when the action opens the hidden panel; migration row-preservation test omits the icon column; stale parenthetical in bottom-auxiliary-terminal spec line 13; pre-existing §62 SDD text contradicts Behaviour 18. |
| user acceptance gate (Stage 1 + Stage 2) | pass | 2026-09-28. User tested the real GUI and accepted: „Jest ok, wszystko działa" (bottom panel, tabs, chord, and the `bottom-terminal` action mode). Review:4 suggestions were presented as non-blocking follow-ups; user closed the gate. The five suggestions are recorded in BACKLOG.md. |
| EOL renormalization (pre-close) | pass | 2026-09-28T00:50Z. `package.json` worktree bytes renormalized CRLF -> LF (63 lines), matching HEAD blob (0 CR) and the `package.json text eol=lf` rule already in HEAD (commit 6b8cc34, lesson `windows-biome-package-json-eol`). After staging the content diff is empty. This completes the EOL migration from center-layout-tabs-actions; `pnpm run lint` now exit 0 (89 files, no findings). |
| retro | pass | 2026-09-28T00:50Z. No qualifying lesson: no user correction, no unresolved operational error (the implementer's `git checkout --` incident was self-recovered and verified within the session; recorded in the implement:2 row). Review:4 non-blocking suggestions recorded in BACKLOG.md as follow-ups. |
| verify-full (subject 1, attempt 1) | fail | 2026-09-28T02:53Z. `python .agents/scripts/verify-full` exit 1. Application checks all passed: `biome check .` 0 findings (89 files), `tsc` node+web 0, vitest 327/327 (24 files), validate-config ok, SKIP harness tests (template-only). Fail was record validation only: the task record still had zero verification subjects (the subject block write had been refused by the write guard) and `current_step` pointed at the already-checked Phase 2.3. Subject 1 remains unchanged. |
| verify-full (subject 2, attempt 2) | pass | 2026-09-28T00:59:38Z. `python .agents/scripts/verify-full` exit 0: validate-config ok; SKIP harness tests (template-only); `cmd /c pnpm run verify` exit 0 -> lint 0 (89 files), typecheck node+web 0, vitest 327/327 (24 files). Subject 2 (head 93a507a, 18 task-owned paths) captured before this attempt after the record-validation fix; package.json EOL renormalization included in the subject. |

### Verification subject 1

```json
{
  "attempt": 1,
  "head": "93a507a7475975a1e313d416fea38bd2d63c8ef5",
  "paths": [
    "BACKLOG.md",
    "docs/UX-UI.md",
    "docs/architecture/sdd.md",
    "docs/features/center-layout-tabs-actions/spec.md",
    "docs/product/requirements.md",
    "package.json",
    "src/main/db/db.test.ts",
    "src/main/db/migrations.ts",
    "src/main/ipc/ipc-validation.test.ts",
    "src/main/ipc/ipc-validation.ts",
    "src/main/services/action-service.test.ts",
    "src/main/services/action-service.ts",
    "src/renderer/src/App.test.tsx",
    "src/renderer/src/App.tsx",
    "src/renderer/src/components/actions/ActionBar.tsx",
    "src/renderer/src/components/actions/ActionSettings.tsx",
    "src/renderer/src/components/terminal/BottomPanel.tsx",
    "src/shared/ipc-contract.ts"
  ],
  "schema_version": 1,
  "staged_diff_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "subject_sha256": "e0e2f57f78c197db6d3ff4b8dbbcde9cd6df30259c616af316154c6d930bdfad",
  "unstaged_diff_sha256": "d34d5bc700db381ecfec15a79ed02f7eb435d97cd44300a7c08755f624641f9a",
  "untracked_files_sha256": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
}
```

### Verification subject 2

```json
{
  "attempt": 2,
  "head": "93a507a7475975a1e313d416fea38bd2d63c8ef5",
  "paths": [
    "BACKLOG.md",
    "docs/UX-UI.md",
    "docs/architecture/sdd.md",
    "docs/features/center-layout-tabs-actions/spec.md",
    "docs/product/requirements.md",
    "package.json",
    "src/main/db/db.test.ts",
    "src/main/db/migrations.ts",
    "src/main/ipc/ipc-validation.test.ts",
    "src/main/ipc/ipc-validation.ts",
    "src/main/services/action-service.test.ts",
    "src/main/services/action-service.ts",
    "src/renderer/src/App.test.tsx",
    "src/renderer/src/App.tsx",
    "src/renderer/src/components/actions/ActionBar.tsx",
    "src/renderer/src/components/actions/ActionSettings.tsx",
    "src/renderer/src/components/terminal/BottomPanel.tsx",
    "src/shared/ipc-contract.ts"
  ],
  "schema_version": 1,
  "staged_diff_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "subject_sha256": "4888f90a3da4d4ebc419bdad31923c9e564a62b341d553dfc4a85541ed6fc089",
  "unstaged_diff_sha256": "d34d5bc700db381ecfec15a79ed02f7eb435d97cd44300a7c08755f624641f9a",
  "untracked_files_sha256": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
}
```

## Timing

| Element | Kind | Started | Ended |
|---|---|---|---|
| intake | work | 2026-09-27T20:03:57Z | 2026-09-27T20:09:59Z |
| spec | work | 2026-09-27T20:09:59Z | 2026-09-27T20:09:59Z |
| plan | work | 2026-09-27T20:09:59Z | 2026-09-27T20:09:59Z |
| approval | wait | 2026-09-27T20:09:59Z | 2026-09-27T20:21:26Z |
| preflight | work | 2026-09-27T20:21:26Z | 2026-09-27T20:23:13Z |
| implement:1 | work | 2026-09-27T20:23:13Z | 2026-09-27T21:00:01Z |
| handoff | wait | 2026-09-27T21:00:01Z | 2026-09-27T21:17:01Z |
| review:1 | work | 2026-09-27T21:17:01Z | 2026-09-27T21:36:53Z |
| correction:1 | work | 2026-09-27T21:36:53Z | 2026-09-27T22:01:53Z |
| review:2 | work | 2026-09-27T22:01:53Z | 2026-09-27T22:10:21Z |
| handoff | wait | 2026-09-27T22:10:21Z | 2026-09-27T22:24:10Z |
| review:3 | work | 2026-09-27T22:24:10Z | 2026-09-27T22:40:59Z |
| implement:2 | work | 2026-09-27T22:41:00Z | 2026-09-27T23:34:46Z |
| review:4 | work | 2026-09-27T23:35:00Z | 2026-09-28T00:02:24Z |
| user-gate | wait | 2026-09-28T00:02:30Z | 2026-09-28T00:44:00Z |
| retro | work | 2026-09-28T00:44:00Z | 2026-09-28T00:51:00Z |
| verify | work | 2026-09-28T00:51:00Z | 2026-09-28T00:59:38Z |
| verify | work | 2026-09-28T00:59:38Z | 2026-09-28T01:01:00Z |
| close | work | 2026-09-28T01:01:57Z | 2026-09-28T01:01:57Z |

## Risks and blockers

- Ukrycie panelu nie może zabić PTY. Identyfikatory zakładek dolnych nie są identyfikatorami czatów.
- Migracja `run_mode` jest nową wersją. Stary wpis tabeli `actions` nie jest edytowany.

## Resume instructions

Wznów z `.agents/handoffs/bottom-auxiliary-terminal.md`. Review:2 korekty etapu 1 nie wrócił i nie jest zaliczeniem. Następna akcja: świeży niezależny re-review samego diffa korekty (`code-review`), nie cały etap 1 i nie Stage 2. Została najwyżej jedna runda korekty. Diagnoza hooków jest w Verification. Nie zmieniaj `.agents/hooks.json` ani `dispatch.py` z tego powodu. Nie commituj `package.json` z powodu CRLF.
