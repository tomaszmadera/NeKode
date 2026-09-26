# Project Files: File Tree and Read-Only Preview

This file is the behavioral contract for the feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

## Goal

Let the user inspect a registered project's files without leaving NeKode: browse the project directory tree in the left panel and read file content in a read-only Monaco preview in the center. The user is a developer on Windows 11 working with CLI agents who needs project context next to the chat terminal.

## Related requirements

- `docs/product/requirements.md` §2 item 4 (project file tree; read-only Monaco preview).
- `docs/architecture/SDD.md` §7 (five-region layout), §12 (file tree), §13 (file preview), §6 (renderer owns no OS capabilities).
- `docs/UX-UI.md` §11 (left navigation modes), §18 (center surface — project), §19 (file tree and file preview), §69 (project files layout example), §73 (preserve spatial memory).
- Navigation decision (user, 2026-09-26): entering Project Files uses an explicit per-project "Files" action; clicking a project row keeps expanding the chat list only; project removal is reachable only from a row context menu.

## Scope

- Left panel "Project Files" mode: file tree of the project root with folder expand/collapse, file selection, `← Projects` back affordance, and a header showing the project name.
- Read-only file preview in the center main surface (Monaco Editor): line numbers, syntax highlighting by extension where supported, scrolling, breadcrumb of the selected file.
- Per-project entry point: a "Files" hover action on the project row in Projects/Chats navigation.
- Project row context menu with the "Remove Project" action (the row-level remove control moves here and disappears from the row).
- Large-file and binary-file fallbacks with an "Open externally" action.
- Default excluded-directory filtering (SDD §12 list).
- Retaining file-tree expansion state and the last selected file per project for the duration of the app session.

## Non-goals

- Editing files of any kind; no save, no dirty state.
- Configurable exclusion patterns (the default list is fixed in this slice; configuration is later).
- The Kanban tab (post-MVP): the project view shows the "Files" label only, no dead tab.
- File operations beyond reading: create, rename, delete, move, drag & drop.
- File search, git status decoration on tree entries, file icon themes.
- Persisting tree expansion or preview selection across application restarts.
- Showing the file tree simultaneously with the Projects/Chats navigation.

## Behaviour

1. In Projects/Chats navigation, each project row shows a "Files" action (visible on hover/focus; tooltip "Show project files"). Clicking it enters Project Files mode for that project. The action is independent of the row's expand/collapse click target.
2. Clicking a project row itself keeps its current meaning: select the project and expand/collapse its chat list. It never opens Project Files.
3. The project row opens a context menu on right-click (and the keyboard context-menu key). The menu contains "Remove Project", which runs the existing removal flow unchanged. The row-level remove control is removed; no visible row button performs removal.
4. Entering Project Files mode replaces the left panel content with the project file tree: a `← Projects` back affordance, the project name, then the tree of the project root. The center shows the project context header (unchanged), a "Files" view label, and the main surface. Mode entry per project is idempotent.
5. The tree lists directories and files under the project root, directories first, then files, case-insensitive alphabetical order. Entries matching the default exclusions (`.git`, `node_modules`, `vendor`, `.idea`, `.vscode`, `dist`, `build`, `coverage` — matched as directory names at any depth) are absent. Dotfiles are shown (only the exclusion list filters).
6. Expanding a folder loads its children lazily (one directory read per expansion). Collapsing and re-expanding a folder keeps its children and nested expansion state for the session.
7. Clicking a file selects it and opens the preview in the center main surface with a breadcrumb of its path relative to the project root (e.g. `app / Services / Billing.php`). The preview is read-only Monaco with line numbers and syntax highlighting derived from the file extension where supported (plain text otherwise).
8. There are no editing affordances in the preview: no cursor editing, no save controls. Monaco is mounted read-only.
9. Before any file is selected (on mode entry) the main surface shows an empty state ("Select a file to preview"); the tree remains interactive.
10. A text file larger than the preview threshold (2 MB) shows the fallback "This file is too large for preview." with an "Open externally" action. A binary file (NUL byte in the first 8 KB, or bytes not decodable as UTF-8) shows "Binary file" with "Open externally". A file exactly at the threshold previews normally.
11. "Open externally" asks the OS to open the file with its default application. It is the only OS-facing action in this feature and runs in the main process.
12. `← Projects` exits the mode: the left panel returns to Projects/Chats navigation, and the center returns to the surface that was active before entry (the selected chat's terminal, or the Welcome/Start-new-chat surface). Terminal sessions keep running while the user is in Project Files mode; typing resumes in the same session after the round-trip.
13. Selecting a chat from Projects/Chats navigation (after exiting the mode) shows that chat's terminal as today. The chat tree and its close/exit flows are unchanged by this feature.
14. Within one app session, each project retains its file-tree expansion state and last selected file: leaving and re-entering the mode restores them. The tree state is not persisted to the database.
15. While the mode is open for project P, the file tree shows P's files only; entering the mode for another project (via that project's "Files" action after `← Projects`) shows that project's tree with its own retained state.

## Business rules

- All file access is read-only. The renderer never touches the filesystem directly; every listing and read goes through typed IPC served in the main process (SDD §6).
- Path containment: every request is resolved against the registered project root, and any resolved path outside that root is rejected (including `..` segments and symlinks resolving outside the root). No channel returns content outside project roots.
- Excluded directories are unreachable by direct request as well: `files:list`/`files:read`/`files:openExternal` on a path whose segment matches a default exclusion (case-insensitively) resolves as not-found (a same-named regular file still previews).
- Relative paths carrying `:` (NTFS alternate data streams) resolve as not-found at the file service.
- The exclusion list is a single constant in the main-process file service; renderer receives already-filtered listings.

## Authorization

None (local single-user application). The path-containment rule above is the access boundary.

## Data / API

New typed IPC channels follow the existing `IPC_CHANNEL` / `AppApi` pattern (`src/shared/ipc-contract.ts`):

- `files:list(projectId, relativePath | null) -> FileEntry[]` — one directory level. `FileEntry = { name: string; relativePath: string; kind: 'file' | 'directory' }`.
- `files:read(projectId, relativePath) -> FilePreview` where `FilePreview` is one of:
  - `{ kind: 'text'; content: string; language: string | null }` (language derived from extension),
  - `{ kind: 'too-large'; size: number }`,
  - `{ kind: 'binary' }`.
- `files:openExternal(projectId, relativePath) -> void` — opens via the OS default application.

No write channels. All inputs are validated with the existing IPC validation pattern; invalid input returns a typed error (`ipc-error`), never raw stack traces. Preview threshold (2 MB) and the exclusion list are constants in the main-process file service.

## Edge cases

- Project root missing or unreadable (deleted disk, permissions): the tree area shows an inline error naming the problem; the rest of the app keeps working; `← Projects` still exits the mode.
- File deleted or renamed between listing and read: the preview shows an error state for that file; selecting another file works.
- Empty directory: renders as an expandable node with no children; no error.
- Empty file: previews as an empty text document.
- Unicode and spaces in names are displayed and passed through unchanged.
- A file exactly 2 MB previews; 2 MB + 1 byte falls back to too-large.
- Window resize keeps the tree and preview laid out (preview re-fits via Monaco automatic layout).

## Errors

- IPC failures (unreadable directory, missing file, containment rejection, external-open failure) surface as a localized error state: inline in the tree or preview area where the failure occurred, or a notice for `Open externally` failure. No silent fallback; no crash; the user can always leave the mode via `← Projects`.
- Containment rejections are indistinguishable from "not found" to the caller (same error), and never leak paths outside the root.

## Acceptance criteria

1. Clicking the "Files" action on a project row enters Project Files mode: the left panel shows `← Projects`, the project name, and the project's file tree; the center shows the "Files" label and the "Select a file to preview" empty state.
2. Clicking a project row still only selects the project and expands/collapses its chat list; with no "Files" click the app never enters Project Files mode. "Remove Project" is reachable only via the row context menu and the row shows no remove button.
3. The tree shows the project's directories/files in the defined order with the default exclusions absent; expanding a folder loads and caches its children.
4. Clicking a text file shows a read-only Monaco preview with line numbers, the breadcrumb, and syntax highlighting for a known extension (e.g. TypeScript); there is no way to edit the content from the UI.
5. A file above the threshold shows the too-large fallback with "Open externally"; a binary file shows the binary fallback with "Open externally"; "Open externally" opens the file with the OS default application.
6. `← Projects` returns to Projects/Chats navigation with the previously active center surface; a terminal session that was live before entering the mode is still live after exiting (output produced in the meantime appears).
7. A `files:list`/`files:read` request whose path resolves outside the project root fails with the not-found error and returns no content.
8. With the project directory removed on disk, the mode still opens and shows the inline error state; `← Projects` works.
9. Re-entering Project Files mode for the same project within one session restores folder expansion and the previously selected file preview.

## Required tests

- Main file-service unit tests: listing order and laziness (one read per call), exclusion filtering, dotfiles shown, containment rejection (`..`, absolute paths, symlinks leaving the root), text/binary/too-large classification boundaries (2 MB exact vs over, NUL-byte and invalid-UTF-8 detection), extension→language mapping, unreadable/missing paths.
- IPC handler tests: argument validation and typed errors for all three channels (same pattern as existing `ipc-handlers.test.ts`).
- Renderer tests (mocked `window.app`): "Files" action enters the mode and row click does not; context menu holds Remove Project and the row has no remove button; tree expand/collapse/select; empty state → preview; fallback rendering for too-large and binary; `← Projects` restores the previous center surface; per-project state retention across mode round-trips.
- Regression: existing chat selection, chat close/exit, and remove-project flows stay green (the removal flow itself is unchanged).

## Relevant SDD / ADR

- `docs/architecture/SDD.md` §6, §7, §12, §13.
- `docs/UX-UI.md` §11, §18, §19, §69, §73.
- `none` (no ADR required; the feature adds no architecture-level decision beyond the typed IPC pattern already in force).
