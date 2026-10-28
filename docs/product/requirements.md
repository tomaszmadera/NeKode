# Product requirements: NeKode MVP

**Status:** Accepted MVP product requirements\
**Version:** 0.2\
**Role:** Canonical product requirements; accepted user decisions and ADRs take precedence according to the [source hierarchy](../development/project-contract.md#sources-and-authority).
**Related documents:** [Architecture](../architecture/sdd.md), [UX/UI](../UX-UI.md), [feature contracts](../features/). The design documents also cover future scope; describing it does not confirm an implementation.

---

## 1. Product goal

NeKode is a desktop **agent-first coding workspace** for Windows 11. The app is a control center for working with autonomous coding agents that run in a terminal (for example Codex CLI, Claude Code, OpenCode, agy, Gemini CLI).

In the MVP, agents are treated as standard terminal processes (PTY), without implementing dedicated protocols (ACP/MCP).

The central concept of the MVP is the **Chat**: a terminal session assigned to a project and shown in the tree on the left (PROJECT → CHATS). The chat carries its work context: the working directory (workspace) and the Git state. A separate entity (post-MVP) is the **Task**: a unit of work with a progress record, pinned to a chat; its progress tracking is meant to be independent of any specific harness.

---

## 2. MVP functional requirements

1. **Project management:**
   - Registering local software projects.
   - Switching the active project in the sidebar.
   - Reading the project context: path, detected runtimes, Git branch state and worktree status.

2. **Chat management (Chats):**
   - A tree in the left panel: PROJECT → CHATS (chats shown under projects).
   - Creating a new chat without a name form (the name is the terminal or shell name, for example "PowerShell"; names may repeat) and switching between chats while keeping the state of the work session.
   - Closing a chat together with closing its terminal (`exit`, `Ctrl+D`): the chat disappears from the tree and the app moves to the next chat in the project (when no chats are left, an empty state with a "Start new chat" button).

3. **Terminal sessions (PTY):**
   - Running agents and CLI tools in native terminal processes (node-pty) in the main process.
   - Rendering the terminal in the main view with xterm.js (one main terminal per chat).
   - Keeping active terminal sessions while the app runs when switching chats; after an app restart the chat tree returns to its state before the restart (as in Zed), and terminals start fresh when a chat is opened.
   - An auxiliary bottom terminal panel (able to open several terminals/tabs), delivered as a separate task.

4. **Browsing project files:**
   - A project file tree in the left panel with collapsible and expandable directories.
   - Read-only file content preview using the Monaco Editor component. A Markdown file (`md`, `markdown`) has a `Code` | `Preview` toggle in the action bar (user decision 2026-10-06): `Preview` is the default and renders the same text as Markdown, `Code` shows Monaco. The choice is remembered per file for the app session and is not saved.

5. **Project action bar (Action Bar):**
   - The action bar in the center column, directly under the tab bar (user decision 2026-09-26): fixed groups `Handoff | Resume` and `Stop | Continue`, followed by configurable buttons that run defined project commands (for example dev server, tests, build, verification).
   - `Stop` sends Ctrl+C, and `Continue` sends text and CR, through `terminals:write`. `Handoff` and `Resume` paste their string into the console without submitting by default; with auto-send on, they send the string and one CR. The flow is owned by [handoff-resume-flow](../features/handoff-resume-flow/spec.md).
   - Running commands in `background` or `new-terminal` mode (a new chat with the command); the `bottom-terminal` mode (a new bottom panel tab with the command) follows the `docs/features/bottom-auxiliary-terminal/spec.md` contract once the bottom terminal panel is delivered (requirement 3).

6. **Data persistence:**
   - Saving the configuration of projects, chats, history and layout state in a local SQLite database (`better-sqlite3`).

7. **User interface:**
   - An ergonomic dark interface that follows the [`UX-UI.md`](../UX-UI.md) specification.
   - Scalable and resizable work panels.
   - Center column: a tab bar at the top (the active chat tab, which cannot be closed; tabs of open files; `+ New chat`), the action bar under it (see 5), and the main surface below.
   - A status bar at the very bottom of the window (full width) with the project context: name, path, detected runtimes, and Git branch and status.
   - The interface is entirely in English; fixed action bar button strings (for example `Write a handoff`) are literal data and are not translated. Handoff and Resume paste their string into the console without submitting or, with auto-send on, send it with CR. This flow is owned by [handoff-resume-flow](../features/handoff-resume-flow/spec.md).

---

## 3. Out of MVP scope (Explicit Non-Goals)

- No direct editing of source code in the app (code is changed by agents or an external editor).
- No implementation of ACP (Agent Client Protocol) or MCP (Model Context Protocol).
- No direct LLM API requests from the app.
- No LSP (Language Server Protocol) engine and no IntelliSense.
- No automatic creation or management of Git worktrees per task.
- No cloud sync and no user accounts (data is stored only locally).
- Post-MVP: the **Task** entity, a unit of work pinned to a chat, with a panel for recording work progress (the `.agents/tasks/*/task.md` records from project-template can serve as a pattern, but the app must not depend on a specific harness).
- Post-MVP: work handoff snapshots linked to tasks.
- Post-MVP: manual chat renaming (the `name` field in the database is prepared). New chats are named `[shell] profile name`, and without a profile just `[shell]`. The prefix is the shell abbreviation: `PS5`, `PS7`, `cmd`, `bash`, `WSL`, and for a custom shell the file name. The shell comes from the project configuration at the moment the chat is created; the full label (`PowerShell 7`, `WSL: Ubuntu-24.04`) stays in Project Settings and on the bottom terminal tab. Existing chats keep their saved names.
- Delivered (user decisions 2026-10-11 and 2026-10-12): a **Kanban** board as a view of external tasks (Plane backend through a plugin adapter), with the Start, Resume and New task actions and an item overview. Contract: [kanban-adapter-interface](../features/kanban-adapter-interface/spec.md). The delivery does not include a local Task entity.
- Post-MVP: a **Kanban** board linked to the local **Task** entity (a task pinned to a chat with a progress panel), following the previous point on the Task entity (earlier planned as an illustrative preview in the MVP, moved out of the MVP to rethink the model together with tasks).
