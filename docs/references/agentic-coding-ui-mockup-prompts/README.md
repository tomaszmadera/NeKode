# Mockup Prompt Pack

This pack contains **33 mockup prompts** derived from the current SDD and UX/UI specification.

## How to use

Best consistency:

1. Give the mockup-generating model `00_MASTER_VISUAL_SYSTEM.md`.
2. Give it one selected prompt from `views/`, `overlays/`, `component-studies/` or `motion-studies/`.
3. Generate one result.
4. Keep the same master prompt, seed/reference image/style reference where your tool supports it.
5. Use the previous accepted mockup as a visual reference for subsequent screens when possible.

Every individual prompt also contains a compact mandatory visual contract, so it can be used standalone if the model cannot accept multiple documents.

## Recommended generation order

Generate these first and approve the visual language before producing the rest:

1. `views/02_task-active.md` — canonical daily workspace.
2. `views/05_project-files.md` — file-navigation mode.
3. `views/06_project-kanban.md` — main Kanban direction.
4. `views/08_task-bottom-terminal.md` — vertical workspace composition.
5. `views/09_task-right-browser.md` — secondary right panel.

Once these five are consistent, generate Settings, Handoffs, overlays and state boards.

## Important

The product UI is **English-only**. `Implement` is the primary Kanban action for unstarted coding Tasks; `Resume` is the primary action for active Tasks or Tasks with Handoffs. The default console agent is **Codex**, with alternative configured console agents selectable.

See `VIEW_INVENTORY.md` for the complete list.
