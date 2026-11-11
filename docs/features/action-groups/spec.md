# Action Groups in the Action Row

Path: `docs/features/action-groups/spec.md`.

This file is the behavioral contract for a feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

## Goal

Let a project's configured actions be organized into named groups, where each group occupies one compact control in the action row instead of one button per action. The user is the NeKode developer on Windows 11 who keeps many one-click commands in the action row and wants related ones behind a single element.

Card: NEKODE-174. Accepted user decision (2026-11-11): a per-action group name, rendered as one dropdown control per group; not a group entity and not a collapse-all switch.

## Related requirements

- `docs/product/requirements.md` §2 item 5 (project action bar) and item 6 (action configuration persists).
- `docs/features/center-layout-tabs-actions/spec.md` Behaviour 9, 13, 17 and Data/API (action model, action row, configuration form). This spec extends that contract for grouping; everything else there stays in force.
- `docs/architecture/sdd.md` §22 (action model) and §35 (persistence: `actions` table).

## Scope

- `group` on the action definition: optional, free-text group name, persisted with the action.
- Action row rendering: visible actions that share a group name render as one dropdown control (trigger + menu); ungrouped actions keep their own button.
- Configuration: a `Group` field in Project Settings → Actions (add/edit form) and the group shown in the action list.
- Migration of the `actions` table for the new nullable column; existing rows stay ungrouped.
- Contract and documentation updates: the action input schema, the action model in SDD §22 and the table sketch in SDD §35, and the pointer in the center-layout spec.

## Non-goals

- A separate group entity: no group table, no per-group icon, no group settings page, no independent group ordering.
- Bulk rename or bulk move of a group's members; drag-and-drop ordering of actions or groups.
- Group-level confirmation, run mode, working directory, or command: those stay per action.
- Collapsing the fixed `Handoff | Resume` and `Stop | Continue` groups, the `New session` button, or the Kanban toolbar controls.
- New IPC channels; repository-supplied action configuration; new keyboard shortcuts.
- An explicit ordering field for groups beyond the existing per-action sort order.

## Behaviour

1. An action carries an optional group name: free text, trimmed, at most 60 characters. An empty or whitespace-only name means no group.
2. Group names are matched exactly after trimming; letter case is significant. `Build` and `build` are two groups.
3. Group membership is independent of scope: a global and a project action with the same group name appear under one control when both are visible in the active project.
4. The action row computes its entries from the visible actions (global plus the active project's), ordered by sort order, then title, then id. Every visible action that shares a group name joins one group entry anchored at the position of the group's first member; members need not be adjacent in the configured order.
5. A group with two or more visible members renders as one control: a trigger button labeled with the group name and a chevron. The members' own buttons are not rendered separately.
6. A group with exactly one visible member renders that member's normal action button, without a trigger. A group with no visible member renders nothing.
7. Clicking the trigger opens a menu anchored under it, listing the group's members in sort order, then title, then id. Each item shows the member's icon (preset glyph, custom emoji, or the generic status glyph when none is set) and its title, and carries that action's run state: a running member is disabled and shows the running glyph; a failed member uses the error color. The menu closes on Escape, on a click outside it, on selecting an item, and when the group stops existing (project switch, deletion, or regroup while open).
8. Selecting a menu item executes that action through the existing execution path, with no change: the same confirmation prompt when `confirm` is set, the same execute lock, the same `actions:execute` call, the same status polling, and the same delivery to a new terminal or the bottom terminal. The menu closes before execution starts; a cancelled confirmation runs nothing.
9. Run states stay per action and independent. The trigger takes the active (running) style while at least one member is running; a failed member is not marked on the trigger.
10. Each menu item keeps the copy-command context menu: right click, the ContextMenu key, or Shift+F10 opens it for that action and closes the group menu. Items outside a group keep their existing button and context menu unchanged.
11. The action row in Kanban mode groups the same way: the Kanban controls keep their place, and grouped actions render on the right like any other tab.
12. Project Settings → Actions adds a `Group` field (optional text) to the add/edit form, offering the current group names as suggestions while still accepting a new name. The saved value appears in the action list row after the run mode and scope, and the action row reflects it immediately after the existing refresh.
13. Clearing the field removes the action from its group. Deleting or moving the last member removes the group; no group state survives its members.
14. Persistence: the group is stored on the action row in the SQLite `actions` table. Existing rows keep no group and render as individual buttons.

## Business rules

- Grouping is presentation only. It never changes the command, working directory, run mode, confirmation flag, scope, or sort order of any action, and the main process never filters or reorders actions by group.
- The group value is persisted per action and validated with the existing IPC validation pattern; the renderer derives every group control from the `actions:list` result and holds no separate group state.
- The fixed command strings and byte semantics of `Handoff`, `Resume`, `Stop`, and `Continue` (`docs/features/handoff-resume-flow/spec.md`, center-layout spec Behaviour 10 and 11) are unaffected.
- Actions are never executed at application or project open, grouped or not.

## Authorization

None (local single-user application). Explicit user-triggered execution remains the access boundary for action commands.

## Data / API

- `ActionInput` gains one key, `group: string | null` (nullable, trimmed, at most 60 characters). `actions:create` and `actions:update` require the exact key set, so every caller passes `group`, using `null` for an ungrouped action.
- `ActionControl` extends `ActionInput` and therefore carries `group`. `actions:list` returns it for every row.
- No new IPC channel, no change to `actions:execute`, `actions:status`, or `actions:delete` signatures.
- Migration 9 adds the column with no data rewrite:
  `ALTER TABLE actions ADD COLUMN group_name TEXT CHECK (group_name IS NULL OR length(trim(group_name)) > 0);`
- The service normalizes `group`: trimmed, and an empty result becomes `null`, for create, update, and every read path.

## Edge cases

- A group whose members span both scopes keeps one control; switching to a project where only the global member is visible turns the group into that single button.
- Group names that differ only in surrounding whitespace are one group; names that differ in case are not.
- Two actions with the same title in one group stay distinguishable by their commands in the menu.
- A long group menu is capped to the viewport height and scrolls; its position is clamped inside the window like the existing action context menu.
- An open group menu survives an action status poll (running member becomes disabled in place) and closes when its group disappears.
- A group member that fails keeps its error state inside the menu; the trigger is not marked failed and no toast appears.
- Renaming a group in one action splits the group; the other members keep the old name.
- An action saved with a group in a project that is not active does not create a control until that project is active.

## Errors

- `actions:create` or `actions:update` with a non-string or over-long `group` fails with the typed `ipc-error` from the shared schema; the settings form shows that message and keeps the form open.
- Any other `actions:*` failure keeps its existing behavior (typed error in the form or an inline notice); grouping adds no silent fallback.
- Saving the form with an empty group writes `null`, never an empty string.

## Acceptance criteria

1. Project Settings → Actions offers a `Group` field on the add/edit form, suggests existing group names, saves the value, and shows the group in the action list row.
2. Two actions saved with the group `Build` render in the action row as one control labeled `Build` with a chevron; neither action has its own button.
3. Opening that control lists both actions with their icons and titles, and selecting one executes exactly that action, including its confirmation prompt when the flag is set.
4. A group with one visible action renders that action's normal button, and an action without a group renders its normal button; the two coexist in configured order.
5. While a member runs, its menu item is disabled and shows the running state, and the trigger takes the active style; other members stay executable.
6. Escape, an outside click, selecting an item, and the group disappearing each close the menu.
7. The copy-command context menu still works from a group item (right click, ContextMenu key, Shift+F10) and closes the group menu.
8. A global and a project action sharing a group name render under one control in the active project, and the group degrades to a single button in a project where only one member is visible.
9. The group value survives an application restart and appears in `actions:list`.
10. The database upgrade from schema version 8 keeps every existing action row with no group.
11. Ungrouped behavior is unchanged: existing action row, settings, execution, Kanban mode, and fixed-button contracts stay green.

## Required tests

- Main process: migration 9 upgrades a version-8 database with existing action rows and leaves their group empty; `ActionService` create/update/list round-trips a group, normalizes whitespace to `null`, and returns existing rows with `group: null`; `ipc-validation` accepts a null and a text group and rejects a non-string and an over-long value.
- Renderer `ActionBar`: grouping two actions into one trigger; menu contents and order; executing one member calls `actions:execute` with that id; confirmation cancel runs nothing; running member disabled plus trigger active; failed member colored; singleton group renders a button; ungrouped action unchanged; grouping across scopes; menu close on Escape, outside click, and group disappearance; copy-command menu from a menu item; Kanban mode grouping.
- Renderer `ActionSettings`: the group field saves the typed value and `null` when cleared; the datalist offers existing group names; the list row shows the group.
- Regression: existing action row, action settings, action service, migration, and IPC tests stay green with `group: null` fixtures.

## Relevant SDD / ADR

- `docs/architecture/sdd.md` §22 (action model), §35 (persistence: `actions` table), §44 (IPC `actions:*`), §50 (errors).
- `docs/UX-UI.md` §8 (action bar buttons).
- No new ADR: the feature reuses the typed IPC, exact-schema validation, and SQLite migration patterns already in force.
