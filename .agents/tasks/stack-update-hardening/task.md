---
id: stack-update-hardening
schema_version: 2
status: completed
intent: repository-operation
complexity: large
durability: recorded
current_phase: Phase 6
current_step: none
updated: 2026-09-24
branch: main
worktree: current
next_action: none
blockers: none
---

# NeKode — aktualizacja i utwardzenie stacku

## Objective

Uaktualnienie i utwardzenie toolchainu istniejącego repozytorium NeKode (Electron desktop,
Windows 11): wspierany Electron 44, kompatybilny i odtwarzalny toolchain (electron-vite 5,
Vite 7, pnpm 12 allowBuilds), działające moduły natywne (better-sqlite3, node-pty) bez
lokalnych VS C++ Build Tools, bezpieczny preload/IPC (CSP, nawigacja, openExternal,
senderFrame, walidacja payloadów), testy regresyjne, migracje Vitest i Biome, aktualna
dokumentacja setup.

## Scope

Wykonawczy brief użytkownika (zatwierdzony plan — kolejność i bramki w sekcji 7 briefu):
Baseline -> P0-A (Electron 44 + electron-vite/Vite) -> P0-B (pnpm, natywne, instalator)
-> P0-C (bezpieczeństwo) -> P1 (Vitest, Biome) -> dokumentacja + macierz weryfikacji.
Bez przebudowy architektury main/preload/renderer; bez nowych frameworków i abstrakcji.
Nie implementować TerminalService od zera (stub Stage 3 pozostaje stubem).

## Phase 0 - Intake

- [x] Phase 0.1 - Inspect the repository and refine the provisional classification

## Phase 1 - Baseline and Inventory

- [x] Phase 1.1 - Baseline gates and version inventory (pre-existing typecheck failure documented)

## Phase 2 - P0-A: Electron 44 and bundler migration

- [x] Phase 2.1 - Upgrade Electron 44.4.5 + electron-vite 5.0.0 + Vite 7.3.6 + plugin-react 5.2.0 (externalizeDepsPlugin -> v5 default)
- [x] Phase 2.2 - Fix stale typecheck test (src/preload/app-api.test.ts) and run full gates
- [x] Phase 2.3 - Dev + production build smoke on the new toolchain

## Phase 3 - P0-B: Dependencies, packaging, native modules

- [x] Phase 3.1 - pnpm allowBuilds-only policy, packageManager pin, frozen-lockfile install
- [x] Phase 3.2 - better-sqlite3 12.11.1 -> 13.x verification (win32-x64 prebuild, Electron main open/migrations, tests)
- [x] Phase 3.3 - node-pty 1.1.0 verification in real Electron main (load/spawn smoke; full PTY UI = Stage 3 of mvp-core-shell)
- [x] Phase 3.4 - electron-builder Windows package and out-of-dev app smoke (binaries present, DB opens)

## Phase 4 - P0-C: Security hardening

- [x] Phase 4.1 - Security fixes: CSP, navigation/window-open lockdown, safe openExternal URLs, IPC senderFrame validation, error hygiene
- [x] Phase 4.2 - Regression tests: invalid IPC sender/payload, path handling, safe URL, SQLite open/migration

## Phase 5 - P1: Test and lint tooling

- [x] Phase 5.1 - Vitest 3.2.7 -> supported stable with `test.projects` (environmentMatchGlobs removed)
- [x] Phase 5.2 - Biome 1.9.4 -> Biome 2.x via official `biome migrate`

## Phase 6 - Docs and close

- [x] Phase 6.1 - Update docs/development/setup.md to the verified toolchain
- [x] Phase 6.2 - Final verification matrix and close

## Decisions

- Klasyfikacja skorygowana z `feature` na `repository-operation` (dowody z fazy execution):
  to była bezpośrednia robota wykonawcza na toolchainie/pakowaniu/utwardzeniu repo wg
  zatwierdzonego briefu użytkownika — bez trasy spec/plan/approval/preflight/review,
  więc Timing uczciwie zawiera tylko `work` (+ retro/verify/close), a nie fazy, których
  nie było. Complexity `large` pozostaje (zakres rzeczywisty).

- Combo P0-A zweryfikowany w npm registry 2026-09-24: electron-vite 5.0.0 (peer vite
  ^5||^6||^7) + Vite 7.3.6 (najnowszy 7.x; Vite 8 poza peerelectron-vite) +
  @vitejs/plugin-react 5.2.0 (peer vite do ^8; wersja 6.x wymaga Vite 8 — odrzucona).
- Electron 44.4.5 = najnowszy stabilny patch 44.x (releases.electronjs.org 2026-09-24;
  45.x to alpha). Node wewnątrz Electron 44 = 24.21.0 (host: 24.18.0 — ta sama major).
- node-pty: pozostaje 1.1.0 (jedyny stabilny; 1.2.0 to serie beta — bez przejścia).
- electron-builder: pozostaje 25.1.8 o ile build działa (brief: aktualizować tylko
  w razie potrzeby).
- Lepsze decyzje P0-B/P1 dopisywane w miarę etapów.
- better-sqlite3: 12.11.1 -> 13.0.3 — wymuszone empirycznie: 12.x (NODE_MODULE_VERSION 137)
  nie laduje sie w Electron 44 (modules=149); bez VS Build Tools przebudowa niemozliwa.
  13.x = N-API + wbudowane prebuildy (prebuilds/win32-x64.node). @types 7.6.12 -> 9.6.0.
- allowBuilds (pnpm-workspace.yaml): true tylko dla @biomejs/biome, esbuild, node-pty
  (realne skrypty instalacyjne); better-sqlite3: false (implicitny node-gyp psul instalacje,
  prebuildy wystarczaja); electron 44.4.5 nie ma zadnych skryptow (binarny download lazy).
  Usunieto legacy onlyBuiltDependencies.
- electron-builder: npmRebuild: false (electron-builder.yml) — @electron/rebuild prubowal
  node-gyp rebuild obu modulow N-API (bez Build Tools fail); smart unpack sam wypakowuje
  *.node/dll/exe do app.asar.unpacked (zweryfikowane w dist/win-unpacked i instalacji).
- Weryfikacje uruchomieniowe robic przez PowerShell Start-Process; bash-owy start/cmd
  wrapper instalatora NSIS wisi lub pada (exit 139) na tym hoście.

## Changed files

- `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `biome.json`,
  `electron.vite.config.ts`, `electron-builder.yml` (nowy), `vitest.config.ts`
- `docs/development/setup.md`
- `src/main/index.ts`, `src/main/ipc/ipc-handlers.ts`, `src/main/ipc/ipc-validation.ts`,
  `src/main/ipc/ipc-validation.test.ts` (nowy), `src/main/db/connection.ts`,
  `src/main/db/db.test.ts` (nowy), `src/main/security/sender-guard.ts` + `sender-guard.test.ts` (nowe),
  `src/main/services/project-service.ts`, `src/main/services/task-service.ts`,
  `src/main/services/app-state-service.ts`
- `src/shared/ipc-error.ts` + `ipc-error.test.ts` (nowy), `src/shared/safe-url.ts` + `safe-url.test.ts` (nowe)
- `src/preload/app-api.test.ts` (fix pod kontrakt `projects.add()` — zamyka też Resume 1 mvp-core-shell)
- `src/renderer/index.html` (CSP), `src/renderer/src/components/layout/ResizeHandle.tsx` (usunięty nieużywany import)
- `.agents/lessons/index.json`, `.agents/lessons/items/native-deps-prebuilt-binaries.md` (update),
  `.agents/lessons/items/windows-gui-launchers-powershell.md` + `electron-userdata-not-appdata.md` (nowe)
- `.agents/tasks/stack-update-hardening/task.md`

Nietknięte (nadal niezatwierdzone zmiany mvp-core-shell Stage 2): `src/preload/index.ts`,
  `src/preload/app-api.ts`, `src/preload/bridge-types.ts`, `src/renderer/src/App.tsx`,
  `src/renderer/src/App.test.tsx`, `src/renderer/src/components/` (poza ww. importem),
  `src/renderer/src/hooks/`, `src/renderer/src/lib/`, `src/renderer/src/env.d.ts`,
  `tsconfig.node.json`, `tsconfig.web.json`, `src/main/services/create-services.ts`,
  `src/main/db/migrations.ts`, `docs/features/`, `.agents/tasks/mvp-core-shell/`,
  `.agents/handoffs/mvp-core-shell.md`.

## Verification

| Check | Result | Notes |
|---|---|---|
| `pnpm run lint` (baseline, 2026-09-24) | pass | Biome 1.9.4, 38 files |
| `pnpm run typecheck` (baseline) | fail | 1 known error: src/preload/app-api.test.ts:39 (stale test vs new `projects.add()` contract — Stage 2 mvp-core-shell) |
| `pnpm run test` (baseline) | pass | 16/16, Vitest 3.2.7 (environmentMatchGlobs deprecation warning) |
| `pnpm run build` (baseline) | pass | electron-vite 3.1.0 / Vite 6.4.3 |
| `python .agents/scripts/task-status --check .agents/tasks/stack-update-hardening/task.md` | pass | record valid on creation |
| P0-A gates (po upgrade) | pass | lint 0, typecheck 0 (po fixie stale testu), test 16/16, build (electron-vite 5 / Vite 7.3.6) |
| Native smoke w prawdziwym Electron 44.4.5 (smoke-main.cjs, APPDATA nie izoluje userData na Windows) | pass | better-sqlite3 WAL+CRUD ok; node-pty ConPTY spawn/output/resize/kill/cleanup ok; modules=149 |
| Dev smoke (`pnpm dev`) po migracji | pass | main czysto, serwisy + migracje v1 (schema w userData), okno dziala |
| Paczka `build:unpack` + uruchomienie poza dev | pass | binaria w app.asar.unpacked (win32-x64, conpty.dll, OpenConsole.exe); apka odtworzyla swieza baze + migracje v1 |
| Instalator NSIS `build:win` + cicha instalacja + uruchomienie + deinstalacja | pass | nekode Setup 0.1.0.exe (149 MB); instalacja /S /D=... (PowerShell Start-Process), start zainstalowanej apki + migracje v1, Uninstall /S czysty |
| Cleanroom `pnpm install --frozen-lockfile` | pass | czysty katalog + lockfile; 19s; prebuildy staging ok; tylko dozwolone skrypty |
| Smoke dev (baseline, przed migracją better-sqlite3) | fail → naprawione w P0-B | better_sqlite3.node (137) vs Electron (149) — root cause migracji do 13.x |
| `commands.verify_full` (próba 1, 2026-09-24T16:37:38Z) | fail | bramki w środku przeszły (lint 0, tc 0, test 41/41), ale całość exit 1: walidacja rekordu (nachodzący Timing retro, brak bloku verification subject). Korekta rekordu = nowy subject + jedna nowa próba. |
| `commands.verify_full` (próba 2, 2026-09-24T16:41:23Z) | pass | exit 0: validate-config OK, lint 0 (4 ostrzeżenia a11y = follow-up), typecheck 0, test 41/41; `verification_subject.py check` = match (attempt 2) przed zamknięciem |

### Verification subject 1

```json
{
  "attempt": 1,
  "head": "939ef4308a1d007a09762b31ada5e33938ae898b",
  "paths": [
    ".agents/lessons/index.json",
    ".agents/lessons/items/electron-userdata-not-appdata.md",
    ".agents/lessons/items/native-deps-prebuilt-binaries.md",
    ".agents/lessons/items/windows-gui-launchers-powershell.md",
    "biome.json",
    "docs/development/setup.md",
    "electron-builder.yml",
    "electron.vite.config.ts",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "src/main/db/connection.ts",
    "src/main/db/db.test.ts",
    "src/main/index.ts",
    "src/main/ipc/ipc-handlers.ts",
    "src/main/ipc/ipc-validation.test.ts",
    "src/main/ipc/ipc-validation.ts",
    "src/main/security/sender-guard.test.ts",
    "src/main/security/sender-guard.ts",
    "src/main/services/app-state-service.ts",
    "src/main/services/project-service.ts",
    "src/main/services/task-service.ts",
    "src/preload/app-api.test.ts",
    "src/renderer/index.html",
    "src/renderer/src/components/layout/ResizeHandle.tsx",
    "src/shared/ipc-error.test.ts",
    "src/shared/ipc-error.ts",
    "src/shared/safe-url.test.ts",
    "src/shared/safe-url.ts",
    "vitest.config.ts"
  ],
  "schema_version": 1,
  "staged_diff_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "subject_sha256": "5dc9fb264061cc4ea6a67ba3291799d0136ff03841fbcc2ef7ccf4bd1c146b9a",
  "unstaged_diff_sha256": "122a124a17844500fb1cd10339f24764e1a1a42843563d490b95ae2fcf152879",
  "untracked_files_sha256": "2894eb01705720ba85353726173a611c4392db95d94dc0e9087729b4377ed6c1"
}
```

### Verification subject 2

```json
{
  "attempt": 2,
  "head": "939ef4308a1d007a09762b31ada5e33938ae898b",
  "paths": [
    ".agents/lessons/index.json",
    ".agents/lessons/items/electron-userdata-not-appdata.md",
    ".agents/lessons/items/native-deps-prebuilt-binaries.md",
    ".agents/lessons/items/windows-gui-launchers-powershell.md",
    "biome.json",
    "docs/development/setup.md",
    "electron-builder.yml",
    "electron.vite.config.ts",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "src/main/db/connection.ts",
    "src/main/db/db.test.ts",
    "src/main/index.ts",
    "src/main/ipc/ipc-handlers.ts",
    "src/main/ipc/ipc-validation.test.ts",
    "src/main/ipc/ipc-validation.ts",
    "src/main/security/sender-guard.test.ts",
    "src/main/security/sender-guard.ts",
    "src/main/services/app-state-service.ts",
    "src/main/services/project-service.ts",
    "src/main/services/task-service.ts",
    "src/preload/app-api.test.ts",
    "src/renderer/index.html",
    "src/renderer/src/components/layout/ResizeHandle.tsx",
    "src/shared/ipc-error.test.ts",
    "src/shared/ipc-error.ts",
    "src/shared/safe-url.test.ts",
    "src/shared/safe-url.ts",
    "vitest.config.ts"
  ],
  "schema_version": 1,
  "staged_diff_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "subject_sha256": "60498a2ded479f3a734ed4b7ccf07b15e039173d8e72278e31a1f84b508d37b1",
  "unstaged_diff_sha256": "122a124a17844500fb1cd10339f24764e1a1a42843563d490b95ae2fcf152879",
  "untracked_files_sha256": "2894eb01705720ba85353726173a611c4392db95d94dc0e9087729b4377ed6c1"
}
```

## Timing

| Element | Kind | Started | Ended |
|---|---|---|---|
| intake | work | 2026-09-24T15:36:12Z | 2026-09-24T15:36:12Z |
| work | work | 2026-09-24T15:36:12Z | 2026-09-24T16:35:29Z |
| retro | work | 2026-09-24T16:35:29Z | 2026-09-24T16:37:25Z |
| verify | work | 2026-09-24T16:37:25Z | 2026-09-24T16:37:41Z |
| verify | work | 2026-09-24T16:40:45Z | 2026-09-24T16:41:24Z |
| close | work | 2026-09-24T16:42:04Z | 2026-09-24T16:42:04Z |

Praca przed utworzeniem rekordu (baseline, inwentaryzacja) zachowana jako dowody w tabeli
Verification; brak nagłówków Timing dla prac sprzed rejestracji (brak wiarygodnych znaczników).

## Risks and blockers

- Brak lokalnych VS C++ Build Tools: każdy moduł natywny wymaga zweryfikowanego prebuilda
  win32-x64; brak prebuilda = BLOCKED, nie obchodzić forkiem/losowymi binariami.
- Repozytorium zawiera niezatwierdzone zmiany z mvp-core-shell Stage 2 (8 zmodyfikowanych
  plików, katalogi src/main/db|ipc|services niepod commit). Nie ruszać ich zakresem poza
  konieczne; nie commitować, nie czyścić.
- Fix app-api.test.ts zamyka też krok Resume 1 wstrzymanego zadania mvp-core-shell.
- Instalator Windows i pełne ConPTY mogą wymagać smoke testu manualnego — oznaczyć
  BLOCKED/NOT RUN zgodnie z briefem, jeśli host nie pozwala.

## Resume instructions

Kontynuuj od `next_action` (Phase 2.1). Przed edycją: `git status` (chronić niezatwierdzone
zmiany mvp-core-shell), potem edycja package.json i electron.vite.config.ts zgodnie z
decyzjami, `pnpm install`, bramki `pnpm run lint && pnpm run typecheck && pnpm run test &&
pnpm run build`. Dowody zapisuj w tabeli Verification; stany Timing zamykaj/otwieraj, nie
przepisuj historii.
