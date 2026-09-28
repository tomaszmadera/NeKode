---
id: review4-followups
schema_version: 2
status: completed
intent: refactor
complexity: small
durability: recorded
current_phase: Phase 1
current_step: none
updated: 2026-09-28
branch: main
worktree: current
next_action: none
blockers: none
---

# Review:4 follow-ups

## Objective

Zamknąć cztery nieblokujące sugestie review:4 zadania bottom-auxiliary-terminal zanim zniknie kontekst: dwa małe usprawnienia product-path w rendererze, jedno wzmocnienie testu migracji, dwie korekty dokumentów.

## Scope

Zakres kodu: `src/renderer/src/App.tsx` + testy renderera, `src/main/db/db.test.ts`, wybrane dokumenty. Bez zmian kontraktów IPC i bez migracji bazy. Poza zakresem: kontrola zadań/trwałość między restartami, reszta BACKLOG.md.

Cztery elementy (źródło: review:4, non-blocking suggestions):

1. Wyciek wpisów `pendingBottomCommandsRef` (App.tsx): wpis jest usuwany tylko przy udanym ready-write; zamknięcie zakładki, exit, spawn-error albo przerwane createBottomTab zostawiają wpis do końca sesji. Fix: usuwać wpis w handleCloseBottomTab / handleBottomExit / onSpawnError / przy abort createBottomTab. Test: wpis znika na każdej z tych ścieżek.
2. `focusBeforeOpenRef` (App.tsx): wykonanie akcji `bottom-terminal` otwiera ukryty panel zwykłym open bez zapisu focusu; późniejszy hide przywraca fokus na powierzchnię środkową zamiast na element sprzed otwarcia (odchylenie od Behaviour 4 spec bottom-auxiliary-terminal na tej ścieżce). Fix: przechwycić document.activeElement przy otwieraniu z ukrytego, z taką samą ochroną przed fokusem body jak w showBottomPanel. Test: hide po otwarciu z akcji przywraca fokus.
3. Test migracji v5 (`src/main/db/db.test.ts`): asercja zachowania wierszy pomija kolumnę `icon` — dodać icon do SELECT i oczekiwanych wierszy, fixture z nie-NULL icon, żeby realny drop kolumny padał.
4. Dokumenty: `docs/features/bottom-auxiliary-terminal/spec.md` l. 13 (Related requirements) — nieaktualny dopisek o rezerwacji trybu; `docs/architecture/sdd.md` §62 MVP User Flow — „Git status refreshes when command ends" sprzeczne z Behaviour 18.

## Phase 0 - Intake

- [x] Phase 0.1 - Inspect the repository and refine the provisional classification (branch main, clean worktree at d2e00a8; all four items are App.tsx-local, no IPC/database contract changes; refactor stands)

## Phase 1 - Preflight, Implementation, Review and Verify

- [x] Phase 1.1 - Preflight gate (preflight exit 0, worktree clean at f705e03, task-status exit 0)
- [x] Phase 1.2 - Implementation (single implementer, discriminating regression tests)
- [x] Phase 1.3 - Independent review (implementation gate: verdict pass; both deviations accepted on mutation probes; one non_blocking finding — project-removal leak — fixed in-scope and gated)
- [x] Phase 1.4 - Final verification `changed` and close (subject 1 attempt 1 pass; retro lesson appended; subject 2 attempt 2 pass with lesson paths; closed 2026-09-28)

## Decisions

- Zakres i priorytet pochodzi z review:4 (werdykt No significant issues found; sugestie nieblokujące). Użytkownik przyjął rekomendację koordynatora 2026-09-28: zrobić follow-upy przed diagnozą Ctrl+D/Ctrl+U GUI.
- Drobne poprawki product-path robimy teraz, nie przy okazji innych zadań; BACKLOG.md po scaleniu elementów traci cztery wpisy.

## Changed files

- `src/renderer/src/App.tsx` — element 1 (delete staged pendingBottomCommandsRef entries in handleCloseBottomTab, handleBottomExit, and all abort paths of createBottomTab incl. the in-set tombstone check; spawn-error keeps the entry: retry remount must redeliver) + element 2 (handleBottomTerminalAction captures focusBeforeOpenRef with the showBottomPanel body-guard when opening the hidden panel).
- `src/renderer/src/test/pending-bottom-command.lifecycle.test.tsx` (new) — element 1: close/exit/abort paths deliver nothing after the tab is gone (3 tests); spawn-error path keeps the staged command and redelivers exactly once on retry (1 test).
- `src/renderer/src/BottomPanel.test.tsx` — element 2: hide after an action-opened hidden panel restores the pre-open focus (discrimination proven: fails on pre-fix code, passes with fix).
- `src/main/db/db.test.ts` — element 3: migration 5 row-preservation SELECT + expected rows include `icon`; fixture has non-NULL icon ('hammer'); mutation probe (icon dropped from INSERT..SELECT) fails the test.
- `docs/features/bottom-auxiliary-terminal/spec.md` — element 4a: Related requirements line 13 no longer calls requirements §2.5 a reservation.
- `docs/architecture/sdd.md` — element 4b: §62 flow line aligned with Behaviour 18 (no command-end git refresh; refresh happens on project selection change).
- `BACKLOG.md` — the four realized review:4 entries removed.

## Implementation evidence

- Gates after implementation (2026-09-28): `pnpm run lint` exit 0 (90 files), `cmd /c pnpm run typecheck` exit 0 (node+web), `cmd /c pnpm run test` exit 0 — 332/332 in 25 files (baseline 327 + 5 new).
- Discrimination: element 2 test failed on pre-fix code (revert probe) and passes with the fix. Element 3 test fails with the migration mutated to drop `icon`. Element 1 close/exit/abort paths are not behavior-discriminable (a dead view never fires onReady; the `disposed` guard already blocks late writes) — the new tests pin the observable contract (no delivery after tab death; retry redelivery once) and the fix is hygiene verified by inspection; spawn-error deletion was deliberately NOT applied because it would break retry redelivery (contract: command + 0x0D once).
- Deviation from the snapshot's onSpawnError fix list recorded: deleting on spawn-error would destroy the staged command needed by the Retry remount (Backlog entry's own path list conflicts with the closed task's delivery contract; repository evidence: BottomPanel retry remounts the view, ChatTerminal fires onReady per mount).

## Verification

| Check | Result | Notes |
|---|---|---|
| intake inspection | pass | 2026-09-28. Branch main at d2e00a8, worktree clean; review:4 suggestions list reconciled with BACKLOG.md (4 entries present) |
| preflight | pass | 2026-09-28. `python .agents/scripts/preflight` exit 0 (worktree clean at f705e03; python 3.11.16; pnpm 12.5.1); `python .agents/scripts/task-status --check` exit 0. HEAD f705e03 vs snapshot head d2e00a8: difference is the handoff checkpoint itself |
| baseline tests (before edits) | pass | 2026-09-28. `cmd /c pnpm run test` 327/327 in 24 files at f705e03 + package.json EOL repair; `pnpm run lint` exit 0 after restoring worktree package.json to the HEAD blob (it had CRLF despite a clean status — leftover of the 0.4.0 EOL renormalization, checkout-on-touch artifact, not an edit); `cmd /c pnpm run typecheck` exit 0 |
| implementation gates | pass | 2026-09-28. After all four elements: `pnpm run lint` exit 0 (90 files), `cmd /c pnpm run typecheck` exit 0, `cmd /c pnpm run test` exit 0 — 332/332 in 25 files (+5 new tests). Migration probe and focus revert probe restored byte-identical afterwards (migrations.ts re-saved from the HEAD blob after `git checkout --` reintroduced CRLF) |
| implementation diff self-review | pass | 2026-09-28. `git diff` inspected per element: App.tsx +31 (only deletes on dead paths + focus capture + comments), two test files additive, two doc lines, BACKLOG minus exactly the four realized entries. No IPC contract changes, no migration changes, tombstone rules intact |
| review:4 follow-ups (independent subagent, implementation gate) | pass | 2026-09-28. Fresh-context subagent vs uncommitted diff, base f705e03; code-review skill, no review file. Verdict pass, zero undeclared edits. Mutation probes in a throwaway scratch copy (live tree untouched): focus revert kills the focus test; migration icon drop kills the row-preservation test; Backlog's literal onSpawnError delete kills the retry-redelivery test (decision 1 accepted); removing all three hygiene deletes leaves lifecycle tests green, confirming the record's non-discriminability disclosure (decision 2 accepted, tests honest). EOL wobble verified: package.json and migrations.ts byte-identical to HEAD, 0 CR. One non_blocking finding: handleRemoveProject dropBottomProject path never deleted staged entries (leak class residual, unnamed path) |
| review correction (non_blocking finding, in-scope trivial polish) | pass | 2026-09-28. handleRemoveProject now deletes staged entries for the project's bottomIds after removal success (before dropBottomProject; placed after the failed-removal early return so a failed removal keeps the staged commands deliverable). Gates re-run: lint exit 0, typecheck exit 0, targeted renderer suites 78/78. package.json and migrations.ts diff empty (stat-dirty only) |
| verify `changed` (subject 1, attempt 1) | pass | 2026-09-28. `python .agents/scripts/verify-changed` exit 0: validate-config ok; `cmd /c pnpm run lint && cmd /c pnpm run typecheck` exit 0 (biome 90 files 0 findings; tsc node+web 0). Subject 1 captured before the run (head f705e03, 9 task-owned paths); subject check after the run: matches (subject_sha256 76ccb577…) |
| verify `changed` (subject 2, attempt 2) | pass | 2026-09-28. Retro lesson appended (git-checkout-reintroduces-crlf, item + index). Subject 2 recaptured with the lesson paths added (11 task-owned paths, head f705e03); `python .agents/scripts/verify-changed` exit 0 again: validate-config ok; biome 90 files 0 findings; tsc node+web 0 |

### Verification subject 1

```json
{
  "attempt": 1,
  "head": "f705e034389013d4d2b86747dbbb9ffca40da4ba",
  "paths": [
    "BACKLOG.md",
    "docs/architecture/sdd.md",
    "docs/features/bottom-auxiliary-terminal/spec.md",
    "package.json",
    "src/main/db/db.test.ts",
    "src/main/db/migrations.ts",
    "src/renderer/src/App.tsx",
    "src/renderer/src/BottomPanel.test.tsx",
    "src/renderer/src/test/pending-bottom-command.lifecycle.test.tsx"
  ],
  "schema_version": 1,
  "staged_diff_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "subject_sha256": "76ccb57765333c16705b4e53556a5fbc89411f26b0f655630b4094d3667dc5ca",
  "unstaged_diff_sha256": "8a9d5d91b993cb7226c1dc8bab896447cbd934299a4134f616c09ea0432af007",
  "untracked_files_sha256": "ed7af104434128ca5e400217f0ca44dd7db6c1539983d883ca8d639412bba514"
}
```

### Verification subject 2

```json
{
  "attempt": 2,
  "head": "f705e034389013d4d2b86747dbbb9ffca40da4ba",
  "paths": [
    ".agents/lessons/index.json",
    ".agents/lessons/items/git-checkout-reintroduces-crlf.md",
    "BACKLOG.md",
    "docs/architecture/sdd.md",
    "docs/features/bottom-auxiliary-terminal/spec.md",
    "package.json",
    "src/main/db/db.test.ts",
    "src/main/db/migrations.ts",
    "src/renderer/src/App.tsx",
    "src/renderer/src/BottomPanel.test.tsx",
    "src/renderer/src/test/pending-bottom-command.lifecycle.test.tsx"
  ],
  "schema_version": 1,
  "staged_diff_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "subject_sha256": "cf00f8ba206363a14577cef3a234e6c14cadcfe9af8b5e4f07697c209d9996fb",
  "unstaged_diff_sha256": "6f50e412dcf2452d4e72bed26d253821ce3594aba950584c1514515ea28c3630",
  "untracked_files_sha256": "0ddbccc1b76d463401cf594d539bde72348c454e20640a3a90e6cf133477dbc4"
}
```

## Timing

| Element | Kind | Started | Ended |
|---|---|---|---|
| intake | work | 2026-09-28T01:10:00Z | 2026-09-28T01:12:00Z |
| handoff | wait | 2026-09-28T01:12:00Z | 2026-09-28T09:00:00Z |
| preflight | work | 2026-09-28T09:00:00Z | 2026-09-28T09:01:30Z |
| plan | work | 2026-09-28T09:01:30Z | 2026-09-28T09:01:31Z |
| implement | work | 2026-09-28T09:01:31Z | 2026-09-28T09:50:00Z |
| review | work | 2026-09-28T09:50:00Z | 2026-09-28T12:35:00Z |
| correction | work | 2026-09-28T12:35:00Z | 2026-09-28T12:45:00Z |
| verify | work | 2026-09-28T12:45:00Z | 2026-09-28T13:10:00Z |
| retro | work | 2026-09-28T13:10:00Z | 2026-09-28T13:20:00Z |
| verify | work | 2026-09-28T13:20:00Z | 2026-09-28T13:35:00Z |
| close | work | 2026-09-28T13:35:00Z | 2026-09-28T13:35:00Z |

## Risks and blockers

- Zmiany w App.tsx dotykają ścieżek używanych przez zamknięty bottom-auxiliary-terminal; regresje łapią istniejące testy renderera (327 w baseline).

## Resume instructions

Wznów z handoff snapshot .agents/handoffs/review4-followups.md. Pierwsza akcja: preflight, potem jeden implementer na wszystkie cztery elementy z testami dyskryminującymi.
