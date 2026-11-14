# Handoff/Resume flow: reusable sources, prompts and console delivery

Status: Delivered (reusable Resume sources, prompts, console delivery and task-centric Kanban integration delivered under NEKODE-142).
Resume template amendment (NEKODE-83): specification and plan approved on 2026-10-17.
NEKODE-142 amendment below: specification and three-stage plan approved by the user on 2026-10-29; Stage 3 completed. Legacy handoff directory setting and old handoff matcher decommissioned.
NEKODE-172 amendment below: approved by the user on 2026-11-12; configurable Handoff and Continue instructions with the Resume instruction kept in its single template source.
NEKODE-187 amendment below: proposed 2026-11-14; global Start and Resume instructions, Resume templates become Resume sources without a prompt. It supersedes the NEKODE-142 and NEKODE-172 rules that place the Resume instruction in a template.
Path: `docs/features/handoff-resume-flow/spec.md`.

This file is the behavioral contract for a feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

## Delivered baseline and legacy compatibility

The following baseline sections describe historical behavior superseded by the delivered NEKODE-142 implementation. Their directory configuration, handoff-only picker, pathless fallback and JSON prompt override were temporary compatibility contracts decommissioned in Stage 3. The NEKODE-142 section is the sole final contract for Resume configuration, discovery, selection and prompts. Add Project, Handoff delivery, auto-send, Stop, Continue and addressed-console injection remain current requirements throughout.

### Baseline goal

Make the Handoff/Resume action row and the Add Project dialog less lossy for an English-speaking agent workflow: the Add Project dialog reopens at the previously selected directory, Handoff/Resume paste English commands into the active console without submitting (with an opt-in auto-send), and Resume offers a lazily loaded list of handoff files from a per-project configured directory managed in a project configuration view.

## Related requirements

- [Local task workflow](../local-task-workflow/spec.md): owns the ready `Local progress files` preset and the no-Harness execution-context convention.

Accepted user decisions 2026-10-01, owned by this public contract:

1. Add Project resumes from the previously selected path.
2. Configuration gains auto-send after Handoff / Resume.
3. Resume gets a lazy-loaded handoff list; it requires a handoff directory setting in a project configuration view.
4. Commands pasted by Handoff / Resume must be English.
5. Handoff / Resume paste into the active console without submitting (updated by the user decision on 2026-10-28 to remove the dedicated text field and its display setting).

## Scope

- Main process: `projects:add` dialog `defaultPath` plus persistence of the confirmed directory; new typed IPC `handoffs:list(projectId)`; new typed IPC `dialogs:pickDirectory(defaultPath)`; cleanup of the per-project handoff-directory key on `projects:remove`.
- Shared: IPC contract additions (`handoffs`, `dialogs` namespaces, `HandoffEntry`), new `APP_STATE_KEY` entries and the per-project key helper.
- Renderer: ActionBar fixed-action behavior (English commands, console paste or direct send), a Resume handoff picker modal, PromptActions external-injection support threaded through ChatWorkspace/ChatTerminal, and a Configuration section in the existing Project Settings modal (auto-send toggle, per-project handoff directory with Browse; the directory control was removed by NEKODE-142).

## Non-goals

- Reading handoff file content, creating, editing, or deleting handoffs from the UI.
- A default handoff directory convention: an unset setting means unconfigured.
- Changes to Stop (`\x03`) and Continue (`Continue\r`) fixed actions: delivery and wording stay as-is.
- Any change to the projects database schema, ProjectInfo, or chat/terminal flows beyond the ActionBar delivery path.
- Translating the UI (the interface stays English).

## Behaviour

1. Add Project dialog: `projects:add` opens the native directory picker with `defaultPath` set to the stored `projects.lastDirectory` app_state value (missing value: Electron default). When the user confirms a directory, main persists it to `projects.lastDirectory` before adding the project. Cancel changes nothing.
2. Default fixed action commands are English: Handoff pastes `Write a handoff`, Resume (plain fallback) pastes `Resume from handoff`. With a handoff selected from the picker, Resume pastes `Resume from handoff <path of the selected file>`: the path is project-root-relative when the file lies inside the project root, absolute otherwise (the same form the picker displays). The [Resume template amendment](#resume-template-amendment-nekode-83) defines the optional override for Resume with a selected file.
3. Delivery (auto-send off, the default): the command text is pasted into the active chat console through xterm without an appended CR; the user reviews and submits with Enter or Send. Delivery (auto-send on): the command text plus CR is written directly to the active chat PTY (the pre-0.4.8 behavior, now English).
4. Resume click opens a handoff picker modal. The list is loaded lazily at modal open via `handoffs:list` for the active project: regular files only, `README.md` (case-insensitive) excluded, sorted by modification time descending, showing file name, project-root-relative path, and modification time. Selecting an entry applies rule 2 and closes the modal.
5. Picker empty states: no active project or chat keeps the Resume button disabled (existing rule). Unconfigured directory: the picker shows a "not configured" state with a Configure button that opens Project Settings for the active project, and a "Paste without path" fallback that applies rule 2 with the plain command. Configured but missing directory or read failure: the picker shows the typed error message.
6. Project Settings modal gains a Configuration section above Actions: an "Auto-send after Handoff/Resume" checkbox (application-level) and, when the modal is bound to a project, a "Handoff directory" input (relative to the project root, or absolute for directories outside it) with a Browse button (`dialogs:pickDirectory`, defaultPath: current value or project root) and Save. Browse stores the confirmed directory project-root-relative when it lies inside the root, absolute otherwise. Empty input clears the setting. Superseded by NEKODE-142: the Handoff directory input, its Browse and Save are removed and Project Settings selects a Resume template instead; the auto-send checkbox and its storage stay. Auto-send is stored under `handoffResume.autoSend` as `'1'`/`'0'`; missing means off.
7. Console injection is per active chat: a pending injection reaches only the addressed chat's PromptActions, which pastes into its console once the terminal view is available and reports consumption. A new click pastes again even with identical text (nonce). Switching chats with a pending injection for a non-active chat drops it.
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
- The console already holds text: injection uses xterm paste at its current cursor, as dictation does. There is no separate draft field or replacement buffer.
- Chat exits while the picker is open: selecting an entry is a no-op when the chat is no longer live (same guard as the current `sendFixed`).
- Empty configured directory: the picker shows an empty list state (no fallback prompt beyond rule 5's unconfigured state).

## Errors

- `handoffs:list` with an unknown project id: `not_found`.
- `handoffs:list` when the configured path does not exist or is not a directory: `not_found` with a message naming the configured path; the picker renders it as an inline error state, not a toast.
- `dialogs:pickDirectory` and `projects:add` keep the existing typed error transport; a failed state write after a confirmed dialog surfaces the notice but does not roll back the dialog choice's persistence attempt.

## Acceptance criteria

1. After adding a project at some directory, reopening Add Project starts the dialog at that directory.
2. With auto-send off (default), Handoff pastes `Write a handoff` into the console without appending CR; the user submits it.
3. With auto-send on, Handoff writes `Write a handoff\r` straight to the PTY.
4. Resume opens a picker that lists the configured directory's files newest-first (regular files except `README.md`), loaded only at open; selecting one pastes `Resume from handoff <project-relative path, or absolute when outside the root>` into the console (or sends it with CR when auto-send is on).
5. Unconfigured project: picker shows the not-configured state with Configure (opens Project Settings) and the plain-paste fallback `Resume from handoff`.
6. Project Settings exposes auto-send and, per project, the handoff directory with Browse; saving persists via app_state and the picker reflects it on next open. Superseded by NEKODE-142: the per-project control is a Resume template selector, and no handoff directory field remains.
7. Default Handoff/Resume pasted command text is English. A user-authored Resume template retains its own language.
8. Removing a project clears its `project.handoffDir` key.

## Required tests

- Main: `projects:add` passes the stored default path and persists the confirmed directory (cancel persists nothing); `handoffs:list` relative-path resolution, newest-first sort, files-only filtering, README.md exclusion, missing-directory and unknown-project errors; `projects:remove` key cleanup; `dialogs:pickDirectory` null-on-cancel.
- Renderer: Handoff/Resume injection into the addressed console through PromptActions (and PTY write with CR when auto-send is on); picker open triggers one lazy `handoffs:list` call; picker empty states; Resume command and picker rows use the project-relative path; Configuration section persists auto-send and the per-project Resume template selection (the removed directory Browse has no test); injection is pasted once per nonce.

## Relevant SDD / ADR

- `docs/features/mvp-core-shell` (app_state store, projects:add dialog contract)
- Design system: `docs/references/NeKode-Design-System.md` (modal and control language)

## Resume template amendment (NEKODE-83)

This section applies to legacy consumers until their migration, not to reusable sources. After migration its bounded UTF-8/JSON reader validation remains the contract for explicit import into the editor. Import previews the value and saves only after confirmation; no new source consults settings.json during discovery or prompt composition. The legacy defaults, pathless action and per-click reload rules expire with their owning consumer.

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
   Multiline templates are pasted unchanged into the console without appending CR. Editing and line-break handling belong to the running terminal program; Enter or Send submits its current input.
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

## Reusable Resume sources and prompts (NEKODE-142)

### Authority and scope

This amendment and its three-stage plan were approved by the user on 2026-10-29. It replaces the handoff-directory, file-picker, selected-path formatting and JSON-only prompt configuration rules above, including the conflicting parts of NEKODE-83. Add Project, Stop, Continue, console targeting, nonce consumption and paste/auto-send semantics remain as specified above. The staged transition below governs temporary legacy behavior.

Current user decisions on 2026-10-29: remove the old Handoff directory field and retain its saved values without use; define reusable templates in application settings and select them in projects; configure both file search or discovery and the Resume instruction in the UI; allow arbitrary directories and file names; provide Harness as one ready-made template. Missing or incompatible Harness discovery has a visible install/update error, not a fallback to old handoff files.

The actors are the local user, the main-process source service and the running agent. NeKode discovers and selects continuation context. The agent owns handoff/resume lifecycle, reconciliation and its workflow gates. NeKode does not execute lifecycle mutations while listing or composing prompts.

The approved staged transition first adds template management and Test without changing existing consumers, then switches the action-bar picker and project binding, then switches Kanban. During the middle stage only, the old directory input is labelled Legacy Kanban handoff directory and affects only that old consumer. The completed feature removes it. No new source reads its values.

### Templates and project selection

Application Settings gains a Resume templates section to create, edit, duplicate and delete named templates. The editor exposes the source kind and its fields, the Resume prompt, and Test for a selected project with a preview of candidates or an actionable error. The Test preview shows each candidate identity and display path, the exact instruction produced by substituting that path, and individual rejected files with reasons. A saved template has a stable id. Duplicate creates a new id; names are not identities. Changes persist across restart through existing app_state storage.

Project Settings replaces Handoff directory with a Resume template selector and a route to manage application templates. It shows the selected template's source summary and instruction. Selecting and saving a template opts that project into its configured source. No source is guessed from files, the old directory value or the presence of Harness. A project without a selection shows Configure Resume; configuration is reused by reference rather than copied into each project. An edit invalidates results in every project using that template. An in-use template cannot be deleted until its project bindings are removed or changed; the UI names those projects. Invalid edits do not replace a valid saved template.

Templates contain either a file source or a command source:

- File source: a directory relative to each registered project root or an explicit absolute directory, a file-name wildcard filter (`*` and `?`, no path separators), an explicit recursive-search switch (default off), and candidate identity from either the file stem or immediate parent directory. The same template can therefore select `notes/<id>.txt` or `work/<id>/progress.md`. Arbitrary literal file names and extensions are supported. Relative directories must stay within the project; absolute directories explicitly permit another root. Symlinks and directory junctions are not followed. The source lists matching readable regular files without inferring completion or parsing a Harness schema. The UI describes them as files, not validated unfinished tasks. File candidates sort newest first with path as a stable tie-breaker. The [local task workflow](../local-task-workflow/spec.md) supplies one ready preset for `work/<ref>/progress.md`; selecting it creates and binds nothing.
- Command source: executable and an argument list edited separately, run without a shell in the project root and appropriate project runtime. Stdout is one UTF-8 JSON object with `success: true` and `tasks`, each with unique nonblank `id`, `title`, `path`; optional task status and continuation metadata are validated when present. Paths resolve against the project root and must remain within it after realpath resolution. Unknown optional fields may be ignored; malformed, duplicate or conflicting identities reject the whole response. No renderer-supplied invocation is accepted at list or launch time: main loads the saved template. Listing does not interpret stdout as instructions or execute reported paths.

The Harness preset is a command source invoking `python .agents/scripts/taskctl list --json` in the selected project's runtime. It additionally requires `status`, `current_phase`, `current_step`, `next_action` and boolean `awaiting_resumption` on every row, with unfinished status `active` or `blocked`. Its output is sorted by id. It uses the producer's reported canonical paths and does not reimplement discovery by scanning `.agents/tasks`. It includes archived unfinished records and excludes completed ones. Absence of a handoff wait does not hide a task; a wait does not imply a live or dead process. Missing Python, missing script, unsupported command and invalid producer output show distinct actionable errors. The UI does not install or update Harness.

The preset is available for selection or duplication, not implicitly bound to every project. Custom command sources use the same JSON envelope without requiring Harness-specific metadata. Generic file sources work without Python or Harness. Command sources execute local code configured by the user, like existing adapters; selection and Test make that execution visible.

Decision on 2026-10-30 (NEKODE-145): each project uses one selected template. Its results are task/file contexts, not additional source configurations. The external harness owns the independent `taskctl list --json`, `taskctl handoff <task> --reason <reason>` and `taskctl resume <task>` interface. Discovery returns the canonical identity/path and continuation metadata; the agent performs lifecycle transitions using the same CLI, without depending on NeKode settings or a running NeKode application. NeKode consumes discovery through the configured template and composes its saved prompt. It does not perform lifecycle writes. Resume includes all unfinished tasks, including work interrupted without a handoff; `awaiting_resumption` describes an open handoff wait only.

### Discovery and selection

Resume opens a lazily loaded Resume task picker for the active project and chat. It shows title, identity, display path, and known status/next action for task-aware sources; generic files show file metadata. Distinguish unconfigured source, loading, ready-empty and error. Configure opens the project's template selector. Retry repeats discovery. There is no pathless Resume fallback.

The action-bar picker chooses among tasks/files returned by that single template. Kanban already identifies the task and therefore automatically uses its unique matching context, showing its identity/path as read-only information. Missing or multiple matches block launch, with a visible diagnostic for ambiguity, as defined by the [Kanban modal contract](../kanban-adapter-interface/spec.md#modal-and-launch). Kanban has no source or candidate selector.

Discovery uses the saved source, not the old `project.handoffDir:<projectId>` key. It returns metadata and opaque selection tokens, never file bodies. Selection triggers fresh source validation and verifies the chosen identity, path and content fingerprint before composing a prompt. A changed, moved, completed, missing or unreadable selection requires refresh and delivers nothing. The fingerprint covers the selected file bytes and relevant entry metadata, not unrelated task files. Binding/template revision and request generation are part of the selection token. Invalid or superseded tokens never deliver text.

Source limits are 30 seconds per discovery, 10 MiB stdout for command sources, 1 MiB per selected file, and at most 10,000 visited entries for file traversal. Exceeding a limit is an explicit error, never a silently truncated success. File text must be valid UTF-8. Directory errors are not empty results; individual rejected files have visible reasons while valid file candidates remain available. A command failure rejects the inventory as a whole, matching Harness validation. Cancellation and project removal terminate owned child processes. Local Windows, Linux and Windows-hosted WSL projects preserve their existing runtime boundaries; a WSL source and its prompt paths use that distribution's Linux paths, not UNC paths. NeKode running on Linux does not gain Windows-hosted WSL support.

### Prompt configuration and compatibility

The template editor exposes the Resume instruction. Placeholder `{taskPath}` is the selected display path, relative within the project and absolute for explicitly configured external file roots. `{handoffPath}` remains a deprecated alias to the same value so existing prompt text can be reused. Require a nonblank prompt containing at least one supported path placeholder and no NUL. Replace all supported placeholders in one pass; preserve whitespace, language, line breaks, dollar signs and unknown braces; never expand inserted path contents. This compatibility choice is part of the approved plan.

The Harness preset's default is `Resume task {taskPath}`. Generic templates start with `Resume from {taskPath}` and remain editable. Handoff keeps its existing English instruction `Write a handoff` and delivery semantics; in a Harness project the agent's skill now records canonical task state rather than creating a transfer file. Handoff does not require discovery or start a taskctl process in NeKode.

The UI owns new prompt configuration. Existing `<userData>/settings.json` is neither rewritten nor deleted. Application Settings offers an explicit Import existing Resume template operation using NEKODE-83's bounded UTF-8/JSON validation, showing the prompt before saving it into a selected template. No automatic import, per-click JSON override or silent prompt replacement occurs once the new source is used. Import errors are visible and leave saved templates unchanged. The application does not delete old handoffs or task data. Removing a project may retain the existing cleanup of its obsolete directory key, but discovery never reads it.

### Boundaries and acceptance

Main owns template validation, storage, project resolution, source execution, matching, fingerprints and prompt composition behind strict typed IPC and the trusted-sender guard. Renderer names project ids, template ids and opaque selections, not arbitrary scan/format paths or an executable for an individual request. Test uses a saved template and a registered project. Absolute external file roots must be explicitly configured in that template. Source commands receive no adapter secrets. Set the intended `TASKCTL_ROOT` for the Harness invocation so inherited environment cannot redirect it. Do not log file bodies, prompts or full discovery output.

Required evidence:

1. Create one template, select it in two projects, restart and observe the same saved configuration; edits invalidate both projects and deletion protects active bindings.
2. Select arbitrary file names, custom directories and parent-directory identity without Harness; recursion, exclusion of links, file limits, encoding failures and external-root display paths have behavioral tests.
3. The Harness preset consumes real `taskctl list --json` output, including archived unfinished and interrupted work; duplicates, invalid records, completed entries and incompatible CLI fail visibly without fallback. Custom command output has strict protocol, timeout, output-cap and child-cleanup tests.
4. Both auto-send modes deliver the configured prompt once to the addressed live chat. Selection changes, closing, switching projects or invalidating a template discard late results. Errors deliver no text.
5. Template substitution and explicit legacy JSON import preserve multiline text and literal path data; invalid templates/imports leave saved state unchanged.
6. IPC rejects untrusted senders, malformed payloads, arbitrary selection paths, stale revisions and unknown projects/templates. Temporary fixtures isolate test configuration from the user's real settings.
7. Real Electron smoke proves configuration, picker selection, console paste and direct-send behavior using a local fixture CLI without a model call. User documentation covers template reuse, both source kinds, Harness setup, compatibility and recovery.

The paired [Kanban amendment](../kanban-adapter-interface/spec.md#task-and-file-resume-sources-nekode-142) owns work-item matching and launch. No new Kanban backend entity, automatic lifecycle write, watcher or background polling is introduced.

## Configurable Handoff, Continue and Resume instructions (NEKODE-172)

### Authority and scope

User decision 2026-11-12: Handoff, Resume and Continue instructions are configurable; the current action set stays; Stop stays `Ctrl+C`; no separate "prepare handoff and finish work" action is added. Follow-up user decision 2026-11-12: Handoff and Continue are application-level instructions inherited by every project; Resume keeps its single instruction source in the shared Resume profile (template). No per-project instruction override is stored or offered.

This amendment supersedes the fixed Continue wording in Behaviour 2 and the Non-goals entry "Changes to Stop and Continue fixed actions" only for the Continue text, and the sentence in the NEKODE-142 section that fixes Handoff wording. Handoff delivery, Resume discovery, selection, composition, Kanban launch, addressed-console injection and Stop behavior stay as specified. The fixed command set and toolbar labels stay.

Actors are the local user, the action bar and the running agent. NeKode only sends text. Recording a handoff, updating a task record or a progress file, and closing a card are the agent's acts. Sending a message never proves a handoff exists.

### Inheritance and visible scope

Three levels apply:

- Application settings: the Handoff and Continue instructions, shared by every registered project, plus the existing auto-send setting.
- Shared Resume profile (template): owns discovery, project binding and the single Resume instruction, reused by reference across projects under the NEKODE-142 contract.
- Project: inherits Handoff and Continue and selects one Resume template. It has no instruction override of its own.

Effective content and origin stay visible:

- Application Settings, Instructions lists the registered projects affected by Handoff or Continue edits ("Applies to all projects (N)" plus names).
- Project Settings shows the effective Handoff, Continue and Resume text with its origin (Application settings, or the Resume template name) or the unconfigured Resume state.
- The Resume template editor shows the projects using that template ("Used by: ...") and states that saving applies the edited instruction to all of them. A shared edit never replaces a prompt the user did not edit.

### Instruction configuration

Application Settings gains an Instructions tab. It shows one group per action with its purpose, effective text and send mode:

- Handoff asks the running agent to record transfer context and stop. In an Agent Harness project the agent updates the task record; without Harness the project convention, for example a progress file, carries the context. The application does not claim a saved handoff, completed task or closed card because it sent the text.
- Continue asks the running agent to continue the current conversation. It selects no task and no context file and starts no discovery.
- Resume starts from the context selected by the project's Resume template. The editable control remains the existing template editor; the Instructions tab shows the effective saved instruction and routes there. It is not a second editable Resume prompt.
- Stop is read-only: it sends `Ctrl+C`, is not configurable, creates no task record or handoff and does not close a card.

Handoff and Continue are multiline text areas. Defaults are the current texts: Handoff `Write a handoff`, Continue `Continue`. Missing or blank stored value means the default. A Reset control restores the default.

Saving requires nonblank text after trimming, no NUL and at most 10,000 characters. Handoff and Continue support no placeholders; the stored text is sent exactly as written, preserving line breaks, whitespace, braces, dollar signs and other literal characters. The UI states this.

### Delivery

- Handoff uses the existing addressed prompt delivery: with auto-send off it pastes the effective text into the active chat console without CR; with auto-send on it writes the text and CR to the active chat PTY. One click delivers once. The preview derives its send mode from the same stored setting.
- Continue keeps its direct split write to the active chat PTY (text, then CR after the submit gap) and does not depend on auto-send. It delivers once.
- Both address the chat active at the click and never another chat. Switching chat or project before a pending paste is consumed drops it. Custom text changes neither the target nor the nonce rules.
- Stop remains a direct `\x03` write.

### Compatibility and boundaries

- Existing Resume templates, ids, bindings, prompts, revisions, discovery, fingerprints and Kanban launch behave unchanged. No migration.
- The Resume instruction is never copied into application settings, and no default is substituted into a saved template.
- No per-project override, no inheritance of Handoff or Continue from a Resume template and no new placeholder.
- No new action, automatic lifecycle transition, taskctl invocation or handoff/task-record write by the application.
- Settings stay in the flat app_state store; no SQLite schema, table or migration change.

### Data / API

- `APP_STATE_KEY` additions: `handoffInstruction: 'instructions.handoff'`, `continueInstruction: 'instructions.continue'`. Values are multiline strings; missing or blank means the built-in default; they are written only after validation.
- Shared contract additions: the two default constants, a resolver from stored value to effective text, and the validation rule shared by the settings store and tests.
- `AppApi.resumeSources.usage(templateId: string): Promise<ResumeSourceUsage>` with `ResumeSourceUsage { templateId: string; projects: Array<{ id: string; name: string }> }`. Unknown template is `not_found`; malformed id is `validation`. The call is read-only.
- No signature change to `resumeSources` list, put, duplicate, delete, bind, binding, test, discover, prepare or importLegacy.

### Edge cases

- Stored instruction is blank or whitespace (external edit): the default is used and the editor shows the default.
- Stored instruction contains NUL or exceeds the limit: the default is used and the Instructions tab shows a visible invalid-saved-value message until a valid value is saved.
- Text ends with a line break: stored and sent unchanged; the transport CR is not part of the instruction. The editor does not normalize line breaks.
- Two rapid clicks: each click follows the existing nonce and split-write rules; Continue cancels a pending CR from the previous click, so the second click submits once.
- No registered projects: the affected list says "No projects registered."
- Resume template not used by any project: the editor shows "Not used by any project."
- Project has no Resume template: Project Settings and the Instructions tab show `Not configured` with a route to the editor.
- The chat exits while a Handoff paste is pending: the paste is dropped under the existing rule.

### Errors

- Save with blank, NUL or oversize text: visible validation error, no app_state write, previous effective text remains.
- Settings read or write failure: visible error; delivery keeps the built-in default until a valid value loads.
- Usage query for an unknown template: `not_found`; the editor shows the error and no usage list.
- Invalid Resume template edits keep their existing behavior and never replace valid saved state.

### Acceptance criteria

1. Fresh defaults send `Write a handoff` for Handoff and `Continue` for Continue, keep every existing Resume template prompt and leave Stop as `Ctrl+C`.
2. Multiline custom Handoff and Continue instructions persist across restart with exact text and reach only the chat active at the click.
3. Handoff follows the displayed auto-send mode: paste without CR when off, direct send with CR when on. Continue always submits once and does not depend on auto-send.
4. Application Settings names every registered project affected by a Handoff or Continue change; Project Settings shows each effective text and origin; no project override is created.
5. The Resume instruction is editable only in its template; the Instructions tab and Project Settings show the effective saved text and route to it; the template editor lists the projects using it.
6. A shared edit never silently replaces another saved prompt; Reset restores only the action being reset.
7. The Handoff description says the agent records the context and the app does not claim the handoff; Continue describes the current conversation; no automatic lifecycle transition exists anywhere in the flow.
8. Resume keeps `{taskPath}` as its required placeholder and `{handoffPath}` as its deprecated alias; Handoff and Continue require no selection and perform no substitution.
9. The usage call validates the template id, rejects unknown templates and returns only registered project ids and names.
10. Existing Resume discovery, binding, prompt composition, Kanban launch, auto-send and Stop tests keep passing.

### Required tests

- Shared: default resolution for missing and blank values, handling of invalid stored values, validation of blank/NUL/length, and exact literal preservation of multiline text, braces and dollar signs.
- Renderer settings store: hydrate defaults and custom values, save exact text into the two keys, reset, keep the previous value on failure and report an error.
- Instructions tab: three purpose descriptions plus the read-only Stop note, edit/save/reset, preview text and send mode, affected project list, Resume project selection with bound prompt and unconfigured state, and no second editable Resume prompt.
- Project Settings: effective Handoff, Continue and Resume text with origins and the unconfigured Resume state.
- Template editor: usage line with project names, empty usage, usage error, and the warning that saving affects those projects.
- ActionBar/App: custom Handoff paste with auto-send off, custom Handoff CR send with auto-send on, custom Continue split write once, Stop `\x03` with no instruction delivery, pending Handoff dropped on chat or project switch, no double delivery, and defaults when unset.
- Main: usage call keeps the trusted-sender guard, validates the payload and rejects an unknown template.
- Regression: existing Resume source, template, picker, Kanban launch and auto-send suites.

### Relevant SDD / ADR

- `docs/features/mvp-core-shell` (app_state store)
- The NEKODE-142 section above (Resume profile ownership)
- No new ADR.

## Global Start and Resume instructions (NEKODE-187)

### Authority and scope

User decisions 2026-11-14: the text an action sends to the agent is application-level, and only the continuation source is per project. Start and Resume instructions join Handoff and Continue in Application Settings, Instructions. A Resume template keeps its source and loses its prompt; the library stays shared by reference and is named Resume sources. Migration keeps one common prompt or falls back to the default with a visible list of the previous prompts. No per-project instruction override exists.

This amendment supersedes, for the Resume instruction only, the NEKODE-142 rule that the template editor exposes the instruction and that Project Settings shows the template instruction, and the NEKODE-172 rules that the Resume instruction stays in the template, that the Instructions tab shows it read-only, and "No migration". It also supersedes the fixed Start wording of [Kanban Start](../kanban-adapter-interface/spec.md#start) Behaviour 5 and the [local task workflow](../local-task-workflow/spec.md) preset prompt. Discovery, sources, bindings, Test, usage, fingerprints, selection tokens, Kanban matching and launch, Handoff, Continue, Stop, auto-send and console injection stay as specified.

NeKode only sends text. The agent's instructions own what Start and Resume mean in a project.

### Levels

- Application settings: Start, Resume, Handoff and Continue instructions, shared by every registered project, plus auto-send.
- Resume source (formerly Resume template): name, source kind and its fields, reused by reference across projects. It owns discovery only.
- Project: selects one Resume source (or none) and inherits every instruction.

### Start instruction

- Used when a card is started from a Kanban board. Its group in the Instructions tab says so and, when no registered project has a Kanban adapter, adds the note `No project uses a Kanban board yet.` The text stays editable.
- Placeholders: `{ref}` (the full ref), `{title}`, `{description}`, `{url}`. `{ref}` is required. `{description}` becomes the trimmed description, or `This task has no description.` when it is blank. `{url}` becomes the trimmed URL, or empty when there is none.
- Substitution is one pass over the saved text: inserted values are never scanned for placeholders, and unknown braces, `$`, whitespace and line breaks stay literal.
- Empty paragraph rule: the saved text is split into paragraphs at blank lines. A paragraph that contains at least one placeholder and is blank after substitution is removed together with one adjoining blank-line separator. No other text is changed.
- Default, equal to the current `buildStartPrompt` output for every item, with and without description and URL:

  ```text
  Work on task {ref}: {title}.

  {description}

  {url}

  Follow the project's instructions. Do not assume approval for actions that require it.

  Keep the full ref in the name of the local task record, following the project's instructions.
  ```

- Main composes the Start prompt from the saved instruction during launch preparation, after it fetches the current item, under the existing Start rules. An undelivered retry composes again from the current saved text; a delivered attempt sends nothing again.

### Resume instruction

- Placeholder `{taskPath}` is required; `{handoffPath}` stays its deprecated alias. Composition keeps the NEKODE-142 one-pass rule and path forms.
- Default: `Resume task {taskPath}`.
- Main composes it in `resumeSources.prepare` from the saved application instruction, for both the action-bar picker and Kanban Resume. A template prompt is never read again.
- The Instructions tab edits it like Handoff, with a preview and the auto-send mode. The project selector and the read-only template prompt leave that group.
- The explicit legacy import (`resumeSources.importLegacy`, NEKODE-83 bounded reader) moves to the Resume group: it fills the editor with the imported text, which is saved only by Save. Import errors are visible and change nothing.

### Validation and fallback

- Saving Start or Resume requires nonblank text after trimming, no NUL, at most 10,000 characters and its required placeholder. Failed validation shows an error and writes nothing.
- A missing or blank stored value means the default. An invalid stored value (external edit) makes main and the renderer use the default, and the Instructions tab shows the invalid-saved-value message, as NEKODE-172 defines for Handoff and Continue.

### Resume sources

- The Application Settings section and editor are named Resume sources. The editor keeps name, source kind, fields, Duplicate, Delete protection, usage (`Used by: ...`) and Test. It has no prompt field. The Test preview shows each candidate identity and display path, and the instruction formatted from the current saved Resume instruction, labelled as coming from Application settings.
- Project Settings shows a Resume source selector (`None (Unconfigured)` plus saved sources), the source summary and the effective Resume instruction with origin Application settings.
- Ready presets (Agent Harness, Local progress files) fill only source values.
- Stored ids, bindings (`project.resumeTemplate:<projectId>`), revisions and the `resume.sources` key are unchanged. A stored row may still carry a legacy `prompt`: it is accepted on read, ignored, and dropped on the next save of that row. `resumeSources.put` rejects a `prompt` field.

### Migration

Runs once in main, before the first Resume composition or Instructions read of a session, when `instructions.resume` is absent:

1. If no Resume library is saved, write nothing; the default applies.
2. Otherwise take the prompts of templates bound to registered projects; if none is bound, take the prompts of all saved templates.
3. If those prompts are identical strings, write that string to `instructions.resume`.
4. Otherwise write the default to `instructions.resume` and write `instructions.resumeMigration` with the distinct previous prompts and the names of the templates that carried them. The Resume group shows them read-only with Copy and Dismiss; Dismiss clears the key (stores an empty value, which means dismissed, because the state API has no delete).
5. A failed write is logged by main, the default applies, and the migration is retried in the next session (user decision 2026-11-14: no Instructions tab message). The notice is written before `instructions.resume`, so a partial failure also retries. The migration does not rewrite stored template rows.

### Data / API

- `APP_STATE_KEY` additions: `startInstruction: 'instructions.start'`, `resumeInstruction: 'instructions.resume'`, `resumeMigration: 'instructions.resumeMigration'` (JSON `{ prompts: Array<{ prompt: string; templates: string[] }> }`).
- Shared contract additions: Start and Resume defaults, validation with required placeholders, the Start formatter (placeholders and the empty paragraph rule) and the effective-value resolver used by main and the renderer.
- `ResumeSourceTemplate` and `ResumeSourcePut` lose `prompt`. No IPC channel is added or removed; `resumeSources.put` and `duplicate` no longer carry a prompt.
- Settings stay in the flat app_state store; no SQLite schema change.

### Edge cases

- A description contains `{url}` or `{ref}`: inserted literally.
- A description contains blank lines: kept; the empty paragraph rule looks only at template paragraphs.
- A template paragraph mixes literal text and an empty `{url}`: it is kept with its literal text.
- The stored Resume instruction lacks `{taskPath}` (external edit): default plus the visible warning.
- One bound custom prompt and other unbound templates with different prompts: the bound prompt wins (rule 2).
- The notice is dismissed before copying: the prompts are gone; the UI states this next to Dismiss.

### Acceptance criteria

1. With no saved Start instruction, every Kanban Start sends exactly the previous prompt for items with and without description and URL.
2. A saved multiline Start instruction with all four placeholders produces the expected text; `{ref}` is required; empty `{url}` and blank description follow the defined rules; inserted values are not expanded.
3. Resume from the action bar and from Kanban both use the saved application Resume instruction; editing it changes the next prepare without restart; no template prompt is read.
4. Resume sources have no prompt field; presets fill only source values; legacy stored prompts are ignored and dropped on save.
5. Migration: an identical common prompt is preserved; differing prompts give the default plus a visible, copyable, dismissible list; no saved library gives the default with no notice; the migration runs once.
6. Instructions shows Start, Resume, Handoff, Continue and Stop; Start shows the Kanban note when no adapter is configured; Project Settings shows the source selector and the effective Resume text with origin Application settings.
7. Existing discovery, binding, Test, usage, delete protection, fingerprints, Kanban matching and launch, auto-send, Handoff, Continue and Stop tests keep passing.

### Required tests

- Shared: Start formatter (placeholders, one pass, empty paragraph rule, default equal to the previous `buildStartPrompt` cases), validation of both instructions, resolver fallback.
- Main: migration cases from acceptance 5 with in-memory state; `prepare` uses the application instruction; Start launch composes from the saved instruction and a retry recomposes; `put` rejects `prompt`; legacy rows with `prompt` still list.
- Renderer: Instructions tab Start and Resume edit/save/reset/validation, Kanban note, migration notice copy/dismiss, legacy import into the draft; Resume sources editor without prompt and with the Test preview using the application instruction; Project Settings source selector and origin.
- Regression: existing Resume source, picker, Kanban launch and ActionBar suites.

### Relevant SDD / ADR

- NEKODE-142 and NEKODE-172 sections above.
- No new ADR.
