---
task_id: project-files-view
created: 2026-09-26T16:50:59Z
schema_version: 2
from: Main (Hermes, sesja coder CLI 2026-09-26)
to: Main (kolejna sesja)
branch: main
worktree: current
checkpoint_subject: 946ab28fbe19e56e0efce3dd99d925756f49338b+sha256:18a6d0142bbf7be03e9ac814baa102965c2a5343aedb507f0dd29298d1a13a28
current_step: Phase 3.1
next_action: User-gate:r3 - demo AC8 (katalog projektu usuniety na dysku -> inline error w trybie plikow, dziala ← Projects) w pnpm dev; po werdykcie task-close (skill task-close): verification_subject check, close, archiwum snapshotu
blockers: none
---

# Handoff: Project File Tree and Read-Only Monaco Preview

## Repository snapshot

Task record: `.agents/tasks/project-files-view/task.md` (status active, current_step Phase 3.1 — bramka AC8; Phase 3.2: retro + verify-full zamknięte). Rola: Main (koordynator sesji Hermes) → Main (kolejna sesja); powód: user-gate AC8 odroczony przez użytkownika na sam koniec, close po werdykcie. Spec: `docs/features/project-files-view/spec.md`; plan: `.agents/tasks/project-files-view/plan.md` (status approved, Standard, Stage 1).

**Working** (kod w checkpoincie 2d7d8f3 — scope zadania w commicie; checkpoint_subject wyżej identyfikuje stan sprzed checkpointu):

- `src/main/services/files/files-service.ts` (+test): listowanie jednego poziomu, wykluczenia katalogów (case-fold, nazwy na dowolnej głębokości), containment przez realpath na formach bez separatora końcowego (rooty dysków działają), requestRel leksykalny, klasyfikacja `>2MB`/NUL/nie-UTF-8, `shell.openExternal`.
- Typed IPC: `files:list`, `files:read`, `files:openExternal` (`src/shared/ipc-contract.ts`, `src/main/ipc/*`, `src/preload/app-api.ts`) — walidacja shape-only nietknięta.
- Renderer: `src/renderer/src/components/files/*` (FileTree, FilePreview, MonacoPreview — lazy `monaco-setup.ts`, ProjectFilesPanel, ProjectFilesSurface, files-types, monaco-modules.d.ts), `LeftNavigation.tsx` (przycisk „Files" na hover/focus + context menu „Remove Project"), `NoticeBanner.tsx`, `App.tsx` (tryb Project Files; ChatWorkspace ukrywany `display:none` — sesje i scrollback terminali przeżywają round-trip), `test-ids.ts`.
- Bramki (verify-full subject 1, 2026-09-26T17:26Z): lint 0, typecheck node+web 0, test 232/232 (19 plików), `cmd /c pnpm run verify` 0; bundle renderera bez `electron`/`node` (weryfikowane przy Stage 1).
- Rekord zadania walidny (`python .agents/scripts/task-status --check .agents/tasks/project-files-view/task.md` = exit 0).

**Broken**: nic. Pozostały: bramka AC8 (user-gate:r3) i close (patrz Resume instructions).

## Decisions

- Nawigacja (decyzja użytkownika 2026-09-26): klik wiersza projektu nadal tylko rozwija listę czatów; wejście w Project Files wyłącznie przyciskiem „Files" (tooltip „Show project files") na wierszu projektu; „Remove Project" dostępne tylko z menu kontekstowego wiersza (prawy klik + klawisz ContextMenu/Shift+F10), przycisk usuwania z wiersza usunięty; etykieta widoku „Files" bez martwej zakładki Kanban (post-MVP); powrót `← Projects`; stan drzewa i ostatni plik per projekt trzymany w sesji renderera, bez bazy.
- Sesje terminali: ChatWorkspace ukrywany `display:none` w trybie plików, nigdy nieodmontowywany (spec Behaviour 12).
- Containment: porównanie form bez separatora końcowego (root `D:`, '' dla POSIX roota); requestRel = `posix.relative(root, target)` leksykalnie wzgl. zarejestrowanego roota (crafted `..` echo-uje ścieżki kanoniczne, symlinki w środku zachowują nawigowaną nazwę).
- Wykluczone katalogi niedostępne przez bezpośredni request (pośrednie segmenty + liść gdy jest katalogiem; plik o nazwie wykluczenia nadal się podgląda); dopasowanie case-fold (Windows).
- `:` w ścieżce względnej (NTFS ADS `file.txt:stream`) → not-found po stronie serwisu; warstwa walidacji celowo NIE odrzuca (kontrakt: absolute/traversal inputs pass untouched do serwisu, AC7).
- Monaco: `monaco-editor` bezpośrednio, lokalny loader (`monaco-setup.ts`, dynamic import, bez CDN); `@monaco-editor/react` w package.json zostaje (pre-existing nieużywany — poza zakresem).
- Fallbacki: `>2MB` (dokładnie 2MB = podgląd) → „This file is too large for preview." + „Open externally"; binarne (NUL w pierwszych 8KB lub nie-UTF-8 fatal decode) → „Binary file" + „Open externally".
- AC8 odroczony decyzją użytkownika 2026-09-26 („na sam koniec"): ostatnia bramka user-gate:r3 przed close; NIE deferred-do-backlog. Świadome odstępstwo: Phase 3.2 (retro/verify-full) przed AC8; fail AC8 = korekta + nowy verification subject + ponowny verify (CAP 2 rundy korekt/re-review na stage).

## Failed approaches

- Odrzucanie `:` w `assertRelativePath` (ipc-validation) — łamało istniejący kontrakt testu „absolute/traversal inputs pass validation untouched" (AC7 wymaga not-found z serwisu dla tych form). Wycofane; reguła przeniesiona do serwisu. Nie powtarzać odrzucania w walidacji dla form, które kontrakt każe przepuszczać.
- Dyskryminacja mutacjami przez replace_all regexem — kaleczyła nawiasy (mutant nie kompilował się) i bywała nieskuteczna, bo fake fs jest case-sensitive i nie modeluje ADS: test przechodził bez guardu. Lekcja (pokryta przez skill discriminating-tests): fixture musi jawnie zawierać węzły wariantów (`NODE_MODULES`, `Node_Modules/pkg.js`, `file.txt:stream`), a mutant musi zabijać dokładnie wskazane testy przed uznaniem dyskryminacji.

## Verification

- tests-before-edits (resume preflight 2026-09-26T16:58Z): preflight exit 0; `pnpm run test` 232/232 (19 plików); `pnpm run typecheck` 0 — baseline zgodny ze stanem po Stage 1.
- User-gate demo AC1-9 runda 1 (użytkownik, pnpm dev, 2026-09-26): AC1-7 i AC9 pass; AC8 odroczony decyzją użytkownika na user-gate:r3 (ostatnia bramka przed close).
- verify-full (subject 1, attempt 1, 2026-09-26T17:26Z): `python .agents/scripts/verify-full` exit 0 — configuration valid; lint 0; typecheck 0; vitest 232/232 (19 plików); validate-config ok; `cmd /c pnpm run verify` 0; SKIP: harness tests (template-only). Subject 1 (head 2d7d8f3, paths: plan, docs/features/project-files-view, src) zamrożony do close.
- Historia Stage 1 (implementacja subagent, review → request-changes F1-F5, korekta F1-F4 z testami dyskryminującymi, re-review approve, hardening R2-1 case-fold): pełne wiersze w tabeli Verification rekordu.
- Niewykonane (świadomie): demo AC8; close.

## Open product invariants

- `project-files-view/AC8`: status **pending-user-gate** (user-gate:r3). Wpływ: bez werdyktu AC8 zadanie nie może zostać zamknięte. Evidence do zmiany statusu: werdykt użytkownika z `pnpm dev` (katalog projektu usunięty na dysku → inline error, `← Projects` działa), zapisany w rekordzie. AC1-7 oraz AC9: pass w user-gate runda 1 (2026-09-26).

## Unresolved assumptions

- `@monaco-editor/react` nieużywany w package.json (pre-existing). Decyzja: zostawić; ewentualny housekeeping poza zakresem. Rozstrzyga: przyszła decyzja użytkownika lub osobny commit porządkowy.
- (Rozstrzygnięte 2026-09-26: realny mount Monaco read-only potwierdzony demo — AC4 pass.)

## Resume instructions

1. Pierwsza akcja: user-gate:r3 — użytkownik testuje AC8 w realnym GUI (`pnpm dev`): zarejestrowany projekt, katalog usunięty na dysku, wejście w tryb „Files" → inline error w miejscu drzewa, `← Projects` wychodzi z trybu. Oczekiwane evidence: werdykt użytkownika (pass/fail AC8) w rekordzie.
2. Przed jakąkolwiek edycją: `git status` (scope: rekord + snapshot; subject 1 dotyczy plan/docs/src i musi zostać nietknięty), `python .agents/scripts/task-status --check .agents/tasks/project-files-view/task.md`, lektura Decisions w rekordzie.
3. Po pass: zamknąć wiersz user-gate:r3, odhaczyć Phase 3.1; włączyć skill **`task-close`** (reszta Phase 3.2): `python .agents/skills/task-record/scripts/verification_subject.py check --record .agents/tasks/project-files-view/task.md` (exit 0 wymagane), close transition (odhaczyć Phase 3.2, status completed, current_step none), walidacja, archiwum snapshotu do `.agents/handoffs/archive/`, jeden scoped commit (skill `ci`).
4. Po fail: korekta wg zgłoszenia (Standard → Main implementuje), dotknięte bramki + testy regresyjne, niezależny re-review (świeży subagent, skill `code-review`), nowy verification subject + verify-full, nowy user-gate. CAP 2 rundy korekt/re-review — po wyczerpaniu eskalować do użytkownika.

Wszystkie artefakty zatwierdzenia kompletne: plan approved (2026-09-26), spec bez otwartych pytań, tests-before-edits w rekordzie, subject 1 + verify-full pass.