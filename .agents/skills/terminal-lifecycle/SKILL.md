---
name: terminal-lifecycle
description: Use when changing NeKode terminal sessions (PTY spawn and ownership, xterm.js views, IO streaming and buffering, resize, reconnect, agent CLI processes, ConPTY, or session termination). Do not use for pure UI styling, IPC plumbing, or database work.
---

# Terminal lifecycle

Four lifecycles with separate owners: xterm view, PTY process, agent CLI,
application. Reference: https://github.com/microsoft/node-pty

## When to use and when not to use

Use for: `terminals:*` channels, a TerminalService (when it exists), xterm.js
mount/unmount, PTY spawn/kill, ConPTY behavior, streaming and backpressure,
agent CLI startup in a task terminal. Do not use for visual-only panel
changes without terminal code, or for git/database tasks.

## Current state (verified 2026-09-24)

- Contract exists: `terminals:create/write/resize/terminate` plus push
  channels `terminals:data` and `terminals:exit`
  (`src/shared/ipc-contract.ts:35-40`), typed `AppApi.terminals` with
  `Unsubscribe` callbacks.
- Served as Stage 3 stubs: `STUB_CHANNELS` in
  `src/main/ipc/ipc-handlers.ts:13-19` and `stubChannel` entries in
  `src/main/ipc/ipc-validation.ts:135-138` (fixed values, no PTY).
- No TerminalService exists in `src/main/services/`. `node-pty` 1.1.0 is
  installed (prebuild staging allowed in `pnpm-workspace.yaml`), xterm.js
  5.5 with fit and web-links addons is a dependency, but no terminal view is
  mounted yet (`src/renderer/src/App.tsx` keeps the bottom region hidden).
- Behavior contract: `docs/features/mvp-core-shell/spec.md`. One PTY per
  task, PowerShell as default shell, cwd = project path, session survives
  task switching within one app run, no resurrection across app runs, app
  close kills all PTYs, self-exit shows a "session ended" state and a fresh
  spawn on next selection, writes to hidden terminals still reach their PTY.

## Lifecycle ownership

| Layer | Lives in | Dies when |
|---|---|---|
| xterm view | renderer | panel unmount or task closed: dispose the terminal and drop `onData`/`onExit` via `Unsubscribe` |
| PTY process | main | `terminals:terminate`, its `exit` event, or app shutdown |
| agent CLI | child of the PTY | shell exits or the PTY is killed; it is not an app-level entity |
| application | main process | `window-all-closed`; no PTY outlives it |

A view unmount never kills a PTY (that is session preservation). A PTY kill
always disposes its renderer subscription. Do not promise PTY survival after
the main process exits: there is no external host or daemon in this
architecture.

## Sequence for terminal work

1. Identify which lifecycle the change touches (table above) and keep the
   change inside that layer's owner.
2. New or changed channels follow the `electron-ipc` skill: contract,
   validation, sender guard. Keep the `taskId` keying of push events exactly
   as `src/preload/app-api.ts` `subscribe()` filters it, so no data bleeds
   across tasks.
3. When a real TerminalService lands, replace the matching `stubChannel`
   entry with a `serviceChannel`, drop the channel from `STUB_CHANNELS`, and
   keep the `AppApi` shape unchanged.
4. Buffer discipline: bound xterm scrollback, one `Unsubscribe` per mount
   (never per render), stop writing to exited PTYs, and cap queued writes.

## Checkpoints and verification

- Spawn failure (project dir moved or deleted) surfaces as an explicit error
  state per spec; no silent retry loop. Log PIDs and exit codes; never log
  terminal input (it can carry secrets).
- Unit tests cover logic decoupled from Electron and PTY (pattern:
  `IpcRendererLike` in `src/preload/bridge-types.ts`). jsdom tests never
  spawn PTYs. Real ConPTY behavior needs a dev or packaged smoke on Windows
  (`pnpm run dev` or `dist/win-unpacked/nekode.exe`); when the environment
  cannot run it, record it as not run.
- Regression checks on every change: task switching keeps sessions alive and
  app quit leaves no orphaned `pwsh`/`powershell` processes.
