---
task_id: handoff-resume-flow
created: 2026-10-01T12:44:39Z
schema_version: 2
from: Main (ZCode, sesja 2026-10-01)
to: Main (kolejna sesja, po restarcie komputera)
branch: main
worktree: current
checkpoint_subject: c66cc2e337b082e8468b4181e0847e490b963014+sha256:66d6cf2799277abbf1f505d606e1a5b451434945ac28fc8390ec1cee53a7ed73
current_step: Phase 5.1
next_action: Spawn exactly one independent reviewer subagent for the stage diff (review gate), then run the changed-scope final verification and task-close
blockers: none
---

# Handoff: Handoff/Resume flow (remembered path, auto-send, project configuration, handoff list)

## Repository snapshot

Task record: `.agents/tasks/handoff-resume-flow/task.md` (active, Phase 5.1). Reason: the user stopped the session to restart the computer mid-stage, right after the independent review subagent was cancelled before returning findings. Transferred role: Main (the next session owns the review gate and closure).

Contracts: spec `docs/features/handoff-resume-flow/spec.md` (8 behaviours; refined in place: `HandoffEntry` gained the resolved absolute `path`), plan `.agents/tasks/handoff-resume-flow/plan.md` (approved, single Standard stage), user change list and decisions in the task record.

Working:

- Stage 1 is implemented end to end against HEAD `c66cc2e`: shared contract (`src/shared/ipc-contract.ts`: `HandoffEntry`, channels `handoffs:list` + `dialogs:pickDirectory`, keys `projects.lastDirectory` + `handoffResume.autoSend`, `projectHandoffDirKey()`), preload bridge, main handlers (`projects:add` defaultPath + persist-before-add, `projects:remove` deletes `project.handoffDir:<id>`), validators, `HandoffsService` (`src/main/services/handoffs/handoffs-service.ts`, posix separators, files only, newest first), picker injection at the composition root (`src/main/index.ts`), renderer wiring (ActionBar English commands + host delivery, PromptInput injection threaded ChatWorkspace -> ChatTerminal, `HandoffPicker.tsx`, Configuration section in `ActionSettings.tsx`).
- Checks at stop: `pnpm test` 364/364 (baseline was 342/342), `pnpm run lint` exit 0, `pnpm run typecheck` exit 0.
- Spec/plan/task record/lessons complete; no product edits happened before preflight and baseline.

Broken:

- none known: no failing or skipped check at stop.

## Decisions

- Auto-send defaults to off (paste into the prompt input; item 5 is the default behavior), application-global key `handoffResume.autoSend` (`'1'` = send). The user did not answer the approval questions; proceeding on the direct five-item work order with the recommended options is recorded in Phase 3.1 of the task record.
- Per-project handoff directory lives in app_state (`project.handoffDir:<projectId>`), not a projects-table migration; `projects:remove` deletes the key explicitly.
- The existing "Project Settings" modal (`ActionSettings.tsx`) hosts the Configuration section; no separate configuration view.
- Resume with an unconfigured directory opens the picker with Configure + "Paste without path" fallback (`Resume from handoff`); a configured-but-missing directory is an inline error state only.
- English fixed commands: `Write a handoff` (ActionBar constant `HANDOFF_COMMAND`), `Resume from handoff <absolute path>` composed in `HandoffPicker.tsx` (`PLAIN_RESUME_COMMAND` for the fallback). Stop (`\x03`) and Continue (`Continue\r`) delivery unchanged.
- `HandoffEntry` carries the resolved absolute `path`; the service normalizes separators to posix (FilesService precedent).
- Configuration Save button has accessible name "Save handoff directory" so existing `getByRole('button', { name: 'Save' })` action-form tests stay unambiguous.

## Failed approaches

- Initial `HandoffsService` used `node:path` `join`, producing backslash paths on Windows that broke the injectable-fs fixtures and mixed separators in the pasted command: normalize with `toPosix`/`posix.join` (FilesService precedent).
- Reusing the button label "Save" for the Configuration section collided with the action-form Save in existing App.test queries: give it the distinct accessible name instead of rewriting four existing tests.
- Do not set `current_step: none` on an active task record during a wait phase (validator rejects it; lesson `active-record-keeps-current-step` recorded this session).

## Verification

- Fresh at stop: `pnpm test` 364/364 (26 files), `pnpm run lint` exit 0, `pnpm run typecheck` exit 0. Baseline before edits: 342/342, preflight exit 0.
- lint initially failed on an untouched `package.json` (CRLF in worktree vs LF in HEAD): restored HEAD bytes per lesson `windows-biome-package-json-eol`; `.gitattributes` already carries `package.json text eol=lf`.
- Not done: the independent review of the stage diff. The 12:40Z reviewer subagent spawn was cancelled before findings; this is the open gate, not a pass.
- Not done: final `verify` with a captured verification subject, retro, and task-close.

## Open product invariants

- IPC boundary discipline: every new channel declared once in `IPC_CHANNEL`/`AppApi`, validated in `ipc-validation.ts`, served behind the trusted-sender guard, errors only as typed `AppError` payloads (`.agents/skills/electron-ipc/SKILL.md`). Impact: `handoffs:list` and `dialogs:pickDirectory` must keep this shape in review and future changes. Evidence to change: an ADR or contract change owned by the user.

## Unresolved assumptions

- Auto-send default and scope: source - the approval questions went unanswered; consequence - off/global are implemented; resolution - the user flips the toggle in Project Settings or asks for a per-project key.
- English command wording (`Write a handoff`, `Resume from handoff ...`): source - item 4 asked for English without exact strings; consequence - agents receive these literal commands; resolution - user review during acceptance, single-string change if reworded.
- No manual `pnpm dev` walkthrough happened this session: source - time; consequence - UI behavior is covered by component tests only; resolution - user acceptance pass after review and closure.

## Resume instructions

1. Confirm the checkpoint: worktree matches `checkpoint_subject` (HEAD `c66cc2e...` or its checkpoint commit, diff hash `66d6cf27...`). Run `python .agents/scripts/task-status --check .agents/tasks/handoff-resume-flow/task.md` and `python .agents/scripts/handoff-status --check .agents/handoffs/handoff-resume-flow.md`.
2. End the `handoff` wait row, reopen `review:stage-1`, and start exactly one independent reviewer as a subagent (never self-review). Comparison base HEAD `c66cc2e337b082e8468b4181e0847e490b963014`; give it the changed paths listed in the task record Phase 4.2 evidence, the spec, the plan, and `.agents/skills/code-review/SKILL.md`.
3. Expected evidence of a correct resume: a reviewer verdict line; on blocking findings open `correction:stage-1` (Standard: Main corrects what fits), then re-review; then capture the verification subject, run the recorded changed-scope verification, and close through `task-close` with final verification `changed`.
4. Next skill to load: `task-record` (resume), then `code-review` for the gate. The changed-scope command is `cmd /c pnpm run lint && cmd /c pnpm run typecheck` plus the targeted vitest run; `pnpm test` directly in Git Bash, never `cmd /c "pnpm ..."`.
