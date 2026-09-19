---
name: task-record
description: Create, resume, transition, validate, and close durable task state when durability is recorded, at any complexity. Do not use for ephemeral work.
---
# Task record

Own the lifecycle of `.agents/tasks/<task-id>/task.md`. Other skills request transitions through this skill rather than maintaining competing task-state rules.

## Schema compatibility

Use `.agents/templates/task-record.md` and the repository's current validator. New records persist the router's `intent` and `complexity` with `durability: recorded`. The validator also reads legacy `size` records; preserve them unless a migration is requested. Never mix legacy `size` with canonical fields. The template owns identifier format and initial values.

## Create or resume

1. Reuse a known live record for the same user task. Otherwise derive a readable id in the template's format; on collision with an unrelated record, try deterministic `-2`, `-3`, and so on.
2. For a newly recorded task, create the record before broad discovery or further implementation. The router's bounded classification probe may precede it. Read the template and check the exact candidate path. When ephemeral work becomes recorded, preserve completed work as evidence without inventing timestamps.
3. Create the initial record from the template with the owning intent, complexity, recorded durability, one current intake step, a truthful next action, and an open `intake` Timing row.
4. After repository/Git inspection, replace the template's placeholder branch with the actual branch before intake closes and refine classification from evidence.
5. Close `intake` and open the first route-specific element the template names for this route.

## State invariants

- Allowed statuses are `active`, `blocked`, and `completed` unless the current template explicitly says otherwise.
- Pending decisions belong in the next action or body until a real blocked transition occurs.
- An active/blocked record has exactly one current unchecked step. A completed record has no current/unchecked step.
- `current_phase` always names an existing `Phase N` heading, including on completed records. Only `current_step` becomes `none` on completion. An active `current_step` uses `Phase N.M` form and names an unchecked step. An active record must not declare a blocker; write a declared blocker with `status: blocked` in the same edit.
- Update only at meaningful checkpoints. Repository evidence wins over stale record text.
- Preserve recorded start timestamps. Close/open Timing rows instead of rewriting or deleting history.
- Timing timestamps are UTC in the format required by the current template. Do not invent wait rows merely to account for gaps.

## Timing elements

The current task-record contract uses named Timing elements. The caller requests transitions; this skill owns their representation and timestamps.

- `intake`: initial record through repository discovery/classification refinement.
- `spec`: Standard/Large specification work.
- `plan`: Small in-session planning or Standard/Large plan-file work.
- `approval`: wait after presenting a Standard/Large plan until user approval.
- `preflight`: preflight gate.
- `implement` / `implement:<stage>`: implementation work.
- `review` / `review:<stage>`: required review work.
- `correction` / `correction:<stage>`: blocking review correction only when it occurs.
- `user-gate` / `user-gate:<stage>`: explicit planned manual gate only when it occurs.
- `retro`: completion retrospective checkpoint.
- `verify`: selected final verification.
- `close`: state closure/validation.
- `handoff`, `blocked`: waits when those states occur.
- `work`: recorded `review`, `debug`, or `analysis`.

`approval`, `user-gate`, `handoff`, and `blocked` are waits; the others are work. Use UTC `YYYY-MM-DDTHH:MM:SSZ` timestamps unless the current template explicitly defines a compatible replacement.

Completed Small records contain `plan`, `implement`, `review`, and `verify` when those phases occurred under the current schema. Completed Standard/Large development records preserve separate `spec`, `plan`, `approval`, `preflight`, `implement`, `review`, `retro`, and `verify` evidence. Recorded `review` / `debug` / `analysis` / `repository-operation` preserve `work`; additional rows appear only for actions that actually occurred.

## Validate

Use the session-cached project profile. Read `.agents/project-profile.yaml` only when it has not yet been loaded in this session or repository evidence shows that it changed. Run `commands.task_status` with the required validation arguments. Pass the repository-relative task-record path, not a bare id. Do not infer a substitute command when it is unrecorded.

## Verification subjects

Schema v2 records bind each final verification attempt to an immutable subject. After all implementation, review, correction, retro, and lesson writes for that attempt are complete, list every task-owned path whose content the verification covers. Include specifications, plans, lessons, generated artifacts, and other task-owned files when they changed. Exclude only the task record itself because its verification evidence and close transition must be written after the check.

Run recorded `commands.verification_subject` with:

```text
capture --record <task-record> --path <task-owned-path> [--path <task-owned-path> ...]
```

Persist the emitted `### Verification subject N` block verbatim before running verification. In the same task-record transition, open the matching `verify` Timing row. Subjects and failed verification rows are append-only: never edit or replace an earlier subject. A correction requires a new subject and a new `verify` row.

Before a verification-dependent close, run the read-only comparison:

```text
commands.verification_subject check --record <task-record>
```

Exit `0` proves that the latest subject's HEAD, sorted path set, staged diff, unstaged diff, and untracked file content match exactly. Any other exit blocks close and returns control to the owning workflow for correction, review, and fresh verification.

## Close

Close only after the caller supplies required review/verification evidence and any required verification subject still matches. End required Timing rows, set the schema's completed state, clear current/next action as required, preserve historical evidence, and run the recorded validation command. Do not delete the record after completion.
