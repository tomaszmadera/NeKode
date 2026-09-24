---
name: electron-e2e
description: Use for end-to-end verification of the real NeKode Electron app (IPC regressions, terminal behavior, startup and shutdown, or smoke of Windows builds). Do not use for Vitest unit or component tests.
---

# Electron end-to-end tests

Desktop-level verification of the dev or packaged Electron app. Harness
reference: https://playwright.dev/docs/api/class-electron

## When to use and when not to use

Use for: smoke of the real app (dev or packaged), regressions across IPC,
terminal, startup or shutdown, verification of a new Windows build. Do not
use for unit or component tests: those belong to Vitest (`vitest.config.ts`,
node project for `src/main`, `src/preload`, `src/shared`; jsdom project for
`src/renderer`).

## Current state (verified 2026-09-24)

- No e2e harness exists in the repo. Coverage is Vitest only
  (`*.test.ts`/`*.test.tsx` next to the sources).
- When e2e work starts, the recommended harness is Playwright's `_electron`
  API (reference above). Do not add a second framework once that lands, and
  do not add it before the first e2e task: `package.json` and the lockfile
  stay untouched until then, with an `allowBuilds` review per
  `electron-native`.

## Isolation and cleanup rules

1. Never run tests against the developer's real `userData`. On Windows,
   `%APPDATA%` redirection does not isolate Electron; use
   `app.setPath('userData', tempDir)` in the launched app or harness
   (.agents/lessons/items/electron-userdata-not-appdata.md). Point the test
   database and fixture project at scratch directories.
2. Kill and reap every spawned Electron and PTY process in teardown; assert
   that no orphaned `nekode.exe` or `pwsh` remains after the run.
3. Distinguish smoke targets and record which one ran:
   - dev smoke: `pnpm run dev`, or `pnpm run build` with `out/`;
   - packaged smoke: `pnpm run build:unpack` and run
     `dist/win-unpacked/nekode.exe`;
   - installer smoke: PowerShell `Start-Process -Wait`
     (.agents/lessons/items/windows-gui-launchers-powershell.md).
4. Renderer probes without a test runner: `nekode.exe
   --remote-debugging-port=<port>` plus a CDP `Runtime.evaluate` check
   (`docs/development/setup.md`, section 3).

## Checkpoints and verification

- A scenario counts as PASS only when its assertions ran inside a real
  Electron process; jsdom results never count as e2e.
- If the environment cannot run a Windows-only check, record it as not run
  with the reason; never as passed.
- Keep logs free of terminal input and secrets; create and remove fixture
  directories per run.
