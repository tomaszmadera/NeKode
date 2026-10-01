---
task_id: handoff-resume-flow
spec: docs/features/handoff-resume-flow/spec.md
status: approved
---

# Plan: Handoff/Resume flow (remembered path, auto-send, project configuration, handoff list)

This file is the execution strategy for one task. It is not live progress and must not replace the task record. Do not put checkboxes here. Link the spec; do not copy it.

`status` is `draft` until the user approves the plan, then `approved`. A Standard plan has exactly one stage. A Large plan has two or more stages. Do not run tests-and-preflight or product code while status is `draft`.

## Goal of this iteration

Deliver the five behavior changes from the spec: remembered Add Project directory, English Handoff/Resume commands delivered into the prompt input (opt-in auto-send), lazy handoff picker for Resume, and the Configuration section (auto-send + per-project handoff directory) in the Project Settings modal.

## Spec

`docs/features/handoff-resume-flow/spec.md`

## Out of scope

Everything under spec Non-goals: no handoff content reads/writes, no default handoff directory, no Stop/Continue changes, no schema migration, no UI translation.

## Stages

### Stage 1 - Handoff/Resume flow slice (single Standard stage)

- Outcome: all spec behaviours 1-8 live end to end (main IPC additions, shared contract, renderer ActionBar/PromptInput/picker/Configuration section) with the spec's required tests green.
- Boundary: additive IPC (`handoffs:list`, `dialogs:pickDirectory`), app_state keys, renderer wiring of ActionBar -> ChatWorkspace -> ChatTerminal -> PromptInput and the picker/settings modals. No changes outside these surfaces; Stop/Continue untouched.
- Verification: targeted vitest run of touched test files plus `cmd /c pnpm run lint && cmd /c pnpm run typecheck` (profile `changed_command`), then task-close final verification `changed`.
- Expected evidence: new/updated tests for `ipc-handlers` (defaultPath persist, handoffs:list, pickDirectory, remove cleanup), ActionBar delivery paths (paste vs auto-send, English text), PromptInput injection, Configuration section persistence; lint/typecheck exit 0.
- Likely files: `src/shared/ipc-contract.ts`, `src/preload/*` (bridge), `src/main/ipc/ipc-handlers.ts`, `src/main/ipc/ipc-validation.ts`, `src/main/services/handoffs/` (new listing service or a function beside files-service), `src/renderer/src/App.tsx`, `src/renderer/src/components/actions/ActionBar.tsx`, `src/renderer/src/components/actions/ActionSettings.tsx`, `src/renderer/src/components/terminal/PromptInput.tsx`, `src/renderer/src/components/terminal/ChatTerminal.tsx`, `src/renderer/src/components/workspace/ChatWorkspace.tsx`, plus tests.

Implementation notes (contract-level, from repository evidence):

- Activate the `electron-ipc` skill before touching the IPC contract/preload/validation; follow its sender-validation and typed-error rules.
- `projects:add` keeps its dialog-in-main shape: read `projects.lastDirectory` for `defaultPath`, persist the confirmed directory before `services.projects.add`.
- `handoffs:list` validates the project via the existing project service, resolves the configured directory (relative against project root), and lists regular files newest-first; failures follow spec Errors (`not_found` with the configured path named).
- Renderer delivery: ActionBar decides paste-into-input vs direct write from `handoffResume.autoSend` (read once per render cycle via `app.state.get`); injection travels as `{ chatId, text, nonce }` state in App and reaches only the active chat's PromptInput.
- The picker modal and Configuration section reuse the existing modal/control language (ActionSettings patterns, design-system tokens).

## Preflight before edits

- Skill: `preflight`
- Preflight command from `.agents/project-profile.yaml`: `{python} .agents/scripts/preflight`
- Baseline: `pnpm test` before product edits, results recorded in the task record Verification table.

## Risks

- Injection threading crosses four renderer layers (App -> ChatWorkspace -> ChatTerminal -> PromptInput); covered by a dedicated ChatTerminal/App test so the contract is pinned.
- Auto-send read timing: the toggle read must not race a click; the renderer reads the setting when the modal saves and caches it in App state (single source), not per keystroke.
- `dialogs:pickDirectory` is a new OS-bound channel: injectable dialog like `projects:add` keeps it testable.

## Approval

Standard and Large: do not run tests-and-preflight or product code until the user approves this plan.
