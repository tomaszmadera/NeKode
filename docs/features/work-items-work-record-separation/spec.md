# Work items and work record: separate settings and agent skills

Status: Delivered (separate `Work items` and `Work record` tabs and two independent skill files; existing projects re-teach explicitly).
Path: `docs/features/work-items-work-record-separation/spec.md`.

This file is the behavioral contract for a feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

## Goal

A project configures work items and work records as two independent concerns. Each concern has its own Project Settings tab, its own binding, its own `Teach agents` action, and its own agent skill file. A project can use one, the other, or both, and an agent learns only the concern that the project actually uses.

Users: anyone who keeps a board, a work record, or both for a project, and any agent that reads NeKode project skills.

## Related requirements

- [Project home](../project-home/spec.md) owns the work item source, the board, and the work item skill text. This spec supersedes its one-file rule for `Teach agents` and its `local-file` skill text that embeds the work record convention.
- [Local task workflow](../local-task-workflow/spec.md) owns the `Local work record` preset and the local work record prose and `nekode-state` convention. This spec moves that teaching out of the work item skill.
- [Handoff/Resume flow](../handoff-resume-flow/spec.md) owns work record sources, application instructions, and the current `WORK RECORD` section inside the `Work items` tab. This spec moves that section to its own tab.
- [Work record progress](../work-record-progress/spec.md) owns the vocabulary, exact labels, and the state block. This spec adds the separate tab and the second skill file.
- [Kanban adapter interface](../kanban-adapter-interface/spec.md) owns external work item adapters and their optional `agentSkill` body.
- [UX-UI](../../UX-UI.md) section 32 owns the settings label table.
- User decision 2026-11-20: separate the two settings surfaces and use two independent skill files. A combined skill was rejected because the bindings are independent and a combined `description` would load irrelevant instructions or miss the relevant ones.

## Scope

- Project Settings navigation: a new `Work record` tab, ordered after `Work items`.
- `Work items` tab: `WORK ITEMS` and `AGENTS` only.
- `Work record` tab: `WORK RECORD` and `AGENTS` only.
- Removal of the application-level `HANDOFF AND INSTRUCTIONS` block from Project Settings.
- App Settings, Instructions: the `Auto-send after Handoff and Resume` switch.
- Two independent agent skill files:
  - `.agents/skills/nekode-tasks/SKILL.md` for work items.
  - `.agents/skills/nekode-work-record/SKILL.md` for work records.
- Work record skill text selected by the bound work record source.
- Documentation and test updates for both surfaces.

## Non-goals

- Changing work item source discovery, board behavior, adapter protocol, card CRUD, Start, Resume matching, or Resume launch.
- Changing work record source discovery, matching, fingerprints, bindings, or the `resumeSources` data model.
- Adding an optional `agentSkill` field to `ResumeSourceTemplate`. This delivery generates text from the source kind and preset values.
- Automatic migration or rewriting of existing skill files. Re-teaching is explicit.
- Per-agent skill folders, `.claude/skills`, `.grok/skills`, or a skill marketplace.
- Creating, repairing, or migrating work records or work items.
- Changing Step progress adapters or their bindings.
- Translating the UI. Copy stays English.
- SSH project support for local skill files. The existing local-file boundary is unchanged.

## Behaviour

### Settings surfaces

1. Project Settings navigation order is `Shell`, `Actions`, `Work items`, `Work record`, `Step progress`, `Agents`.
2. The `Work items` tab contains:
   - `WORK ITEMS`: the source select, the `Task file: .nekode/tasks.json` line for `local-file`, the adapter fields, Test, and Save.
   - `AGENTS`: `Teach agents how to use this work item source` and its `Teach agents` button, shown only while a work item source is bound.
   It contains no work record selector, no work record summary, and no Handoff or instructions block.
3. The `Work record` tab contains:
   - `WORK RECORD`: the `Work record source` select, the `None (Unconfigured)` option, the selected source summary, `Manage sources`, and Save.
   - `AGENTS`: `Teach agents how to keep this project's work record` and its `Teach agents` button, shown only while a work record source is bound.
   It contains no work item source, no task file line, and no Handoff or instructions block.
4. `HANDOFF AND INSTRUCTIONS` is removed from Project Settings. The `Auto-send after Handoff and Resume` switch moves to App Settings, Instructions. Start, Resume, Handoff, and Continue remain there and are unchanged.
5. The `Work record` tab description still states that the Resume instruction is set in Application settings, Instructions.
6. A project binding to a work item source is independent from its binding to a work record source. Any combination of bound and unbound is valid.

### Work item skill

7. `Teach agents` in `Work items` writes only `.agents/skills/nekode-tasks/SKILL.md`.
8. The text is chosen by the bound work item source exactly as today:
   - `local-file`: the built-in work item text.
   - A process adapter with `agentSkill`: NeKode front matter plus the adapter body.
   - Any other process adapter: the built-in default text naming that adapter.
9. The work item text contains only work item instructions: the source location or tracker, the local file shape and revision rule when applicable, one backlog, and the prohibition on a second task list or TODO file.
10. The work item text contains no work record location, no record prose template, no `nekode-state` block, no Handoff, Stop, or Resume procedure, and no completion move to `work-completed`.
11. The work item text may state that a work record, when the project has one, holds execution context and is not a second backlog. It does not describe the record format.
12. The work item skill contains no work record source name, path, preset values, or work record examples.

### Work record skill

13. `Teach agents` in `Work record` writes only `.agents/skills/nekode-work-record/SKILL.md`.
14. The text is chosen by the bound work record source:
    - The exact `Local work record` preset (`files`, directory `work`, pattern `progress.md`, recursive, identity `parent`): the local record text.
    - The `Agent Harness` source (`command`, protocol `agent-harness`, executable `python`, args `.agents/scripts/taskctl list --json`): the Agent Harness text.
    - Any other `files` source: a file-source text that names the configured directory, pattern, recursion, and identity rule.
    - Any other `command` source: a neutral command-source text.
    - No bound source: no `Teach agents` action and no preview.
15. The local record text states:
    - the record lives at `work/<ref>/progress.md`, with the complete ref as the directory name and the literal file name `progress.md`;
    - the prose states the ref and title, finished and current work, decisions and reasons, checks with commands and results, blockers, one exact next action naming a file or command, and the UTC update time;
    - the record contains exactly one fenced `nekode-state` block with the schema owned by [work record progress](../work-record-progress/spec.md);
    - Handoff updates the record, leaves the card In Progress, and stops; Stop is not a Handoff; Resume reads the record before changing files and continues from its next action;
    - after confirmed completion and only when the card is Done, the record moves to `work-completed/<ref>/progress.md` and is kept;
    - the board remains authoritative for work item state and status; the record is never a second backlog.
16. The Agent Harness text states:
    - the project keeps work records in the Agent Harness format and its own workflow owns creation and updates;
    - NeKode discovers records with `python .agents/scripts/taskctl list --json` and never creates, repairs, or migrates them;
    - the agent does not create `work/<ref>/progress.md` or any other parallel local record;
    - Handoff, Stop, Resume, and completion keep the meanings in Behaviour 15, using the Harness record as the context;
    - the board remains authoritative for work item state and status.
17. A custom file-source text names the configured directory, pattern, recursion, and identity rule, and tells the agent to write a record that the source can find. It may include an optional `nekode-state` block for Step progress, but it does not claim the `work/<ref>` convention and does not require the block for Resume.
18. A custom command-source text states that the project's work record source is an external command, that the project's own workflow owns its records, and that the agent must not create a parallel local record. It guesses no location and no command.
19. The work record text contains no work item file shape, no board revision rule, and no work item source name. It may state that the board is authoritative and that the agent uses the ref NeKode gives it.
20. The work record text contains no work item list, no existing record content, and no secrets.

### Teach preview and write

21. Both `Teach agents` actions use the same dialog semantics:
    - the path and whether the write creates or replaces a file;
    - the origin of the text;
    - the exact full text in a scrollable monospace block;
    - a line diff when replacing, `No changes` when equal, and a hidden-current-file notice when the current file is not valid UTF-8 or exceeds 256 KiB;
    - the boundary note `Writing this file installs and configures nothing. Agents that do not read project skills ignore it.`;
    - the project's selected agent profile names, or the existing empty-profile message.
22. The work item origin labels stay `Local file instructions`, `Instructions from the {name} adapter`, and `NeKode default instructions for {name}`.
23. The work record origin labels are `Local work record instructions`, `Agent Harness instructions`, `Instructions for the {name} file source`, and `Instructions for the {name} command source`.
24. Confirm writes exactly the previewed text. The renderer sends only the project id and the preview token; main rebuilds the text from the bound source and the current file.
25. A changed source, a changed source library entry, or a changed current file between preview and Confirm writes nothing and returns `conflict`; the dialog shows `The skill file or its source changed. Review the new preview.` and loads a new preview that needs its own confirm.
26. Clearing the surface's binding while its dialog is open closes that dialog and writes nothing. Changing the binding reloads the preview.
27. Cancel and a failed write leave the previous file unchanged.
28. The two `Teach agents` actions are independent. Confirming one never writes, deletes, renames, or reads the other skill file as a write target.
29. Both files can exist at the same time. Teaching work items again does not change the work record skill, and teaching work records again does not change the work item skill.
30. Clearing a binding does not delete either skill file. The old file remains until the user explicitly teaches again or edits it outside NeKode.

### Existing projects

31. No automatic rewrite. A project taught before this change keeps its existing `nekode-tasks` file until the user teaches work items again.
32. The existing `nekode-tasks` file may still contain the old combined work record content. Re-teaching work items replaces it with the work item-only text. The work record skill is written only by the new `Teach agents` action in the `Work record` tab.
33. The first work record `Teach agents` creates `.agents/skills/nekode-work-record/SKILL.md`; it does not move or delete the old content from `nekode-tasks`.

### Boundary and environment

34. Both writes stay inside the stored project root, use the same root the file tree reads, create only the missing `.agents`, `.agents/skills`, and surface directory segments one at a time, and replace the file by a temp file in the same directory plus a rename.
35. No shell runs. No adapter process runs. No source command runs during preview or write.
36. A WSL project uses its stored UNC path as the root. An SSH project is unsupported for local skill files, as it is for the work item skill today.
37. The work record skill contains no work item items and no secrets. The work item skill contains no work record content and no secrets.

## Business rules

- One work item source and one work record source per project. Each binding is independent and may be absent.
- The work item source is the board authority. The work record is execution context, never a second backlog or a board state source.
- A work record source owns discovery only. The skill text is derived from the source kind and preset values; it is not stored in the source template.
- The work record skill is written per project. The work record source library is shared by reference, so editing a shared source affects every project that binds it; each project must re-teach to pick up the new text.
- The skill text is generated by main. The renderer never sends skill text, a path, or a source configuration.
- The work item skill and the work record skill have separate front matter, separate descriptions, separate tokens, and separate files.
- `Teach agents` is available only while the corresponding source is bound.

## Authorization

Renderer calls stay behind the existing trusted-sender guard. The work record skill preview and write accept only a known project id. The write accepts only the preview token. Main writes only the bound project's root and only the work record skill path. No other project is read or written.

## Data / API

- New constant `WORK_RECORD_SKILL_FILE_PATH = '.agents/skills/nekode-work-record/SKILL.md'`. The existing `AGENT_SKILL_FILE_PATH` stays `.agents/skills/nekode-tasks/SKILL.md`.
- Shared preview shape: `{ path, origin, sourceName, exists, current, text, token }`. `origin` adds `local-progress`, `agent-harness`, `file-source`, and `command-source` to the existing work item origins.
- New IPC channels:
  - `resumeSources:skillPreview(projectId)` returns the work record preview.
  - `resumeSources:writeSkill(projectId, token)` writes the previewed work record text.
- Both channels take one non-empty registered project id, and the write takes a 64-character lowercase hex token. They use the same validation and error transport as `kanban:skillPreview` and `kanban:writeSkill`.
- The existing `kanban:skillPreview` and `kanban:writeSkill` remain the work item operations and keep their payloads, semantics, and path.
- `ResumeSourcesService` gains `skillPreview` and `writeSkill`. It resolves the project's binding, rejects when no source is bound or the bound source is missing, builds the text from the saved source, and delegates to the shared skill-file writer.
- The shared skill-file writer is parameterized by the surface path segments. The existing work item writer behavior, containment checks, temp-file rename, and token format are unchanged.
- No SQLite migration. No new `app_state` key. The auto-send storage stays `handoffResume.autoSend` with the existing `'1'`/`'0'` semantics.
- `ResumeSourceTemplate` and its schema are unchanged. No `agentSkill` field is added in this delivery.

## Edge cases

- Only work items bound: the `Work record` tab shows `None (Unconfigured)`, no `Teach agents`, and no skill write.
- Only work record bound: the `Work items` tab shows no `Teach agents`; the board welcome or setup state is unchanged.
- Both bound: two tabs, two Teach actions, two files, independent previews and tokens.
- Source deleted while bound: the `Work record` tab still shows the binding but the preview rejects with `validation_error` and writes nothing. The selector shows `None (Unconfigured)` after the next library load, matching the existing selection behavior.
- Source edited while the dialog is open: the next Confirm returns `conflict` and reloads the preview.
- Existing file written for the other surface: the diff shows the whole replacement, and the other file is untouched.
- Current file larger than 256 KiB or not valid UTF-8: the dialog hides the current text, still allows the replace, and the diff area uses the existing hidden-current notice.
- No selected agent profiles: the dialog still offers the file and says that no profile is selected.
- Project removed while a write is in flight: the write is dropped and the file is not deleted.
- A project has a work record file but no work record source: Resume does not discover it and no work record skill is offered. The file is not deleted.
- A custom file source points outside the project: discovery keeps its existing boundary. The work record skill names the configured values but does not grant a write outside the project root; the skill file itself is still written only under the project root.
- A custom command source has no known record format: the text is neutral and the agent asks the user rather than inventing a record location.

## Errors

- Unbound source on preview or write: `validation_error` naming the missing binding.
- Bound source deleted or missing: `validation_error`; nothing is written.
- Bad project id, missing token, or malformed token: the existing typed validation error for the channel.
- Existing segment or skill file resolves outside the project root: `validation_error`; nothing is written outside.
- A link that exists but cannot be resolved: `unknown` naming the relative path.
- IO failure: `unknown` with the relative path; the previous file stays unchanged.
- Stale token: `conflict`; nothing is written and a new preview is required.
- No text is guessed for an unknown source kind. There is no silent fallback to the local work record text or the work item text.

## Acceptance criteria

1. Project Settings shows `Work items` and `Work record` as separate tabs, in that order, with `Step progress` after them.
2. `Work items` contains only `WORK ITEMS` and `AGENTS`. It has no `WORK RECORD` section and no `HANDOFF AND INSTRUCTIONS` block.
3. `Work record` contains only `WORK RECORD` and `AGENTS`. It has no work item source and no Handoff or instructions block.
4. `Teach agents` in `Work record` is absent with no source and present with a bound source. The same rule holds for `Work items`.
5. `Teach agents` in `Work items` writes only `.agents/skills/nekode-tasks/SKILL.md`, and its text has no work record location, state block, Handoff, Resume, Stop, or completion procedure.
6. `Teach agents` in `Work record` writes only `.agents/skills/nekode-work-record/SKILL.md`, and its text has no work item file shape or revision rule.
7. The local work record text contains the `work/<ref>/progress.md` convention, the prose requirements, exactly one `nekode-state` block, Handoff, Stop, Resume, and the `work-completed` completion move.
8. The Agent Harness text uses `taskctl list --json`, forbids `work/<ref>/progress.md` and any parallel local record, and does not claim a local file format.
9. A custom file source names its directory, pattern, recursion, and identity. A custom command source is neutral and guesses no location.
10. Both previews show the path, new or replace, origin, full text, diff when replacing, boundary note, and profile names. A stale token returns `conflict` and writes nothing.
11. Teaching one surface leaves the other skill file byte-for-byte unchanged. Clearing a binding leaves both files in place.
12. `Auto-send after Handoff and Resume` is in App Settings, Instructions, keeps `handoffResume.autoSend`, and no longer appears in Project Settings.
13. Existing projects need an explicit re-teach. No skill file is rewritten automatically.
14. The work record source schema, discovery, binding, Resume matching, and Resume launch are unchanged.
15. Exact labels: `Work items`, `Work record`, `WORK ITEMS`, `WORK RECORD`, `Work record source`, `Teach agents`. Saved code identifiers and keys keep their compatibility names.

## Required tests

- Renderer: tab order and exact labels; `Work items` has no work record or instructions block; `Work record` has the selector, summary, Manage sources, and Teach; Teach visibility by binding; both preview dialogs (new, replace, diff, hidden current, no changes, profiles, empty profiles); cancel; conflict reload; auto-send in Instructions; project settings no longer renders the app-level block.
- Main: work item skill text for `local-file`, adapter, and default has no work record content; work record text for local, Agent Harness, custom file, and custom command; exact local preset detection; missing binding and deleted source errors; path containment for `nekode-work-record`; temp-file rename; token conflict after a source edit and after a file edit; no write on conflict; both files independent.
- IPC: new channel validation for one project id and a 64-character token; preload routing; rejection of extra arguments; trusted-sender guard.
- Service: binding to a deleted source; binding to a shared source; changing a shared source forces a re-teach; project removal drops the binding without deleting files.
- Documentation: the label table, the two paths, and the app-level instruction ownership.
- Regression: existing work item board, local-file CRUD, Resume discovery and launch, Step progress adapters, and existing work item `Teach agents` suites.

## Relevant SDD / ADR

- [Project environment adapters](../../architecture/project-environment-adapters.md) for the WSL and SSH root boundary.
- [Kanban adapter interface](../kanban-adapter-interface/spec.md) for the work item adapter manifest and `agentSkill` body.
- [Handoff/Resume flow](../handoff-resume-flow/spec.md) for work record sources and application instructions.
- No new ADR. The separation and the two-file decision are recorded here as the accepted feature decision.
