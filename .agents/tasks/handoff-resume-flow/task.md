---
id: handoff-resume-flow
schema_version: 2
status: active
intent: feature
complexity: standard
durability: recorded
current_phase: Phase 5
current_step: Phase 5.1
updated: 2026-10-01
branch: main
worktree: current
next_action: Resume at the review gate: spawn exactly one independent reviewer subagent for the stage diff, then run the changed-scope final verification and task-close
blockers: none
---

# Handoff/Resume flow: remembered path, auto-send setting, project configuration, English commands, prompt-input paste

## Objective

Improve the Add Project and Handoff/Resume flows in the NeKode renderer and main process: the Add Project directory dialog resumes from the last used path; a configuration setting controls auto-send after Handoff/Resume; Resume gets a lazy-loaded handoff list backed by a per-project handoff directory setting and a new project configuration view; Handoff/Resume commands are English; pasted text lands in the dedicated prompt input. Affects renderer UI surfaces, typed IPC, and persisted settings.

## Scope

User change list (intake 2026-10-01):

1. Add Project dialog resumes from the previously selected path.
2. Configuration gains auto-send after Handoff / Resume.
3. Resume gets a lazy-loaded handoff list; it requires a handoff directory setting in project configuration, which needs a project configuration view.
4. Commands pasted by Handoff / Resume must be English.
5. Handoff / Resume paste into the dedicated prompt input.

Spec: `docs/features/handoff-resume-flow/spec.md`. Plan: `.agents/tasks/handoff-resume-flow/plan.md`.

## Phase 0 - Intake

- [x] Phase 0.1 - Inspect the repository and refine the provisional classification (feature/standard/recorded, no risk flags; evidence: `ActionBar.tsx:22-27` fixed Polish commands with `\r` via `app.terminals.write`, `PromptInput.tsx` internal-only value state, `ipc-handlers.ts:87-101` dialog without `defaultPath`, generic `state:get/set` app_state store, existing `ActionSettings` "Project Settings" modal per project)

## Phase 1 - Spec

- [x] Phase 1.1 - Write `docs/features/handoff-resume-flow/spec.md` (contract: 8 behaviours, app_state persistence, new IPC `handoffs:list` + `dialogs:pickDirectory`, no schema change)

## Phase 2 - Plan

- [x] Phase 2.1 - Write `.agents/tasks/handoff-resume-flow/plan.md` (one Standard stage, status draft)

## Phase 3 - Approval

- [x] Phase 3.1 - Approval gate: plan presented with the auto-send default and scope questions; the user did not answer within the session. Proceeded on the user's direct five-item work order with the recommended options (auto-send default off, global scope); plan status set to approved and the two choices recorded under Decisions.

## Phase 4 - Preflight and Stage 1

- [x] Phase 4.1 - Preflight exit 0; baseline `pnpm test` 342/342 (2026-10-01)
- [x] Phase 4.2 - implement:handoff-resume-flow Stage 1 (main IPC, shared contract, renderer); implementation and complete diff self-review finished (one comment typo corrected)

## Phase 5 - Review

- [ ] Phase 5.1 - Independent review of the stage diff by one reviewer subagent (the 12:40Z spawn was cancelled with the session interruption before any findings; an interrupted review is not a pass)

Stage 1 implementation evidence (2026-10-01):

Stage 1 implementation evidence (2026-10-01):

- Main: `projects:add` defaultPath + persist-before-add; `projects:remove` deletes `project.handoffDir:<id>`; new `handoffs:list` and `dialogs:pickDirectory` channels; `HandoffsService` (posix-normalized relative resolution, files only, newest first); `state.delete` on the main-side registry; picker injected at the composition root.
- Renderer: ActionBar English commands with host delivery (`Write a handoff`, Resume opens picker); PromptInput injection API threaded ChatWorkspace -> ChatTerminal; HandoffPicker modal (lazy load, unconfigured/error/empty states); Configuration section in ActionSettings (auto-send toggle + handoff dir with Browse).
- Checks: `pnpm test` 364/364 (baseline 342 + 22 new); `pnpm run lint` exit 0 (after restoring package.json to HEAD LF bytes per lesson `windows-biome-package-json-eol`); `pnpm run typecheck` exit 0.
- Decisions: `HandoffEntry` carries the resolved absolute `path` (spec updated); Configuration Save has the accessible name "Save handoff directory" to keep the action-form Save queries unambiguous.

## Decisions

- Auto-send defaults to off: Handoff/Resume paste into the prompt input and wait for the user to submit (change-list item 5 is the default behavior); the setting is opt-in.
- Auto-send is application-global (`handoffResume.autoSend` in app_state), not per project: it governs button delivery behavior, not project data.
- Per-project handoff directory lives in app_state (`project.handoffDir:<projectId>`), avoiding a projects-table migration; removed projects clear the key.
- The existing "Project Settings" modal (`ActionSettings.tsx`) hosts the new Configuration section instead of a separate configuration view.
- Resume with an unconfigured directory opens the picker with a not-configured state (Configure button plus plain `Resume from handoff` fallback), so Resume still works before any configuration.

## Changed files

## Verification

| Check | Result | Notes |
|---|---|---|

Include tests-before-edits evidence, planned commands, and final results as they become available.

For every final verification attempt, append the exact immutable `### Verification subject N` JSON block emitted by the task-record verification subject tool. Attempts are append-only and consecutive. The subject covers every task-owned path whose content is being verified, but excludes this task record because recording verification evidence and closing state must update it after the check. Omit subject blocks only when the closure verification mode is `none`.

## Timing

| Element | Kind | Started | Ended |
|---|---|---|---|
| intake | work | 2026-10-01T11:58:20Z | 2026-10-01T12:05:10Z |
| spec | work | 2026-10-01T12:05:10Z | 2026-10-01T12:14:30Z |
| plan | work | 2026-10-01T12:14:30Z | 2026-10-01T12:16:00Z |
| approval | wait | 2026-10-01T12:16:00Z | 2026-10-01T12:24:40Z |
| preflight | work | 2026-10-01T12:24:40Z | 2026-10-01T12:27:30Z |
| implement:stage-1 | work | 2026-10-01T12:27:30Z | 2026-10-01T12:40:00Z |
| review:stage-1 | work | 2026-10-01T12:40:00Z | 2026-10-01T12:44:39Z |
| handoff | wait | 2026-10-01T12:44:39Z | |

Open `intake` with a real UTC `Started` when creating a new record. After repository discovery, close it and open the first path-specific element: Small development uses `plan`, Standard or Large development uses `spec`, and direct work, investigations, repository operations, and bootstrap use `work`. Existing records created before the intake contract remain valid without this row.

## Risks and blockers

## Resume instructions

State the exact next action and the repository evidence to inspect before editing.
