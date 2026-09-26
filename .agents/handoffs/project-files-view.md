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
next_action: User-gate demo AC1-9 w realnym GUI (pnpm dev), potem werdykt do rekordu i task-close
blockers: none
---

# Handoff: Project File Tree and Read-Only Monaco Preview

## Repository snapshot

Task record: `.agents/tasks/project-files-view/task.md` (status active, Phase 3.1 — user-gate). Rola: Main (koordynator sesji Hermes) → Main (kolejna sesja); powód: user stop, kontynuacja w nowej sesji. Spec: `docs/features/project-files-view/spec.md`; plan: `.agents/tasks/project-files-view/plan.md` (status approved, Standard, Stage 1).

**Working** (kod w checkpoincie obejmującym cały scope zadania — patrz checkpoint_subject):

- `src/main/services/files/files-service.ts` (+test): listowanie jednego poziomu, wykluczenia katalogów (case-fold, nazwy na dowolnej głębokości), containment przez realpath na formach bez separatora końcowego (rooty dysków `D:\` działają), requestRel leksykalny, klasyfikacja `>2MB`/NUL/nie-UTF-8, `shell.openExternal`.
- Typed IPC: `files:list`, `files:read`, `files:openExternal` (`src/shared/ipc-contract.ts`, `src/main/ipc/*`, `src/preload/app-api.ts`) — walidacja shape-only nietknięta.
- Renderer: `src/renderer/src/components/files/*` (FileTree, FilePreview, MonacoPreview — lazy `monaco-setup.ts`, ProjectFilesPanel, ProjectFilesSurface, files-types, monaco-modules.d.ts), `LeftNavigation.tsx` (przycisk „Files" na hover/focus w dawnym slocie przycisku usuwania + context menu „Remove Project"), `NoticeBanner.tsx`, `App.tsx` (tryb Project Files; ChatWorkspace ukrywany `display:none` — sesje i scrollback terminali przeżywają round-trip), `test-ids.ts`.
- Bramki ostatnie pełne (koordynator, 2026-09-26T16:35:34Z): `pnpm run lint` 0, `pnpm run typecheck` 0, `pnpm run test` 232/232 (19 plików; baseline przed zadaniem 183/17), `pnpm run build` 0; bundle renderera bez `electron`/`node` (grep out/renderer = 0 trafień).
- Rekord zadania walidny (`python .agents/scripts/task-status --check .agents/tasks/project-files-view/task.md` = pass).

**Broken**: nic. Niezrealizowane pozostały tylko bramka użytkownika i task-close (patrz Resume instructions).

## Decisions

- Nawigacja (decyzja użytkownika 2026-09-26): klik wiersza projektu nadal tylko rozwija listę czatów; wejście w Project Files wyłącznie przyciskiem „Files" (tooltip „Show project files") na wierszu projektu; „Remove Project" dostępne tylko z menu kontekstowego wiersza (prawy klik + klawisz ContextMenu/Shift+F10), przycisk usuwania z wiersza usunięty; etykieta widoku „Files" bez martwej zakładki Kanban (post-MVP); powrót `← Projects`; stan drzewa i ostatni plik per projekt trzymany w sesji renderera, bez bazy.
- Sesje terminali: ChatWorkspace ukrywany `display:none` w trybie plików, nigdy nieodmontowywany (spec Behaviour 12).
- Containment: porównanie form bez separatora końcowego (root `D:`, '' dla POSIX roota); requestRel = `posix.relative(root, target)` leksykalnie wzgl. zarejestrowanego roota (crafted `..` echo-uje ścieżki kanoniczne, symlinki w środku zachowują nawigowaną nazwę).
- Wykluczone katalogi niedostępne przez bezpośredni request (pośrednie segmenty + liść gdy jest katalogiem; plik o nazwie wykluczenia nadal się podgląda); dopasowanie case-fold (Windows).
- `:` w ścieżce względnej (NTFS ADS `file.txt:stream`) → not-found po stronie serwisu; warstwa walidacji celowo NIE odrzuca (kontrakt: absolute/traversal inputs pass untouched do serwisu, AC7).
- Monaco: `monaco-editor` bezpośrednio, lokalny loader (`monaco-setup.ts`, dynamic import, bez CDN); `@monaco-editor/react` w package.json zostaje (pre-existing nieużywany — poza zakresem, decyzja koordynatora).
- Fallbacki: `>2MB` (dokładnie 2MB = podgląd) → „This file is too large for preview." + „Open externally"; binarne (NUL w pierwszych 8KB lub nie-UTF-8 fatal decode) → „Binary file" + „Open externally".

## Failed approaches

- Odrzucanie `:` w `assertRelativePath` (ipc-validation) — łamało istniejący kontrakt testu „absolute/traversal inputs pass validation untouched" (AC7 wymaga not-found z serwisu dla tych form). Wycofane; reguła przeniesiona do serwisu. Nie powtarzać odrzucania w walidacji dla form, które kontrakt każe przepuszczać.
- Dyskryminacja mutacjami przez replace_all regexem — kaleczyła nawiasy (mutant nie kompilował się) i bywała nieskuteczna, bo fake fs jest case-sensitive i nie modeluje ADS: test przechodził bez guardu. Lekcja: fixture musi jawnie zawierać węzły wariantów (`NODE_MODULES`, `Node_Modules/pkg.js`, `file.txt:stream`), a mutant musi zabijać dokładnie wskazane testy przed uznaniem dyskryminacji.

## Verification

- tests-before-edits: preflight exit 0, baseline 183/183 (17 plików) — w rekordzie zadania.
- Implementacja (subagent-implementer deleg_a8c5ea4c): bramki zielone; review 1 (deleg_cbcd0628): request-changes (F1 warning + F2–F4 suggestions + F5 needs-confirmation); korekta (Main, Standard): F1–F4 zamknięte z testami dyskryminującymi; re-review runda 1 (deleg_b034f461): **approve** (mutacje sha256-verified, brak regresji, AC1–AC9 potwierdzone); hardening R2-1 (case-fold wykluczeń wg fixa reviewera): zmutowany case-sensitive wariant zabija dokładnie 2 wskazane testy.
- Niewykonane (świadomie): user-gate demo AC1-9 w realnym GUI; `verify-full` w task-close.

## Open product invariants

- `project-files-view/AC1-9`: status **pending-user-gate**. Wpływ: bez demo w realnym GUI zadanie nie może zostać zamknięte (plan Stage 1, Expected evidence). Evidence do zmiany statusu: werdykt użytkownika z `pnpm dev` (AC1–AC9, spec.md „Acceptance criteria"), zapisany w wierszu user-gate rekordu.

## Unresolved assumptions

- Realny mount Monaco (`readOnly`/`domReadOnly`) potwierdzony tylko inspekcją kodu — testy jsdom mockują MonacoPreview (review runda 1, test_honesty). Skutkiem demo może ujawić różnicę w zachowaniu podglądu. Rozstrzyga: punkt 4 user-gate.
- `@monaco-editor/react` nieużywany w package.json (pre-existing). Decyzja: zostawić; ewentualny housekeeping poza zakresem. Rozstrzyga: przyszła decyzja użytkownika lub osobny commit porządkowy.

## Resume instructions

1. Pierwsza akcja: user-gate — użytkownik testuje AC1–AC9 w realnym GUI (`pnpm dev`); checklistę demo wysyłamy wg spec.md „Acceptance criteria" (wejście przyciskiem „Files", expand czatów bez zmian, context menu z Remove Project, drzewo z wykluczeniami, read-only Monaco z breadcrumbem, fallbacki large/binary + Open externally, `← Projects` z żywą sesją terminala, retencja stanu drzewa). Oczekiwane evidence: werdykt użytkownika (pass/fail per AC) w rekordzie.
2. Przed jakąkolwiek edycją: `git status` (scope zadania w checkpoincie handoff), `python .agents/scripts/task-status --check .agents/tasks/project-files-view/task.md`, oraz ponowna lektura `docs/features/project-files-view/spec.md` i Decisions w rekordzie.
3. Po pozytywnym werdykcie: zamknąć wiersz user-gate, odhaczyć Phase 3.1, włączyć skill **`task-close`** i wykonać Phase 3.2 — task-close z final verification `full` (wielowarstwowy diff, nowe kanały IPC, integracja Monaco): capture verification subject (`python .agents/skills/task-record/scripts/verification_subject.py capture --record .agents/tasks/project-files-view/task.md --path ...` — wszystkie task-owned paths poza rekordem), potem `python .agents/scripts/verify-full`, zapis subjectu i wierszy verify, zamknięcie rekordu.
4. Przy failu z demo: korekta wg zgłoszeń użytkownika (Standard → Main implementuje), dotknięte bramki + testy regresyjne, niezależny re-review (świeży subagent, skill `code-review`), następnie nowy user-gate. CAP korekt/re-review: 2 rundy na stage — po wyczerpaniu eskalować do użytkownika zamiast kolejnej pętli.

Wszystkie artefakty zatwierdzenia kompletne: plan approved (2026-09-26), spec bez otwartych pytań, tests-before-edits w rekordzie.
