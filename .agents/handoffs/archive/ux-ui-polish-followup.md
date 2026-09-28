---
task_id: ux-ui-polish-followup
created: 2026-09-28T22:53:39Z
schema_version: 2
from: main session 2026-09-28/29 night (eight-item polish slice verified, then seven user-driven correction rounds; all uncommitted, checkpointed here)
to: next session (user's further UI improvements)
branch: main
worktree: current
checkpoint_subject: 8b6cbc6e8651eec1936d68fc37630b729b45a172+sha256:334df620ecb6987e45ad5585c3e45ea747b01693342943988bec0157ced5f076
current_step: Phase 7.1
next_action: Take the user's next UI improvement list at intake, then plan the first slice
blockers: none
---

# Handoff: UX/UI polish follow-up session (round 2)

## Repository snapshot

Task record: `.agents/tasks/ux-ui-polish-followup/task.md` (validates under `commands.task_status --check`; active at Phase 7.1, carries the full slice + correction history). Transferred role: new agent (next ZCode session); reason: user session boundary after the correction rounds, more improvements announced without a list.

**Working:**

- HEAD `8b6cbc6` (version 0.4.5). The checkpoint commit created by this handoff contains the entire uncommitted batch: the verified eight-item slice plus the post-close correction rounds. Worktree clean after the checkpoint. No remote configured (push impossible, not offered).
- Title bar: WCO custom title bar (`src/main/index.ts`: `titleBarStyle: 'hidden'`, `titleBarOverlay` `#111423`/`#cacbd1`/36px, `backgroundColor`); drag surfaces are the tab strip, Projects header, Files header (`.drag-region`/`.no-drag` in `src/renderer/src/index.css`); TabStrip clears the caption buttons via `calc(100vw - env(titlebar-area-width, 100vw))` and has no `border-b` (the action row owns `border-y`; the 36px WCO strip painted over a border at the strip's bottom edge).
- Action row: `px-2 py-2`, segmented groups at `h-control` with `bg-button` surface; divider is a single 1px centered 16px hairline (`--color-divider` rgb(56 70 96)) over that surface, so no dark gap above/below the hairline.
- Terminals (chat and bottom): xterm host `px-3 py-2` (`ChatTerminal.tsx`; FitAddon fits the content box).
- Prompt input: no separator line above the row; the `--radius-md` frame is the only boundary; Dictation is the frame's right segment (`overflow-hidden` frame, `h-full` button, square left edge, mic + "Dictation" label, disabled).
- Left navigation: project names uppercase with no selection fill and no hover background; chat rows full-width with `Icon.chat` whose left edge aligns with the project name text (measured diff 0px); no vertical guide line; "New Chat" is a chat-height row with the plus icon in the icon column.
- Files tree: rows `text-sm` (14px).
- Welcome/"No chats" surfaces: vertically centered in the middle column (`h-full`; hosts are plain blocks, `flex-1` did nothing).
- Cursor: `button:not(:disabled) { cursor: pointer }` in `index.css`; disabled controls keep `not-allowed`.
- Tests 340/340; design contract in `docs/references/NeKode-Design-System.md` sections 5, 7, 11.4, 14, 15, 19, 21, 23, 26.1, 26.2, 30.

**Broken:**

- Nothing new. `src/main/services/terminal/terminal-service.test.ts:196` (ConPTY spawn) remains flaky on this machine, predates all UI work, and passed in every full run of this session.

## Decisions

- Icons: Lucide only, imported by role name from `src/renderer/src/lib/icons.tsx`, never from `lucide-react` directly; icons carry `aria-hidden` when a visible label names the control.
- Filled buttons and input frames: `--spacing-control` (32px); ghost row controls stay compact.
- Components consume semantic tokens only; no raw palette classes or hex colors in renderer sources (xterm theme literals in `ChatTerminal.tsx` and the overlay hexes in `src/main/index.ts` are recorded exceptions).
- Segmented divider: single centered hairline, never a two-tone groove (user: too intense) and never a full-height border; the group surface behind the divider column is `--color-button`.
- Project rows: no selection fill, no hover background on the name; chat rows keep the full-width highlight; the chat icon aligns with the project name text start.
- The prompt input frame is the only boundary above the input row; no separator line.
- Hand cursor on every enabled button (`index.css` global rule).
- Welcome/StartNewChat center in the middle column, not the whole window.
- Dictation stays disabled until the recognizer feature is decided; design doc 21 owns its states.
- Prompt input submits with Enter semantics: the Ctrl+D prompt base must re-collect from the shell's next redraw; do not freeze it like generic synthetic input.
- Theme is one file (`src/renderer/src/theme.css`, Tailwind v4 `@theme`); runtime switching does not exist; a variant means a second token set plus a loader (doc section 3).
- Run `pnpm <script>` directly in Git Bash, never via `cmd /c "pnpm ..."` (the chain gets swallowed).

## Failed approaches

- Centering Welcome with a `fixed inset-0` overlay: it centered on the whole window; the user corrected to the middle column. Then `flex-1` on the section did nothing because its host (`terminalHost` in `ChatWorkspace.tsx`) is a plain block, not flex; `h-full` is the fix. Apply the same to any future center-column empty state.
- Two-tone 3D divider groove (dark+light 2px column): user found it too intense; also the divider column showed dark background above/below the hairline until the group surface got `bg-button`. Do not reintroduce full-height or two-tone dividers.
- Aligning elements by arithmetic from class names: missed the 4px gap before the project name text (reported x=36 vs icon x=32). Measure real pixels with a DOM harness (built CSS served over HTTP, `getBoundingClientRect`/Range) before claiming alignment.
- `ci commit -f` with the deleted side of a staged `git mv` rename in the path list: fatal `pathspec ... did not match any files`. Unstage the rename first (`git reset -- <old> <new>`), then commit with both paths.
- `git checkout -- <path>` on `core.autocrlf=true` reintroduces CRLF; restore via `git show HEAD:<path>` redirect (lessons `windows-biome-package-json-eol`, `git-checkout-reintroduces-crlf`).

## Verification

- Baseline: preflight exit 0; `pnpm test` 340/340 (2026-09-28T21:12Z).
- Slice: `python .agents/scripts/verify-full` exit 0 (validate-config, lint 0 errors, typecheck, vitest 340/340); `pnpm build` exit 0; compiled CSS contained the new classes/tokens; `env(titlebar-area-width, 100vw)` present in the renderer JS bundle; Electron runtime smoke (built app, 12s alive, clean log).
- Post-close rounds: every round re-ran lint (exit 0), typecheck (exit 0), vitest 340/340; last full run 2026-09-28T22:50Z.
- Alignment: DOM measurement harness over the built CSS in the in-app browser: project name text x == chat icon x (diff 0), chat row == New Chat row height (24px). Harness removed afterwards.
- Not verified: one `pnpm dev` walkthrough of the whole batch by the user (individual changes were confirmed between rounds).

## Open product invariants

- none

## Unresolved assumptions

- Dictation recognizer: source - the user asked only for the button; consequence - it ships disabled inside the prompt frame; resolution - decide Web Speech API (needs network/Google key in Electron) versus a local model, then wire it.
- Runtime theme switching: source - earlier user question; consequence - documented as not existing (design doc 3); resolution - decide whether to build a multi-token-set loader and settings UI.
- Next-session scope: source - the user said they will continue improving the UI without a list; consequence - the record sits at Phase 7.1 intake; resolution - the user provides the concrete list in the next session.

## Resume instructions

1. Read this snapshot and `.agents/tasks/ux-ui-polish-followup/task.md`; confirm the worktree is clean (or holds only unrelated changes) and HEAD is at or after the checkpoint commit that contains this snapshot (version 0.4.5, record active at Phase 7.1). Run `commands.task_status --check .agents/tasks/ux-ui-polish-followup/task.md`.
2. Resume via `task-record`: end the `handoff` wait, open Phase 7.1 intake; take the user's change list from their first message (ask one concrete question if it is absent), classify, and plan the slice with `.agents/workflows/small-development.md` unless the scope says Standard.
3. Tests-before-edits: run `pnpm test` as the baseline.
4. Expected evidence of a correct resume: an explicit change list recorded in the task record, a planned slice, and no edits before the baseline run.
5. Next skill to load: `task-record` (resume), then `small-development`.
