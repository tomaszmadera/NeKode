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
- Settings: terminal fonts and icon fonts, attention alerts, per-project shell selection, agent profiles, dictation, and Kanban adapter configuration.
- Kanban board: external work items (Plane today) through adapter plugins, with Start, Resume, New task, and item review.
- Bottom auxiliary terminal panel: additional terminals in tabs below the main surface.
- Handoff/Resume flow: English prompt commands, optional auto-send, and a per-project handoff directory with a resume list.
- WSL projects: browse files and run terminals inside a WSL distribution.
- Dictation (OpenWhispr): speech to text into the focused application.

Each feature's behavior contract lives in [`docs/features/`](docs/features/).

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

- `src/main`: Electron main process; domain services (ProjectService, ChatService, AppStateService, ActionService, TerminalService, plus modules for files, Git, shells, handoffs, Kanban, and dictation), SQLite, PTY.
- `src/preload`: strictly typed IPC bridge (`contextBridge`).
- `src/renderer`: React 19, Tailwind CSS, xterm.js, Monaco Editor.

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [public project contract](docs/development/project-contract.md), which map requirements, architecture, verification, and contribution rules to their public owners. Maintainer version publication follows the [release procedure](docs/operations/releases.md).

`AGENTS.md`, the `.agents/` harness, and agent-specific configuration are local working files and remain ignored. They contain personal tools and execution mechanics, so the public repository does not prescribe that workflow. Project requirements and contribution rules live in the public documentation. A clean clone needs no harness to build, test, or contribute. You can create your own locally ignored `AGENTS.md` from the public contract and link to its owners without duplicating their rules.

### Working with AI agents (your own AGENTS.md)

NeKode is built with coding agents, but this repository ships no agent instructions: `AGENTS.md` and any harness stay personal and git-ignored. The public documentation is the canonical reference for project rules.

To work with an agent in your clone:

1. Create `AGENTS.md` in the repository root (already git-ignored).
2. Put the canonical rules in it: copy the "Canonical rules" block from [`docs/development/agents-md.md`](docs/development/agents-md.md) and keep it in sync with the owners it links.
3. Keep personal preferences (tools, workflow, style) in a separate section.

Why: a clean clone must be enough to build, test, and contribute, and every contributor uses different agents. Rules that matter to everyone live in [the public project contract](docs/development/project-contract.md) and the documents it names; your `AGENTS.md` points at them and never replaces them. If your guide and the documentation disagree, the documentation wins.

## Documentation

- `docs/product/` - approved product requirements.
- `docs/features/` - feature behavior contracts, indexed with their delivery status in [`docs/features/README.md`](docs/features/README.md).
- `docs/architecture/` - architecture decisions and documentation.
- `docs/development/` - instructions for contributors.
- `docs/operations/` - deployment and maintenance runbooks.
- `docs/references/` - the design system and historical or visual references, which are not behavior contracts.
- `adapters/plane/` - the optional Plane adapter with its own toolchain and setup instructions.
- [`BACKLOG.md`](BACKLOG.md) - deferred product ideas, not an active plan.

## License

[MIT](LICENSE)
