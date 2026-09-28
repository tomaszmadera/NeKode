# NeKode MVP Core Shell — first vertical slice

This file is the behavioral contract for a feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

## Goal

Deliver the first vertically functional slice of the NeKode desktop workspace: a user can register a local project, create a chat inside it, and work in a live terminal attached to that chat. The terminal session survives chat switching during the application session. This gives the agent-first workflow its minimum usable loop: pick chat → run agent CLI in terminal.

A chat is a terminal session listed under a project (left tree: projects → chats). Closing the chat's terminal (`exit`, `Ctrl+D` at an empty input line outside full-screen programs, or shell termination) closes the chat itself. A chat is labeled automatically with its shell name (e.g. "PowerShell"); manual renaming is post-MVP. The task concept — a work item with progress tracking, attachable to a chat, recorded harness-agnostically — is a post-MVP entity and is out of scope for this slice.

Target user: a developer on Windows 11 running coding-agent CLIs (Codex, Claude Code, OpenCode, agy, Gemini CLI) as plain terminal processes.

## Related requirements

- `docs/product/requirements.md` §2.1 (project management), §2.2 (chats), §2.3 (PTY sessions), §2.6 (SQLite persistence), §2.7 (dark UI, English).
- `docs/architecture/SDD.md` §3 (MVP scope items 1–4, 8, 12, 13), §5 (service architecture), §6 (renderer must not own OS capabilities), §7 (five-region layout).
- `docs/UX-UI.md` §5 (global layout), §6 (default/restore state), §9–10 (left navigation), §14 (context header), §16 (git branch/worktree status), §17 (chat surface = primary terminal).

## Scope

- Five-region application shell (top bar placeholder, left navigation, center context header + main surface, hidden right region, hidden bottom region) with resizable left and bottom regions.
- SQLite persistence (better-sqlite3) in the Electron main process for projects, chats, and application state.
- Left navigation: project list with expandable chat lists; add-project and new-chat flows; active selection persisted.
- Chat workspace: primary terminal (node-pty in main, xterm.js in renderer) attached to the selected chat, running the platform shell (PowerShell) with the project directory as cwd.
- Session preservation: terminals of open chats keep running with scrollback while another chat is selected.
- Chat closing on terminal exit: the chat disappears from the tree and the database; navigation continues on the next chat of the project.
- Center context header: project name, project path, detected primary runtime label, Git branch and dirty/clean worktree status.
- Preload IPC bridge (`window.app.*`) as the only renderer access path to privileged operations.

## Non-goals

- File tree, file preview (Monaco), configurable Action Bar, bottom auxiliary terminal panel (multiple terminals/tabs, `Ctrl + `` shortcut), Kanban — later tasks.
- Task entity and work-progress tracking (task attached to a chat, harness-agnostic progress records) — post-MVP.
- Git operations UI, worktree mutation, handoff snapshots, agent selection/protocol work (ACP/MCP), LLM APIs.
- Multi-window support, terminal split panes, multiple terminals per chat (exactly one primary terminal per chat in this slice).
- Project settings, runtime auto-detection beyond a static label, remote/cloud anything.
- Chat rename (manual) — post-MVP; the `name` column stays in the schema for it.

## Behaviour

1. On first launch (empty database) the app shows the default state: left shows an empty Projects list with an Add Project affordance, center shows a Welcome/empty state, right and bottom regions hidden (UX-UI §6).
2. Add Project: user picks a directory via the native dialog; the app stores absolute path and derives the project name from the folder name. Selecting it makes it the active project.
3. New Chat: created immediately with no naming form; its name is derived from the platform shell (e.g. "PowerShell" on Windows). It is created under the active project and becomes the selected chat.
4. Selecting a chat opens the chat workspace in the center surface: context header on top, primary terminal filling the rest (UX-UI §17).
5. The first terminal render for a chat spawns exactly one PTY process: the user's default shell (PowerShell on Windows), cwd = project path. The renderer may write to it and resize it.
6. Switching to another chat hides the previous chat's terminal view but does NOT kill or reset its PTY process or scrollback; switching back shows the live session continuing.
7. Selecting a different project keeps its chats' terminals alive under the same preservation rule.
8. Closing the application terminates all PTY processes (no cross-session terminal resurrection in this slice). Application quit is NOT a chat exit: chats are never deleted on quit and are restored on the next launch.
9. Context header for the selected project shows: project name, absolute path, a runtime label (static, from project record), Git branch name and worktree status (clean/dirty), read via IPC from the main process (`git` CLI, read-only).
10. On startup the app restores the full left tree and its state: last selected project, last selected chat, left panel width, active center surface (UX-UI §6). Terminals are re-created lazily on first show of each chat (fresh process, no scrollback restore).
11. Closing a chat terminal closes the chat: when the shell process exits (user types `exit`, presses `Ctrl+D` at an empty input line, or the shell terminates), the terminal view is disposed and the chat is removed from the tree and the database. The `Ctrl+D` and `Ctrl+U` shortcuts are intercepted only outside the alternate buffer (full-screen programs such as vim/htop, where both pass through untouched). `Ctrl+D` at an empty input line closes the chat; on a non-empty line it is emulated as readline `delete-char` (the Delete key byte), and `Ctrl+U` removes the whole input line, including text behind the cursor (PowerShell `SelectAll` followed by Backspace). Raw `Ctrl+D` and `Ctrl+U` bytes are never forwarded to the PTY outside the alternate buffer: the user's shell (PowerShell + PSReadLine, Windows edit mode) has no binding for them and self-inserts them into the input line as visible `^D`/`^U` glyphs. Product decision: inside normal-buffer programs (e.g. a Python REPL) `Ctrl+D` at an empty line still closes the chat — leaving such a program is done with its own command (`exit()`, `Ctrl+Z`+Enter). The terminal view is disposed and the chat is removed from the tree and the database. The app then selects the next chat of the same project in tree order (if the closed chat was last, the previous one). If the project has no chats left, the center surface shows an empty state with a "Start new chat" affordance. There is no "session ended" state in this slice.
12. Renderer never touches Node/fs/child_process APIs; all privileged work goes through the narrowly typed `window.app.*` preload bridge (SDD §6).

## Business rules

- A project path must be an existing absolute directory; the same path cannot be registered twice (unique constraint).
- A chat belongs to exactly one project; deleting a project deletes its chats and their state rows (cascade).
- Chat name is derived from the platform shell at creation and is non-empty; duplicates within one project are allowed (the name is a display label, chat identity is the id). Manual renaming is post-MVP.
- One PTY process maximum per chat at a time; a chat with no project directory on disk (moved/deleted) cannot spawn a terminal and shows an explicit error state instead.
- A chat is removed only by project removal or by its terminal exiting (Behaviour 11); application quit never removes chats.
- Application state is a flat key–value store; selection keys are written on every selection change.

## Authorization

none (local desktop application, single user).

## Data / API

SQLite database at Electron `userData/nekode.db` (better-sqlite3, WAL mode).

- `projects(id TEXT pk, name TEXT not_null, path TEXT not_null unique, runtime_label TEXT, created_at TEXT)`
- `chats(id TEXT pk, project_id TEXT not_null references projects on delete cascade, name TEXT not_null, created_at TEXT)` (no unique constraint on name — duplicates within a project are allowed)
- `app_state(key TEXT pk, value TEXT not_null)`

Preload bridge (typed, the full public contract of this slice):

- `window.app.projects.list() / add() / remove(id)`
- `window.app.chats.list(projectId) / create(projectId) / remove(id)` (`create` derives the chat name from the platform shell in the main process)
- `window.app.state.get(key) / set(key, value)`
- `window.app.terminals.create(chatId, cwd) / write(chatId, data) / resize(chatId, cols, rows) / onData(chatId, cb) / onExit(chatId, cb)`
- `window.app.git.getStatus(projectPath)` → `{ branch, dirty }` (read-only)

IDs are generated in the main process (UUID v4). All IPC channels are validated (type + existence) in the main process before touching services.

## Edge cases

- Project directory deleted/moved after registration: terminal spawn fails with an explicit error surface on the chat workspace; project row remains until user removes it.
- Terminal exits on its own (`exit`, `Ctrl+D` at an empty input line outside full-screen programs, shell crash): the chat closes and is removed from the tree and database (Behaviour 11); navigation continues on the next chat of the project or the "Start new chat" empty state.
- Very fast chat switching: writes targeted at a hidden terminal are still delivered to its PTY; no cross-chat data bleed (channel keyed by chatId).
- Empty project name derivation (drive root selected): reject with a validation error.
- App state contains a selection pointing to a removed project/chat: fall back to default empty state and clean the stale keys.

## Errors

- IPC validation failures reject with a typed error surfaced to the renderer (no silent fallback).
- SQLite errors bubble as dialog/notification-level errors in the renderer, never crash the main process.
- `git` invocation failure (not a repo, git missing) degrades the header to "no git" instead of failing the workspace.

## Acceptance criteria

1. Fresh start shows the empty default state; after registering a project and creating a chat, a PowerShell terminal opens with cwd set to the project path.
2. Typing in the terminal executes commands; resizing the window resize-fits the terminal (fit addon).
3. With two chats in one project, starting a long-running command (e.g. `pnpm dev`) in chat A, switching to chat B and back, shows chat A's output still streaming with scrollback intact.
4. Restarting the app restores the last selected project/chat, the full chat tree, and left panel width; terminal starts fresh on first show.
5. Registering the same directory twice is rejected with a visible error; removing a project removes its chats from the navigation and from the database.
6. Context header shows correct branch and dirty/clean status for a git repository, and a degraded "no git" state outside one.
7. `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build` all pass; renderer bundle contains no direct `require('electron')`/Node API usage beyond the preload bridge contract.
8. All UI text is English; dark theme tokens match UX-UI.
9. Typing `exit` (or `Ctrl+D` at an empty input line; outside full-screen programs `Ctrl+D` on a non-empty line emulates `delete-char` and `Ctrl+U` removes the whole input line, while both keys pass through untouched to full-screen programs) in a chat terminal closes the chat: it disappears from the tree and the database, the next chat of the project is selected (or a "Start new chat" empty state when none remain); no "session ended" state exists anywhere in the UI.
10. Creating a chat requires no name input: the chat is labeled with the shell name (e.g. "PowerShell"), and several chats in one project may share the same label.

## Required tests

- Unit (vitest): persistence services — project/chat/state CRUD, cascade delete, stale-state cleanup (duplicate chat names allowed, shell-derived name).
- Unit (vitest): IPC payload validation layer (stubbed services).
- Unit (vitest): git status parsing (fixture outputs: clean, dirty, non-repo).
- Unit (vitest): terminal service (fake PTY) — chat removal on exit is renderer-driven and suppressed during application quit; project removal terminates the right PTYs.
- Renderer smoke: shell renders five regions and empty state (jsdom or similar; no real PTY in unit tests).
- Renderer: chat-close flow on terminal exit (dispose + chat removal + next-chat selection / "Start new chat" empty state); `Ctrl+D` closes only at an empty input line outside full-screen programs and is passed through otherwise; chat creation without a naming form.
- Manual/verification run: acceptance criteria 1–6 and 9 exercised via `pnpm dev` (documented in task record).

## Relevant SDD / ADR

- `docs/architecture/SDD.md` §3, §5, §6, §7 (no ADR register exists in this repo).
