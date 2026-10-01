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

- ConPTY passthrough (measured 2026-10-01, this machine): BEL (0x07), OSC 9
  (`ESC]9;...BEL`) and OSC 777 all reach the node-pty stream byte-for-byte
  through a spawned PowerShell. Agent-CLI attention signals (Claude Code
  `preferredNotifChannel: terminal_bell`, Codex `[tui] notifications` with
  notification_method osc9/bel) are therefore detectable in app code, via
  xterm `onBell` + `registerOscHandler(9)` or a scan in `TerminalService.onData`.
  Probe recipe: child writes the sequences fenced by ASCII markers; parent
  spawned via node-pty diffs what arrives between the markers. Historic
  ConPTY stripped OSC sequences (microsoft/node-pty#714); fixed in ConPTY
  shipped with Windows Terminal 1.23 (late 2024) — this machine has the
  fixed one, but old Windows 10 hosts may degrade to BEL-only.

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
- Renderer copy/paste is wired in ChatTerminal's
  `attachCustomKeyEventHandler` + right-click menu (TerminalContextMenu):
  Ctrl+C with an xterm selection copies instead of sending \x03 (Windows
  convention), Ctrl+Shift+C/V are always copy/paste, Ctrl+V/Ctrl+Shift+V paste
  through `terminal.paste()` — never write clipboard text with
  `terminals:write` directly, or the Ctrl+D prompt-base tracker misses it and
  the raw \x16 would double-paste in Windows edit mode.
- Regression checks on every change: task switching keeps sessions alive and
  app quit leaves no orphaned `pwsh`/`powershell` processes.
- Submit lines to a TUI with the split-write helper
  (`src/renderer/src/lib/pty-submit.ts`): the line text first, the CR after a
  150 ms gap — never `line + '\r'` in one write. ConPTY delivers a
  single-write burst as one chunk, and prompt_toolkit TUIs (Hermes Agent)
  parse that chunk as an unterminated bracketed paste: text enters their
  input box, the CR is swallowed, nothing submits (measured on this host: a
  CR reaching the child ≥120 ms after the text commits; ≤40 ms never does).
  Plain shells (PSReadLine) submit either way, so the gap is inert there.
  Raw-PTY node-pty probes are the way to verify such bugs — the byte path
  through `terminals:write` was correct and only the chunking was wrong.
