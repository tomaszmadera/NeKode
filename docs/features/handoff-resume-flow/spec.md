# Handoff/Resume flow: remembered Add Project path, auto-send, project configuration, handoff list

This file is the behavioral contract for a feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

## Goal

Make the Handoff/Resume action row and the Add Project dialog less lossy for an English-speaking agent workflow: the Add Project dialog reopens at the previously selected directory, Handoff/Resume paste English commands into the dedicated prompt input (with an opt-in auto-send), and Resume offers a lazily loaded list of handoff files from a per-project configured directory managed in a project configuration view.

## Related requirements

User change list 2026-10-01 (task `.agents/tasks/handoff-resume-flow/task.md`):

1. Add Project resumes from the previously selected path.
2. Configuration gains auto-send after Handoff / Resume.
3. Resume gets a lazy-loaded handoff list; it requires a handoff directory setting in a project configuration view.
4. Commands pasted by Handoff / Resume must be English.
5. Handoff / Resume paste into the dedicated prompt input.

## Scope

- Main process: `projects:add` dialog `defaultPath` plus persistence of the confirmed directory; new typed IPC `handoffs:list(projectId)`; new typed IPC `dialogs:pickDirectory(defaultPath)`; cleanup of the per-project handoff-directory key on `projects:remove`.
- Shared: IPC contract additions (`handoffs`, `dialogs` namespaces, `HandoffEntry`), new `APP_STATE_KEY` entries and the per-project key helper.
- Renderer: ActionBar fixed-action behavior (English commands, input injection or direct send), a Resume handoff picker modal, PromptInput external-injection support threaded through ChatWorkspace/ChatTerminal, and a Configuration section in the existing Project Settings modal (auto-send toggle, per-project handoff directory with Browse).

## Non-goals

- Reading handoff file content, creating, editing, or deleting handoffs from the UI.
- A default handoff directory convention: an unset setting means unconfigured.
- Changes to Stop (`\x03`) and Continue (`Continue\r`) fixed actions: delivery and wording stay as-is.
- Any change to the projects database schema, ProjectInfo, or chat/terminal flows beyond the ActionBar delivery path.
- Translating the UI (the interface stays English).

## Behaviour

1. Add Project dialog: `projects:add` opens the native directory picker with `defaultPath` set to the stored `projects.lastDirectory` app_state value (missing value: Electron default). When the user confirms a directory, main persists it to `projects.lastDirectory` before adding the project. Cancel changes nothing.
2. Fixed action commands are English: Handoff pastes `Write a handoff`, Resume (plain fallback) pastes `Resume from handoff`. With a handoff selected from the picker, Resume pastes `Resume from handoff <absolute path of the selected file>`.
3. Delivery (auto-send off, the default): the command text is placed into the dedicated prompt input of the active chat terminal and is not sent; the user reviews and submits with Enter or Send. Delivery (auto-send on): the command text plus CR is written directly to the active chat PTY (the pre-0.4.8 behavior, now English).
4. Resume click opens a handoff picker modal. The list is loaded lazily at modal open via `handoffs:list` for the active project: regular files only, sorted by modification time descending, showing file name and modification time. Selecting an entry applies rule 2 and closes the modal.
5. Picker empty states: no active project or chat keeps the Resume button disabled (existing rule). Unconfigured directory: the picker shows a "not configured" state with a Configure button that opens Project Settings for the active project, and a "Paste without path" fallback that applies rule 2 with the plain command. Configured but missing directory or read failure: the picker shows the typed error message.
6. Project Settings modal gains a Configuration section above Actions: an "Auto-send after Handoff/Resume" checkbox (application-level) and, when the modal is bound to a project, a "Handoff directory" input (absolute, or relative to the project root) with a Browse button (`dialogs:pickDirectory`, defaultPath: current value or project root) and Save. Empty input clears the setting. Auto-send is stored under `handoffResume.autoSend` as `'1'`/`'0'`; missing means off.
7. Injection into the prompt input is per active chat: a pending injection addressed to the active chat reaches only that chat's PromptInput, which fills its value and reports consumption. A new click re-injects even with identical text (nonce). Switching chats with a pending injection for a non-active chat drops it.
8. `projects:remove` deletes the removed project's `project.handoffDir:<projectId>` key.

## Business rules

- `handoffResume.autoSend`: `'1'` enables direct send; any other value or absence means paste-only.
- `project.handoffDir:<projectId>`: stored string; a relative path resolves against the registered project root at listing time; an empty stored value means unconfigured.
- `projects.lastDirectory`: absolute directory path of the last confirmed Add Project dialog selection, shared across projects (application-level).
- `handoffs:list` returns only regular files (no directories, no content), each `{ name, modifiedAt }`, `modifiedAt` ISO 8601 UTC, newest first.
- Pasted Resume command uses the resolved absolute path of the selected handoff file.

## Authorization

Renderer invokes stay behind the existing trusted-sender guard. `handoffs:list` rejects unknown project ids (`not_found`). `dialogs:pickDirectory` opens a read-only OS dialog and persists nothing. Filesystem access from `handoffs:list` is a read-only directory listing of the user-configured path; it is not restricted to the project root because the user explicitly configures the directory.

## Data / API

- `APP_STATE_KEY` additions: `projectsLastDirectory: 'projects.lastDirectory'`, `autoSendHandoffResume: 'handoffResume.autoSend'`; helper `projectHandoffDirKey(projectId)` returning `project.handoffDir:<projectId>`.
- `AppApi.handoffs.list(projectId: string): Promise<HandoffEntry[]>` with `HandoffEntry { name: string; path: string; modifiedAt: string }` (`path`: resolved absolute path, the paste target of Behaviour 2).
- `AppApi.dialogs.pickDirectory(defaultPath: string | null): Promise<string | null>` (null on cancel).
- No SQLite schema or migration: all new persistence uses the existing flat `app_state` key-value store.

## Edge cases

- Stored `projects.lastDirectory` points at a deleted directory: Electron shows its default location; no error.
- Handoff directory contains subdirectories or non-file entries: skipped.
- Handoff file deleted between listing and selection: the paste still names the path; the agent reports the missing file (no renderer file revalidation).
- PromptInput already holds text: injection replaces the whole draft value.
- Chat exits while the picker is open: selecting an entry is a no-op when the chat is no longer live (same guard as the current `sendFixed`).
- Empty configured directory: the picker shows an empty list state (no fallback prompt beyond rule 5's unconfigured state).

## Errors

- `handoffs:list` with an unknown project id: `not_found`.
- `handoffs:list` when the configured path does not exist or is not a directory: `not_found` with a message naming the configured path; the picker renders it as an inline error state, not a toast.
- `dialogs:pickDirectory` and `projects:add` keep the existing typed error transport; a failed state write after a confirmed dialog surfaces the notice but does not roll back the dialog choice's persistence attempt.

## Acceptance criteria

1. After adding a project at some directory, reopening Add Project starts the dialog at that directory.
2. With auto-send off (default), Handoff fills the prompt input with `Write a handoff` and sends nothing; the user submits it.
3. With auto-send on, Handoff writes `Write a handoff\r` straight to the PTY.
4. Resume opens a picker that lists the configured directory's files newest-first, loaded only at open; selecting one fills the prompt input with `Resume from handoff <absolute path>` (or sends it with CR when auto-send is on).
5. Unconfigured project: picker shows the not-configured state with Configure (opens Project Settings) and the plain-paste fallback `Resume from handoff`.
6. Project Settings exposes auto-send and, per project, the handoff directory with Browse; saving persists via app_state and the picker reflects it on next open.
7. All Handoff/Resume pasted command text is English.
8. Removing a project clears its `project.handoffDir` key.

## Required tests

- Main: `projects:add` passes the stored default path and persists the confirmed directory (cancel persists nothing); `handoffs:list` relative-path resolution, newest-first sort, files-only filtering, missing-directory and unknown-project errors; `projects:remove` key cleanup; `dialogs:pickDirectory` null-on-cancel.
- Renderer: Handoff/Resume injection into PromptInput (and PTY write with CR when auto-send is on); picker open triggers one lazy `handoffs:list` call; picker empty states; Configuration section persists both settings; injection replaces an existing draft.

## Relevant SDD / ADR

- `docs/features/mvp-core-shell` (app_state store, projects:add dialog contract)
- Design system: `docs/references/NeKode-Design-System.md` (modal and control language)
