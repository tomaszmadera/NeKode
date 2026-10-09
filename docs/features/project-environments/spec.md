# Project environments: opening WSL projects

Status: WSL opening approved with the user's scope correction on 2026-10-08. The NEKODE-34 UI extension below was approved on 2026-10-09.

## Goal

Open a project stored in WSL directly in NeKode. Its files must be browsable and its terminals must use the project's distribution and Linux working directory. Shell detection for that project must never scan the Windows host.

## Related requirements

- NEKODE-29: architecture and WSL, narrowed by the user to the minimum needed to open a WSL project.
- NEKODE-33: SSH, outside this task.
- Existing [project files](../project-files-view/spec.md) and [shell selection](../project-shell-selection/spec.md) contracts, with the WSL-specific rules below.

## Scope

- A small WSL project-add flow: installed distribution, absolute Linux directory, and Add/Cancel.
- Store the project as a Windows-accessible WSL UNC path using the current project schema.
- Reuse existing file inspection and external opening through that UNC path, preserving UNC roots during path joins.
- Automatically use that distribution and Linux cwd for chat and bottom terminals. Executable/argv launches through a WSL project terminal stay in WSL.
- Detect and select Linux shells in the project's distribution; keep Local shell detection unchanged.
- A small documented boundary for path conversion and WSL invocation, without a generic registry.

## Non-goals

SSH, database migration, plugin loading, runtime daemon, general filesystem/process capability framework, installations, project environment conversion, a new file editor, and a broad rewrite of Git, actions, agents, Kanban, or handoffs.

## Behaviour

1. Local Add Project keeps the existing directory picker and cancellation behavior. WSL Add Project offers installed distributions and an absolute Linux directory path. Invalid/missing/inaccessible targets show an English error and create no project.
2. WSL projects store a canonical WSL UNC server name, distribution, and native directory components. Existing WSL UNC projects selected through the Local picker are recognized as WSL as well. Different distributions naturally have distinct paths in the current unique path column.
3. Reject empty distributions, malformed path components, traversal, NUL, and a distribution filesystem root. Preserve path case and spaces. Never interpolate path or executable arguments into shell source.
4. File tree, preview, exclusions, limits, external opening, and containment keep the Project Files contract. Path joining must preserve the UNC server/share, including nested directories. Existing read-only handoff paths using the same joins remain functional.
5. Chat and bottom terminals start through wsl.exe in the explicitly selected distribution and Linux directory. The Windows PTY cwd remains a valid host directory, separate from the Linux cwd. Default means the distribution user's default shell. There is no fallback to a Windows shell.
6. Opening Shell settings for a WSL project probes only that distribution's Linux shell list. It does not inspect Windows candidate executables, enumerate unrelated distributions, or validate/prune host custom-shell settings. The list contains Default and usable Linux shells. Custom Linux paths are scoped to the project/distribution, not added to the host custom-shell list.
7. Existing host shell choices saved for a WSL UNC project are not used to launch a host shell. A removed Linux shell fails explicitly or uses the distribution default according to a visible documented default rule; it never falls back to the host.
8. Existing terminal IO, resize, switching, close, and quit behavior remains. Real WSL smoke checks that terminal termination closes its owned foreground process without shutting down the distribution.
9. Existing project-bound executable launches use the same WSL terminal boundary. Any operation this minimal implementation cannot support safely must fail visibly rather than accidentally execute a Windows command in a WSL project. This does not introduce new execution features.
10. Existing Local projects and shell behavior remain unchanged. UI stays English. Distribution or directory unavailability is visible; project registration survives application restart without requiring a schema change.

## Business rules

The persisted project path determines the distribution. Existing project operations cannot switch it based on a renderer-provided shell label. Linux cwd and Windows UNC filesystem path are separate values. No privileged or shared-distribution shutdown operation is introduced.

## Authorization

Existing trusted-sender guards and input validation apply to new IPC. Existing action confirmation rules remain. No secrets or prompts are logged.

## Data / API

Add typed WSL distribution discovery and WSL project registration endpoints. Pass project context to shell discovery/custom-shell endpoints while retaining compatibility for Local callers. Use a pure shared WSL path parser/converter and a thin main WSL invocation helper; keep `ProjectInfo.path` and the database schema compatible.

## Edge cases and errors

Missing WSL/distribution/directory, spaces and Unicode, shell metacharacters, malformed UNC paths, aliases wsl$ and wsl.localhost, nested directories, symlink escape, unavailable shell, discovery failure, cancellation, repeated terminal attachment, and termination during spawn. Errors are sanitized, explicit, and never cause cross-environment fallback.

## Acceptance criteria

1. Add and reopen a WSL project through the UI using distribution plus Linux directory.
2. Browse nested files, preview text, and open its root externally through a valid UNC path.
3. New chat and bottom terminals report the selected distribution and expected Linux cwd; executable arguments survive unchanged.
4. WSL Shell settings list Linux shells only; tests prove host probes and host settings pruning were not called.
5. Existing Local registration, files, shell choices, and terminal lifecycle pass regression checks.
6. A real Windows/WSL smoke is recorded, including terminal teardown; independent review and final verification pass. If runtime smoke is unavailable, record the exact missing evidence.

## Required tests

Pure path conversion and UNC joins; WSL registration and validation; project-specific shell routing and no-host-probe assertions; terminal distribution/cwd/argv; file containment and Local regression; IPC validation and sender guards; project-add and Shell settings renderer behavior; real WSL smoke with isolated fixture data.

## Relevant SDD / ADR

[Minimal WSL integration design](../../architecture/project-environment-adapters.md). This scope supersedes the earlier proposed general environment framework.

## Unified project-add UI (NEKODE-34)

This section extends the project-add presentation only. It does not reopen the completed NEKODE-29 backend work or change its file, shell, terminal, path or persistence contracts. UI text stays English. Approved by the user on 2026-10-09.

1. The Projects header has one `Add Project` plus. The welcome `Add Project` action opens the same modal. A `Project location` selector offers only `Local` and `WSL`, initially Local. Future implemented locations can extend this selector without adding navigation actions; no unavailable transport is offered.
2. Local explains folder selection and offers `Choose folder...` using the existing native picker/registration API. Picker cancellation keeps the modal open with no project or selection change. Success follows the existing project-added selection path and closes the modal.
3. WSL offers installed `Distribution`, `Linux project directory`, path help, and `Add Project`. Discovery starts on WSL selection. Loading is announced; empty/failing discovery has explicit copy and Retry. Local and Cancel remain available during discovery.
4. Validate submitted Linux paths with the shared WSL path contract before invoking registration. Never silently trim, change case or normalize invalid input. Field errors are visible, announced, associated with the input, and focus the invalid path. Main-process validation remains authoritative for access and existence.
5. Registration errors remain inside the modal with inputs preserved. Busy actions prevent duplicate registration and show progress. Disable closing and changes only while the native picker or registration is pending, since their existing APIs are not abortable. Discovery responses from a closed modal cannot update it.
6. Use existing theme tokens, UI typography, control scale and dialog conventions. Keep the modal within the viewport. Tab stays inside, native selectors support keyboard choices, Enter submits, and Escape/Cancel dismiss when idle. Focus starts on location and returns to the invoking connected control on close. Cancelling the picker restores focus to its action; asynchronous discovery never steals focus.
7. Preserve existing Local/WSL reopening, files and shell behavior. Do not change IPC, database schema, services or transports for this presentation work. (NEKODE-35 below adds one read-only directory-listing channel and reopens only that IPC clause.)

Acceptance requires a single shared entry flow, passing Local/WSL dialog and App regressions, no unavailable options, explicit loading/empty/error/invalid/busy/cancel states, keyboard and focus coverage, independent review, and recorded final live smoke of both flows plus file/shell regression checks. The approved design and actual smoke evidence belong to the NEKODE-34 task record; a mock picker is not evidence of native Local picker behavior.

## WSL directory suggestions (NEKODE-35)

Status: approved (2026-10-09); extends the NEKODE-34 WSL field. It reopens only the NEKODE-34 §7 sentence that forbids IPC changes, and only for the read-only directory-listing channel below. The database schema, persistence, terminals and every other service stay unchanged.

Goal: as the user types `Linux project directory`, NeKode suggests matching subdirectories of the selected distribution, so the Linux path does not have to be typed from memory.

1. One new read-only channel, `projects:wslDirectories`, takes the selected distribution and the renderer's current directory text and returns matching absolute Linux directory paths. It reuses the existing WSL invocation boundary (`runWsl`) with an argv array and no shell, and registers no project.
2. Suggestions are the child directories of the query's parent: the text after the last `/` filters the directory names directly under that parent. A query that does not start with `/` yields no suggestions. Only directories are returned, only as absolute paths, capped at 100 entries, sorted.
3. Every returned path is a valid candidate under the shared WSL path contract. A child whose component the contract rejects (a control character) is dropped, so a suggestion can never bypass the path rules that registration enforces.
4. Output is NUL-delimited so names with spaces and newlines survive unchanged.
5. A missing parent, an unreadable or permission-denied parent, and an unavailable distribution surface as an explicit error state, never as an empty list. An empty result is its own state, distinct from loading and error.
6. The renderer debounces the input before invoking the channel and drops a response that newer input or unmount has superseded; a late response never overwrites newer state.
7. `Linux project directory` becomes a combobox with a listbox: while suggestions are open, Up/Down move the active option, Enter accepts the active option and does not submit the form, Tab accepts the active option and keeps focus inside the modal, a pointer click accepts, and Escape closes the list without dismissing the modal. While suggestions are closed, Tab and Enter keep the NEKODE-34 behavior (Tab moves focus through the modal, Enter submits).
8. Accepting a suggestion fills the field with that absolute path and leaves the list available for further navigation. It changes no other input and never registers a project.
9. Loading and empty states are announced; suggestions never steal focus. Main-process validation stays authoritative for existence and access at registration time (NEKODE-34 item 4).
10. The Local flow, WSL distribution discovery, and the remaining NEKODE-34 state and focus behavior are unchanged.

Business rules: the channel is read-only and advisory. Registration still runs the shared WSL path contract plus the distribution and `test -d` checks in main. No privileged or destructive operation is added.

Authorization: the existing trusted-sender guard and payload shape validation apply. Both arguments are shape-validated before the service runs, and the service validates the distribution name and the query shape.

Data/API: add `projects:wslDirectories(distribution, linuxPath): Promise<string[]>` to `IPC_CHANNEL` and `AppApi`, one validator entry, a thin `listWslDirectories` helper beside `runWsl`, and the preload mapping. No database or schema change.

Edge cases and errors: empty and non-absolute queries, a trailing slash (lists that directory), double slash or `..` or NUL, names with spaces and newlines, Unicode names, permission-denied and missing parents, entry limit, response ordering, stale responses, unmount, and a missing distribution.

Acceptance: typing an absolute path shows matching subdirectories of the selected distribution and they are selectable by keyboard and by mouse; Tab behavior with no list open is unchanged from NEKODE-34; main stays authoritative for path validation and every suggestion is a valid candidate; missing/denied parents and empty results are distinguishable states; the Local and WSL add flows plus file browsing and shells show no regression; independent review and a real WSL smoke pass.

Required tests: pure query splitting and filtering; NUL-delimited parsing including spaces and newlines; distribution and query validation with negative cases; entry limit; renderer combobox keyboard, pointer and stale-response cases; `AppApi` stub updates across the test tree; IPC validation and sender-guard cases; and a real WSL smoke listing a fixture tree.
