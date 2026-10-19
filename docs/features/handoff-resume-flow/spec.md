# Handoff/Resume flow: remembered Add Project path, auto-send, project configuration, handoff list

Status: Delivered (Handoff and Resume actions, remembered directory, per-project handoff list).
Resume template amendment (NEKODE-83): specification and plan approved on 2026-10-17.
Path: `docs/features/handoff-resume-flow/spec.md`.

This file is the behavioral contract for a feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

## Goal

Make the Handoff/Resume action row and the Add Project dialog less lossy for an English-speaking agent workflow: the Add Project dialog reopens at the previously selected directory, Handoff/Resume paste English commands into the dedicated prompt input (with an opt-in auto-send), and Resume offers a lazily loaded list of handoff files from a per-project configured directory managed in a project configuration view.

## Related requirements

Accepted user decisions 2026-10-01, owned by this public contract:

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
2. Default fixed action commands are English: Handoff pastes `Write a handoff`, Resume (plain fallback) pastes `Resume from handoff`. With a handoff selected from the picker, Resume pastes `Resume from handoff <path of the selected file>`: the path is project-root-relative when the file lies inside the project root, absolute otherwise (the same form the picker displays). The [Resume template amendment](#resume-template-amendment-nekode-83) defines the optional override for Resume with a selected file.
3. Delivery (auto-send off, the default): the command text is placed into the dedicated prompt input of the active chat terminal and is not sent; the user reviews and submits with Enter or Send. Delivery (auto-send on): the command text plus CR is written directly to the active chat PTY (the pre-0.4.8 behavior, now English).
4. Resume click opens a handoff picker modal. The list is loaded lazily at modal open via `handoffs:list` for the active project: regular files only, `README.md` (case-insensitive) excluded, sorted by modification time descending, showing file name, project-root-relative path, and modification time. Selecting an entry applies rule 2 and closes the modal.
5. Picker empty states: no active project or chat keeps the Resume button disabled (existing rule). Unconfigured directory: the picker shows a "not configured" state with a Configure button that opens Project Settings for the active project, and a "Paste without path" fallback that applies rule 2 with the plain command. Configured but missing directory or read failure: the picker shows the typed error message.
6. Project Settings modal gains a Configuration section above Actions: an "Auto-send after Handoff/Resume" checkbox (application-level) and, when the modal is bound to a project, a "Handoff directory" input (relative to the project root, or absolute for directories outside it) with a Browse button (`dialogs:pickDirectory`, defaultPath: current value or project root) and Save. Browse stores the confirmed directory project-root-relative when it lies inside the root, absolute otherwise. Empty input clears the setting. Auto-send is stored under `handoffResume.autoSend` as `'1'`/`'0'`; missing means off.
7. Injection into the prompt input is per active chat: a pending injection addressed to the active chat reaches only that chat's PromptInput, which fills its value and reports consumption. A new click re-injects even with identical text (nonce). Switching chats with a pending injection for a non-active chat drops it.
8. `projects:remove` deletes the removed project's `project.handoffDir:<projectId>` key.

## Business rules

- `handoffResume.autoSend`: `'1'` enables direct send; any other value or absence means paste-only.
- `project.handoffDir:<projectId>`: stored string; the relative form (against the registered project root) is the norm — a relative path resolves against the registered project root at listing time, an absolute path is used as-is (for directories outside the root); an empty stored value means unconfigured.
- `projects.lastDirectory`: absolute directory path of the last confirmed Add Project dialog selection, shared across projects (application-level).
- `handoffs:list` returns only regular files (no directories, no content, no `README.md`), each `{ name, modifiedAt }`, `modifiedAt` ISO 8601 UTC, newest first.
- Pasted Resume command names the selected handoff file project-root-relative when it lies inside the project root, absolute otherwise.
- `HandoffEntry.path` stays the resolved absolute path (the paste target's raw data); the relative form is composed in the picker.

## Authorization

Renderer invokes stay behind the existing trusted-sender guard. `handoffs:list` rejects unknown project ids (`not_found`). `dialogs:pickDirectory` opens a read-only OS dialog and persists nothing. Filesystem access from `handoffs:list` is a read-only directory listing of the user-configured path; it is not restricted to the project root because the user explicitly configures the directory.

## Data / API

- `APP_STATE_KEY` additions: `projectsLastDirectory: 'projects.lastDirectory'`, `autoSendHandoffResume: 'handoffResume.autoSend'`; helper `projectHandoffDirKey(projectId)` returning `project.handoffDir:<projectId>`.
- `AppApi.handoffs.list(projectId: string): Promise<HandoffEntry[]>` with `HandoffEntry { name: string; path: string; modifiedAt: string }` (`path`: resolved absolute path, the raw data from which Behaviour 2 composes the pasted path).
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
4. Resume opens a picker that lists the configured directory's files newest-first (regular files except `README.md`), loaded only at open; selecting one fills the prompt input with `Resume from handoff <project-relative path, or absolute when outside the root>` (or sends it with CR when auto-send is on).
5. Unconfigured project: picker shows the not-configured state with Configure (opens Project Settings) and the plain-paste fallback `Resume from handoff`.
6. Project Settings exposes auto-send and, per project, the handoff directory with Browse; saving persists via app_state and the picker reflects it on next open.
7. Default Handoff/Resume pasted command text is English. A user-authored Resume template retains its own language.
8. Removing a project clears its `project.handoffDir` key.

## Required tests

- Main: `projects:add` passes the stored default path and persists the confirmed directory (cancel persists nothing); `handoffs:list` relative-path resolution, newest-first sort, files-only filtering, README.md exclusion, missing-directory and unknown-project errors; `projects:remove` key cleanup; `dialogs:pickDirectory` null-on-cancel.
- Renderer: Handoff/Resume injection into PromptInput (and PTY write with CR when auto-send is on); picker open triggers one lazy `handoffs:list` call; picker empty states; Resume command and picker rows use the project-relative path; Configuration section persists both settings; Browse stores the project-relative form; injection replaces an existing draft.

## Relevant SDD / ADR

- `docs/features/mvp-core-shell` (app_state store, projects:add dialog contract)
- Design system: `docs/references/NeKode-Design-System.md` (modal and control language)

## Resume template amendment (NEKODE-83)

### Goal and evidence

Allow the local user to edit the Resume prompt in JSON while preserving existing behavior when no override exists. This section owns the template contract for both the action-bar picker and [Kanban Resume](../kanban-adapter-interface/spec.md). It is proposed under NEKODE-83 (internal tracker).

Existing storage uses SQLite: `src/main/index.ts` supplies `<userData>/nekode.db`, `AppStateService` reads and writes `app_state`, and `AgentProfilesService` stores JSON values through that service. Before this amendment, `src/main/services/create-services.ts` had no general JSON settings-file reader; Resume defaults were built in `task-launch-service.ts:buildResumePrompt` and `HandoffPicker.tsx:resumeCommand`. The amendment adds `ResumeTemplateService`, which owns the JSON reader and the action-bar default; `buildResumePrompt` retains the Kanban default.

### Configuration and scope

The optional application-wide file is `<userData>/settings.json`, beside the existing `nekode.db`, resolved using Electron's `app.getPath('userData')` and the existing injected `userDataPath`. The actual `userData` path, including an explicit test override, is authoritative; do not derive it from an environment variable or the current project. The configuration belongs to the local NeKode installation, applies to every project, and is independent of each project's handoff directory. No project-local settings file is introduced.

Example UTF-8 JSON:

```json
{
  "resume": {
    "template": "Resume from {handoffPath}\nFollow the project's instructions."
  }
}
```

The application reads the optional file and never creates or rewrites it. Existing settings stay in SQLite; no migration, JSON editor UI, file watcher, dependency, or general settings import/export is included. Handoff, Continue, Stop, task Start, agent-profile argument substitution, and auto-send keep their existing behavior.

### Reading and formatting

1. The main process owns the reader and formatter. Read the file anew for each Resume with a selected handoff, immediately before composing the prompt. Do not read it at application startup, board refresh, handoff listing, or picker opening. Editing or removing the file affects the next composition without restarting NeKode, including another choice in an already open picker.
2. In Kanban, compose after the existing candidate/stamp validation and before creating a chat or spawning a process. An undelivered spawn retry re-reads settings through the existing preparation path. An already delivered attempt remains idempotent and sends nothing again.
3. In the action-bar picker, request the formatted prompt on selection through typed IPC. Deliver it through the existing paste/auto-send path only after a successful response. Prevent duplicate submissions while pending. A response after the picker closes or its project changes must not deliver text.
   The prompt input preserves multiline templates for review and editing; Enter or Send submits the draft, while Shift+Enter inserts a line break.
4. With a valid override, replace every literal `{handoffPath}` in one pass with the selected display path. Preserve the rest of the template, including whitespace, line breaks, language, dollar signs, and other braces. Do not interpret inserted path contents as more placeholders. There is no shell evaluation or general template engine.
5. Path rules stay unchanged: project-relative inside the project root, absolute outside it. Kanban uses its revalidated candidate path. The picker uses its selected entry path and main resolves its display form against the registered project root. Reading settings never reads the handoff's content or grants new filesystem access through a renderer-supplied path.
6. When the file, `resume`, or `resume.template` is absent, preserve the exact existing default for the calling flow: Kanban `Resume from <path>`, action bar `Resume from handoff <path>`.
7. The action-bar "Paste without path" action remains exactly `Resume from handoff`. It does not read settings or substitute an empty path. Kanban still requires a selected valid handoff.

### Validation, errors, and authorization

- Accept a UTF-8 JSON object, optionally with a UTF-8 BOM, with a maximum file size of 64 KiB. Unknown keys are ignored. If present, `resume` must be an object and `resume.template` must be a nonblank string containing at least one exact `{handoffPath}`. Reject a NUL character in the template. An empty string, `null`, an array, a wrong type, or a missing placeholder is invalid, rather than an absent override.
- Only an absent file (`ENOENT`) or absent configuration fields select defaults. Invalid UTF-8/JSON, oversize data, permission/read errors, and invalid fields produce a typed configuration error naming the settings path and an actionable reason. Do not include file contents or the generated prompt in diagnostics.
- A configuration error blocks that Resume attempt. Kanban creates no chat and spawns no process; the picker displays an inline error, delivers nothing, and lets the user retry after fixing the file. A malformed file does not block startup, Start, handoff listing, or pathless Resume.
- Extend the existing trusted-sender and payload-validation boundary with `AppApi.handoffs.resumePrompt(projectId: string, handoffPath: string): Promise<string>`. Reject unknown projects, malformed arguments, empty/nonabsolute paths, and NUL characters. The path is formatting data only. This operation accepts neither a settings path nor arbitrary file contents and performs no writes or process launch.
- Kanban continues to enforce its stronger handoff identity and stamp checks. The action-bar picker keeps its existing rule that selecting a previously listed file does not revalidate file contents or existence.

### Acceptance and required tests

1. With no settings file or no override, both flows produce their exact previous prompt; pathless Resume stays unchanged.
2. A valid template is used by both flows. All placeholder occurrences are replaced literally for relative and external absolute paths, including spaces, `$`, braces, and Windows separators; multiline text is preserved.
3. Editing, adding, and removing the file affects the next Resume without restart. An open picker reads the latest file on selection. An undelivered Kanban retry re-reads it; a delivered attempt sends nothing again.
4. Invalid JSON/UTF-8, incorrect root or field types, blank/missing-placeholder/NUL templates, oversize data, and non-ENOENT read failures report visible errors with no prompt delivery, chat creation, or spawn. Fixing the file allows retry. Cover BOM handling and ignored unrelated keys.
5. IPC tests prove trusted-sender checks, strict payload validation, unknown-project rejection, and no renderer control over the settings-file path. Renderer tests cover paste, auto-send, pending duplicate selection, stale responses after close/project change, and recoverable inline errors.
6. Existing handoff selection, path formatting, candidate/stamp validation, Start prompts, profile argv substitution, and attempt idempotency retain regression coverage. Configuration tests use temporary directories, never the real user's settings.
7. Update the user-facing settings documentation with the file location, JSON example, reload timing, defaults, and error recovery. Run affected tests and static checks, then independent review and final changed verification.
