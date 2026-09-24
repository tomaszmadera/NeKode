# NeKode MVP Core Shell — first vertical slice

This file is the behavioral contract for a feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

## Goal

Deliver the first vertically functional slice of the NeKode desktop workspace: a user can register a local project, create a task inside it, and work in a live terminal attached to that task. The terminal session survives task switching during the application session. This gives the agent-first workflow its minimum usable loop: pick task → run agent CLI in terminal.

Target user: a developer on Windows 11 running coding-agent CLIs (Codex, Claude Code, OpenCode, agy, Gemini CLI) as plain terminal processes.

## Related requirements

- `docs/product/requirements.md` §2.1 (project management), §2.2 (tasks), §2.3 (PTY sessions), §2.7 (SQLite persistence), §2.8 (dark UI, English).
- `docs/architecture/SDD.md` §3 (MVP scope items 1–4, 8, 12, 13), §5 (service architecture), §6 (renderer must not own OS capabilities), §7 (five-region layout).
- `docs/UX-UI.md` §5 (global layout), §6 (default/restore state), §9–10 (left navigation), §14 (context header), §16 (git branch/worktree status), §17 (task surface = primary terminal).

## Scope

- Five-region application shell (top bar placeholder, left navigation, center context header + main surface, hidden right region, hidden bottom region) with resizable left and bottom regions.
- SQLite persistence (better-sqlite3) in the Electron main process for projects, tasks, and application state.
- Left navigation: project list with expandable task lists; add-project and new-task flows; active selection persisted.
- Task workspace: primary terminal (node-pty in main, xterm.js in renderer) attached to the selected task, running the platform shell (PowerShell) with the project directory as cwd.
- Session preservation: terminals of open tasks keep running with scrollback while another task is selected.
- Center context header: project name, project path, detected primary runtime label, Git branch and dirty/clean worktree status.
- Preload IPC bridge (`window.app.*`) as the only renderer access path to privileged operations.

## Non-goals

- File tree, file preview (Monaco), configurable Action Bar, bottom auxiliary terminal and `Ctrl + `` shortcut, Kanban preview — later tasks.
- Git operations UI, worktree mutation, handoff snapshots, agent selection/protocol work (ACP/MCP), LLM APIs.
- Multi-window support, terminal split panes, multiple terminals per task (exactly one primary terminal per task in this slice).
- Project settings, runtime auto-detection beyond a static label, remote/cloud anything.
- Task status workflow mutation (status field exists, set only by creation; markers later).

## Behaviour

1. On first launch (empty database) the app shows the default state: left shows an empty Projects list with an Add Project affordance, center shows a Welcome/empty state, right and bottom regions hidden (UX-UI §6).
2. Add Project: user picks a directory via the native dialog; the app stores absolute path and derives the project name from the folder name. Selecting it makes it the active project.
3. New Task: user enters a task name; the task is created under the active project and becomes the selected task.
4. Selecting a task opens the Task workspace in the center surface: context header on top, primary terminal filling the rest (UX-UI §17).
5. The first terminal render for a task spawns exactly one PTY process: the user's default shell (PowerShell on Windows), cwd = project path. The renderer may write to it and resize it.
6. Switching to another task hides the previous task's terminal view but does NOT kill or reset its PTY process or scrollback; switching back shows the live session continuing.
7. Selecting a different project keeps its tasks' terminals alive under the same preservation rule.
8. Closing the application terminates all PTY processes (no cross-session terminal resurrection in this slice).
9. Context header for the selected project shows: project name, absolute path, a runtime label (static, from project record), Git branch name and worktree status (clean/dirty), read via IPC from the main process (`git` CLI, read-only).
10. On startup the app restores: last selected project, last selected task, left panel width, active center surface (UX-UI §6). Terminals are re-created lazily on first show of each task (fresh process, no scrollback restore).
11. Renderer never touches Node/fs/child_process APIs; all privileged work goes through the narrowly typed `window.app.*` preload bridge (SDD §6).

## Business rules

- A project path must be an existing absolute directory; the same path cannot be registered twice (unique constraint).
- A task belongs to exactly one project; deleting a project deletes its tasks and their state rows (cascade).
- Task name must be non-empty after trimming; duplicates within one project are rejected.
- One PTY process maximum per task at a time; a task with no project directory on disk (moved/deleted) cannot spawn a terminal and shows an explicit error state instead.
- Application state is a flat key–value store; selection keys are written on every selection change.

## Authorization

none (local desktop application, single user).

## Data / API

SQLite database at Electron `userData/nekode.db` (better-sqlite3, WAL mode).

- `projects(id TEXT pk, name TEXT not_null, path TEXT not_null unique, runtime_label TEXT, created_at TEXT)`
- `tasks(id TEXT pk, project_id TEXT not_null references projects on delete cascade, name TEXT not_null, status TEXT not_null default 'idle', created_at TEXT)` with `unique(project_id, name)`
- `app_state(key TEXT pk, value TEXT not_null)`

Preload bridge (typed, the full public contract of this slice):

- `window.app.projects.list() / add() / remove(id)`
- `window.app.tasks.list(projectId) / create(projectId, name)`
- `window.app.state.get(key) / set(key, value)`
- `window.app.terminals.create(taskId, cwd) / write(taskId, data) / resize(taskId, cols, rows) / onData(taskId, cb) / onExit(taskId, cb)`
- `window.app.git.getStatus(projectPath)` → `{ branch, dirty }` (read-only)

IDs are generated in the main process (UUID v4). All IPC channels are validated (type + existence) in the main process before touching services.

## Edge cases

- Project directory deleted/moved after registration: terminal spawn fails with an explicit error surface on the task workspace; project row remains until user removes it.
- Terminal exits on its own (user types `exit`): view shows "session ended" state; selecting the task again spawns a fresh session.
- Very fast task switching: writes targeted at a hidden terminal are still delivered to its PTY; no cross-task data bleed (channel keyed by taskId).
- Empty project name derivation (drive root selected): reject with a validation error.
- App state contains a selection pointing to a removed project/task: fall back to default empty state and clean the stale keys.

## Errors

- IPC validation failures reject with a typed error surfaced to the renderer (no silent fallback).
- SQLite errors bubble as dialog/notification-level errors in the renderer, never crash the main process.
- `git` invocation failure (not a repo, git missing) degrades the header to "no git" instead of failing the workspace.

## Acceptance criteria

1. Fresh start shows the empty default state; after registering a project and creating a task, a PowerShell terminal opens with cwd set to the project path.
2. Typing in the terminal executes commands; resizing the window resize-fits the terminal (fit addon).
3. With two tasks in one project, starting a long-running command (e.g. `pnpm dev`) in task A, switching to task B and back, shows task A's output still streaming with scrollback intact.
4. Restarting the app restores the last selected project/task and left panel width; terminal starts fresh on first show.
5. Registering the same directory twice is rejected with a visible error; removing a project removes its tasks from the navigation and from the database.
6. Context header shows correct branch and dirty/clean status for a git repository, and a degraded "no git" state outside one.
7. `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build` all pass; renderer bundle contains no direct `require('electron')`/Node API usage beyond the preload bridge contract.
8. All UI text is English; dark theme tokens match UX-UI.

## Required tests

- Unit (vitest): persistence services — project/task/state CRUD, unique constraints, cascade delete, stale-state cleanup.
- Unit (vitest): IPC payload validation layer (stubbed services).
- Unit (vitest): git status parsing (fixture outputs: clean, dirty, non-repo).
- Renderer smoke: shell renders five regions and empty state (jsdom or similar; no real PTY in unit tests).
- Manual/verification run: acceptance criteria 1–6 exercised via `pnpm dev` (documented in task record).

## Relevant SDD / ADR

- `docs/architecture/SDD.md` §3, §5, §6, §7 (no ADR register exists in this repo).
