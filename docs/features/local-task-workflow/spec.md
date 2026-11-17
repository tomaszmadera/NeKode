# Local work items and work records

Status: Delivered in part (local board and work record workflow; the optional integration's board backend still requires upstream work).
Path: `docs/features/local-task-workflow/spec.md`.

This file is the behavioral contract for a feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

## Goal

A project keeps its work items in the built-in `local-file` source and one work record per work item. The same record carries continuation context for Resume and optional Step progress. The local workflow needs no external board service, Python, or workflow installation. Changing the work item source migrates no cards or records.

Users: anyone who wants a local board and an agent that can Handoff and Resume through a work record.

## Related requirements

- [Work record progress](../work-record-progress/spec.md) owns the canonical vocabulary, exact settings labels, state block schema, and bundled progress adapters (NEKODE-192).
- [Project home](../project-home/spec.md) owns `.nekode/tasks.json`, the `local-file` binding, and the agent skill file written by `Teach agents`.
- [Handoff/Resume flow](../handoff-resume-flow/spec.md) owns work record sources, file discovery, and the application-level Resume instruction.
- [Step progress adapters](../task-progress-adapters/spec.md) owns the read-only adapter protocol and Step progress.
- [Kanban adapter interface](../kanban-adapter-interface/spec.md) owns the board, Start, and Resume launch.
- NEKODE-173 introduced the local workflow. NEKODE-187 moved Start and Resume instructions to App Settings, Instructions. NEKODE-192 adds the state block and renames the preset to `Local work record`. UI copy is English.

## Scope

- The `Local work record` preset in App Settings, Work record sources.
- The generated `local-file` agent skill: work record content, state block, Handoff, Resume, Stop, and confirmed completion.
- Explicit source configuration and exact instruction previews.
- A complete T-1 workflow without Python, Plane, or `.agents/scripts/taskctl`.
- The source switch and the boundary of the optional integration.

## Non-goals

- Another backlog or a new card format.
- Automatic card migration, work record creation, source binding, or `.gitignore` edits.
- Parsing work records as board items or deriving board state from step data.
- Installing a workflow, running lifecycle commands, or implementing the upstream integration's board backend.
- Changes to Start, Resume matching and launch, Handoff delivery, Continue, or Stop.

## Behaviour

1. One backlog. `.nekode/tasks.json` remains the only board authority for a `local-file` project. A work record holds execution context and step data, never a second task list, TODO list, or source of board state.
2. Work record location. The agent creates or updates `work/<ref>/progress.md` under the project root when starting work. There is at most one active local work record per work item. The directory name is the complete ref, for example `T-1`; the file name is literally `progress.md`. NeKode never creates, writes, or repairs it.
3. Ready source. App Settings, Work record sources offers `Local work record` with exactly these file-source values: directory `work`, file-name filter `progress.md`, `Search subdirectories` on, `Candidate identity` set to `Immediate parent directory`. It fills only discovery values. The Resume instruction is shared across projects in App Settings, Instructions; its default is `Resume task {taskPath}`.
4. Explicit configuration. Choosing the preset fills an unsaved source form. Save the source and bind it as the project's `Work record source` explicitly. These actions create no directory, record, or workflow installation. Source values remain editable. Shared edits affect every project bound to that source.
5. Exact visibility. Source Test shows each candidate identity and display path plus the instruction composed from the saved application Resume instruction. Project Settings shows the selected source summary and effective Resume instruction with origin App Settings. `Teach agents` shows the exact skill path and full text.
6. Agent instructions. The work record's prose states the ref and title; finished and current work; decisions and reasons; check commands and results; blockers; one exact next action naming a file or command; and the UTC update time. It contains exactly one `nekode-state` block described below. The agent keeps the block and prose aligned on every update and replaces the block rather than appending another.
7. Handoff. The configured instruction (default `Write a handoff`) asks the agent to update the work record, including block and prose, leave the card In Progress, and stop. Handoff is an action. The work record carries the context; no separate handoff file is created. Sending text does not prove that the record was updated.
8. Stop and Continue. Stop sends `Ctrl+C`; it is an interruption and writes no record by itself. Continue addresses the running conversation without selecting a work item or record. When asked to continue after Stop, the agent reconciles the existing work record with repository evidence.
9. Resume. The agent reads the discovered work record before changing files, checks its claims, and continues from its next action. Missing or stale context is reported, never invented. Matching uses the complete ref, case-insensitively: identity equals the ref or starts with it followed by `-`. `T-1` matches `T-1-follow-up`, never `T-10` or `old-T-1`.
10. Confirmed completion. Only after the user confirms completion and the card is in Done, the agent sets block `status` to `completed`, aligns the final prose and checks, and moves the record to `work-completed/<ref>/progress.md`. Resume no longer discovers it through the configured `work` source. The archived work record is preserved; deletion needs an explicit request. Reopening moves it back and updates block and prose to the actual active or blocked state.
11. Discovery and progress are separate. The Files work record source lists readable matching regular files without parsing their body or inferring completion. A completed record left in `work/` still matches Resume. The `NeKode work record` progress adapter reads the state block in both `work/` and `work-completed/`, with a live record winning over an archived duplicate. Invalid or unsupported records show no indicator and a visible reason in Step progress. Records without a block still work for Resume.
12. Work item source switch. Changing between Plane and `local-file` changes the board binding only. It migrates no cards, moves or deletes no files, changes no work record source binding, and rewrites no agent skill file. Bind and teach the new source explicitly.
13. Optional integration. The `Agent Harness` work record source preset discovers the external format using `taskctl list --json`. The separately selected `Agent Harness` progress adapter invokes the existing read-only `python .agents/scripts/task-status --json` command. It does not install a workflow or provide a board backend. An upstream backend linking `.nekode/tasks.json` cards to the external records remains required for that integrated board workflow. Reuse the complete ref and keep one work record, never a parallel `progress.md`.
14. Optional Step progress. Choose a progress adapter explicitly in Project Settings, Step progress. Both `NeKode work record` and `Agent Harness` are bundled, have no configuration fields, and support local projects only in this delivery. A WSL binding reports `environment_unsupported` without starting a process. No binding or matching record means no indicator. Step progress never changes board state or performs lifecycle writes.

## Work record state block

The block uses the exact opening fence ```` ```nekode-state ```` and a closing fence. Its content is strict JSON. This is an example record for a work item whose next action is to edit `CHANGELOG.md`:

````markdown
# T-1: Write the release note

The release note is in progress. Next action: edit CHANGELOG.md.
Checks: none yet. Blockers: none. Updated: 2026-11-17T12:00:00Z.

```nekode-state
{
  "schemaVersion": 1,
  "status": "active",
  "phases": [
    {
      "name": "Implementation",
      "steps": [
        { "id": "1.1", "label": "Write the release note", "done": false }
      ]
    }
  ],
  "currentStepId": "1.1",
  "nextAction": "Edit CHANGELOG.md",
  "blockers": null,
  "updatedAt": "2026-11-17T12:00:00Z",
  "title": "Write the release note"
}
```
````

Required fields are `schemaVersion` (integer `1`), `status` (`active`, `blocked`, or `completed`), and `phases` (an array, possibly empty). Each phase has a nonblank string `name` and an array `steps`. Each step has a nonblank string `id` unique across the record, a nonblank string `label`, and boolean `done`.

Optional fields are `currentStepId` (string naming an existing step or null), `nextAction` and `blockers` (string or null), `updatedAt` (ISO 8601 UTC string), and `title` (string). Unknown fields are ignored. Invalid JSON, duplicate ids, an unknown current step, multiple blocks, or a block content over 64 KiB make a record invalid. An unsupported `schemaVersion` is unsupported. The entire record must be at most 1 MiB. Prose outside the block is for the agent and has no schema.

The [work record progress contract](../work-record-progress/spec.md#work-record-state-block-schema) owns the schema and adapter mapping. The application core validates only normalized snapshots, never this block.

## Complete T-1 example

1. Project Settings, Work items: choose `Use a local task list`. NeKode creates `.nekode/tasks.json` at revision 1 and binds `Local file`.
2. Board, `New task`: create `Write the release note` in Todo. The ref is `T-1` and revision becomes 2.
3. Project Settings, Work items, `Teach agents`: review the full agent skill file at `.agents/skills/nekode-tasks/SKILL.md`, then confirm the write.
4. App Settings, Work record sources: create a source using `Local work record`, save it, and bind it in Project Settings, Work items, Work record source. Optionally select `NeKode work record` in Step progress and Save. Neither action creates a record.
5. Board, Start: the agent receives the full ref and work item details, the card moves to In Progress, and the agent writes `work/T-1/progress.md` with prose and one state block.
6. Handoff sends the configured instruction. The agent updates block and prose and stops, leaving the card In Progress.
7. Resume finds identity `T-1`. Confirm starts a new chat with the saved application instruction, by default `Resume task work/T-1/progress.md`. The agent reads and reconciles the work record, then continues. `T-10` does not match.
8. After confirmed completion and Done, the agent marks the block completed and moves the record to `work-completed/T-1/progress.md`. Resume disappears; Step progress can retain the last step.
9. Reopening moves the work record back and updates its state. Resume works again.

The UI displays paths with runtime separators; instructions use project-relative forward slashes.

## Business rules

- Refs are opaque identifiers. Titles and prose do not create matches.
- A work record contains no secrets or credentials.
- Board state and step state are distinct; only the work item source owns the board.
- Ambiguous Resume candidates block launch; the application never chooses the newest.
- A work item can exist without a work record. Start remains available; Resume and the step indicator are unavailable.
- The agent owns archiving. The core application never creates, cleans, or directly reads `work-completed/`; the read-only progress adapter scans it.

## Authorization

Existing trusted-sender, project root, task-file write, agent skill file confirmation, and Resume launch boundaries stay unchanged. Preset selection writes no files and binds no project. The agent writes the work record under the user's process privileges, through no new IPC channel.

## Data / API

- No new IPC channel, database table, migration, or app_state key.
- The preset is an ordinary `ResumeSourceTemplate` with `{ kind: 'files', directory: 'work', pattern: 'progress.md', recursive: true, identity: 'parent' }`.
- `resumeSources` operations, stored ids and `project.resumeTemplate:<projectId>` bindings keep their names.
- `buildAgentSkill` still generates the `local-file` text in main at the existing destination. The revision and parallel-write rules for `.nekode/tasks.json` remain unchanged.
- Existing records are not migrated. Missing blocks hide only Step progress.

## Edge cases and errors

- Missing or unreadable `work/`: visible Files source error with Retry; board and Start remain available. The progress adapter instead treats missing scan directories as an empty snapshot.
- Invalid encoding or oversize discovery candidate: existing file-source rejection with path and reason; other candidates remain available.
- Invalid or unsupported state block: no indicator; error visible in Step progress; no prose parsing or repair fallback.
- No bound work record source: Resume offers configuration; the board still works.
- A record changes while Resume is open: fingerprint revalidation rejects launch and requests a refresh.
- A candidate with no corresponding board card has no board Resume action.
- Optional integration command, runtime, or backend missing: visible error, no substitute record.
- A skill write failure preserves the previous skill file and reports its typed error.

## Acceptance criteria

1. A fixture without Python, Plane, or `taskctl` can Start, write a work record, and discover it through Files.
2. `Local work record` fills the exact source values only; saving and binding are explicit, and Test previews the saved application instruction.
3. Full-ref matching, stale-launch rejection, local card CRUD, and revision conflicts remain unchanged.
4. The generated skill documents the prose, exactly one valid state block, its required and optional fields, bounds, synchronization, and lifecycle.
5. Handoff updates and stops; Stop writes nothing itself; only confirmed completion plus Done archives the completed record.
6. The bundled `NeKode work record` adapter reads valid steps; missing or invalid blocks hide indicators without changing Resume.
7. Switching work item sources migrates nothing and changes no work record source binding or skill file.
8. The optional integration uses one record with the full ref and clearly separates discovery, progress, and the still-required upstream board backend.

## Required tests

- Local fixture: Start, write, Files discovery with parent identity, `T-1` versus `T-10`, missing record, archive, and reopening, without Python or external calls.
- Skill text: parse the example as strict JSON through the bundled adapter; assert one block, schema guidance, bounds, prose alignment, Handoff/Stop/Resume, and confirmed-completion archive instructions.
- Regression: `Teach agents` preview and writes, local card CRUD and conflicts, Resume matching and launch, and exact source preset values.
- Documentation: relative links exist; retired product terms appear only in technical storage or external-format descriptions.

## Relevant SDD / ADR

- [Project contracts](../../development/project-contract.md) for IPC, file boundaries, and decision ownership.
- No new ADR; NEKODE-192 records the accepted work record format and vocabulary.
