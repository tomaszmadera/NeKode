# Local task workflow without Harness

Status: Delivered in part (no-Harness workflow; the Harness-backed variant requires the upstream local-file backend and adapter).
Path: `docs/features/local-task-workflow/spec.md`.

This file is the behavioral contract for a feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

## Goal

A project can keep its work items in the built-in `local-file` list and continue work from a plain file that records execution state, without installing Agent Harness, without Python, and without Plane. The task list stays the only backlog; a separate progress file carries the context that Resume needs. The same project can later switch to Plane or to a Harness-backed workflow without moving or converting its cards.

Users: anyone who wants a local board in NeKode and an agent that can hand off and resume its own work through files.

## Related requirements

- [Project home](../project-home/spec.md) owns `.nekode/tasks.json`, the `local-file` binding, and the one skill file written by `Teach agents`.
- [Handoff/Resume flow](../handoff-resume-flow/spec.md) owns Resume templates, file discovery, and prompt composition.
- [Kanban adapter interface](../kanban-adapter-interface/spec.md) owns the board, Start, and Resume launch.
- Work item NEKODE-173. Related accepted decisions: NEKODE-170 (separate tracker, continuation source, and agent instructions), NEKODE-171 (Resume profile with separate discovery and instruction settings), NEKODE-172 (configurable Handoff/Resume/Continue instructions), NEKODE-175 (install the Agent Harness adapter when the upstream backend exists).
- UI copy in this contract is English.

## Scope

- One ready Resume template preset for local progress files, visible in Resume template settings.
- The `local-file` agent instructions extended with execution context, Handoff, Resume, Stop, and completion handling.
- Configuration text that shows the exact context path, the source settings, and the exact instruction an agent receives.
- A complete T-1 example covering card creation, Start, context, Handoff, Resume, and confirmed completion.
- Fixture checks without Plane, without Python, and without `.agents/scripts/taskctl`.
- Documentation of the Plane/local-file switch and of the Harness-backed variant, distinguishing shipped behavior from required upstream work.

## Non-goals

- A new task backend, a second task list, or a new storage format for cards.
- Automatic migration of Plane cards to `.nekode/tasks.json`, or the reverse.
- Creating `work/` files or binding a Resume template automatically when a project is added or a card is started.
- Parsing progress files as work items, inferring completion from them, or validating them as unfinished tasks.
- Installing or bundling Agent Harness, running `taskctl`, or implementing the upstream Harness local-file backend.
- A new Handoff action, a new Stop behavior, or changes to Continue.
- Editing `.gitignore`.
- A graphical progress panel.

## Behaviour

1. One backlog. `.nekode/tasks.json` is the only work-item list for a `local-file` project. Progress files are execution context. An agent must not copy cards into a progress file and must not create a second TODO list, tracker file, or backlog. The board does not read progress files.
2. Context location. For a card with ref `T-1`, the agent records execution context in `work/T-1/progress.md` under the project root, using forward slashes in instructions. The directory name is the complete ref. The file name is literally `progress.md`.
3. Ready profile. Resume template settings offer a `Local progress files` source preset with exactly these file-source values: directory `work`, file-name filter `progress.md`, `Search subdirectories` on, and `Candidate identity` set to `Immediate parent directory`. Its default Resume instruction is `Resume task {taskPath}.\nRead that progress file before continuing. It records the work so far, decisions, checks, and the next action.`
4. Explicit configuration. Choosing the preset only fills an unsaved template form. The user still saves the template and selects it in a project. Selecting the preset creates no directory or file, binds no project, and installs nothing. The preset remains editable like any other file template, and editing a source field back to the preset values shows the preset name again.
5. Exact visibility. The template editor shows the preset's exact directory, file-name filter, recursion, and identity values. A template test lists each candidate's identity and display path and shows the exact instruction produced by substituting that path. Project Settings shows the selected Resume template's source summary and instruction. The `Teach agents` preview keeps showing the exact skill path and the full skill text.
6. Agent instructions. The `local-file` skill tells the agent to create or update the progress file when it starts working on a card, and to keep in it: the ref and title; the current execution state; decisions and their reasons; checks with the command and result; blockers; one exact next action naming the file or command; and the UTC time of the last update. The agent updates the file when one of those facts changes, keeps the task list unchanged unless a card field must change, and never duplicates the card list in the file.
7. Handoff. `Write a handoff` is the transfer instruction. The agent updates the progress file, leaves the card In Progress, and stops. The progress file is the transfer; no separate handoff copy is created. The application does not claim that a handoff exists because it sent the instruction.
8. Stop and Continue. Stop remains `Ctrl+C` and a user interruption. It is not a handoff: it stops the running agent and does not create, update, or complete a progress file by itself. Continue addresses the running conversation and does not select a task or a context file. After a Stop, the agent, when asked to continue, reconciles the existing progress file with the repository before acting.
9. Resume. The Resume instruction names the single matching progress file. The agent reads that file before changing files, checks its claims against the repository, and continues from its recorded next action. A missing file, a changed file, or a stale claim is reported, not replaced with invented state.
10. Completion and withdrawal. After the user confirms the task is complete and the card is moved to Done, the agent moves the context to `work-completed/T-1/progress.md`, outside the configured `work` directory, so discovery no longer offers it. The agent preserves the file; deletion needs an explicit user request. If a completed task reopens, the agent moves the file back to `work/T-1/progress.md` and updates it before continuing.
11. Files are not task records. The file source discovers readable regular files matching the configured name, uses the parent directory name as the candidate identity, and never parses the file body or infers an unfinished state. A file left in `work/` continues to match after the card is Done; moving it to `work-completed/` is the explicit withdrawal. Missing directories, unreadable files, links, and oversized files keep the existing source error behavior.
12. Matching. Resume matches the full ref case-insensitively when the candidate identity equals the ref or starts with the ref followed by `-`. `T-1` matches `T-1` and `T-1-follow-up`; `T-1` does not match `T-10`, `T-11`, or `old-T-1`. Titles and file contents create no match.
13. Tracker switch. Changing the project's tracker between Plane and `local-file` changes only the binding. It does not migrate cards, move `.nekode/tasks.json`, delete progress files, change the selected Resume template, or rewrite the skill file. The user must bind and teach the new source explicitly. No tracker is guessed from files or from the presence of a Resume template.
14. Harness variant. A Harness-backed project uses task records as the execution record and `taskctl list --json` as the Resume source. Cards stay in `.nekode/tasks.json`, and a linked record uses the same complete ref as the card. That variant does not require a parallel `progress.md`. It is available only after the upstream Harness local-file backend ships and its adapter is installed; choosing a Resume profile does not install Harness, create task records, or make the variant available.
15. Shipped versus required. Shipped now: `.nekode/tasks.json`, board Start, the Files Resume source, the `Local progress files` preset and its prompt preview, the project Resume source summary, the extended `local-file` skill text, the Harness command preset, and `Teach agents`. Required upstream: a Harness backend that manages `.nekode/tasks.json` cards and links task records to them. This contract does not simulate that backend.

## Complete T-1 example

This example is the acceptance slice for the no-Harness variant. It uses only the local board, the Files Resume source, and one skill write. It needs no Plane, Python, or `.agents/scripts/taskctl`.

1. Project Settings, Tasks: choose `Use a local task list`. NeKode creates `.nekode/tasks.json` and binds `Local file`. The file starts at revision 1 and the board is empty.
2. Board, `New task`: title `Write the release note`, state Todo. The card is `T-1` and the file revision grows to 2.
3. Board, Start on `T-1`: the agent starts in the project directory with the ref, title, description, and the project's instructions. The card moves to In Progress.
4. Project Settings, Tasks, `Teach agents`: the preview shows `.agents/skills/nekode-tasks/SKILL.md`, the origin `Local file instructions`, and the full text, including `work/T-1/progress.md` and `work-completed/<ref>/progress.md`. Confirm writes it once.
5. Application Settings, Resume templates: `New template`, source `Local progress files`, name `Local progress`, `Save template`. Project Settings, Resume template: select `Local progress`, `Save`. These steps create no directory and no file.
6. The agent starts work and creates `work/T-1/progress.md`. The file records the current state, the decision and its reason, the check command and result, any blocker, the exact next action, and the UTC update time. The card stays In Progress.
7. Handoff: the user runs `Handoff`, which sends `Write a handoff`. The agent updates `work/T-1/progress.md`, leaves the card In Progress, and stops. The file is the transfer. A `Stop` before that point is an interruption, not a handoff, and does not by itself write the file.
8. Resume: discovery finds `work/T-1/progress.md` and uses `T-1` from the parent directory. The board shows Resume for `T-1` only. The dialog shows the read-only context `T-1` and `work/T-1/progress.md`. Confirm starts a new chat and sends the instruction `Resume task work/T-1/progress.md.` followed by the instruction's second line. The agent reads the file, checks it against the repository, and continues from its next action.
9. Confirmed completion: the user confirms the work is done and moves `T-1` to Done. The agent moves the file to `work-completed/T-1/progress.md`. A refresh no longer finds `T-1`, so Resume is absent while the Done card remains.
10. Reopening: the user moves `T-1` back to In Progress and asks the agent to continue. The agent moves `work-completed/T-1/progress.md` back to `work/T-1/progress.md`, updates it, and proceeds. Resume works again.

The displayed path uses the project runtime's separators; `work/T-1/progress.md` is the repository-relative form used by the instructions.

## Business rules

- Refs are opaque identifiers for matching. The app does not derive a ref from a title, path, or file content.
- A progress file is ordinary project data. It contains no secrets and no credentials.
- The progress file is not a task-status source. The card state in `.nekode/tasks.json` remains authoritative for the board.
- One card has at most one active progress file under `work/`. An ambiguity of two matching candidates blocks Resume under the existing template contract; the app never chooses the newest.
- A task may be worked on without a progress file. Resume is unavailable then; Start remains available.
- `work-completed/` is a convention owned by the agent instructions, not a hidden application state. The app does not read it, create it, or clean it.
- The preset is a source template, not a project binding. Shared edits affect every project that uses that template.
- No data conversion happens on a binding change. Existing Plane cards and values stay in Plane; existing local cards stay in the file.

## Authorization

Renderer calls stay behind the trusted-sender guard. The preset writes no files and binds no project. The existing project root boundary, task-file write authorization, skill write confirm, and Resume launch authorization are unchanged. A progress file is written by the agent under the user's own process privileges, not by a new application IPC channel.

## Data / API

- No new IPC channel, database table, migration, or app_state key.
- Shared contract additions: the ready source constant and default prompt for `Local progress files`, reusable by settings UI and tests. The persisted template is an ordinary `ResumeSourceTemplate` with `kind: 'files'`.
- The exact preset source is `{ kind: 'files', directory: 'work', pattern: 'progress.md', recursive: true, identity: 'parent' }`.
- The default prompt is `Resume task {taskPath}.\nRead that progress file before continuing. It records the work so far, decisions, checks, and the next action.` It uses the existing `{taskPath}` placeholder and the existing one-pass substitution.
- The existing `resumeSources` operations (`list`, `put`, `binding`, `test`, `discover`, `prepare`) carry the template unchanged.
- `local-file` skill text remains generated in main by `buildAgentSkill`; this contract adds no new file destination.

## Edge cases

- The `work` directory is missing: discovery reports its own file-source error; the board still loads and Start still works.
- `work/T-1/progress.md` exists but `T-1` is not on the board: the file is a candidate; no card displays Resume for it.
- Two cards, `T-1` and `T-10`, both have progress files: `T-1` matches only `T-1`.
- A completed context is left in `work/`: Resume still offers it because Files do not validate completion. The documented withdrawal is the move to `work-completed/`.
- A progress file is renamed or moved while Resume is open: the existing fingerprint revalidation rejects the launch and asks for a refresh.
- A project switches from `local-file` to Plane: the board reads Plane, the local file and the progress files stay, and the selected Resume template stays bound.
- A project has no selected Resume template: Resume shows `Configure Resume`; Start and the local board work normally.
- A Harness profile is selected but the upstream backend or adapter is missing: discovery reports the existing install/update error; no `progress.md` is created as a substitute.

## Errors

- Missing or unreadable `work` directory: visible Resume source error with Retry; no fallback to another directory or tracker.
- Invalid progress file encoding or oversize file: the file is rejected with its path and reason; other candidates remain available.
- A stale or superseded discovery result never delivers Resume text.
- A failed skill write leaves the previous skill file unchanged and reports the typed error in the dialog.
- No silent creation of a progress file, no silent repair of a missing one, and no invented handoff state.

## Acceptance criteria

1. A fixture project with no `.agents/scripts/taskctl` and no Python completes Start, context write, and Resume discovery through the Files source without Plane.
2. The preset shows directory `work`, filter `progress.md`, recursion on, identity `Immediate parent directory`, and the default instruction; selecting it saves nothing and binds nothing.
3. `work/T-1/progress.md` produces the `T-1` candidate and matches the `T-1` card; `work/T-10/progress.md` does not match `T-1`.
4. A missing progress file yields no Resume candidate for its card while Start stays available.
5. After a completed task's context is moved to `work-completed/T-1/progress.md`, discovery no longer returns `T-1`; moving it back restores the candidate.
6. The generated `local-file` skill names `work/<ref>/progress.md`, the required content, Handoff, Resume, the Stop distinction, completion withdrawal, the no-second-backlog rule, and the `work-completed/<ref>/progress.md` move.
7. `Teach agents` shows the exact skill path and the full text, and the Resume template test shows each candidate path with the exact formatted instruction.
8. A stale write to `.nekode/tasks.json` returns `conflict` and leaves the newer file unchanged, and the documented parallel-write protocol is unchanged.
9. Documentation states that Plane/local-file switching migrates nothing and leaves files and bindings untouched.
10. Documentation separates shipped local, Files, and Harness-preset behavior from the required upstream Harness backend; the Harness variant reuses the same ref and creates no second record or backlog.
11. `Stop` is documented as an interruption, not a Handoff; Handoff is documented as an update-and-stop action whose transfer is the progress file.
12. All existing project-home, Resume source, board, and launch behavior remains unchanged.

## Required tests

- Fixture integration: a real temporary project root creates the local task file and `T-1`, writes `work/T-1/progress.md`, discovers it through the Files source with parent identity, matches `T-1`, and does not match `T-10`. No taskctl, Python, or Plane call runs.
- Fixture integration: missing file, completed context moved to `work-completed/`, and restored context.
- Local task file: a stale revision write returns `conflict` and does not change the file (existing coverage stays and is exercised through the fixture).
- Skill text: the `local-file` text contains the context path convention, required fields, Handoff and Resume behavior, the Stop distinction, the withdrawal path, and the no-second-backlog rule; it contains no em dash.
- Renderer: the `Local progress files` preset fills exactly the source values and the instruction; saving and binding require explicit actions; a test preview shows candidate paths and the exact instruction; Project Settings shows the selected source summary and instruction.
- Regression: existing file-source discovery, Resume matching boundaries, `Teach agents` preview and write, local task file CRUD and conflict, and board Start/Resume tests keep passing.

## Relevant SDD / ADR

- [Project contracts](../../development/project-contract.md) for the typed IPC and file-boundary rules.
- No new ADR. This feature adds a profile preset and agent instructions on top of the delivered `local-file` and Resume source contracts.
