# Task progress example adapter

Example adapter for the NeKode task progress protocol v1. It reads one JSON file
in the snapshot format from the project and returns it to NeKode. Use it to try
the `Task progress` tab and as a starting point for your own adapter.

NeKode does not ship any task progress adapter. This directory is not packaged
with the application; you install an adapter yourself, and NeKode runs it only
after you select it in Project Settings > `Task progress`.

| File | Purpose |
| --- | --- |
| `adapter.json` | Manifest: id `task-progress-example`, invocation `node adapter.cjs`. |
| `adapter.cjs` | The adapter (Node.js, standard library only). |
| `example-snapshot.json` | A snapshot file with one task, to copy into a project. |

## Requirements

A `node` executable (Node.js 20 or newer) on `PATH`. NeKode starts
`node adapter.cjs` with the working directory set to the adapter directory.

## Install

NeKode reads adapters from one fixed directory, `task-progress-adapters` in the
application data directory. There is no setting to change it. Each subdirectory
with a valid `adapter.json` is one adapter. Copy this directory there:

```powershell
# Windows
New-Item -ItemType Directory -Force "$env:APPDATA\nekode\task-progress-adapters" | Out-Null
Copy-Item -Recurse -Force "<nekode>\adapters\task-progress-example" "$env:APPDATA\nekode\task-progress-adapters\task-progress-example"
```

```sh
# Linux
mkdir -p ~/.config/nekode/task-progress-adapters
cp -r <nekode>/adapters/task-progress-example ~/.config/nekode/task-progress-adapters/task-progress-example
```

An adapter from another repository installs the same way. For the Agent Harness
adapter (its path in the agent-harness repository, `adapters/nekode-task-progress`,
is still to be confirmed when that adapter is created):

```powershell
# Windows
New-Item -ItemType Directory -Force "$env:APPDATA\nekode\task-progress-adapters" | Out-Null
Copy-Item -Recurse -Force "<agent-harness>\adapters\nekode-task-progress" "$env:APPDATA\nekode\task-progress-adapters\agent-harness"
```

```sh
# Linux
mkdir -p ~/.config/nekode/task-progress-adapters
cp -r <agent-harness>/adapters/nekode-task-progress ~/.config/nekode/task-progress-adapters/agent-harness
```

The `Task progress` tab rescans the directory each time it opens, so a new
adapter appears without restarting NeKode.

## Try it

1. Install the adapter as above.
2. In a project, create `.nekode/task-progress.json` with the content of
   `example-snapshot.json`.
3. Open Project Settings > `Task progress`, choose `Example: JSON snapshot file`,
   keep the default path, and press `Test`. The tab shows
   `Found 1 task in .nekode/task-progress.json.`
4. Press `Save` to bind the adapter to the project.

## Manifest

```json
{
  "id": "task-progress-example",
  "name": "Example: JSON snapshot file",
  "kind": "task-progress",
  "protocolVersion": 1,
  "invocation": { "command": "node", "args": ["adapter.cjs"] },
  "environments": ["local", "wsl"],
  "configSchema": [
    { "key": "path", "label": "Snapshot file (relative to the project root)", "type": "string", "required": true, "default": ".nekode/task-progress.json" }
  ]
}
```

- `id`: kebab-case (`[a-z0-9-]`). With two directories declaring the same id,
  the first directory in lexicographic order wins and the other is skipped.
- `kind` must be `"task-progress"` and `protocolVersion` must be `1`; any other
  manifest is skipped with a warning in the tab and the main-process log.
- `invocation`: `command` and optional `args`, run as argv without a shell.
- `environments`: `"local"` and/or `"wsl"`; the default is `["local"]`.
- `configSchema[]`: `{ key, label, type, required?, options?, default? }`.
  `type` is `string`, `select` (needs `options`), or `boolean`. There are no
  secret or directory fields in v1.

## Protocol

One process per request. NeKode writes one JSON object to stdin and closes
stdin, then reads stdout to EOF and expects exactly one JSON object.

- Success: `{ "ok": true, "data": { ... } }` and exit code `0`.
- Failure: `{ "ok": false, "error": { "code": "...", "message": "..." } }` and
  exit code `1`.
- Anything else (another exit code, invalid JSON, two objects, no output, an
  unknown error code) is a protocol error.
- stderr is for diagnostics only. NeKode writes its tail to the main-process
  log and never shows it in the UI.
- Limits: 15 s per request (NeKode then kills the whole process tree) and
  10 MB of stdout.

### Request

```json
{
  "protocolVersion": 1,
  "action": "test",
  "config": { "path": ".nekode/task-progress.json" },
  "project": { "root": "D:\\code\\demo", "environment": "local" }
}
```

- `config` holds the field values from the tab as strings (`boolean` fields as
  `"true"` or `"false"`). NeKode never passes them in argv or environment
  variables.
- `project.root` is the project path on the host. For a WSL project it is the
  UNC path (`\\wsl.localhost\<distribution>\...`), and `project` also carries
  `"environment": "wsl"`, `distribution`, and `linuxRoot` (the Linux path).
- The adapter always runs on the host. If it must run a command inside a WSL
  project, it starts it in that distribution itself, for example with
  `wsl.exe -d <distribution> --cd <linuxRoot> -- <command>`. NeKode does not run
  Windows commands inside WSL projects, and it refuses `Test` and reads for a
  WSL project when the manifest lacks `"wsl"` (`environment_unsupported`).

### Actions

- `test`: check the configuration against the project and return
  `{ "summary": "..." }`, a short text of at most 500 characters, for example
  the number of records found. `Test` in the tab sends the values currently in
  the form, also unsaved ones.
- `snapshot`: return the snapshot below.

### Snapshot (`schemaVersion: 1`)

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-10-23T09:27:37Z",
  "watch": [{ "path": ".agents/tasks", "recursive": true }],
  "tasks": [
    {
      "id": "nekode-101-palette-tokens",
      "ref": "NEKODE-101",
      "title": "NEKODE-101: Palette tokens",
      "state": "completed",
      "location": "archived",
      "recordState": "valid",
      "errors": [],
      "activity": "idle",
      "phases": [
        { "name": "Intake", "steps": [{ "id": "Phase 0.1", "label": "Inspect the repository", "done": true }] }
      ],
      "currentStepId": null,
      "currentLabel": null,
      "corrections": 0,
      "reviews": 0,
      "nextAction": null,
      "blockers": null,
      "createdAt": "2026-10-23T09:14:09Z",
      "updatedAt": "2026-10-23T09:27:37Z",
      "completedAt": "2026-10-23T09:27:37Z",
      "checkpoints": [{ "stepId": "Phase 0.1", "completedAt": "2026-10-23T09:14:57Z" }],
      "path": ".agents/tasks/archive/nekode-101-palette-tokens/task.md"
    }
  ]
}
```

- Required per task: `id` (1-120 characters, unique in the snapshot), `state`
  (`active | blocked | completed`), `location` (`live | archived`),
  `recordState` (`valid | invalid | unsupported`), and `phases` (may be empty
  only when `recordState` is not `valid`). Each step has a non-empty `id`
  (unique within the task), a `label`, and `done`.
- Optional: `ref`, `title`, `errors` (list of texts), `activity`
  (`working | waiting | idle`), `currentStepId` (must name an existing step),
  `currentLabel` (up to 40 characters), `corrections` and `reviews`
  (non-negative numbers), `nextAction`, `blockers` (`null` means none), ISO 8601
  UTC timestamps, `checkpoints`, and `path` (relative, informational).
- `archived` with `state: "active"` or `"blocked"` means a record archived while
  closing, not a finished task. Only `state: "completed"` is finished.
- `watch[]`: at most 8 directories relative to `project.root`, without `..` or
  absolute paths. NeKode watches them and asks for a new snapshot after a change.
- Unknown fields are ignored. A missing required field, a wrong type, a
  duplicate `id`, or a `currentStepId` without its step makes the whole snapshot
  a protocol error. An empty `tasks` list means no tasks.

This example returns the file content as the snapshot. Without a `watch` entry
in the file it watches the directory that holds the file.

### When NeKode reads

- Only projects with a saved adapter that are selected or expanded in the left
  navigation are read. A project leaving that set stops at once; a running
  adapter process is killed and its result discarded.
- The first read runs when observation starts. A change in a `watch` directory
  triggers a read after 300 ms of quiet; a burst of changes gives one read.
- Fallback polling runs every 60 s while watching works and every 10 s when it
  does not (missing directory, watch error, empty `watch`, or a WSL project,
  which is never watched). Reads start at least 2 s apart, and one project has
  at most one read running; changes during a read give one follow-up read.
- A hidden or minimized window pauses reads; showing it runs one overdue read.
- `transient`, `protocol`, and `timeout` failures are retried after 1, 2, and
  4 s, subject to the 2 s minimum between read starts. The last snapshot stays
  current while the tab shows the retry error; then it is marked out of date.
- `config`, `runtime`, `unsupported_source`, `environment_unsupported`,
  `adapter_missing`, and `spawn` mark the snapshot out of date at once and stop
  automatic reads until the binding is saved, `Test` runs, or a watched
  directory changes. `internal` marks it out of date and polling continues.
- A task missing from a snapshot stays until a confirming read, scheduled 1 s
  later and subject to the same 2 s minimum, also lacks it. This covers a record
  being moved to the archive.

### Error codes

| Code | Meaning |
| --- | --- |
| `config` | The configuration does not fit the project (for example a missing file). |
| `runtime` | A program, interpreter, or source command is missing. |
| `unsupported_source` | The source format or version is not supported by the adapter. |
| `transient` | A short-lived state, for example a record being moved to the archive; NeKode retries. |
| `internal` | Any other adapter failure. |

NeKode adds its own codes: `adapter_missing`, `environment_unsupported`,
`timeout`, `protocol`, and `spawn` (the command could not be started).

## Notes for the Agent Harness adapter

The default `task-status --json` (`schema_version: 2`) skips completed records
in the archive (`.agents/scripts/task-status`, `discover_paths`). An adapter
that must return finished tasks passes the record paths explicitly.
