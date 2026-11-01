# File preview window

Status: Delivered (read-only file preview window from the file tree, NEKODE-149).
Path: `docs/features/file-preview-window/spec.md`.

This file is the behavioral contract for the feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

## Goal

Let the user read one project file in its own NeKode window next to the main window, for example a spec or plan that an agent is editing, while the main window keeps its terminals and navigation. The window looks like NeKode (same theme and preview rendering) and shows only the document.

## Related requirements

- NEKODE-149 (user decisions 2026-11-01): the window is read-only, refreshes when the file changes on disk, gets a minimal preload bridge that does not expose the full `window.app` API, focuses an existing window for the same file, and closes with the main window. A later decision the same day adds a `Code` / `Preview` switch for Markdown files.
- `docs/features/project-files-view/spec.md`: file tree context menu (Behaviour 20) and the read-only preview classification (Behaviour 6-7, 10).
- `docs/features/markdown-mermaid-diagrams/spec.md`: Markdown and Mermaid rendering reused by the window.
- `docs/architecture/sdd.md` §6: the renderer owns no OS capabilities and IPC verifies the calling frame.

## Scope

- An `Open in new window` item in the file tree context menu, shown on file rows only.
- A preview window per opened file: a title bar with the file name and the project-relative path, a `Code` / `Preview` switch for Markdown files, the OS window controls, and the existing preview surface (Markdown rendered, other text in read-only Monaco, the too-large and binary fallbacks with `Open externally`).
- Automatic refresh of the shown content when the file changes on disk.
- A minimal preload bridge for preview windows (`window.preview` only) and a main-process preview channel set that serves only the file bound to that window.

## Non-goals

- Editing, saving, or any other write to the file.
- Terminals, chats, the left navigation, the action row, the status bar, tabs, or settings in the preview window.
- Remembering the Markdown `Code` / `Preview` choice after the window closes.
- Opening a directory in a window, or navigating to another file from the window (relative Markdown links are not followed).
- Persisting preview windows, their size, or their position across app restarts.

## Behaviour

1. The file tree context menu on a file row lists, in order: `Open in new window`, `Show in file explorer`, a separator, `Copy relative path`, `Copy absolute path`, a separator, `Delete`. A directory row has no `Open in new window` and keeps the menu of `project-files-view` Behaviour 20.
2. `Open in new window` asks main to open a preview window for the project id and the row's relative path. The main window and its open tabs do not change.
3. Main validates the request with the same containment rules as `files:read` (registered project, relative path inside the project root, no symlink leaving it). A rejected request opens no window and the main window shows a notice.
4. At most one preview window exists per (project id, relative path). Opening a file that already has a window restores it if minimized and focuses it; no second window appears.
5. A new preview window is 900 x 720 pixels, uses the main window's frame style (hidden native title bar with the caption-button overlay, the base background color, the app icon), and its OS title is `<file name> - NeKode`.
6. The window shows a title bar strip with the file name and, muted, the project name and the relative path, and the OS minimize, maximize, and close buttons. The strip is the drag region. For a Markdown file the strip also has the `Code` / `Preview` switch (Behaviour 14); there are no other controls.
7. Below the strip the window shows the preview of the bound file with the same classification as a file tab: a Markdown file renders as Markdown (with Mermaid) or, in `Code` mode, in read-only Monaco, other text renders in read-only Monaco with the mapped language, a file above the preview threshold or a binary file shows the matching fallback with `Open externally`.
8. The window applies the theme currently selected in the main window when it loads, and follows a later theme change made in the main window without reopening.
9. While a preview window is open, main checks the bound file about once per second. When its size or modification time changes, main notifies that window, and the window reads the file again and replaces the shown content. Monaco keeps its scroll position when the new content has enough lines; rendered Markdown keeps its scroll offset when the new document is long enough.
10. When the bound file disappears, the window shows the not-found state of the preview in place of the content and keeps checking. When the file appears again, the window reads it and shows it again.
11. Closing a preview window stops its file checks and removes it from the per-file registry. Closing the main window closes every preview window, and an open still in progress at that moment creates no window. Quitting the app closes them as part of the normal shutdown.
12. Removing the project from NeKode while its preview window is open leaves the window open; its next read fails with the not-found state.
13. A preview window's renderer cannot open new windows and cannot navigate away from the preview document. Safe external links in rendered Markdown open in the OS browser through the same allowlist as the main window.
14. For a Markdown file (`.md` or `.markdown`, same rule as a file tab) the right end of the strip, before the OS caption buttons, shows the same `Code` / `Preview` switch as the main window action row. The switch is not a drag area. The window opens in `Preview`. `Code` shows the file in read-only Monaco with the Markdown language; `Preview` renders it. The choice applies to that window only, survives refreshes from Behaviour 9 and 10, and is not stored: a reopened window starts in `Preview`. A non-Markdown file has no switch.

## Business rules

- A preview window is bound to one (project id, relative path) pair chosen by main at creation. The renderer never sends a project id or path to the preview channels.
- The preview window is read-only: no preview channel writes to the filesystem, the database, or app state.
- The main window's IPC channels reject a preview window as a sender, and the preview channels reject every sender that is not a registered preview window. Main-window broadcasts (terminal output, dictation, task progress, resume sources) are not sent to preview windows.

## Authorization

The user acts locally; there is no account model. The trust rules are:

- Preview channels accept a call only from the main frame of a `webContents` that main created as a preview window and still has in its registry.
- Existing `window.app` channels keep their current trust check (exact trusted renderer document URL, main frame) and also reject every registered preview window by its `webContents` id, so a preview window is rejected even where its URL would pass (the dev-server root accepts any query).
- Session permissions: a registered preview window's main frame gets `clipboard-sanitized-write` only, so `Copy` in the read-only Monaco menu works (user decision 2026-11-01). It gets no `clipboard-read`, microphone, or other permission.

## Data / API

- New main-window channel `files:openInWindow(projectId, relativePath): Promise<void>` on `window.app.files`, validated like `files:read`.
- One preload file serves both window kinds. Main creates preview windows with the `webPreferences.additionalArguments` flag `--nekode-file-preview`; with that flag the preload exposes only `window.preview` and no `window.app`, and without it only `window.app`. The renderer cannot set the flag. A second preload entry was not used: electron-vite 5.0.0 `isolatedEntries` (needed so sandboxed preloads share no chunk) fails in non-TTY builds such as CI.
- `window.preview` in preview windows:
  - `target(): Promise<{ projectName: string; relativePath: string; fileName: string }>`
  - `read(): Promise<FilePreview>` (same `FilePreview` contract as `files:read`)
  - `openExternal(): Promise<void>` (same behaviour as `files:openExternal` for the bound file)
  - `onChanged(listener: () => void): () => void` (subscription to the main change notice; returns an unsubscribe function)
- Channels: `preview:target`, `preview:read`, `preview:openExternal` (invoke) and `preview:changed` (main to preview window send). Errors use the existing `AppError` transport payload.
- The preview document is the renderer `index.html` loaded with the query `?view=file-preview`. The renderer entry renders the preview root instead of the main app when it sees that query.
- Change detection compares `size` and `mtimeMs` from a `stat` of the contained path. It polls instead of using `fs.watch`, so it behaves the same for Windows paths and WSL `\\wsl$` paths and for editors that replace files by rename.
- No persistence. The theme comes from the same `localStorage` key the main window writes; the window listens for the `storage` event.

## Edge cases

- The file is replaced atomically (write to temp, rename): the size or mtime check sees the new file on the next poll.
- The file grows above the preview threshold: the window switches to the too-large fallback.
- The file changes several times within one poll interval: the window shows the latest content after one read.
- A read is in progress when another change notice arrives: the window shows the result of the newest read; an older response never replaces a newer one.
- Two different files of the same project: two independent windows.
- The same relative path in two projects: two windows, keyed by project id.
- The main window reloads in development: preview windows stay open and keep working.

## Errors

- A failed `files:openInWindow` shows a notice in the main window (same notice surface as a failed `Copy relative path`).
- A failed `preview:read` shows the preview error state in the window with the transport message. The window keeps checking and recovers on the next successful read.
- A failed `stat` during polling counts as "file missing" (Behaviour 10). It is not logged on every poll.
- A failed `Open externally` shows an inline notice in the preview window.
- An IPC call from an untrusted sender is rejected with the existing `validation` error.

## Acceptance criteria

1. Right-click on a file row shows `Open in new window` first; right-click on a directory row does not show it.
2. `Open in new window` on `README.md` opens a window with the title `README.md - NeKode`, the file name and relative path in the strip, and rendered Markdown in the current theme. The main window is unchanged.
3. Choosing `Open in new window` again for the same file focuses the existing window and the window count does not grow.
4. Editing the file on disk updates the window within about two seconds without user action.
5. Deleting the file shows the not-found state; restoring it shows the content again.
6. Changing the theme in the main window changes the preview window's theme.
7. Closing the main window closes every preview window.
8. From a preview window, calling any existing `window.app` channel is impossible (no `window.app` object), and an IPC invoke of an existing channel with the preview document as sender is rejected by main.
9. A preview channel invoked by the main window is rejected.
10. A preview window for `README.md` shows `Code` / `Preview` with `Preview` active; `Code` shows the source in read-only Monaco, and an edit on disk keeps the `Code` view. A preview window for a `.ts` file shows no switch.

## Required tests

- Renderer (Vitest): the file-row menu shows `Open in new window` first and calls `files.openInWindow`; the directory-row menu does not show it; a rejected call shows a notice.
- Renderer (Vitest): the preview root renders the strip and the classified preview from a stubbed `window.preview`; a change notice triggers a new read; a stale read never replaces a newer one; a not-found read shows the not-found state and a later successful read replaces it; the `Code` / `Preview` switch is shown only for Markdown, starts in `Preview`, switches between rendered Markdown and Monaco, and keeps the choice across a refresh.
- Main (Vitest): the preview window registry focuses an existing window for the same key, creates distinct windows for distinct keys, removes an entry on close, closes all on main window close, and creates no window for an open in flight during that close.
- Main (Vitest): the preview clipboard permission allows only `clipboard-sanitized-write` from a main frame.
- Main (Vitest): the change poller notifies on size or mtime change, notifies once when the file disappears and again when it returns, and stops on close.
- Main (Vitest): preview channels reject unregistered senders and resolve the bound file only; `files:openInWindow` rejects paths outside the project like `files:read`; the existing sender guard rejects the `?view=file-preview` URL.
- Preload (Vitest): `window.preview` exposes exactly `target`, `read`, `openExternal`, `onChanged`; the bridge selection gives a preview window only `window.preview` and the main window only `window.app`.
- E2E smoke (`electron-e2e`) when the recorded command is available: open a preview window from the tree and see the content.

## Relevant SDD / ADR

- `docs/architecture/sdd.md` §6 (IPC trust and renderer capabilities).
- No new ADR: the change adds a narrower bridge, selected in the existing preload, under the existing IPC trust model.
