# Bottom auxiliary terminal

This file is the behavioral contract for a feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

Path: `docs/features/bottom-auxiliary-terminal/spec.md`.

## Goal

Give the developer a full-width auxiliary terminal panel above the status bar, with several terminal tabs per project, so tests, logs, and scripts can run without interrupting the active chat terminal. The same feature unlocks the `bottom-terminal` action run mode.

## Related requirements

- `docs/product/requirements.md` §2 item 3 (auxiliary bottom terminal panel, including several terminals or tabs) and item 5 (the `bottom-terminal` run mode follows this spec's contract; the panel it requires is delivered here).
- `docs/architecture/sdd.md` §19 (toggle, keep the session while hidden, remember height, vertical resize), §23.2 (bottom-terminal execution), §33 (`bottomPanel.open` and `bottomPanel.height`), §61 (hide does not kill the process).
- `docs/UX-UI.md` §5 (bottom region spans the window, above the status bar), §6 (hidden by default; restore open state and height), §52 (focus on open, restore focus on hide), §53 (`Ctrl + ``).
- User decision 2026-09-27: the panel has multiple terminal tabs. Panel mechanics stay as in SDD §19 and UX-UI. Tab rules are this spec.
- Chat terminal contract to reuse, not redefine: `docs/features/mvp-core-shell/spec.md` Behaviour 5, 6, 8, and 11.
- Action contract to extend: `docs/features/center-layout-tabs-actions/spec.md` Behaviour 15 and 17. Those sentences still reserve `bottom-terminal`. Shipping this feature updates them so they point here instead of forbidding the mode.

## Scope

- Show and hide the existing bottom region with `Ctrl + ``.
- Persist whether the panel is open, and keep using the existing height persistence and limits.
- Per project, for the current application run: create, switch, and close several bottom terminal tabs.
- Run a configured project action in a new bottom tab (`bottom-terminal`).

## Non-goals

- Listing bottom tabs in the left chat tree, or turning them into chats.
- Persisting the tab list, scrollback, or PTY processes across application restarts.
- Manual rename, drag-and-drop reorder, split panes, and a product cap on tab count.
- Sending `Handoff`, `Resume`, `Stop`, or `Continue` to a bottom terminal. Those buttons keep writing only to the active chat.
- Changing saved actions to `bottom-terminal` automatically.
- Detecting when a command typed into a shell has finished, and refreshing Git status because of that. Git status stays on its current path.
- Right panel, Kanban, the Task entity, file editing, and repository action files (`.agentcode/actions.yaml`).
- A new animation system. Terminal text is not animated.

## Behaviour

1. The bottom region spans the full window width, below the left, center, and right regions and above the status bar. The status bar remains the bottom edge of the window.
2. With no saved open state, and on first launch, the panel is hidden. The saved height is the existing bottom-region size: default 220 px, minimum 160 px, maximum 560 px (`region.bottom.height`). A saved open flag (`region.bottom.open`, `1` or `0`) is restored on startup. A missing or invalid open flag means hidden. A missing or out-of-range height falls back to the default, then clamps to the minimum and maximum.
3. `Ctrl + `` toggles the panel. The chord is matched on `event.code === 'Backquote'` with Ctrl and without Shift or Alt, including when focus is in the chat terminal or a bottom terminal, and it is not written to any PTY. While a modal dialog is open (action settings or a confirmation dialog), the chord does nothing.
4. Opening the panel focuses the active bottom tab's terminal for the active project. Hiding the panel does not kill any bottom PTY and does not clear scrollback. Hiding restores focus to the element that had it before the panel was opened, when that element still exists; otherwise focus returns to the center surface.
5. When the panel is hidden and the active project has no bottom tabs, `Ctrl + `` opens the panel and creates one tab. When that project already has tabs, the chord only shows them. When the panel is open, the chord only hides it.
6. Bottom tabs belong to the project that was active when they were created. They are not chats and they do not appear in the left tree. Switching projects shows that project's own tabs and active tab. Tabs of other projects stay alive, with scrollback, while hidden. Tabs are not restored after an application restart: the open flag and height are, the tab list is not. A restored open panel with no tabs shows the empty state.
7. `New terminal` creates a tab immediately, with no naming form. The label is the platform shell display name (for example `PowerShell` on Windows). Duplicate labels in one project are allowed. The identity of a tab is its id. The PTY is the platform shell, cwd is that project's path, and there is at most one PTY per tab.
8. With no active project, the panel can still open and shows an empty state. `New terminal` creates nothing and shows the notice `Select or add a project before starting a terminal.` `Ctrl + `` in that state only toggles visibility and does not create a tab.
9. Each tab has a close control. Closing a tab, or the shell exiting, terminates that tab's PTY, disposes its view, and removes the tab. The next tab in creation order becomes active, or the previous one when the closed tab was last. Closing the last tab leaves the panel open on an empty state with `New terminal`, except when the close came from the `Ctrl+D` shortcut: that hides the panel (NEKODE-19), through the same hide flow as the toggle. It does not change the selected chat.
10. The input contract of a chat terminal applies inside a bottom terminal: `Ctrl+D` at an empty input line outside the alternate buffer closes the tab; on a non-empty line it is `delete-char`; `Ctrl+U` removes the whole input line, including text behind the cursor; both pass through in the alternate buffer. Raw `Ctrl+D` and `Ctrl+U` are not forwarded outside the alternate buffer. There is no "session ended" state.
11. Switching bottom tabs, or hiding the panel, keeps every bottom PTY and its scrollback for the rest of the application run. Quitting the application terminates every bottom PTY and is not a tab-close: it does not remove chats. Removing a project terminates that project's bottom PTYs and drops its tabs.
12. If the project directory is missing when a tab spawns, that tab shows an explicit error state and a retry. There is no silent retry loop. Other tabs and the chat terminals are unchanged.
13. The vertical resize handle changes the panel height while it is open and persists the clamped height when the drag ends, using the existing `region.bottom.height` key. A failed write of the open flag or the height surfaces in the notice banner. It does not revert the in-memory size and it does not hide a failure.
14. `Handoff`, `Resume`, `Stop`, and `Continue` still write only to the active chat terminal, and only under their existing enabled rules.
15. The action form's Run in control offers `Background`, `New terminal`, and `Bottom terminal`. Saved actions keep the mode they already have.
16. `bottom-terminal` execution requires an active project, the same as `new-terminal`. It confirms first when the action asks for confirmation. Cancel does nothing. It opens the panel if hidden, creates a new bottom tab in the active project, does not create or select a chat, focuses that tab, and writes the configured command followed by one CR (0x0D) once that terminal is ready to receive input. The tab's cwd is the action's working directory, or the project path when the action has none.
17. When that working directory does not exist, execution fails with no new tab and no panel change beyond what was already open. The failure is visible on the action (failed state, the missing-directory error). A failed write of the command leaves the new tab in place and shows a notice.
18. A `bottom-terminal` action reports delivery success, with a null exit code, once the tab exists and the command has been accepted for write. It does not wait for or report the shell command's later exit. `background` execution is unchanged.

## Business rules

- A bottom tab belongs to exactly one project. It is not a row in `chats` and it is not shown as a chat.
- Tab label comes from the platform shell at creation, is non-empty, and may repeat within a project.
- One live PTY per bottom tab. Application quit kills all of them. A view unmount from hiding the panel or switching tabs does not kill the PTY.
- `region.bottom.open` stores `1` or `0`. `region.bottom.height` stores the pixel height as a decimal string. Both are `app_state` keys.
- `run_mode` accepts `background`, `new-terminal`, and `bottom-terminal`. Existing stored modes stay as they are. The new mode is added by a new forward migration. The applied migration that created `actions` is not edited.
- Action execution stays explicit and user-triggered. Nothing in this feature runs a command at startup or on project switch.
- Fixed chat prompts and `Stop` (0x03) are unchanged and never target a bottom tab.
- UI labels are English.

## Authorization

none (local single-user application).

## Data / API

No new chat rows. Bottom tabs live in memory for one application run.

`app_state`:

- `region.bottom.open`: `1` or `0`. Absent means hidden.
- `region.bottom.height`: already used. Semantics and limits are Behaviour 2.

`actions.run_mode` gains `bottom-terminal` through a new migration. Existing rows are not rewritten.

Typed IPC:

- `ActionInput.runMode` and validation accept `bottom-terminal` in addition to `background` and `new-terminal`.
- `actions:execute` for `bottom-terminal` returns an `ActionExecution` with `status: 'success'`, `exitCode: null`, and the command to write (`terminalCommand`) plus `terminalCwd`, addressed to the new bottom tab rather than a `chat`. The renderer writes the command only after that tab's terminal is subscribed, through the existing `terminals:write`.
- Bottom tab ids are not chat ids. `terminals:create`, `terminals:write`, `terminals:resize`, `terminals:data`, and `terminals:exit` accept a bottom tab id under the same payload rules as a chat id. Data and exit events for one id never deliver to another.
- The renderer does not spawn processes or touch the filesystem. Panel open flag and height go through `state.get` / `state.set`.

## Edge cases

- No project: toggle still works; create does not (Behaviour 8).
- Hidden panel, project already has tabs: toggle does not create another tab (Behaviour 5).
- Open panel, last tab closed: panel stays open and empty (Behaviour 9). A last tab closed by the `Ctrl+D` shortcut instead hides the panel (Behaviour 9, NEKODE-19).
- Project switch while a bottom command is running: that tab keeps running under its own project and is hidden until that project is active again (Behaviour 6).
- Restart: open flag and height return; tabs and PTY processes do not (Behaviour 6).
- Quit while bottom terminals are running: PTYs die; chats remain (Behaviour 11).
- Confirmation cancelled: no tab, no write, panel unchanged.
- Modal open: `Ctrl + `` does not toggle (Behaviour 3).
- Duplicate shell labels: both tabs remain, distinguished by identity, not by label.
- Spawn failure on one tab: only that tab shows the error (Behaviour 12).

## Errors

- No active project on `New terminal`: notice `Select or add a project before starting a terminal.` No tab is created.
- No active project on `bottom-terminal` execute: the existing validation error `Select a project to open a terminal.` No tab is created.
- Missing working directory: action status `failed`, error includes the directory, no tab is created.
- Spawn failure: error state and retry on that tab. No automatic respawn loop.
- `state.set` rejection for the open flag or height: notice banner, no silent success.
- Command write rejection after the tab exists: notice `Failed to write the action command.` The tab stays.
- SQLite failures use the existing `Database error.` mapping. They are not swallowed.

## Acceptance criteria

1. `Ctrl + `` shows and hides the bottom panel, including when a terminal has focus, and the chord never reaches a PTY. It does nothing while a modal is open.
2. The panel starts hidden. After a restart it restores the open flag and the height. Height stays within 160-560 px, default 220 px.
3. The panel is full width, above the status bar. Hiding it leaves every bottom PTY and its scrollback running.
4. Opening focuses the active bottom terminal. Hiding restores the previous focus when it still exists.
5. A project can have several bottom tabs, created without a name form, labeled with the shell name, duplicates allowed, absent from the left chat tree, and gone after restart.
6. Switching tabs or projects does not kill hidden bottom sessions. Closing a tab or exiting its shell removes only that tab and selects a neighbor, or leaves an empty panel with `New terminal`.
7. With no project, `New terminal` only shows `Select or add a project before starting a terminal.`
8. `Handoff`, `Resume`, `Stop`, and `Continue` still affect only the active chat terminal.
9. The action form can save `Bottom terminal`. Executing it opens the panel, adds a new bottom tab, does not change the selected chat, and writes the command plus CR. Cancel, a missing directory, or no project creates no tab. Previously saved actions keep their mode.
10. A delivered `bottom-terminal` action shows success with a null exit code and does not track the shell command's later exit.

## Required tests

- Renderer: toggle on `event.code === 'Backquote'` with Ctrl does not call `terminals:write`; Shift+Ctrl+Backquote and an open modal do not toggle; hide keeps session state; open focuses the bottom terminal; empty project notice; create, switch, and close tabs; per-project retention inside one run; no tabs restored from a restarted state fixture; close-last shows `New terminal`; close-last via `Ctrl+D` hides the panel (NEKODE-19), `Ctrl+D` with a sibling tab keeps it; fixed chat buttons still write to the chat id.
- Renderer or service: `bottom-terminal` execute opens the panel, creates one bottom tab, does not create a chat, and writes the exact command bytes plus 0x0D after ready. Confirmation cancel and a missing directory create no tab. A mutated CR byte fails the command assertion.
- Main: migration on an empty database and on a database that already has `background` and `new-terminal` rows accepts `bottom-terminal` and leaves old rows unchanged. IPC validation accepts `bottom-terminal` and still rejects an unknown mode.
- Terminal service, fake PTY: a bottom tab id can create, write, resize, and exit without affecting a chat id. Project removal and quit terminate only the PTYs they own. Quit does not remove chats.

## Relevant SDD / ADR

- `docs/architecture/sdd.md` §19, §23.2, §33, §61.
- `docs/UX-UI.md` §5, §6, §52, §53.
- No ADR. The accepted 2026-09-27 decision is owned here: several terminal tabs per project, retained during the current app run and not restored after restart, as defined in Related requirements, Behaviour, and Business rules.
