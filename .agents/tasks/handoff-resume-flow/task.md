---
id: handoff-resume-flow
schema_version: 2
status: completed
intent: feature
complexity: standard
durability: recorded
current_phase: Phase 6
current_step: none
updated: 2026-10-01
branch: main
worktree: current
next_action: none
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

- [x] Phase 5.1 - Independent review of the stage diff by one reviewer subagent (review resumed 12:59Z after the interrupted 12:40Z spawn): verdict pass, six non-blocking findings, no blocking findings (review:stage-1 12:59:20Z-13:12:05Z)
- [x] Phase 5.2 - correction:stage-1: fix the two real non-blocking defects (Browse with a relative current value; silent state-read fallback) and add the three missing required-test gaps (picker empty-list and error states, two-chat injection addressing, untrusted-sender cases for the new channels)

## Phase 6 - Final verification

- [x] Phase 6.1 - verify:changed on the captured verification subject, then close. `python .agents/scripts/verify-changed` exit 0 on attempt 1 (validate-config OK: 28 skills; biome check clean, 96 files; tsc node+web clean); `verification_subject.py check` exit 0 immediately before close (attempt 1 matches). One earlier gate run was invalidated before it counted: the script refused the record with `current step is already checked: Phase 5.1` (record bookkeeping error, fixed, then the gate passed; the check itself never failed).

Retro 2026-10-01: no qualifying lesson event (no unexpected operational error, user correction, or required-tool substitution during resume, correction, or review); no lesson write.

Correction evidence (2026-10-01): `ActionSettings.tsx` gained `isAbsolutePath` with the project-root fallback for non-absolute drafts and a visible `configError` on a failed setting read; `App.test.tsx` gained the relative-Browse fallback, picker empty/error-state, and two-chat injection tests; `ipc-handlers.test.ts` gained the untrusted-sender case for both new channels. Affected checks after correction: `pnpm test` 368/368, lint exit 0, typecheck exit 0. Re-review by the same reviewer of the incremental diff: verdict pass (one cosmetic UNC-path note, accepted as a documented decision; reviewer terminated).

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

Product and tests (34 task-owned paths, verification subject 1): `src/shared/ipc-contract.ts`, `src/preload/app-api.ts` (+test), `src/main/index.ts`, `src/main/ipc/ipc-handlers.ts` (+test), `src/main/ipc/ipc-validation.ts` (+test), `src/main/ipc/service-registry.ts`, `src/main/services/create-services.ts`, `src/main/services/handoffs/handoffs-service.ts` (+test, new), `src/renderer/src/App.tsx` (+test), `src/renderer/src/BottomPanel.test.tsx`, `src/renderer/src/components/actions/ActionBar.tsx`, `src/renderer/src/components/actions/ActionSettings.tsx`, `src/renderer/src/components/actions/HandoffPicker.tsx` (new), `src/renderer/src/components/terminal/ChatTerminal.tsx` (+test), `src/renderer/src/components/terminal/PromptInput.tsx`, `src/renderer/src/components/workspace/ChatWorkspace.tsx` (+test), `src/renderer/src/components/files/ProjectFiles.test.tsx`, `src/renderer/src/components/layout/StatusBar.test.tsx`, `src/renderer/src/components/tabs/CenterTabs.test.tsx`, `src/renderer/src/hooks/useResizableRegion.test.tsx`, `src/renderer/src/lib/test-ids.ts`, `src/renderer/src/test/pending-bottom-command.lifecycle.test.tsx`. Task-owned records: spec `docs/features/handoff-resume-flow/spec.md`, plan `plan.md` (this directory), handoff snapshot `.agents/handoffs/handoff-resume-flow.md`, lessons `.agents/lessons/index.json` + `.agents/lessons/items/active-record-keeps-current-step.md`.

## Verification

| Check | Result | Notes |
|---|---|---|
| Preflight (resume 2026-10-01) | exit 0 | checkpoint `5abd9ce` HEAD; worktree clean except the documented empty-diff `package.json` CRLF state |
| Baseline `pnpm test` (resume 2026-10-01) | 364/364 | tests-before-edits evidence on the checkpoint; no failures, skips, or unavailable gates |

### Verification subject 1

```json
{
  "attempt": 1,
  "head": "5abd9ce96b947ca44da007167e512829ed505411",
  "paths": [
    ".agents/handoffs/handoff-resume-flow.md",
    ".agents/lessons/index.json",
    ".agents/lessons/items/active-record-keeps-current-step.md",
    ".agents/tasks/handoff-resume-flow/plan.md",
    "docs/features/handoff-resume-flow/spec.md",
    "src/main/index.ts",
    "src/main/ipc/ipc-handlers.test.ts",
    "src/main/ipc/ipc-handlers.ts",
    "src/main/ipc/ipc-validation.test.ts",
    "src/main/ipc/ipc-validation.ts",
    "src/main/ipc/service-registry.ts",
    "src/main/services/create-services.ts",
    "src/main/services/handoffs/handoffs-service.test.ts",
    "src/main/services/handoffs/handoffs-service.ts",
    "src/preload/app-api.test.ts",
    "src/preload/app-api.ts",
    "src/renderer/src/App.test.tsx",
    "src/renderer/src/App.tsx",
    "src/renderer/src/BottomPanel.test.tsx",
    "src/renderer/src/components/actions/ActionBar.tsx",
    "src/renderer/src/components/actions/ActionSettings.tsx",
    "src/renderer/src/components/actions/HandoffPicker.tsx",
    "src/renderer/src/components/files/ProjectFiles.test.tsx",
    "src/renderer/src/components/layout/StatusBar.test.tsx",
    "src/renderer/src/components/tabs/CenterTabs.test.tsx",
    "src/renderer/src/components/terminal/ChatTerminal.test.tsx",
    "src/renderer/src/components/terminal/ChatTerminal.tsx",
    "src/renderer/src/components/terminal/PromptInput.tsx",
    "src/renderer/src/components/workspace/ChatWorkspace.test.tsx",
    "src/renderer/src/components/workspace/ChatWorkspace.tsx",
    "src/renderer/src/hooks/useResizableRegion.test.tsx",
    "src/renderer/src/lib/test-ids.ts",
    "src/renderer/src/test/pending-bottom-command.lifecycle.test.tsx",
    "src/shared/ipc-contract.ts"
  ],
  "schema_version": 1,
  "staged_diff_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "subject_sha256": "165df2841c80759951bd9b142c8aa87567ecafffee0658c387aa510a3fe499bc",
  "unstaged_diff_sha256": "7ef4d57e43d421681d41b80174dde1528b81ae5027d0078fc895393d72a23cd7",
  "untracked_files_sha256": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
}
```

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
| handoff | wait | 2026-10-01T12:44:39Z | 2026-10-01T12:58:22Z |
| preflight | work | 2026-10-01T12:58:22Z | 2026-10-01T12:59:20Z |
| review:stage-1 | work | 2026-10-01T12:59:20Z | 2026-10-01T13:12:05Z |
| correction:stage-1 | work | 2026-10-01T13:12:05Z | 2026-10-01T13:17:37Z |
| retro | work | 2026-10-01T13:17:37Z | 2026-10-01T13:18:30Z |
| verify | work | 2026-10-01T13:18:30Z | 2026-10-01T13:19:50Z |
| close | work | 2026-10-01T13:19:50Z | 2026-10-01T13:19:50Z |

Open `intake` with a real UTC `Started` when creating a new record. After repository discovery, close it and open the first path-specific element: Small development uses `plan`, Standard or Large development uses `spec`, and direct work, investigations, repository operations, and bootstrap use `work`. Existing records created before the intake contract remain valid without this row.

## Risks and blockers

## Resume instructions

State the exact next action and the repository evidence to inspect before editing.
