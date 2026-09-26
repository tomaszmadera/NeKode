---
id: project-files-view
schema_version: 2
status: active
intent: feature
complexity: standard
durability: recorded
current_phase: Phase 3
current_step: Phase 3.1
updated: 2026-09-26
branch: main
worktree: current
next_action: Resume z handoffu .agents/handoffs/project-files-view.md — user-gate demo AC1-9, potem task-close
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

- [ ] Phase 3.1 - User-gate: demo AC1-9 w realnym GUI (pnpm dev)
- [ ] Phase 3.2 - task-close z final verification `full`

## Decisions

- Klasyfikacja (z evidence repo 2026-09-26): intent feature, complexity standard — jeden demonstrable stage (widok Project Files jako pionowy plaster: wejście w tryb → drzewo → read-only podgląd). Niezmienna względem propozycji przedstawionej użytkownikowi przy wyborze zadania.
- Branch main, drzewo czyste poza rekordami zadania; brak kolizji id w `.agents/tasks/`.
- Nawigacja (decyzja użytkownika 2026-09-26): klik wiersza projektu nadal tylko rozwija listę czatów; wejście w Project Files przez osobny przycisk „Files" na wierszu projektu (w miejscu dotychczasowego przycisku usuwania); usuwanie projektu dostępne wyłącznie z menu kontekstowego wiersza (przycisk z wiersza znika). Powrót przez `← Projects`; wybór czatu przywraca terminal. Sesje czatów żyją w ukrytych widokach przez czas w trybie plików.
- Label akcji: „Files" (tooltip „Show project files"); etykieta widoku w centrum „Files" bez martwej zakładki Kanban (post-MVP).
- Model widoku (z zaakceptowanych docs — UX-UI §11/§18/§69, SDD §12-13): left panel przełącza się w tryb file tree z `← Projects` + nazwą projektu; centrum = nagłówek kontekstu + breadcrumb + read-only Monaco; fallbacki too-large/binary z „Open externally"; stan drzewa per projekt w sesji, bez persistencji do bazy.

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
| handoff | wait | 2026-09-26T16:50:59Z | |

## Risks and blockers

- Integracja Monaco w electron-vite (workery, lazy-loading): bundler renderera musi pozostać bez `electron`/`node` (SDD §6) — weryfikować po każdym kroku integracji.
- Containment ścieżek przez realpath (symlinki poza root) i sniff binarności tylko pierwszego 8 KB chunka (bez zamrażania renderera).

## Resume instructions

Wstrzymane na handoffie: `.agents/handoffs/project-files-view.md` (snapshot z pełną instrukcją). Następny krok: Phase 3.1 — user-gate demo AC1-9 w realnym GUI (`pnpm dev`), po werdykcie Phase 3.2 — task-close (skill `task-close`) z verify-full. Kod w checkpoincie handoffu.
