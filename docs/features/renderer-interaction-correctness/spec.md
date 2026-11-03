# Renderer interaction correctness

Status: Not delivered.
Path: `docs/features/renderer-interaction-correctness/spec.md`.

## Goal

Eliminate silent failures, focus trap regressions, and interaction glitches in the NeKode renderer layer to ensure consistent affordances, error feedback, and keyboard accessibility.

## Related requirements

- Task: NEKODE-137, subtask of NEKODE-128.
- Architecture review: `docs/architecture/architecture-agent-review.md`, section 7.4 (items 1–10) and roadmap package P3 in section 8.
- Existing feature specifications: [center-layout-tabs-actions](../center-layout-tabs-actions/spec.md), [handoff-resume-flow](../handoff-resume-flow/spec.md), [kanban-adapter-interface](../kanban-adapter-interface/spec.md), and [project-home](../project-home/spec.md).

## Scope

1. `useResizableRegion.ts`: drag sizing relative to drag start point (`startSize + delta`), correcting the 28 px status bar offset and float theme offsets.
2. Common hook `useDialogFocusTrap` for modal dialogs and overlay menus; focus trap in `ConfirmDialog`, `HandoffPicker`, context menus, `TaskStartModal`, and `TaskResumeModal`; initial focus on first item in `TerminalContextMenu`.
3. Destructive action confirmation dialogs (`ConfirmDialog`) before deleting actions in `ActionSettings` and global agent profiles in `GlobalAgentProfilesSettings`.
4. Surface silent errors: inline error on failed color save in `ShellTab`, clipboard availability check and notice on copy failure in `TabStrip`, and dedicated `actionError` above the list in `DictationDictionary` without marking `loadFailed`.
5. `ActionBar`: stable polling effect dependencies avoiding interval restart every tick; single icon glyph selection (custom preset icon OR custom emoji OR status fallback, never double icons).
6. Project toggle state (`useChatSelection.ts`): compute next expanded set and chat load triggers inside the functional updater of `setExpandedProjectIds`.
7. `KanbanBoard` & status selectors: option value set to `state.id` for known states; clean up `retainedCreates` and `retainedUpdates` on stale/superseded request branches.
8. Error codes (`src/shared/ipc-error.ts`): normalize error codes in `parseAppErrorPayload` (`validation_error` -> `validation`, `notFound` -> `not_found`).
9. `TaskResumeModal`: `runScan` returns to `'loading'` phase when `result` is null so Refresh from error state displays a loading indicator instead of empty content.

## Non-goals

- Decomposition of `App.tsx` and Zustand domain store extraction (delivered in NEKODE-128).
- Main process service redesign or IPC protocol restructuring.
- Drag-and-drop kanban cards or new visual theme overhauls.

## Behaviour

### 1. Resizable region drag calculations
- Vertical drag (bottom panel): size is calculated as `startSize + (startClientY - currentClientY)`.
- Horizontal drag (left panel): size is calculated as `startSize + (currentClientX - startClientX)`.
- Result is clamped between `minSize` and `maxSize`. Drag does not jump by 28 px upon initial pointer movement.

### 2. Focus trap and dialog accessibility
- Modals (`ConfirmDialog`, `HandoffPicker`, `TaskStartModal`, `TaskResumeModal`) and overlay menus trap keyboard focus: pressing Tab on the last focusable element wraps to the first, and Shift+Tab on the first wraps to the last.
- `TerminalContextMenu` focuses its first menu item upon mount and traps Tab navigation within menu items.
- Focus returns to the previously active element when dialogs unmount.

### 3. Deletion confirmations
- Clicking Delete on a custom action in `ActionSettings` opens a `ConfirmDialog` displaying the action title. Deletion IPC executes only upon user confirmation.
- Clicking Delete on a global agent profile in `GlobalAgentProfilesSettings` opens a `ConfirmDialog` displaying the profile name. Deletion IPC executes only upon user confirmation.

### 4. Error visibility
- In `ShellTab`, failing to persist project color sets `saveError` with the extracted message from `parseAppErrorPayload`.
- In `TabStrip`, context menu copy checks for clipboard availability. Rejections or missing API invoke the notice callback with `'Failed to copy the path.'`.
- In `DictationDictionary`, entry deletion and toggling failures display an inline `actionError` alert above the dictionary table; the table remains rendered and `loadFailed` is only set when initial/refresh list loading fails.

### 5. Action bar stability and icon display
- Polling in `ActionBar` depends on the set of currently running action IDs or a ref rather than the mutating `states` object, preventing interval re-creation on every tick.
- Action button renders exactly one icon glyph: preset Lucide icon if matched, custom emoji if provided, or default status icon. Double glyphs are prevented.

### 6. Project toggle updater
- `handleToggleProject` inspects the previous set inside `setExpandedProjectIds((previous) => ...)` to toggle expansion and triggers chat loading only when expanding.

### 7. Kanban board state and cleanup
- Status selection options in `KanbanCreateTaskForm` and `KanbanItemReview` use `state.id` as their value.
- When a board `load()` request is superseded or stale, its `requestId` is removed from `retainedCreates` and `retainedUpdates`.

### 8. IPC error code normalization
- `parseAppErrorPayload` normalizes `validation_error` to `validation` and `notFound` to `not_found`.
- Existing TypeScript contracts accept both canonical and legacy alias codes.

### 9. Task resume modal refresh
- In `TaskResumeModal`, calling `runScan` when `result === null` transitions `phase` to `'loading'`.

## Acceptance criteria

1. Dragging panel edges moves proportionally with the pointer with no initial 28 px jump.
2. Tab and Shift+Tab cycle within `ConfirmDialog`, `HandoffPicker`, `TerminalContextMenu`, `TaskStartModal`, and `TaskResumeModal`.
3. Deleting an action or global agent profile requires confirmation via `ConfirmDialog`.
4. Color save failure in `ShellTab` shows inline error.
5. Clipboard failure in `TabStrip` shows notice.
6. Dictionary action errors display above the list without hiding entries.
7. `ActionBar` polling interval remains stable during running actions; buttons with emoji do not render duplicate icons.
8. Rapid toggles of projects in left nav maintain consistent expanded state.
9. Kanban status selects bind to `state.id`; superseded loads do not leak retained items.
10. `validation_error` responses map to `code: 'validation'`.
11. `TaskResumeModal` shows loading state when refreshed from error state.
12. All unit and component tests pass, and `pnpm run verify` passes.
