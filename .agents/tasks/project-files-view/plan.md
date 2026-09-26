---
task_id: project-files-view
spec: docs/features/project-files-view/spec.md
status: approved
---

# Plan: Project File Tree and Read-Only Monaco Preview

This file is the execution strategy for one task. It is not live progress and must not replace the task record. Do not put checkboxes here. Link the spec; do not copy it.

`status` is `draft` until the user approves the plan, then `approved`. A Standard plan has exactly one stage. A Large plan has two or more stages. Do not run tests-and-preflight or product code while status is `draft`.

## Goal of this iteration

Widok Project Files zgodny ze specyfikacją: tryb file tree w left navigation z `← Projects`, read-only podgląd Monaco w centrum, fallbacki large/binary z „Open externally", kontekstowe menu projektu z „Remove Project". Dostarcza wymaganie 4 requirements.md.

## Spec

`docs/features/project-files-view/spec.md`

## Out of scope

Wg sekcji Non-goals specyfikacji: edycja plików, konfiguracja wykluczeń, zakładka Kanban, operacje na plikach, wyszukiwanie, dekoracje git w drzewie, persistencja stanu drzewa między restartami.

## Stages

### Stage 1 - Project Files view: file tree mode and read-only preview

- Outcome: kompletne zachowanie ze specyfikacji (Behaviour 1–15): przycisk „Files" na wierszu projektu + context menu z „Remove Project", tryb file tree w left panel, leniwe drzewo z wykluczeniami, read-only preview Monaco z breadcrumbem, fallbacki too-large/binary z „Open externally", powrót `← Projects` z zachowaniem sesji terminala i stanu drzewa per projekt.
- Boundary: wszystkie kanały `files:*` są read-only; brak zapisów do bazy (stan drzewa tylko w sesji renderera); bundle renderera bez `electron`/`node` (SDD §6); nowa zależność Monaco ładowana leniwie.
- Verification: bramki `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build`; nowe testy wg „Required tests" specyfikacji (serwis main, handlery IPC, komponenty renderera); regresja istniejących przepływów czatu.
- Expected evidence: zielone bramki z liczbami testów, testy dyskryminujące dla containment i klasyfikacji plików, user-gate demo AC1–9 w realnym GUI (`pnpm dev`) przed task-close.
- Likely files: `src/shared/ipc-contract.ts`, `src/main/services/files/files-service.ts` (+test), `src/main/ipc/ipc-handlers.ts` (+test), `src/preload/app-api.ts`, `src/renderer/src/components/files/*` (ProjectFilesSurface, FileTree, FilePreview), `src/renderer/src/components/layout/LeftNavigation.tsx`, `src/renderer/src/App.tsx` (+testy), `src/renderer/src/lib/test-ids.ts`, `package.json` (monaco).

Etapy są indeksem do czasu startu; po starcie rozwijany jest tylko bieżący nagłówek.

## Preflight before edits

- Skill: `preflight`
- Preflight command from `.agents/project-profile.yaml`: `commands.preflight` → `{python} .agents/scripts/preflight`
- Existing tests to run before product edits, and where to record results (task record Verification table): `pnpm run test` (baseline 183/183 po zamknięciu mvp-core-shell) + `pnpm run typecheck`; wynik w wierszu Verification rekordu zadania.

## Risks

- Integracja Monaco w electron-vite: workery i lazy-loading; bundler renderera musi pozostać czysty z `electron`/`node` — weryfikować po każdym kroku integracji.
- Detekcja binarności bez zamrażania renderera: sniff tylko pierwszego chunka (8 KB), kolejność: stat rozmiaru → too-large, potem sniff.
- Containment ścieżek przez realpath (symlinki wychodzące poza root) — testy na `..`, ścieżki absolutne i symlinki.

## Approval

Standard and Large: do not run tests-and-preflight or product code until the user approves this plan.
