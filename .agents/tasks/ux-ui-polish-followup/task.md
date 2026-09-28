---
id: ux-ui-polish-followup
schema_version: 2
status: active
intent: feature
complexity: small
durability: recorded
current_phase: Phase 0
current_step: Phase 0.1
updated: 2026-09-28
branch: main
worktree: current
next_action: Take the user's next UI change list at intake, then plan the first slice
blockers: none
---

# UX/UI polish follow-up session

## Objective

Continue the UX/UI polish of the NeKode renderer after the 2026-09-28 polish slice (themed scrollbars, tab-height controls, Lucide icon set, terminal prompt input, published as 0.4.5). The user announced more changes for the next session; the concrete list is taken at intake. Affects the renderer UI surfaces only.

## Scope

Small development assumed (no spec or plan file) until intake shows otherwise. Visual contract: `docs/references/NeKode-Design-System.md` (sections 3, 7, 8, 10, 11, 15, 21 updated by the previous slice). Token source: `src/renderer/src/theme.css`.

## Phase 0 - Intake

- [ ] Phase 0.1 - Inspect the repository state, take the user's change list, and refine the provisional classification

## Decisions

Carried from the completed `ux-ui-theme-and-fonts` task (next owner must preserve):

- Icons: Lucide only, imported by role name from `src/renderer/src/lib/icons.tsx`, never from `lucide-react` directly.
- Filled buttons and input frames use `--spacing-control` (32px = tab height); ghost row controls stay compact.
- Components consume semantic tokens only; no raw palette classes or hex colors in renderer sources.
- Terminal prompt input submits with Enter semantics: the line plus CR goes to the PTY and the Ctrl+D prompt base re-collects from the shell's next redraw (`ChatTerminal.tsx` `submitPromptLine`).
- The Dictation button is the design-doc 21 idle state: rendered, disabled, until a recognizer feature is decided and wired.
- Theme is one file (`src/renderer/src/theme.css`, Tailwind v4 `@theme`); runtime theme switching does not exist yet.

## Changed files

None yet (record created at handoff, before any follow-up work).

## Verification

| Check | Result | Notes |
|---|---|---|

No verification yet; see the handoff snapshot for the completed slice's evidence.

## Timing

| Element | Kind | Started | Ended |
|---|---|---|---|
| intake | work | 2026-09-28T21:03:02Z | 2026-09-28T21:03:02Z |
| handoff | wait | 2026-09-28T21:03:02Z | |

Record created retroactively at handoff (user pause after publishing 0.4.5): the intake row shares the record-creation instant instead of inventing a span; the next session ends the `handoff` wait and reopens `intake`/`plan`.

## Risks and blockers

No active blockers. Notes: the app UI of the 0.4.5 polish slice has not been visually accepted by the user yet (`pnpm dev` walkthrough pending); the real dictation feature (recognizer choice and wiring) is an open product decision, not a defect.

## Resume instructions

Read `.agents/handoffs/ux-ui-polish-followup.md`, resume this record via `task-record` (end the `handoff` wait, reopen `intake`), take the user's concrete change list, then plan the first slice with `.agents/workflows/small-development.md`. Repository evidence wins over the snapshot.
