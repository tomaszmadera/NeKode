# Workspace layout modes

Status: Delivered.
Path: `docs/features/workspace-layout/spec.md`.

This file is the behavioral contract for workspace layout modes. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

This file is the canonical contract for the two workspace layouts and for where the project file tree lives. The file tree's listing, preview, context menu, refresh, and Git decoration stay in `docs/features/project-files-view/spec.md`. Those documents link here for placement and do not restate this behaviour.

## Goal

Let the user choose a two-panel or three-panel workspace and keep that choice. In the two-panel layout the file tree stays in the left panel, as the application works today. In the three-panel layout the file tree lives only in the right panel, and the left panel stays on projects and sessions. The user is a developer on Windows 11 working with CLI agents.

User decision 2026-11-02 (NEKODE-150). This decision outranks the earlier paragraphs that describe the right panel as hidden future tools and the file tree as only a mode inside the left panel.

User decision 2026-11-03: remove the title-bar layout switcher and use the status-bar right-panel button to select the layout. Opening selects three panels; closing selects two panels and returns the resolved project's tree to the left slot.

## Related requirements

- `docs/product/requirements.md` §2 item 4 (project file tree) and item 7 (resizable panels, status bar).
- `docs/architecture/sdd.md` §7 (primary layout) and §20 (right panel).
- `docs/UX-UI.md` §5, §6, §11, §21, §50, and §78.
- `docs/features/project-files-view/spec.md` (tree behaviour).
- `docs/features/mvp-core-shell/spec.md` (startup restore).
- `docs/features/center-layout-tabs-actions/spec.md` (status bar).
- `docs/features/bottom-auxiliary-terminal/spec.md` (bottom panel; unchanged).

## Scope

- Layout selection through the status-bar right-panel button, with no title-bar layout switcher.
- Two remembered layouts: two-panel and three-panel.
- Two-panel file-tree entry through the existing project-row File tree control, sliding into the left panel.
- A right panel whose only content is the project file tree of the resolved project.
- Status-bar icons that show and hide the left panel, the right panel, and the bottom terminal.
- Remembered right-panel width and remembered open state for the left and right panels.
- Contract amendments that remove the contradicted sentences from the documents named under Contract amendments.

## Non-goals

- Browser, a second terminal, Changes, Git, Context, Documentation, Preview, and Agent Activity as right-panel content (`docs/UX-UI.md` §21).
- A tool switcher inside the right panel.
- Any change to bottom-terminal behaviour: shortcut, height, tabs, processes, or its own open flag.
- The file preview window (`PreviewApp`) and its title bar.
- New file-tree capabilities (editing, search, watchers, or a new context-menu item).
- A schema migration. The new values use the existing `app_state` key-value store through the existing state IPC.

## Behaviour

1. The workspace has one layout mode, `two` or `three`. The status-bar right-panel button selects the layout. Opening the right panel selects `three`; closing it selects `two`. The title bar has no layout switcher. The control adds no second action band.

2. Missing, empty, or any other stored layout value means `two`. The first launch with no saved layout is the two-panel layout. Changing the mode writes the new value immediately. A failed write shows a notice and leaves the in-memory mode in place. A mode change that lands before startup hydration finishes wins over the stored value, using the same touched-before-hydration rule as `region.bottom.open`.

3. Two-panel layout shows the left slot and the center column. It does not render a right slot. The left slot keeps today's projects and sessions view and today's entry into Project Files. The project-row File tree control (the chevron in `LeftNavigation.tsx`, `onOpenProjectFiles`) stays. Its accessible name is `Open file tree of {project name}`. Activating it slides that project's tree into the left slot through the existing `LeftPanelTrack` transition. `Back to Projects` returns the left slot to projects and sessions. If the left slot is hidden, this activation shows it and then slides the tree in.

4. Three-panel layout adds the right slot. The left slot shows only projects and sessions. It never shows the file tree, including when a files view was open at the moment of the switch: the left track returns to projects and sessions. The File tree chevron stays on the project row, keeps the title `File tree`, and is disabled. Its accessible name is `File tree of {project name}`. Activating it does not run `onOpenProjectFiles`, does not change the selected project or session, and does not change the right tree. The right slot has no `Back to Projects` control. It shows the project name and the existing Refresh control above the tree.

5. The three-panel tree shows one project, resolved in this order: the project of the selected session when a session is selected; otherwise the selected project. Clicking the project name or icon keeps the existing selection behaviour (`handleOpenProjectKanban`): another project becomes selected and its session selection clears, and the already selected project keeps its session. The tree follows that result. With no selected project the right slot shows the sentence `Select a project to browse its files.` and requests no listing. Removing a project uses the existing removal flow; the tree follows whatever selection remains.

6. Switching from three-panel to two-panel removes the right slot. When a project was resolved for the right tree, the left slot enters Project Files for that project through the existing left-track transition. That switch is the only way the tree returns to the left panel. When no project was resolved, the left slot stays on projects and sessions.

7. The status bar keeps the project context. At the far right it shows three 20 by 20 buttons, in this order: left panel, right panel, bottom terminal. Each icon is 13 px. The glyphs are `Icon.panelLeft`, `Icon.panelRight`, and `Icon.terminal`. Open uses the terminal toggle's open colors; closed uses its closed colors. Each button exposes `aria-pressed`. The accessible names are `Hide left panel` / `Show left panel`, `Hide right panel` / `Show right panel`, and the existing `Close bottom terminal` / `Open bottom terminal`. The terminal button keeps its `Ctrl+`` title. The theme switcher, when shown, sits immediately to the left of this group. The group's first control carries the right alignment the terminal button has today.

8. The left icon shows or hides the left panel in either layout without changing the mode. The right icon is enabled in both layouts. It is pressed only when the mode is `three` and the right open flag is shown. When unpressed, activating it selects `three` and sets the right open flag to `1`. When pressed, activating it selects `two` and sets the flag to `0`, returning the tree to the left as in Behaviour 6. Both values are persisted by that action. Showing the right panel renders the tree for the project resolved at that moment.

9. The right panel width uses the same limits as the left panel: default 280, minimum 220, maximum 480. The resize handle is on the right slot's inner edge. A finished resize writes the width. A missing or invalid width uses the default. A failed write shows the existing panel-width notice and leaves the in-memory width in place. The float theme gives the right slot the same detached margin, radius, and border treatment the left slot has. The non-float theme gives the right slot a left border, matching the left slot's right border.

10. Left and right open flags use the `region.bottom.open` value rule: `1` is shown and `0` is hidden. Any other stored value, including missing, means shown for both panels. The right slot is rendered only when the mode is `three` and its flag is shown, so a first launch still has no right slot. A failed write shows a notice (`Failed to save the left panel.` or `Failed to save the right panel.`) and leaves the in-memory flag in place. A toggle that lands before hydration wins over the stored flag.

11. The bottom terminal's open flag, height, shortcut, tabs, and processes stay on their current contract. Closing the last bottom terminal still follows that contract.

## Business rules

- Left-panel visibility is independent of the layout. The right-panel button changes both layout and right-panel visibility in one action.
- The three-panel left slot and the file tree are on screen together. The two-panel left slot still shows one of those two views at a time.
- Tree listing, preview, refresh, Git decoration, context menu, and path containment stay on the project-files contract. This feature only chooses the slot and the project.
- The renderer persists layout through the existing state IPC. It does not add a channel.

## Authorization

none (local desktop application, single user).

## Data / API

New `app_state` keys, added to `APP_STATE_KEY`:

| Key | Stored value | Missing or other value |
|---|---|---|
| `region.layout` | `two` or `three` | `two` |
| `region.right.width` | decimal pixel string, clamped like `region.left.width` | 280 |
| `region.left.open` | `1` shown, `0` hidden | shown |
| `region.right.open` | `1` shown, `0` hidden | shown |

No new IPC channel. No SQLite migration. The existing `region.left.width`, `region.bottom.height`, and `region.bottom.open` keys keep their current meaning.

Startup hydration reads the new keys with the existing region reads. Cleanup of selection keys is unchanged.

## Edge cases

- Stored layout `three` with right open `0` remains supported: no right slot, left slot on projects and sessions, right button unpressed. Activating that button opens the right panel.
- Stored layout `two` with right open `1`: two-panel mode, no right slot, right button unpressed. Activating it selects `three` and shows the right panel.
- Two-panel with the left slot already in Project Files, then switch to three-panel: the left slot leaves Project Files. The right tree uses Behaviour 5, which can be a different project from the one the left slot was showing.
- Three-panel with the right slot hidden from an older saved state: one right-button activation opens it; another closes it and returns the tree to the left slot.
- Selected session in project A, then click project B's name: the session selection clears and the tree shows B.
- Click the already selected project's name: the session stays, and the tree stays on that session's project.
- No projects: both layouts show the existing empty projects state. Three-panel right slot shows the empty sentence.
- Float theme and reduced motion: the left track keeps its current reduced-motion snap. The right slot adds no extra animation.

## Errors

- A failed write of the layout, a panel width, or a panel open flag shows one notice and does not revert the in-memory change.
- A failed tree listing uses the existing project-files error states inside whichever slot is showing the tree.
- No silent fallback chooses a layout other than the missing-value rule in Behaviour 2.

## Acceptance criteria

1. The title bar contains no layout switcher. The status-bar right-panel button opens the three-panel layout and closes it back to two panels. A restart restores the last mode and open flag. A database without `region.layout` opens in two-panel mode with that button unpressed and enabled.
2. In two-panel mode the File tree chevron slides that project's tree into the left slot, and `Back to Projects` returns to projects and sessions. No right slot is rendered.
3. In three-panel mode the left slot never shows a file tree. The disabled File tree chevron does not change the view, the selection, or the right tree. The right slot shows the resolved project's tree, including its Refresh control, and has no `Back to Projects` control.
4. With a selected session, the right tree is that session's project. Clicking another project's name selects it, clears the session, and the tree shows the clicked project.
5. Closing the right panel selects two-panel mode and places the resolved project's tree in the left slot.
6. The status bar's far-right controls are the left icon, the right icon, and the terminal icon, each a 20 by 20 button with a 13 px icon. The right icon is enabled in both layouts and its pressed state matches actual right-panel visibility. The left icon preserves the layout mode. The terminal icon still only toggles the bottom panel.
7. Right-panel width survives a restart inside 220 to 480. Left and right open flags survive a restart. Missing open flags leave the left slot shown and, in three-panel mode, the right slot shown.
8. The bottom terminal's shortcut, height, tabs, and open flag behave as before this feature.
9. The contract amendments below are applied, and the amended documents point here instead of restating this behaviour.

## Contract amendments

Apply these in the same change as the behaviour. Replace the contradicted sentence with a pointer to this file. Do not copy these behaviours into the other document.

- `docs/UX-UI.md`: §5 right-panel semantics, §6 default right state, §11 as the two-panel left-slot rule, §21, §50's sentence that entering Project Files transforms the left panel, §78 items 3 and 12, and the interaction map's `RIGHT` line.
- `docs/product/requirements.md` §2 item 4: the file tree is in the left panel in two-panel layout and in the right panel in three-panel layout.
- `docs/architecture/sdd.md` §7 right-panel line and §20.
- `docs/features/project-files-view/spec.md`: placement sentences in Goal, Scope, Non-goals, Behaviour 1, 2, 4, 12, and 15, and acceptance criterion 1. Listing and preview rules stay. The non-goal that forbids showing the tree together with projects applies to the two-panel left slot only.
- `docs/features/mvp-core-shell/spec.md` Behaviour 10: restore also reads the layout mode, the right width, and the left and right open flags.
- `docs/features/center-layout-tabs-actions/spec.md`: the status bar's panel icons are owned here. The project-context contents stay in that contract.
- `docs/features/README.md`: one row for this contract, status matching the status line above.

## Required tests

Renderer tests with a mocked `window.app` bridge:

- No title-bar layout switcher; right-button pressed state, persisted `region.layout` and right open flag, and the missing-value default `two`.
- Two-panel chevron opens the left tree; back returns to projects. Three-panel chevron is disabled and does not open the left tree.
- Three-panel tree project follows the selected session, then the selected project, then the empty sentence.
- Closing the right panel selects `two` and opens that project's tree in the left slot. Reopening selects `three` and shows the resolved project's tree on the right.
- Status-bar order, button size, icon size, enabled right icon in both layouts, and the terminal toggle still writing only `region.bottom.open`.
- Right width clamp and persist. Left and right open flags persist. A toggle before hydration is not overwritten.
- Float theme renders the right slot with the left slot's detached treatment.

A failed state write is covered once for the layout key: the notice is shown and the mode stays.

## Relevant SDD / ADR

- `docs/architecture/sdd.md` §7 and §20, amended as above.
- No new ADR. The 2026-11-02 decision is recorded in this contract.
