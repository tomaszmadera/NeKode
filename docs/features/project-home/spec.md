# Project home: Tasks

Status: Delivered (home tab, Tasks wording, the built-in `local-file` source, and `Teach agents` writing the one file `.agents/skills/nekode-tasks/SKILL.md`; no per-agent skill folders in this version).
Path: `docs/features/project-home/spec.md`.

This file is the behavioral contract for a feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

This contract describes the shipped behaviour, including `Teach agents` writing only the one skill file `.agents/skills/nekode-tasks/SKILL.md` and no per-agent skill folders.

## Goal

A selected project always has a home tab named with the project. The tab shows the task list when a source exists, and a short setup welcome when it does not. A person can start a local task list in a file without Plane. An agent can be taught that same source through one explicit skill file.

Users: anyone opening a project in NeKode, including a project with no tracker.

## Related requirements

- Accepted decisions of 2026-10-24, recorded in [the analysis](analysis.md): the visible name is Tasks; a restored chat still opens on launch; `.nekode/tasks.json` is created only by `Use a local task list`; the skill is a separate write after the paths are shown. The later 2026-11-08 [left-panel decision](../left-panel/spec.md) restores the project-name home entry: the name selects the project and opens its home tab, while the row's chevron and avatar toggle expansion and `Open project tasks` stays in the context menu.
- [Kanban adapter interface](../kanban-adapter-interface/spec.md). This contract replaces that spec's Behaviour 14 entry-point rule (tab and tile only while a project is bound) and, for the built-in source only, the non-goal that every adapter is a user-installed process. External adapters stay user-installed processes. The normalized board, `New task`, review, Start, and Resume stay that spec's.
- [Center layout](../center-layout-tabs-actions/spec.md) owns the tab strip. This contract adds the home tab's presence and what activates it.
- [Task progress adapters](../task-progress-adapters/spec.md): `.nekode/task-progress.json` is a different file. Nothing in this contract reads or writes it.
- [Local task workflow](../local-task-workflow/spec.md): owns the execution-context convention, the ready `Local progress files` Resume preset, and the Handoff/Resume instructions for a `local-file` project.
- [Project environments](../project-environments/spec.md): a WSL project is addressed by its stored path. This contract adds no new WSL transport.
- UI copy in this contract is English.

## Scope

- The home tab on the top strip for every selected project, bound or not.
- Project context-menu entry, launch selection, and the setup welcome.
- Visible Tasks wording in the home tab, the board's setup copy, and Project Settings.
- The built-in `local-file` source and `.nekode/tasks.json`.
- `Teach agents`: one confirmed write of `.agents/skills/nekode-tasks/SKILL.md`.

## Non-goals

- A column board, drag-and-drop, or the visual design in `docs/UX-UI.md` §26-30.
- Renaming IPC channels, the `kanban` tab kind, or `project.kanbanAdapter` keys.
- A custom task-file path, a second local file, or editing `.gitignore`.
- Deleting `.nekode/tasks.json` or the skill file when a project or a binding is removed.
- Bundling Plane or any other process adapter. Scanning and spawning external adapters stay as they are.
- Per-agent skill folders, `.claude/skills`, `.grok/skills`, or a skill marketplace.
- Knowledge of any specific adapter, agent tool, or repository tooling in NeKode code. Skill text beyond the built-in texts comes only from the bound adapter's manifest (NEKODE-169). NeKode never reads other files under `.agents/` to choose the text.
- Automatic creation of the task file or the skill when a project is added.
- Encrypting the task file. It is ordinary project data.

## Behaviour

1. Home tab. While the tab strip has a project, the first control is a tab, not a plain label. It is not closable. Its visible text is the project name, shortened by the existing 10-grapheme rule. Its tooltip is `Tasks: {full project name}`. The accessible name includes that tooltip. The chat tab stays second. File tabs stay after it. With no project, the strip has no home tab and the existing Add project welcome stays.
2. Contents. A project whose stored adapter id is non-empty shows the existing task list on the home tab. A project with an empty or missing adapter id shows the setup welcome on that tab and does not call `kanban:listBoard`. The home tab stays selected when the project is unbound. The application must not send the user to the chat tab only because no adapter is bound.
3. Setup welcome. Title `No task list yet`. Body `Keep tasks in a file in this project, or connect a tracker.` Primary button `Use a local task list`. Secondary button `Connect a tracker`. `Connect a tracker` opens Project Settings on the Tasks section for that project. The chat welcome and `New Chat` stay on the chat tab and do not mention trackers.
4. Project navigation. Clicking the project name selects the project, expands it, and activates its home tab. For the already selected project it keeps the selected chat and only activates the home tab; for another project it clears the chat selection. Clicking the row's chevron or avatar toggles expansion without changing the center selection. `Open project tasks` in the project context menu does the same as the name click. A chat row and New Chat activate the chat tab.
5. Launch. A restored project and a restored chat that still exists open on the chat tab. A restored project with no restored chat opens on the home tab. Tabs are still not persisted: this rule runs from the restored selection, not from a saved tab.
6. Tasks wording. The Project Settings section label is `Tasks`. The built-in source is labeled `Local file`. Existing board actions keep their English labels (`New task`, `Refresh`, `Configure`). The word Kanban is not used in new or replaced UI copy. Code identifiers may keep `kanban`.
7. Local list. `Use a local task list` creates `.nekode/tasks.json` when that file is absent, binds `local-file` for the project, and shows the task list. The same action is available in the Tasks section when no source is bound. When a source is already bound, the action is absent. Choosing another adapter and saving replaces the binding and leaves the file on disk. Choosing none clears the binding, leaves the file, and returns the home tab to the setup welcome.
8. Local file shape. UTF-8 JSON, stable key order `schemaVersion`, `revision`, `nextRef`, `states`, `items`, pretty-printed, one final newline. `schemaVersion` is 1. `revision` starts at 1. `nextRef` starts at 1. States are exactly: Backlog/`backlog`, Todo/`unstarted`, In Progress/`started`, Done/`completed`, Cancelled/`cancelled`, with `order` 0 through 4. Each item stores `ref`, `id`, `title`, `description`, `stateId`, `priority`, `updatedAt`. `ref` is `T-` plus the decimal `nextRef` consumed for that item. `nextRef` only increases. `id` is a new UUID. Reads fill `stateName` and `stateGroup` from `stateId`, and `assignee` and `url` as null. The list, `New task`, status, and priority then use the existing board.
9. Local writes. `listBoard`, `createItem`, and `updateItem` for `local-file` run in the main process. They do not spawn a process and do not read adapter secrets. A write carries the `revision` last read. Success increments `revision` by 1 and replaces the file by a write in the same directory followed by a rename. A mismatched `revision` changes nothing and returns `conflict`. `New task` still defaults to the state named Todo. Removing a project deletes the binding keys only.
10. Local test. The Tasks section for `local-file` shows the relative path and Test. Test parses the file. Success reports that the file is readable. Failure reports the typed error in the section.
11. Teach agents. The Tasks section shows `Teach agents` only while a source is bound. The confirm dialog names every file it will write. This version writes only `.agents/skills/nekode-tasks/SKILL.md` under the project root. It lists the project's selected agent profiles as the agents that can read a project skill, and it does not offer per-agent destinations. Confirm writes the file. Cancel writes nothing. Replacing still requires confirm. The skill is English instructions, chosen by the bound source only (NEKODE-169):
    - `local-file`: the built-in local text. It names `.nekode/tasks.json`, the file shape, the revision rule, the execution-context convention in `work/<ref>/progress.md`, the Handoff/Resume/Stop behavior, the completion move to `work-completed/<ref>/progress.md`, and forbids a second task list.
    - A process adapter whose manifest declares `agentSkill` (see the [adapter spec](../kanban-adapter-interface/spec.md)): NeKode's fixed front matter followed by the adapter's Markdown body, unchanged. The adapter owns these instructions, for example which tool an agent uses for its tracker.
    - Any other process adapter: the built-in default text. It says the tasks live in the tracker configured for this project in NeKode and names the adapter by its manifest `name`. It forbids copying tasks into the repository and creating a second task list. It forbids no tool. When other instructions in the repository describe a task tool that targets a different tracker or project, or the agent cannot tell, the agent asks the user instead of choosing.
    - A declared `agentSkill` that cannot be read or is invalid is an error in the dialog. NeKode does not fall back to the default text.
12. Paths. Both writes stay inside the stored project root, using the same root the file tree already reads. The main process rejects a path that escapes that root. Parent directories are created only for `.nekode` and `.agents/skills/nekode-tasks`. No shell is used. A WSL project uses its stored UNC path as that root.
13. Teach agents preview (NEKODE-169). Before anything is written, the dialog shows:
    - the path and whether the write creates a new file or replaces an existing one;
    - where the instructions come from: `Local file instructions`, `Instructions from the {name} adapter`, or `NeKode default instructions for {name}`;
    - the exact full text that Confirm writes, in a scrollable monospace block;
    - when replacing, a line diff from the current file to the new text, and `No changes` when they are equal. A current file that is not valid UTF-8 or exceeds 256 KiB is not shown; the dialog says `The current file cannot be shown.` and still allows the replace;
    - the boundary note: `Writing this file installs and configures nothing. Agents that do not read project skills ignore it.`
    Confirm writes exactly the text shown. If the binding, the adapter's declared text, or the current file changed since the preview, the write changes nothing, the dialog shows `The skill file or its source changed. Review the new preview.` and loads a new preview that needs its own confirm. Saving another source or clearing the binding while the dialog is open reloads the preview the same way, or closes the dialog when no source remains. Cancel and a failed write leave the previous file unchanged.

## Business rules

- One bound source per project, as in the adapter spec. `local-file` is that source when selected.
- The task file and the progress snapshot are different documents.
- The skill file contains no task items and no secrets.
- A missing, unreadable, or schema-invalid task file is an error. The application does not recreate or empty it unless the user uses `Use a local task list` and the file is absent.
- External adapter discovery, config, and process protocol are unchanged when the binding is not `local-file`.

## Authorization

Renderer calls stay behind the existing trusted-sender guard. Writes accept only a known project id. The skill write and the task-file write are allowed for that project after the confirm gesture. No other project is written.

## Data / API

- Binding stays `project.kanbanAdapter:<projectId>`. The built-in id is `local-file`. No config secrets.
- `kanban:listBoard` for `local-file` returns the normalized board plus the document `revision` the next write must echo. The revision travels with the existing board payload as `revision: number`. Process adapters omit it; the renderer sends a write revision only for `local-file`.
- `kanban:createItem` and `kanban:updateItem` for `local-file` accept that `revision` and return the updated item and the new `revision`.
- `kanban:test` for `local-file` needs no config fields.
- `kanban:bindLocalFile(projectId)` is the `Use a local task list` action. Its one argument is a non-empty registered project id; IPC validation rejects any other payload. Main creates `.nekode` under the stored project root if needed (never the root itself), then creates `.nekode/tasks.json` with the initial document exclusively, so an existing file, valid or not, is left unchanged. It then binds `local-file` and resolves with no value. A failure leaves the binding unchanged: `not_found` for an unknown project or a missing project folder, `validation_error` when `.nekode` or `tasks.json` resolves outside the project folder, `unknown` with the relative path for an IO failure or a link that cannot be resolved. While bound, a missing task file rejects reads and writes with `not_found` and `detail: "local_task_file_missing"`; the home tab offers `Use a local task list` only for that detail.
- `kanban:skillPreview(projectId)` replaces `kanban:skillStatus` (NEKODE-169). It resolves `{ path, origin, sourceName, exists, current, text, token }`: `origin` is `local-file`, `adapter`, or `default`; `sourceName` is the bound source's display name; `exists` tells whether `.agents/skills/nekode-tasks/SKILL.md` exists; `current` is its UTF-8 text, or null when it is absent, not valid UTF-8, or over 256 KiB; `text` is the exact text a write produces; `token` is the hex SHA-256 over `text`, a NUL, and the current file bytes (or the marker `absent`). It takes one non-empty registered project id. `kanban:writeSkill(projectId, token)` is the confirmed write and resolves with no value. It takes that project id and a 64-character lowercase hex token; IPC validation rejects any other payload. Main rebuilds the preview from the stored binding and the current disk state and writes only when the rebuilt token equals the given one; otherwise it rejects with `conflict` and writes nothing. The renderer sends no path and no text. Both channels reject an unbound project with `validation_error`. A declared adapter `agentSkill` that is missing, outside the adapter folder, not valid UTF-8, blank, over 32 KiB, or starts with a front-matter line `---` rejects both channels with `validation_error` naming the adapter id and the declared relative path. A bound process adapter that is not installed rejects both channels with `not_found`; no text is guessed for it. Main creates only the missing `.agents`, `.agents/skills`, and `.agents/skills/nekode-tasks` segments one at a time under the stored project root (never the root itself) and replaces the file by a temp file in the same directory plus a rename. Both channels reject with `not_found` for an unknown project or a missing project folder, `validation_error` when an existing segment or the file resolves outside the project folder, and `unknown` with the relative path for an IO failure or a link that cannot be resolved; a failed write leaves any previous file unchanged.
- No new SQLite migration.

## Edge cases

- Bindings still loading: the home tab can already be selected. It shows a loading line until the binding read settles, then either the list or the welcome. It does not flicker to the chat tab.
- `local-file` bound and the file missing: the home tab shows the typed error and `Use a local task list`, which creates the file only when absent.
- `local-file` bound and the file has `schemaVersion` other than 1, invalid JSON, or a state the item does not reference: typed error, file unchanged.
- Two writers: the later write with a stale revision gets `conflict`, refetches, and does not merge by itself.
- Very long project name: the existing shortening stays. The tooltip keeps the full name.
- Project removed while a write is in flight: the write is dropped and the file is not deleted.
- Teach agents with no selected profiles: the dialog still offers the one skill file. The profile list is empty and says that no agent profile is selected for the project.
- An existing skill file edited by hand: the preview shows the diff from that content; Confirm replaces it only with the shown text.
- An existing skill file written for another source (for example `local-file` text while a process adapter is bound): the diff shows the whole replacement.

## Errors

- Typed codes: `validation_error` (bad document, empty title, missing state), `conflict` (stale revision), `not_found` (unknown project, missing task file while bound), `unknown` (IO failure with the relative path).
- No silent fallback to Plane, to an empty board, or to the chat tab.
- Setup and settings errors are inline. A failed skill write leaves any previous skill file unchanged and shows the error in the dialog.

## Acceptance criteria

1. With no adapter, the strip's first control is a tab showing the project name, and activating it shows the setup welcome, not the chat welcome.
2. With an adapter, that same tab shows the task list, and its tooltip starts with `Tasks:`.
3. Clicking the current project's name leaves the open chat selected and shows the home tab. Clicking another project's name clears the chat and shows that project's home tab.
4. Relaunch with a saved chat shows that chat. Relaunch with a project and no saved chat shows the home tab.
5. `Use a local task list` creates `.nekode/tasks.json`, binds `local-file`, and shows an empty list with `New task`. A second use does not reset an existing file.
6. Creating and moving a local item survives restart. A stale revision does not overwrite a newer file.
7. A Plane-bound project lists and updates through its process adapter, and gains no task file until the user switches to the local action.
8. `Teach agents` writes only the named skill file, and only after confirm. Cancel leaves the disk unchanged. The skill text contains no copied task items.
9. Removing the project removes the binding and leaves both project files in place.
10. The default text for a process adapter forbids no tool and names no repository tooling. An adapter that declares `agentSkill` gets its own body under NeKode's front matter.
11. The `Teach agents` preview shows the path, new or replace, the origin, the full text, and a diff when replacing. Confirm writes exactly the shown text.
12. A binding change, a changed adapter text, or a changed skill file between preview and Confirm writes nothing and shows a new preview.

## Required tests

- Home tab present for a bound and an unbound project; absent with no project. Tooltip and shortened name.
- Unbound home tab does not redirect to chat and does not call `listBoard`.
- Name click on the current project keeps the chat id. Name click on another project clears it and selects the home tab.
- Restored chat selects the chat tab. Restored project without a chat selects the home tab.
- Settings section label `Tasks`. `Connect a tracker` opens that section.
- `local-file` create, list, update, Todo default, revision conflict, invalid JSON, missing file, and no process spawn.
- Project removal deletes the binding keys and does not delete the task file.
- Teach agents confirm, cancel, replace copy, path escape rejected, and skill text for `local-file` versus an external id.
- Teach agents preview: new file, replacement with diff, hand-edited existing file, unreadable current file, adapter-declared text, default text, invalid declared text, stale token `conflict` after a binding change and after a file change, and IPC rejection of a bad token.
- A bound process-adapter project still renders the existing list.

## Relevant SDD / ADR

[Project environment adapters](../../architecture/project-environment-adapters.md) for the WSL path boundary. No new ADR. The kanban adapter spec remains the contract for external process adapters.
