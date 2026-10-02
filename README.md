# NeKode

Agent-First Coding Environment: a desktop workspace for coding agents on Windows 11. CLI agents (e.g. Codex, Claude Code, OpenCode, agy, Gemini CLI) run as terminal sessions (PTY) attached to chats in a project tree, while a local SQLite database stores the state of projects, chats, and layout.

## Status

Early development (beta). The app runs in dev mode and builds an NSIS installer.

## Features

- Local project management and work context: path, detected runtimes, current branch, and Git status.
- Chats as terminal sessions (node-pty + xterm.js), one main terminal per chat, with session preservation when switching chats.
- Chat attention badge: when an agent CLI in a (deselected) chat rings the terminal bell or emits an OSC 9 notification, the chat row shows an amber dot — with the OSC 9 message as its tooltip. Cleared by selecting the chat or typing into it.
- Project file browsing: directory tree and read-only preview in the Monaco Editor.
- Project action bar: fixed `Handoff | Resume` and `Stop | Continue` actions plus configurable command buttons.
- Persistence in SQLite (better-sqlite3).

## Agent notification setup (attention badge)

The attention badge only works if the agent CLI actually emits a signal. This is per-agent configuration — the app never edits it:

- **Codex CLI**: `~/.codex/config.toml` → `[tui] notifications` with `notification_method = "bel"` or `"osc9"`.
- **Claude Code**: `~/.claude/settings.json` → `"preferredNotifChannel": "terminal_bell"`.
- **Hermes Agent**: off by default. Enable with:
  ```
  hermes config set display.bell_on_complete true   # bell + OSC 9 when a turn ends
  hermes config set display.bell_on_prompt true     # bell + OSC 9 on blocking prompts (clarify/approval)
  ```
  (per profile; run inside the profile, e.g. with `HERMES_HOME` pointing at it).

Detection is passive (xterm parser callbacks: `onBell`, OSC 9); unconfigured agents simply never light the badge. See `docs/features/chat-attention-badge/spec.md` for the full contract.

## Requirements

- Windows 11.
- Node.js `^22.22.2 || ^24.15.0 || >=26.0.0` (the `engines` field in `package.json`).
- pnpm 12.5.1 (pinned in `packageManager`; via Corepack or a global install).
- Git >= 2.40.
- Visual Studio C++ Build Tools are not required: native modules (better-sqlite3, node-pty) use N-API prebuilds.

The full, verified setup guide: [`docs/development/setup.md`](docs/development/setup.md).

## Running locally

```
pnpm install
pnpm run dev
```

On first launch, Electron downloads its binaries (network access is needed only the first time).

Building outside dev mode:

- `pnpm run build:unpack`: a packaged app in `dist/win-unpacked/` (fastest smoke test).
- `pnpm run build:win`: an NSIS installer in `dist/`.

## Testing and verification

- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run test`
- `pnpm run verify` (lint + typecheck + test)
- `pnpm run format`

## Architecture

- `src/main`: Electron main process; domain services (ProjectService, TaskService, WorkspaceService, TerminalService), SQLite, PTY.
- `src/preload`: strictly typed IPC bridge (`contextBridge`).
- `src/renderer`: React 19, Tailwind CSS, xterm.js, Monaco Editor.

## Documentation

- `docs/product/` - approved product requirements.
- `docs/features/` - feature behavior contracts.
- `docs/architecture/` - architecture decisions and documentation.
- `docs/development/` - instructions for contributors.
- `docs/operations/` - deployment and maintenance runbooks.

## License

[MIT](LICENSE)
