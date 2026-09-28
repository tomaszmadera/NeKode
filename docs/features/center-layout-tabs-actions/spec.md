# Center Layout: Tab Strip, Action Row, and Status Bar

This file is the behavioral contract for a feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

## Goal

Restructure the center column and the window bottom of NeKode per the user's layout decision (2026-09-26): a tab strip at the top of the center column (terminal-chat tab, open-file tabs, `+ New chat`), an action row below the tabs (fixed agent-communication groups plus configurable project actions), and a status bar at the very bottom of the window carrying the project context. The user is a developer on Windows 11 working with CLI agents who wants chat, files, and one-click commands in one workspace column.

## Related requirements

- `docs/product/requirements.md` §2 item 5 (project action bar; placement revised by user decision 2026-09-26 — not window-top, but under the tab strip in the center column), item 6 (persistence: action configuration), item 7 (UI).
- `docs/architecture/SDD.md` §7 (layout — to be revised), §9 (context content — moves to the status bar), §21–§25 (action bar, action definition, execution modes, action status, configuration UI), §34–§35 (persistence: `actions` table), §44 (IPC `actions:*`), §52 (security).
- `docs/UX-UI.md` §5 (global layout — to be revised), §7–§8 (action bar and interaction — placement revised), §14–§16 (context header content and presentation — moves to the status bar), §49 (action configuration), §50 (project file navigation), §65 (responsive context display), §68–§69 (layout examples — to be revised).
- Navigation and file-preview behavior inherited from `docs/features/project-files-view/spec.md` (where not superseded by the tab model here).

## Scope

- Tab strip at the top of the center column: one fixed terminal-chat tab, one tab per open file, and a `+ New chat` control at the right end of the strip.
- Read-only file preview surfaces become tabs (adaptation of the existing Project Files preview: Monaco, line numbers, syntax highlighting, large/binary fallbacks with `Open externally`).
- Action row below the tab strip: fixed groups `Handoff | Resume` and `Stop | Continue`, then configurable actions.
- Configurable actions: definition model, SQLite persistence, basic configuration UI (list + add/edit form), and execution in `background` or `new-terminal` mode with visible execution state.
- Status bar at the very bottom of the window, full width: active project name, path, detected runtimes, Git branch and worktree status (the current context-header content, relocated).
- Removal of the center context header and of any window-top action band.
- Documentation revision (deliverable of this feature): `docs/architecture/SDD.md` §7/§9/§21, `docs/UX-UI.md` §5/§7/§8/§14/§49/§50/§65/§68/§69, `docs/product/requirements.md` §2.5/§2.7 wording, and `docs/features/project-files-view/spec.md` sections superseded by the tab model.

## Non-goals

- Bottom auxiliary terminal and the `bottom-terminal` run mode (separate task, requirement 3); the action form offers only `background` and `new-terminal` in this feature. Once the bottom auxiliary terminal panel ships, the mode is offered and its execution contract lives in `docs/features/bottom-auxiliary-terminal/spec.md`.
- The rich Handoff feature from `docs/UX-UI.md` §33–§41 (handoff form, structured handoff records, automatic resume flow, agent resolution). The `Handoff` / `Resume` buttons here are terminal-input shortcuts only.
- Repository-based action configuration (`.agentcode/actions.yaml`, SDD §26) — post-MVP.
- File editing, dirty state, or tab drag-and-drop reordering.
- Persisting open tabs or action execution logs across application restarts (tabs are per-session UI state).
- Multiple terminal tabs, terminal split views, command palette, new keyboard shortcuts.
- Output capture and log viewing for background actions (the error state reports the exit code only).
- Kanban, right-panel tools, icon themes.

## Behaviour

1. The center column is laid out top-down as: tab strip, action row, main surface. There is no window-top action band and no context header above the main surface.
2. The tab strip contains exactly one terminal-chat tab, always first and never closable. Its label is the active chat's name (shell display name, as today). Selecting it shows the terminal surface of the active chat. With no chat in the project it shows the empty state with `Start new chat`.
3. After the terminal-chat tab follow one tab per open file of the active project, in open order. A file tab's label is the file name; its tooltip is the path relative to the project root. Clicking a file in the project file tree opens its tab, or focuses it when already open; opening order is preserved and a file never has two tabs.
4. Each file tab has a close control. Closing the active tab selects the previously active tab; with no other file tab open it selects the terminal-chat tab. No confirmation is required (preview is read-only).
5. Within one app session, each project retains its open file tabs, their order, and the active tab: switching projects shows that project's own tab set. Tabs are not persisted across application restarts.
6. The active tab selects the main surface: the terminal surface (chat sessions stay alive in hidden views across tab switches and mode round-trips) or the file preview. The file preview is read-only Monaco with line numbers and syntax highlighting by extension; the large-file (`> 2 MB`) and binary fallbacks with `Open externally` from `docs/features/project-files-view/spec.md` apply per tab. The breadcrumb and the `Files` view label are superseded by the tab model and are not rendered.
7. A file deleted or renamed while its tab is open shows an error state inside that tab; other tabs and the terminal are unaffected.
8. The `+ New chat` control sits at the right end of the tab strip and is always present. It runs the existing new-chat flow unchanged (immediate creation in the active project, shell display name, chat selected and its terminal shown).
9. The action row sits directly below the tab strip, full width of the center column. Order: the group `Handoff | Resume`, the group `Stop | Continue`, then configurable actions. Buttons are compact per `docs/UX-UI.md` §8.
10. `Handoff` writes the exact text `Napisz handoff` followed by one CR (0x0D) to the active chat's terminal. `Resume` writes `Wznów z handoffu` + CR. `Continue` writes `Continue` + CR. These are literal data strings; they are never localized or altered.
11. `Stop` writes one Ctrl+C (0x03) to the active chat's terminal. It never sends 0x04 (Ctrl+D closes chats under the existing terminal contract).
12. The four fixed buttons are enabled only when the active chat has a live (running) terminal session; otherwise they are disabled.
13. Configurable actions come from the action store: global actions plus the active project's actions, ordered by sort order. The set changes when the active project changes. Clicking an action executes it; an action with the confirmation flag shows a confirmation dialog first.
14. Execution in `background` mode runs the command in the main process with no visible terminal. The button shows state: idle, running, success, failed; hover details show the command, exit code, and completion time. There are no success toasts (UX-UI §8).
15. Execution in `new-terminal` mode creates a new chat in the active project (existing new-chat flow), selects it, and writes the configured command + CR into its terminal; the configured working directory is the terminal's start directory (project root by default).
16. Nothing executes without a user click. Actions are never run at application or project open.
17. Actions are configured in Project Settings → Actions (`docs/UX-UI.md` §49): a list with `Add Action`, and an add/edit form with Title, Icon (optional), Command, Working Directory (project root default), Run In (`Background` | `New terminal`), and an `Ask for confirmation` checkbox. Changes take effect in the action row immediately and survive application restarts.
18. The status bar spans the full window width at the very bottom, below all other regions. When a project is active it shows: project name, path (truncated visually, full on hover), runtime badges (`docs/UX-UI.md` §15, `+N` collapse), Git branch and worktree status (`docs/UX-UI.md` §16 forms, hover details). With no active project the project section is empty; the bar itself stays.
19. The project file tree behavior (Files action, `← Projects`, default exclusions, lazy loading, expansion retention, Remove Project context menu) is unchanged from `docs/features/project-files-view/spec.md`.

## Business rules

- All terminal input from buttons goes through the existing typed IPC (`terminals:write`) — the renderer never touches the OS (SDD §6). Exact bytes: CR is 0x0D; `Stop` is 0x03.
- Action execution is explicit user-triggered trusted local automation (SDD §52): no auto-run on open, no scheduled runs, no repository-supplied configuration in this version.
- Actions persist in the SQLite `actions` table (SDD §35 shape: id, project_id nullable for global scope, scope, title, icon, command, cwd, run_mode, confirm, sort_order) added via the existing migration mechanism.
- `run_mode` accepted `background` and `new-terminal` in this version; with the bottom auxiliary terminal panel shipped, `bottom-terminal` is accepted as well and its execution contract lives in `docs/features/bottom-auxiliary-terminal/spec.md`.
- The fixed button prompt strings (`Napisz handoff`, `Wznów z handoffu`, `Continue`) and `Stop` semantics (0x03) are contractual literals, independent of UI language (UI stays English per requirements §2.7).
- Action command output is never rendered as markup; background failures report actionable state (command + exit code) per SDD §50.

## Authorization

None (local single-user application). The project-root boundary for file access and explicit user-triggered action execution are the access boundaries.

## Data / API

Typed IPC channels follow the existing `IPC_CHANNEL` / `AppApi` pattern (`src/shared/ipc-contract.ts`):

- `actions:list() -> ActionControl[]` — global actions plus the active project's actions (or all with scope metadata; the renderer filters per active project).
- `actions:create(input) -> ActionControl`, `actions:update(id, input) -> ActionControl`, `actions:delete(id) -> void`.
- `actions:execute(id) -> void` — runs per the action's run mode; execution state (running / success / failed / exitCode) is exposed to the renderer via a typed state event or query.
- Existing `terminals:write` carries the fixed-button input (text + CR, or 0x03).

`ActionControl` follows SDD §22: `{ id, scope: 'global' | 'project', projectId?, title, icon?, command, cwd?, runMode: 'background' | 'new-terminal' | 'bottom-terminal', confirm?, sortOrder }`. Inputs are validated with the existing IPC validation pattern; invalid input returns a typed `ipc-error`, never raw stack traces. No new OS-facing channels beyond the existing terminal and file channels.

## Edge cases

- No project selected: the status bar's project section is empty; project-scoped actions are hidden (global actions still shown); the tab strip works normally for chats/files of whatever is active.
- No live chat session (no chat, or the session exited/failed): the four fixed buttons are disabled; `+ New chat` remains available.
- Two open files share a file name: tab labels show the file name; tooltips (relative paths) disambiguate.
- Closing the last file tab leaves only the terminal-chat tab; closing a non-active file tab does not change the selection.
- An action whose command is empty or title is empty cannot be saved (form validation error).
- Deleting the configured working directory does not break the app: the action run fails with a failed state and an actionable hover (command + exit code / spawn error).
- Long paths truncate in the status bar and show fully on hover; many runtimes collapse to `+N` (UX-UI §15).
- A project without a Git repository degrades the Git section of the status bar the way the current git service degrades (no branch, neutral status), never an error banner.

## Errors

- A failed background action shows the `failed` button state with hover details (command, exit code); no toast; the user can re-run by clicking again.
- A `terminals:write` failure (session disappeared between enable-check and click) surfaces as a localized notice (existing notice mechanism); buttons disable on the next state refresh.
- A failed `actions:*` IPC call returns a typed `ipc-error` rendered in the settings form or as an inline notice; no silent fallback and no crash.
- The file-tab error state (file deleted) offers the existing `Open externally` attempt only where meaningful and never blocks other tabs.

## Acceptance criteria

1. The center column shows, top-down: tab strip, action row, main surface. The tab strip has the terminal-chat tab first (label = active chat name), file tabs in open order, and `+ New chat` at the right end. No window-top action band and no center context header remain.
2. Selecting the terminal-chat tab shows the active chat's terminal; switching chats via the left tree switches the tab's label and terminal content; sessions and scrollback survive switching to file tabs and back.
3. Clicking a file in the tree opens (or focuses) its tab with a read-only Monaco preview: line numbers, syntax highlighting for a known extension, tooltip with the relative path; large and binary fallbacks with `Open externally` work per tab; no editing affordances exist.
4. File tabs close via their close control; closing the active tab selects the previously active tab (terminal tab as fallback); each project's open tabs, order, and active tab survive project switching within the app session and are gone after restart.
5. The action row shows `Handoff | Resume`, then `Stop | Continue`, then configurable actions in configured order.
6. `Handoff`, `Resume`, `Continue` write exactly `Napisz handoff`, `Wznów z handoffu`, `Continue` each followed by one CR (0x0D) to the active chat's terminal; `Stop` writes exactly one 0x03 and never 0x04; with no live session the four buttons are disabled.
7. Project Settings → Actions lists actions and adds/edits/removes them (Title, Icon, Command, Working Directory, Run In = Background | New terminal, confirmation flag); saved actions survive restart and appear in the action row immediately; project-scoped actions switch with the active project.
8. Clicking a configurable action executes exactly its configured command with no prior auto-run: `background` runs headless with idle/running/success/failed button state and hover details including exit code; `new-terminal` creates and selects a new chat whose terminal receives the command + CR; a confirmation-flagged action asks first.
9. The status bar at the very bottom shows the active project's name, truncated path (full on hover), runtime badges with `+N` collapse, and Git branch + worktree status in the §16 forms with hover details; with no project the project section is empty.
10. The revised documents match the implemented layout: SDD §7/§9/§21, UX-UI §5/§7/§8/§14/§49/§50/§65/§68/§69, requirements §2.5/§2.7, and the superseded parts of the project-files-view spec.
11. Existing flows stay green: chat create/close/exit, chat selection and session survival, Remove Project, and the project file tree behaviors (exclusions, lazy loading, expansion retention).

## Required tests

- Renderer tests (mocked `window.app`): tab strip order and switching; file tab open/focus/close and previously-active fallback; per-project tab retention across project switches; `+ New chat` flow passthrough; fixed buttons writing the exact byte strings (text + 0x0D, `Stop` = 0x03) and disabled states; action row ordering (fixed groups then configurable); settings form validation (empty title/command) and CRUD reflection in the row; background action state transitions; `new-terminal` action creating/selecting a chat and writing command + CR; status bar rendering, truncation and no-git degradation.
- Main-process tests: actions service CRUD and persistence across an open/close cycle (SQLite `actions` table via migrations), background execution lifecycle (exit codes, failure states), confirmation enforcement, working-directory resolution; IPC handler tests for `actions:*` (argument validation and typed errors, same pattern as `ipc-handlers.test.ts`).
- Regression: existing chat selection, chat close/exit, remove-project, and file-preview flows (from `project-files-view` tests, adapted to the tab model) stay green.

## Relevant SDD / ADR

- `docs/architecture/SDD.md` §6, §7, §9, §10, §21, §22, §23, §24, §25, §34, §35, §44, §47, §50, §52.
- `docs/UX-UI.md` §5, §7, §8, §14, §15, §16, §19, §49, §50, §65, §68, §69.
- `none` (no ADR required; the feature follows the typed IPC and SQLite persistence patterns already in force; the layout revision is a product decision recorded in the task record, not an architecture-level change).
