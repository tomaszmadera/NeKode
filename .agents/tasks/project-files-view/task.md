---
id: project-files-view
schema_version: 2
status: completed
intent: feature
complexity: standard
durability: recorded
current_phase: Phase 3
current_step: none
updated: 2026-09-28
branch: main
worktree: current
next_action: none
blockers: none
---

# Project File Tree and Read-Only Monaco Preview

## Objective

Dostarczenie widoku Project Files dla zarejestrowanego projektu: drzewo plików projektu w lewym panelu (tryb file tree z powrotem `← Projects`) oraz podgląd zawartości pliku w centrum w trybie tylko do odczytu (Monaco Editor, numeracja linii, syntax highlighting). Użytkownik: programista na Windows 11 pracujący z agentami CLI, potrzebujący kontekstu plików projektu obok czatu.

## Scope

Spec: `docs/features/project-files-view/spec.md`. Plan: `.agents/tasks/project-files-view/plan.md`. Zadanie pokrywa wymaganie 4 requirements.md (drzewo plików + read-only preview) wg SDD §12-13 i UX-UI §11/§18/§19/§69. Edycja plików, konfiguracja wzorców wykluczeń, widok Kanban — poza zakresem.

## Phase 0 - Intake

- [x] Phase 0.1 - Inspect the repository and refine the provisional classification

## Phase 1 - Specification and Plan

- [x] Phase 1.1 - Specification (docs/features/project-files-view/spec.md)
- [x] Phase 1.2 - Plan approval (plan status: draft -> approved; zatwierdzony przez użytkownika 2026-09-26)

## Phase 2 - Preflight and Implementation

- [x] Phase 2.1 - Preflight gate
- [x] Phase 2.2 - Stage 1: Project Files view (file tree mode and read-only preview) (review passed 2026-09-26: approve + hardening R2-1)

## Phase 3 - Acceptance and closure

- [x] Phase 3.1 - User-gate: demo AC1-9 w realnym GUI (pnpm dev; AC1-7,9 pass runda 1, AC8 deferred-by-decision 2026-09-26)
- [x] Phase 3.2 - task-close z final verification `full` (subject 1 + verify-full pass 2026-09-26; AC8 deferred-by-decision)
- [x] Phase 3.3 - User-gate AC8 re-check w realnym GUI (user-gate:r4; potwierdzone przez użytkownika 2026-09-28; AC1-9 komplet)

## Decisions

- Klasyfikacja (z evidence repo 2026-09-26): intent feature, complexity standard — jeden demonstrable stage (widok Project Files jako pionowy plaster: wejście w tryb → drzewo → read-only podgląd). Niezmienna względem propozycji przedstawionej użytkownikowi przy wyborze zadania.
- Branch main, drzewo czyste poza rekordami zadania; brak kolizji id w `.agents/tasks/`.
- Nawigacja (decyzja użytkownika 2026-09-26): klik wiersza projektu nadal tylko rozwija listę czatów; wejście w Project Files przez osobny przycisk „Files" na wierszu projektu (w miejscu dotychczasowego przycisku usuwania); usuwanie projektu dostępne wyłącznie z menu kontekstowego wiersza (przycisk z wiersza znika). Powrót przez `← Projects`; wybór czatu przywraca terminal. Sesje czatów żyją w ukrytych widokach przez czas w trybie plików.
- Label akcji: „Files" (tooltip „Show project files"); etykieta widoku w centrum „Files" bez martwej zakładki Kanban (post-MVP).
- Model widoku (z zaakceptowanych docs — UX-UI §11/§18/§69, SDD §12-13): left panel przełącza się w tryb file tree z `← Projects` + nazwą projektu; centrum = nagłówek kontekstu + breadcrumb + read-only Monaco; fallbacki too-large/binary z „Open externally"; stan drzewa per projekt w sesji, bez persistencji do bazy.

- AC8 user-gate odroczony decyzją użytkownika 2026-09-26 (na sam koniec): ostatnia bramka user-gate:r3 przed close; NIE deferred-do-backlog jak punkty 3/5 mvp-core-shell. Kolejność Phase 3.2 przed AC8 to świadome odstępstwo od pełnego werdyktu przed task-close, wymuszone decyzją użytkownika; fail AC8 = korekta + nowy subject + ponowny verify.
- Retro 2026-09-26: kandydat na lekcję z handoffa (fixture fake-fs musi jawnie modelować warianty case/ADS, mutant musi zabijać wskazane testy) jest już pokryty przez skill discriminating-tests (procedure 2 + pitfalls) — brak nowego wpisu w .agents/lessons.

- AC8 ostatecznie: deferred-by-decision (użytkownik 2026-09-26, „wyjdzie w praniu") — bez demo w GUI; wpis w BACKLOG.md; zadanie zamykane z AC8 jawnie niespełnionym (precedens: punkty 3/5 mvp-core-shell).
- AC8 zamknięty (użytkownik 2026-09-28, realne GUI): usunięty/nieczytelny katalog projektu → inline error z nazwaniem problemu w obszarze drzewa plików, reszta aplikacji działa dalej, `← Projects` wychodzi z trybu. Supersedes deferral z 2026-09-26; wpis AC8 usunięty z BACKLOG.md; AC1-9 komplet.

## Changed files

- `docs/features/project-files-view/spec.md`
- `.agents/tasks/project-files-view/plan.md`
- `.agents/tasks/project-files-view/task.md`
- Produkt (Stage 1): `src/shared/ipc-contract.ts`, `src/main/services/files/files-service.ts` (+test), `src/main/ipc/*` (handlers, validation, registry + testy), `src/main/services/create-services.ts`, `src/main/index.ts`, `src/preload/app-api.ts`, `src/renderer/src/components/files/*` (files-types, FileTree, FilePreview, MonacoPreview, monaco-setup, ProjectFilesPanel, ProjectFilesSurface + ProjectFiles.test.tsx), `src/renderer/src/components/layout/{LeftNavigation.tsx,NoticeBanner.tsx}`, `src/renderer/src/{App.tsx,App.test.tsx}`, `src/renderer/src/lib/test-ids.ts`, testy dotknięte: `ChatTerminal.test.tsx`, `ChatWorkspace.test.tsx`, `useResizableRegion.test.tsx`

## Verification

| Check | Result | Notes |
|---|---|---|
| `python .agents/scripts/preflight` (2026-09-26, przed edycjami) | pass | exit 0; windows-native (Windows 11, Node 24.18.0, pnpm 12.5.1), Python 3.11.16, branch main; untracked: rekordy zadania project-files-view |
| `pnpm run test` (tests-before-edits) | pass | 183/183 (17 plików) — baseline zgodny z verify-full zamknięcia mvp-core-shell |
| `pnpm run typecheck` (tests-before-edits) | pass | typecheck:node + typecheck:web, exit 0 |
| Stage 1 implementacja (subagent-implementer deleg_a8c5ea4c) + ponowne bramki koordynatora | pass | 28 plików zgodnych z deklaracją (16 zmodyfikowanych + nowe: src/main/services/files/, src/renderer/src/components/files/, NoticeBanner.tsx); koordynator przeliczył bramki: lint 0, typecheck 0, test 228/228 (19 plików, +45 vs baseline), build 0 (leniwy chunk monaco-setup ~4.4MB + per-language); bundle renderera bez `electron`/`node` (grep out/renderer = 0 trafień); package.json/pnpm-lock nietknięte (monaco-editor już zadeklarowany w deps) |
| Independent review Stage 1 (subagent-reviewer deleg_cbcd0628) | request-changes | 1 warning: F1 containment martwi się rootami dysków (realpath `D:\` z separatorem końcowym → prefix `D://` nie pasuje; fail-closed, ale feature dead-end dla projektu na root'ie dysku). 3 suggestions: F2 zejście do wykluczonych katalogów przez crafted request (serwis nie egzekwuje wykluczeń na żądanej ścieżce), F3 normalizeRequestRel zjada kropkę z `..`-wejść (błędny mapping relativePath), F4 `:` w relative path = NTFS ADS (shape layer nie odrzuca). 1 needs-confirmation: F5 nieużywany @monaco-editor/react (pre-existing, poza zakresem diffu). Test_honesty: 5 mutacji (containment, próg 2MB, NUL, fatal decode, display:none) — każda zabita przez wskazane testy; brudny zestaw = dokładnie deklarowane pliki; bramki reviewera zielone (lint 0, tc 0, 228/228, build 0). Werdykt: request-changes → korekta F1-F4, F5 do decyzji koordynatora |
| Korekta Stage 1 (koordynator, Standard) + bramki | pass | F1: prefix containment na formach bez separatora końcowego (root `D:` / '' dla POSIX roota) — dzieci roota dysku przechodzą; F2: wykluczone katalogi niedostępne przez bezpośredni request (pośrednie segmenty + liść gdy jest katalogiem; plik o nazwie wykluczenia nadal się podgląda); F3: requestRel liczony leksykalnie z `posix.relative(root, target)` (canonical dla crafted `..`, symlinki w środku zachowują nawigowaną nazwę — poprawia też test symlinków); F4: `:` (NTFS ADS) → not-found w serwisie (warstwa shape-only w walidacji nietknięta — kontrakt AC7; wcześniejsza próba w walidacji łamała test „absolute inputs pass untouched", cofnięta). Nowe testy 4 (drive-root, excluded descent, canonical echo, ADS — fixture modeluje węzeł strumienia, żeby guard był tym, który odrzuca); dyskryminacja: mutacje F1 i F4 zabijają dokładnie nowe testy (drive-root, ADS); spec.md Business rules zaktualizowane o 2 reguły. F5 ( nieużywany @monaco-editor/react): decyzja — nie ruszać (pre-existing, poza zakresem stage'u), odnotowane. Bramki: lint 0, tc 0, test 232/232 (19 plików, +4), build 0 |
| Re-review Stage 1 runda 1 (subagent-reviewer deleg_b034f461) | pass | Werdykt approve; F1-F4 zamknięte (trace + mutacje F1/F4 zabijają wskazane testy, sha256 pliku identyczne po restorach); kontrakt shape-only walidacji nienaruszony (absolute/traversal pass untouched); brak regresji i brak niezadeklarowanych zmian; AC1-AC9 potwierdzone. 1 suggestion R2-1 (nieblokujące): dopasowanie wykluczeń case-sensitive przy case-insensitive FS Windows (containment nietknięty). Bramki reviewera: lint 0, tc 0, 232/232, build 0 |
| Hardening R2-1 (koordynator, po approve wg fixa reviewera) + bramki | pass | Case-fold w 3 miejscach (filtr listowania `list()` + 2 checki `#locate`: segmenty pośrednie i liść); testy wzmocnione wariantami pisowni NODE_MODULES/Node_Modules (fixture fake fs modeluje węzły jawne — jest case-sensitive, więc to guard odrzuca); dyskryminacja: mutant case-sensitive (bez `.toLowerCase()`) zabija dokładnie 2 wskazane testy (filtry wykluczeń + never descends); spec.md Business rules: „case-insensitively". Bramki: lint 0, tc 0, test 232/232 (19 plików), build 0 |
| User-gate demo AC1-9 runda 1 (użytkownik, pnpm dev) | pass (AC8 deferred) | AC1-7 i AC9 pass; AC8 (usunięty katalog projektu → inline error) odroczony decyzją użytkownika na ostatnią bramkę przed zamknięciem (user-gate:r3). Świadome odstępstwo: Phase 3.2 (retro/verify-full) przed AC8 — fail AC8 = korekta + nowy verification subject + ponowny verify (CAP 2 rundy) |
| verify-full (subject 1, attempt 1) | pass | `python .agents/scripts/verify-full` exit 0: configuration valid; lint 0 (77 plików); typecheck node+web 0; vitest 232/232 (19 plików); validate-config ok; `cmd /c pnpm run verify` 0; SKIP: harness tests (template-only). Subject 1 (head 2d7d8f3, paths: .agents/tasks/project-files-view/plan.md, docs/features/project-files-view, src) zamrożony do close; AC8 = osobna bramka user-gate:r3, nie pokryta przez tę weryfikację jako spelnione |
| User-gate AC8 (user-gate:r3) | deferred-by-decision | Użytkownik 2026-09-26: nie testuje AC8 („wyjdzie w praniu") — AC8 = deferred-by-decision, precedens: punkty 3/5 mvp-core-shell; wpis w BACKLOG.md. AC1-7 oraz AC9 pass (runda 1) |
| User-gate AC8 re-check (user-gate:r4, realne GUI) | pass | Użytkownik 2026-09-28 potwierdza: katalog projektu usunięty/nieczytelny → inline error z nazwaniem problemu w obszarze drzewa, reszta aplikacji działa, `← Projects` wychodzi z trybu. Deferral zamknięty; AC1-9 komplet |

### Verification subject 1

```json
{
  "attempt": 1,
  "head": "2d7d8f31345501fbf84f2616be365d7cc87642ed",
  "paths": [
    ".agents/tasks/project-files-view/plan.md",
    "docs/features/project-files-view",
    "src"
  ],
  "schema_version": 1,
  "staged_diff_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "subject_sha256": "f18e03f69028b505d2b7509a2d8d61ae1735dfb8745a28ac303f9bafa94bdeb2",
  "unstaged_diff_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "untracked_files_sha256": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
}
```

## Timing

| Element | Kind | Started | Ended |
|---|---|---|---|
| intake | work | 2026-09-26T12:24:32Z | 2026-09-26T12:25:27Z |
| spec | work | 2026-09-26T12:25:27Z | 2026-09-26T13:38:53Z |
| plan | work | 2026-09-26T13:38:53Z | 2026-09-26T13:40:42Z |
| approval | wait | 2026-09-26T13:40:42Z | 2026-09-26T13:53:34Z |
| preflight | work | 2026-09-26T13:53:34Z | 2026-09-26T13:54:39Z |
| implement:stage1 | work | 2026-09-26T13:54:39Z | 2026-09-26T15:02:27Z |
| review:stage1 | work | 2026-09-26T15:02:27Z | 2026-09-26T15:17:35Z |
| correction:stage1 | work | 2026-09-26T15:17:35Z | 2026-09-26T15:34:02Z |
| review:stage1-rr1 | work | 2026-09-26T15:34:02Z | 2026-09-26T15:50:15Z |
| work | work | 2026-09-26T15:50:15Z | 2026-09-26T16:35:34Z |
| user-gate | wait | 2026-09-26T16:35:34Z | 2026-09-26T16:50:59Z |
| handoff | wait | 2026-09-26T16:50:59Z | 2026-09-26T16:58:26Z |
| preflight | work | 2026-09-26T16:58:26Z | 2026-09-26T17:00:38Z |
| user-gate:r2 | wait | 2026-09-26T17:00:38Z | 2026-09-26T17:15:20Z |
| retro | work | 2026-09-26T17:15:20Z | 2026-09-26T17:24:48Z |
| verify | work | 2026-09-26T17:25:22Z | 2026-09-26T17:26:17Z |
| user-gate:r3 | wait | 2026-09-26T17:27:44Z | 2026-09-26T17:40:45Z |
| close | work | 2026-09-26T17:40:45Z | 2026-09-26T17:42:53Z |
| user-gate:r4 | wait | 2026-09-28T17:23:01Z | 2026-09-28T17:23:17Z |

## Risks and blockers

- Integracja Monaco w electron-vite (workery, lazy-loading): bundler renderera musi pozostać bez `electron`/`node` (SDD §6) — weryfikować po każdym kroku integracji.
- Containment ścieżek przez realpath (symlinki poza root) i sniff binarności tylko pierwszego 8 KB chunka (bez zamrażania renderera).

## Resume instructions

Wstrzymane na handoffie: `.agents/handoffs/project-files-view.md` (snapshot z pełną instrukcją). Następny krok: Phase 3.1 — user-gate demo AC1-9 w realnym GUI (`pnpm dev`), po werdykcie Phase 3.2 — task-close (skill `task-close`) z verify-full. Kod w checkpoincie handoffu.
