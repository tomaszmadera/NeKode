# Work record progress and bundled progress adapters

Status: Approved by the user on 2026-11-17 for task `nekode-192`; the separate `Work record` tab and work record skill are amended by [work-items-work-record-separation](../work-items-work-record-separation/spec.md).
Path: `docs/features/work-record-progress/spec.md`.

This file is the behavioral contract for a feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

## Goal

A project keeps one work record per work item. The same record carries continuation context for Handoff and Resume and step progress for the UI. NeKode ships two progress adapters: one for the built-in NeKode work record and one for optional Agent Harness task records. The core application does not learn a record format; adapters own interpretation. Product vocabulary uses one record term everywhere.

Users: anyone who works a local board or an Agent Harness project and wants the step indicator to reflect the work record instead of a second progress file.

## Related requirements

- [Local task workflow](../local-task-workflow/spec.md): owns `work/<ref>/progress.md`, the `Local work record` preset, and the no-Harness workflow.
- [Task progress adapters](../task-progress-adapters/spec.md): owns the adapter protocol, discovery, observation, snapshot validation, and indicators.
- [Handoff/Resume flow](../handoff-resume-flow/spec.md): owns Resume discovery, the application-level Resume instruction, and source bindings.
- [Project home](../project-home/spec.md): owns `.nekode/tasks.json` and the built-in `local-file` work item source.
- [Work items and work record separation](../work-items-work-record-separation/spec.md): owns the separate `Work record` tab and the two independent agent skill files.
- User decisions recorded 2026-11-16 in `.agents/tasks/nekode-192/task.md`.

This contract amends the following clauses:

- `local-task-workflow` Behaviour 2 and 6: the local work record additionally carries the `nekode-state` block.
- `task-progress-adapters` Behaviour 1: bundled adapters join the fixed user directory.
- `task-progress-adapters` Behaviour 7: the adapter list includes bundled adapters.
- `task-progress-adapters` Non-goals: NeKode now ships two progress adapters.
- `handoff-resume-flow` and UI copy naming `Resume source` and `Resume sources`.
- `UX-UI.md` labels for the Tasks, Resume source, and Task progress surfaces.

Code identifiers, IPC channels, file names, and persisted keys named in "Compatibility" remain unchanged.

## Scope

- One work record per work item, with a bounded `nekode-state` block in the local `progress.md`.
- Two bundled task-progress adapters: `NeKode work record` and `Agent Harness`.
- Bundled adapter discovery, user override, packaged paths, and tests.
- Unified product vocabulary and settings labels.
- Agent skill instructions that write the work record and its state block.

## Non-goals

- A second task list, backlog, or status source.
- Arbitrary work record parsing in the core application.
- Creating progress adapter templates. Progress adapters remain selected adapters, not a reusable template library.
- Parsing Agent Harness records in the core application or in the NeKode adapter. The Agent Harness adapter invokes the existing `task-status` command.
- Installing, updating, or running Agent Harness workflow mutations.
- WSL support for the bundled adapters in the first delivery. A WSL project binding a bundled adapter reports `environment_unsupported`.
- Migrating existing `progress.md` files. Records without a block show no step indicator until an agent updates them.
- Changing Resume matching, Resume launch, work item board behavior, or external task-progress adapter protocol v1.

## Behaviour

### Vocabulary and UI copy

1. The product uses these terms and no synonyms:
   - `Work item source`: the adapter that reads and writes board items.
   - `Work item`: one board card from any source.
   - `Ref`: the stable identifier used for matching.
   - `Board`: the board view of one source.
   - `Work record source`: the saved discovery configuration for work records. A project binds one.
   - `Work record`: the durable record of work on one work item. It holds state, decisions, checks, blockers, and the next action.
   - `Archived work record`: a work record withdrawn after completion.
   - `Step progress`: the optional read-only view of phases and steps from a progress adapter.
   - `Start`, `Handoff`, `Resume`, `Continue`, `Stop`: action names. `Handoff` is an action, never a file.
   - `Resume instruction`: the application-level instruction containing `{taskPath}`.
   - `Agent skill file`: one of the two files written by `Teach agents`, the work item skill or the work record skill.
2. `Progress file` and `Task record` are not product terms. They may appear only in technical documentation about a storage path or an external format.
3. Exact settings labels:
   - `TRACKER` becomes `WORK ITEMS`.
   - The `Adapter` field label becomes `Source`.
   - The Project Settings `Tasks` tab becomes `Work items`.
   - A separate Project Settings `Work record` tab owns `WORK RECORD` and its `Work record source`.
   - `RESUME SOURCE` becomes `WORK RECORD`.
   - `Resume source` becomes `Work record source`.
   - The App Settings tab `Resume sources` becomes `Work record sources`.
   - The Project Settings `Task progress` tab becomes `Step progress`.
   - The `Local progress files` source preset becomes `Local work record`.
   - `Task file: .nekode/tasks.json` and `Teach agents` keep their current labels.
4. `Agent Harness` may appear only as the name of an optional adapter or source preset. It is not a core category and does not appear in the canonical vocabulary.
5. The work item source description says it reads and writes board items. The work record source description says it configures where Resume finds the record of work on a work item. The Step progress description says it reads optional step data from a progress adapter.

### Work record

6. One work item has at most one active local work record at `work/<ref>/progress.md`. The directory name is the complete ref. The file name is literally `progress.md`.
7. The agent writes and updates the work record. NeKode never creates, writes, or repairs it. Handoff updates it and stops. Resume reads it through the bound work record source.
8. After confirmed completion the agent moves the record to `work-completed/<ref>/progress.md`. The application does not read, create, or clean that directory.
9. The work record is not a work item, a task list, or a status source. `.nekode/tasks.json` or the bound work item source remains authoritative for the board.
10. A task may exist without a work record. Resume is then unavailable through the file source, and Step progress shows no indicator.
11. The local work record contains exactly one state block:

````markdown
```nekode-state
{
  "schemaVersion": 1,
  "status": "active",
  "phases": [
    {
      "name": "Implementation",
      "steps": [
        { "id": "1.1", "label": "Add the parser", "done": true },
        { "id": "1.2", "label": "Wire the UI", "done": false }
      ]
    }
  ],
  "currentStepId": "1.2",
  "nextAction": "Add the renderer test",
  "blockers": null,
  "updatedAt": "2026-11-16T12:00:00Z"
}
```
````

12. State block fields:
   - Required: `schemaVersion` (integer `1`), `status` (`active`, `blocked`, or `completed`), `phases` (array, may be empty).
   - Optional: `currentStepId` (string or null; when a string it must name an existing step), `nextAction` (string or null), `blockers` (string or null), `updatedAt` (ISO 8601 UTC string), `title` (string).
   - Each phase has `name` (nonblank string) and `steps` (array). Each step has `id` (nonblank string, unique within the record), `label` (nonblank string), and `done` (boolean).
   - Unknown fields are ignored. Duplicate step ids, a `currentStepId` without a step, invalid JSON, an unknown `schemaVersion`, more than one block, or a block over 64 KiB make the record invalid. A record file over 1 MiB is rejected.
13. The block is the only machine-readable part. The rest of the file is prose for the agent and is not validated as a schema.

### Adapter boundary

14. The core application does not parse work records. The `NeKode work record` adapter reads the local block and returns a normalized snapshot. The `Agent Harness` adapter invokes the external `task-status` command and maps its JSON. The core validates only the snapshot shape.
15. A progress adapter is read-only. It never writes a work record, changes a task, or performs lifecycle transitions.
16. The existing adapter protocol v1, typed IPC, scheduler, staleness rules, matching rules, and observation pause rules stay in force.

### Bundled adapters

17. NeKode ships two task-progress adapters:
   - `adapters/task-progress-nekode-work-record/`, id `nekode-work-record`, name `NeKode work record`.
   - `adapters/task-progress-agent-harness/`, id `agent-harness`, name `Agent Harness`.
18. Each adapter directory contains `adapter.json` with `kind: "task-progress"`, protocol version `1`, invocation `node adapter.cjs`, no config fields, and `environments` omitted (default `["local"]`). The implementation file is `adapter.cjs`.
19. Packaging copies both directories to `<resources>/task-progress-adapters/<name>` through `electron-builder.yml` `extraResources`. In an unpackaged checkout they are read from `<appPath>/adapters/<name>`.
20. Discovery reads bundled directories first, then the fixed user directory `<userData>/task-progress-adapters`. A valid user adapter with the same id replaces the bundled adapter. An invalid user adapter is skipped with a warning and does not replace the bundled adapter. Duplicate user ids keep the existing first-in-lexicographic-order rule.
21. Bundled Node adapters run with NeKode's own Node runtime: `process.execPath` and `ELECTRON_RUN_AS_NODE=1`, as the bundled usage adapters do. The RunAsNode fuse stays enabled.
22. `TaskProgressAdapterInfo` gains an optional `bundled: true` flag. It changes no IPC channel and no stored binding.

### NeKode work record adapter

23. The adapter scans `work/` and `work-completed/` under the project root, recursively, for literal `progress.md` files. The candidate identity is the immediate parent directory name. It does not follow symlinks or directory junctions.
24. It returns one task per readable record:
   - `id` and `ref` are the parent directory name.
   - `location` is `live` for `work/` and `archived` for `work-completed/`.
   - `state` is the block `status`.
   - `recordState` is `valid`, `invalid`, or `unsupported` from block validation.
   - `title` is the block `title` or null.
   - `phases`, `currentStepId`, `currentLabel`, `nextAction`, and `blockers` come from the block.
   - `updatedAt` is the block value, or the file modification time when the value is absent.
   - `activity` is null, `corrections` and `reviews` are 0, and `checkpoints` is empty.
   - `path` is the project-relative POSIX path.
25. Invalid and unsupported records are returned with `recordState` and `errors`, and never produce an indicator. A missing block is invalid with the error `missing nekode-state block`.
26. If the same ref exists in both `work/` and `work-completed/`, the live record wins and the archived record is ignored. The `test` summary reports the ignored duplicate. The snapshot contains one task per ref.
27. A missing `work/` or `work-completed/` directory means no records, not an error. An unreadable directory is a typed adapter error.
28. `watch` contains the existing `work/` and `work-completed/` directories recursively. The scheduler handles missing directories with its existing polling rules.
29. `test` returns a bounded summary such as `2 work records, 1 invalid, 1 duplicate ignored`.

### Agent Harness adapter

30. The adapter runs `python .agents/scripts/task-status --json` in the project root. It does not parse `.agents/tasks` records itself. Missing Python, a missing script, or a failed command returns a typed error, never a fallback.
31. The command output must be schema version 2 with a `tasks` array. Invalid JSON, an unsupported schema version, duplicate task ids, or malformed records return a typed error.
32. Each task maps as follows:
   - `id` is the record id; `ref` is the same id.
   - `title` is the record title or null.
   - `state` is `status` (`active`, `blocked`, `completed`).
   - `location` is `archived` when `path` contains `.agents/tasks/archive/`, otherwise `live`.
   - `recordState` maps from `record_state` (`valid`, `invalid`, `unsupported`).
   - `errors` maps from the record errors.
   - `activity` maps from `activity` when present, otherwise null.
   - `phases` maps `number`, `name`, and `steps` with `checked` as `done`.
   - `currentStepId` is `current_step` unless it is `none`.
   - `currentLabel` is the label of the `currentStepId` step.
   - `nextAction` and `blockers` map from the record; `none` becomes null.
   - `updatedAt` is the task record file modification time; `path` is the reported relative path.
   - `corrections` and `reviews` are 0; `checkpoints` maps from `timing.checkpoints`.
33. Completed records remain in the snapshot so the UI can show the last step. Archived unfinished records remain live from the UI perspective and map to `state: active` or `blocked`.
34. `watch` contains `.agents/tasks` recursively. The existing scheduler rules apply.
35. `test` returns a bounded summary such as `2 task records, 1 completed`.

### Step progress UI

36. The `Step progress` tab keeps the existing adapter selector, `None`, config form, `Test`, `Save`, and copy-from-project behavior. It has no template library, no `New template`, and no save-as-template action.
37. The adapter list shows bundled adapters without installation, followed by user adapters. The empty state explains that bundled adapters are included and external adapters are installed in the fixed user directory.
38. Without a binding, step indicators stay hidden. With a binding, the existing left-navigation counter and action-bar segment bar read the snapshot. An invalid or unsupported record shows no indicator; the last-read state and error remain visible in the tab.
39. Projection rules stay unchanged: the current step is `currentStepId` or the first incomplete step; a completed task shows its last step; the chat matches by saved `taskRef` or the ref token in the chat name; a stale snapshot is dimmed with `Out of date:`.
40. No indicator is shown for a record whose `recordState` is not `valid`.

### Compatibility

41. File and directory names stay unchanged: `.nekode/tasks.json`, `work/`, `work-completed/`, `progress.md`, `.agents/tasks/`, `task-status`, `taskctl`.
42. Code identifiers and stored keys stay unchanged: `WorkItem`, `ResumeSource*`, `resume.sources`, `project.resumeTemplate:<projectId>`, `project.taskProgressAdapter:<projectId>`, `project.taskProgressConfig:<projectId>`, `taskProgress:*`.
43. Existing `progress.md` files without a block remain valid for Resume. They show no step indicator until an agent writes the block.
44. Existing external task-progress adapters keep protocol v1. A user adapter with the same id as a bundled adapter replaces it only when valid.
45. The optional `Agent Harness` work record source preset stays available under its current name as an integration preset. Core vocabulary and settings labels do not use `Agent Harness` as a category.
46. Existing Resume discovery, Reserve launch, work item board, Handoff, Continue, Stop, auto-send, and external adapter behavior remain unchanged except for the labels listed above.

## Business rules

- One active work record per work item. A live record wins over an archived duplicate.
- The work record is project data. It contains no secrets and no credentials.
- The board remains the only backlog and the only source of work item state.
- A progress adapter never performs lifecycle writes.
- Invalid or unsupported records are visible as errors, never interpreted as valid progress.
- A missing record, missing block, or missing adapter never falls back to another source or to prose parsing.
- Bundled adapter ids are stable. User overrides apply only to valid manifests.
- The same ref in two projects is two separate work records.

## Authorization

No new access control. Renderer calls stay behind the trusted-sender guard. A renderer names a project and an adapter id; it never supplies a command, path, or adapters directory. Bundled adapter scripts run with the user's process privileges, like external adapters. The NeKode adapter reads only within the project root and rejects symlinks and junctions. The Agent Harness adapter runs the existing read-only `task-status` command in the project root and performs no writes. No progress adapter receives secrets.

## Data / API

### State block

The block is a fenced code block with the exact info string `nekode-state`. Its content is strict JSON. The block is identified by the first line ```` ```nekode-state ```` and the closing fence. Exactly one block is allowed. The 64 KiB bound applies to the block content; the 1 MiB bound applies to the record file.

### Snapshot mapping

Common snapshot fields are `id`, `ref`, `title`, `state`, `location`, `recordState`, `errors`, `activity`, `phases`, `currentStepId`, `currentLabel`, `corrections`, `reviews`, `nextAction`, `blockers`, `createdAt`, `updatedAt`, `completedAt`, `checkpoints`, and `path`.

The NeKode adapter derives `id`, `ref`, `location`, and `path` from the file location; `state`, `phases`, `currentStepId`, `nextAction`, and `blockers` from the block; `recordState` from validation; and `updatedAt` from the block or file mtime. It leaves `activity`, `createdAt`, `completedAt`, `corrections`, `reviews`, and `checkpoints` empty or zero.

The Agent Harness adapter maps the `task-status --json` fields listed in Behaviour 32. It uses the task record file mtime for `updatedAt`.

### Adapter discovery

- Bundled directories: `adapters/task-progress-nekode-work-record` and `adapters/task-progress-agent-harness` in a checkout; `<resources>/task-progress-adapters/<name>` in a packaged app.
- User directory: `<userData>/task-progress-adapters`, one level deep, existing rules.
- The bundled list is a shared constant used by discovery and packaging tests.
- `taskProgress:adaptersList` returns `bundled: true` for bundled adapters. No channel is added or removed.
- `taskProgress:test` runs the selected adapter with the stored or form config. Bundled adapters have an empty config.
- `taskProgress:getBinding`, `saveBinding`, `observe`, `get`, and `changed` are unchanged.

### Work record state block schema

```json
{
  "schemaVersion": 1,
  "status": "active",
  "phases": [
    { "name": "Implementation", "steps": [{ "id": "1.1", "label": "Add the parser", "done": true }] }
  ],
  "currentStepId": "1.1",
  "nextAction": "Add the renderer test",
  "blockers": null,
  "updatedAt": "2026-11-16T12:00:00Z",
  "title": "Work record progress"
}
```

### External command

`python .agents/scripts/task-status --json` is run without a shell in the project root. Its output is one JSON object with `schema_version: 2` and `tasks`. The adapter does not accept a renderer-supplied command or path.

## Edge cases

- Missing `work/` and `work-completed/`: empty snapshot, no error.
- Missing block: task is returned with `recordState: invalid` and no indicator.
- Multiple blocks, invalid JSON, duplicate step ids, unknown `currentStepId`, or an unknown `schemaVersion`: invalid or unsupported, no indicator.
- A block over 64 KiB or a record over 1 MiB: invalid with a size error.
- A symlink or junction named `progress.md` or a `work` directory leaving the project root: excluded, as in the file source.
- Live and archived records share a ref: live wins; the archived copy is ignored and counted in the Test summary.
- A completed record remains in `work/`: it is valid, `location: live`, `state: completed`, and the UI shows the last step.
- A reopened record moves back to `work/`: it becomes live again.
- `task-status` is missing, Python is missing, the command fails, or output is not JSON: typed adapter error, no fallback.
- Duplicate task ids or a malformed task record in `task-status` output: typed protocol error, whole snapshot rejected.
- A user adapter with the same id as a bundled adapter is invalid: bundled adapter stays listed; warning names the skipped directory.
- A bound external adapter is removed: existing `adapter_missing` behavior.
- A WSL project binds a bundled adapter: `environment_unsupported`, no process starts.
- A chat has no matching work item: no indicator, as today.

## Errors

- `config`: invalid stored configuration or unreadable project directory.
- `runtime`: missing Python, missing `task-status`, or a command that cannot start.
- `unsupported_source`: an unsupported task record schema or an unsupported adapter format.
- `protocol`: malformed JSON, duplicate ids, or a response that violates the expected shape.
- `transient`: a temporary read or file race; the existing retry rules apply.
- `internal`: an unexpected adapter failure.
- Invalid and unsupported work records are not adapter errors. They stay in the snapshot with `recordState` and `errors`, and the UI hides their indicator.
- No error is silently converted to an empty success.

## Acceptance criteria

1. The `Step progress` tab lists `NeKode work record` and `Agent Harness` without installing anything, and has no template creation controls.
2. A fixture project with `work/T-1/progress.md` and a valid `nekode-state` block produces a snapshot with `id` and `ref` `T-1`, the phase steps, the current step, and the next action.
3. The same fixture shows the step indicator for a chat matched to `T-1`, and Resume still finds the record through the work record source.
4. A record without a block, with invalid JSON, with duplicate step ids, or with an unknown schema version shows no indicator and a visible reason in the tab.
5. A fixture `task-status --json` response with live, archived, and completed tasks produces the mapped snapshot; completed tasks keep their last step.
6. Missing Python or `task-status`, malformed JSON, unsupported schema, and duplicate ids produce the typed errors and no fallback.
7. A valid user adapter with id `nekode-work-record` or `agent-harness` replaces the bundled adapter; an invalid user adapter does not.
8. The packaged app contains both bundled adapter directories and lists them at runtime.
9. Settings labels are exactly `WORK ITEMS`, `Source`, `Work items`, `Work record`, `WORK RECORD`, `Work record source`, `Work record sources`, and `Step progress`; `Task file` and `Teach agents` stay unchanged.
10. `Task file: .nekode/tasks.json`, `progress.md`, `work-completed`, `WorkItem`, `ResumeSource*`, and existing `taskProgress:*` channels are unchanged.
11. Existing external progress adapters and Resume suites pass unchanged except for label assertions.
12. A live record and an archived record with the same ref produce one task in the snapshot, and the Test summary reports the ignored duplicate.

## Required tests

- Block parser: valid block; missing block; invalid JSON; multiple blocks; unknown fields; duplicate step ids; `currentStepId` without a step; unknown `schemaVersion`; block over 64 KiB; file over 1 MiB.
- NeKode adapter: `work` and `work-completed` scanning; parent identity; live over archived duplicate; missing directories; unreadable directory; symlink and junction exclusion; `test` summary; `watch` paths; snapshot validation.
- Agent Harness adapter: real fixture `task-status --json`; live, archived, and completed tasks; phases and checked steps; current step and label; blockers; missing Python; missing script; non-zero exit; invalid JSON; unsupported schema; duplicate ids; `test` summary; `watch` path.
- Discovery: bundled adapters; user adapter override; invalid user override; duplicate ids; packaged directory resolution; packaging manifest includes both directories.
- Service: binding a bundled adapter; Test; snapshot; observation; stale and missing adapter behavior; no template channels.
- Renderer: exact labels; the separate `Work record` tab and both `Teach agents` sections; bundled adapters listed; no template controls; indicators for valid records; hidden for invalid records; existing matching and staleness behavior.
- Regression: external task-progress adapter host; Resume source discovery and launch; work item board and `local-file`; both `Teach agents` surfaces; settings-dialog-restyle copy assertions.
- Documentation: the work record block is documented in the local task workflow and the skill; no product copy uses `Progress file` or `Task record` as a term.

## Relevant SDD / ADR

- [Project contracts](../../development/project-contract.md) for typed IPC, file boundaries, and decision ownership.
- [Local task workflow](../local-task-workflow/spec.md), [task progress adapters](../task-progress-adapters/spec.md), and [handoff/Resume flow](../handoff-resume-flow/spec.md) for the amended contracts.
- No new ADR. The work record format, bundled adapter rule, and vocabulary are recorded here as the accepted feature decision.
