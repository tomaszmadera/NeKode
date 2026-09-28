---
id: ux-ui-polish-followup
schema_version: 2
status: active
intent: feature
complexity: small
durability: recorded
current_phase: Phase 8
current_step: Phase 8.1
updated: 2026-09-28
branch: main
worktree: current
next_action: Take the user's next UI improvement list at intake, then plan the first slice
blockers: none
---

# UX/UI polish follow-up session

## Objective

Continue the UX/UI polish of the NeKode renderer after the 2026-09-28 polish slice (themed scrollbars, tab-height controls, Lucide icon set, terminal prompt input, published as 0.4.5). The user's eight-item change list was implemented and verified (record closed), then the user drove seven further correction rounds in the same session (record reopened). Work continues in the next session: the user announced more improvements without a list. Affects the renderer UI surfaces and the Electron window options.

## Scope

Small development, no spec or plan file; in-session plan. Visual contract: `docs/references/NeKode-Design-System.md` (sections 5, 7, 11.4, 14, 15, 19, 21, 23, 26.1, 26.2, 30 updated across the session). Token source: `src/renderer/src/theme.css`.

## User change list (intake 2026-09-28)

1. Action row (Handoff/Resume/Stop/Continue): add padding to the row.
2. The bar dividing connected (segmented) buttons: light or 3-D (classic two-tone separator).
3. Both terminals: sensible padding (currently none).
4. Terminal prompt input: the dictation control becomes a recognizable button with the label "Dictation" plus its icon (stays disabled, design doc 21 idle state).
5. Projects list: project names uppercase.
6. Files list: larger font.
7. Chats list: chat icon before each chat name.
8. Window title bar (the grab area): background same as the base app background.

Post-close correction rounds (same session, user-driven):

9. Dictation becomes the input frame's right segment: flush to the frame end, square left edge, right corners clipped by the frame radius.
10. Action row padding equal (8px both axes); the line above the row was the tab strip's `border-b`, painted over by the 36px WCO strip under the caption buttons: ownership moved to the action row's top border.
11. No highlight behind the active project name and no hover background on it; chat rows keep the full-width highlight; vertical guide line at the chat list removed; chat icon left edge aligned with the project name text (verified by DOM measurement, diff 0px).
12. "Welcome to NeKode" (and "No chats in this project") centered vertically inside the middle column (`h-full`; the host is a plain block, so `flex-1` did nothing).
13. Hand cursor on every enabled button (`button:not(:disabled)` in `index.css`); disabled controls keep `not-allowed`.
14. Segmented divider softened from the two-tone groove to a single 1px centered 16px hairline (`--color-divider` rgb(56 70 96)), with the segment group surface (`bg-button`) behind the divider column so no dark gap shows above and below the hairline.
15. "New Chat" becomes a row matching the chat rows (same 24px height) with the plus icon in the chat-icon column.

## Phase 0 - Intake

- [x] Phase 0.1 - Repository state confirmed (clean worktree, HEAD `8b6cbc6`, preflight exit 0, baseline `pnpm test` 340/340), change list taken, classification refined (feature/small/recorded, no risk flags)

## Phase 1 - Plan

- [x] Phase 1.1 - In-session plan (below), no spec or plan file

Plan (as executed):

- `ActionBar.tsx`: row padding (`px-2 py-2`), segmented groups at `h-control` with `bg-button` surface, single centered hairline divider; `border-y` row borders.
- `theme.css`: divider simplified to one token `--color-divider: rgb(56 70 96)` (the two-tone `--color-divider-light` added then removed in the same session).
- `ChatTerminal.tsx`: xterm container `px-3 py-2` (chat and bottom terminals; FitAddon fits the content box).
- `PromptInput.tsx`: no `border-t` above the row (the frame is the only boundary); Dictation as the frame's right segment (`overflow-hidden` frame + `h-full` button, square left edge).
- `LeftNavigation.tsx`: uppercase project names, no selection fill, no hover background on the name, chat rows full-width with `Icon.chat` aligned to the project name text (row `pl-6` + list inset), "New Chat" as a chat row with the plus icon, drag-region header.
- `FileTree.tsx`: tree rows `text-sm`.
- `WelcomeSurface.tsx` / `StartNewChatSurface.tsx`: `h-full` vertical centering in the middle column.
- `index.css`: `.drag-region`/`.no-drag` utilities; `button:not(:disabled) { cursor: pointer }`.
- `TabStrip.tsx`: drag-region strip, `no-drag` tabs, caption-button clearance via `env(titlebar-area-width)`, no `border-b`.
- `src/main/index.ts`: `titleBarStyle: 'hidden'`, `titleBarOverlay` (`#111423`/`#cacbd1`, 36px), `backgroundColor: '#111423'`.
- Design doc sections 5, 7, 11.4, 14, 15, 19, 21, 23, 26.1, 26.2, 30 updated.

## Phase 2 - Implement

- [x] Phase 2.1 - All eight items above, touched files, and the design doc contract update

## Phase 3 - Review

- [x] Phase 3.1 - Complete diff reviewed (scope, regressions, noise, doc impact): findings fixed inline (ResizeHandle does not overlap the drag strips; FitAddon fits the padded content box, confirmed against `node_modules/@xterm/addon-fit`; app-region subtraction model matches the `.no-drag` placement). Environmental fix: `package.json` working copy had CRLF endings (blob is LF, `eol=lf`); rewritten from the index blob, no content change.

## Phase 4 - Verify

- [x] Phase 4.1 - Final verification on the complete diff

## Phase 5 - Retro

- [x] Phase 5.1 - Lesson reconciliation: the `package.json` CRLF incident is fully covered by the existing lessons `windows-biome-package-json-eol` (empty-diff lint failure signature) and `git-checkout-reintroduces-crlf` (restore via `git show HEAD:<path>`, not `git checkout --`); both verified against this session's evidence, no update needed (deduplicated).

Record closed here (2026-09-28T21:37Z); the user then drove further corrections in the same session, so the record reopens.

## Phase 6 - Post-close correction rounds (user-driven)

- [x] Phase 6.1 - Dictation as the input frame's right segment (square left edge, frame-clipped right corners, `pl-3` frame); separator line above the prompt row removed (design doc 15/21)
- [x] Phase 6.2 - Action row padding equalized (8px both axes); WCO-covered `border-b` moved from the tab strip to the action row `border-y` (design doc 26.2)
- [x] Phase 6.3 - Project selection visuals: no fill, no hover background; chat rows full-width highlight, guide line removed; chat icon aligned to project name text (DOM measurement harness over the built CSS: diff 0px); "New Chat" as a chat-height row with the plus icon in the icon column (design doc 14)
- [x] Phase 6.4 - Welcome/StartNewChat vertically centered in the middle column (`h-full`); hand cursor on all enabled buttons (design doc 23)
- [x] Phase 6.5 - Segmented divider softened to a single 1px centered 16px hairline with `bg-button` behind the divider column; `--color-divider-light` token removed (design doc 5/11.4)

## Phase 7 - Next session

- [x] Phase 7.1 - Intake: change list taken (items 16-17 below), classification confirmed (feature/small/recorded, no risk flags)
- [x] Phase 7.2 - Plan the slice (in-session, below)
- [x] Phase 7.3 - Implement, affected checks, review, verify (lint exit 0, typecheck exit 0, `pnpm test` 342/342 including the two new Send tests; diff reviewed, no findings; `verify-targeted` on the two affected test files exit 0, 91/91; verification subject 2 matches)
- [x] Phase 7.4 - Retro: lesson `verify-targeted-cmd-wrapper-gitbash` recorded (bare `pnpm` command fails in `verify-targeted` with `WinError 2`; Git Bash converts `/c` to `C:/`, use `cmd //c`). The lesson writes landed after verification subject 2 was captured, so subject 3 re-captures the state with the lesson files included and a second targeted verify run covers it (append-only).

User change list (intake 2026-09-28, resumed session):

16. Action row, right end: the Actions control keeps only its icon, no default background; hover fill or pointer-only at the implementer's discretion.
17. Terminal prompt input: add a Send button (paper plane icon, label "Send") before the Dictation control, so a line can be submitted by clicking.

Plan:

- `ActionBar.tsx`: the right-end Actions control becomes icon-only: keep `Icon.settings`, drop the visible label, add `aria-label="Actions"` and `title="Actions"` (accessible name and tooltip preserved), remove `bg-button`, add `hover:bg-button-hover`, keep the row-height `self-stretch`. Decision: hover fill, not pointer-only, so the icon stays discoverable as a control and matches the row's other hover states; the hand cursor is already global.
- `PromptInput.tsx`: add a Send submit button between the input and Dictation as a full-height right segment (`h-full`, square left edge) with `Icon.send` plus the visible "Send" label, disabled while the input is empty, `bg-button` with `bg-button-hover` on hover; a standard centered hairline divider separates Send from Dictation (the action row's segment language, design doc 5/11.4).
- `icons.tsx`: add `Icon.send` (Lucide `Send`, the paper plane).
- `test-ids.ts`: add `terminalPromptSend`.
- Tests: `App.test.tsx` action-row `textContent` assertions map `aria-label ?? textContent` so the icon-only button keeps its name in the list; `ChatTerminal.test.tsx` gains a click-submit test for Send.
- Design doc: sections 10 (`Icon.send` role name), 15 (prompt input row gains Send), 21 (Dictation sits after Send), 11.4 (action row right end is icon-only).

Record closed here (2026-09-28T23:17Z); published as commit `4e8d515` plus version bump `75094e5` (tag `0.4.6`). The user approved the publication and announced further UI improvements to continue in a new session, so the record reopens at Phase 8.

## Phase 8 - Next session (round 3)

- [ ] Phase 8.1 - Intake: take the user's next UI improvement list, classify, and plan the slice

## Decisions

Carried from `ux-ui-theme-and-fonts`, the 0.4.5 slice, and this session (next owner must preserve):

- Icons: Lucide only, imported by role name from `src/renderer/src/lib/icons.tsx`, never from `lucide-react` directly; icons carry `aria-hidden` when a visible label names the control.
- Filled buttons and input frames use `--spacing-control` (32px); ghost row controls stay compact.
- Components consume semantic tokens only; no raw palette classes or hex colors in renderer sources (xterm theme literals and the BrowserWindow overlay hexes in main are the recorded exceptions).
- Terminal prompt input submits with Enter semantics; the Ctrl+D prompt base re-collects from the shell's next redraw (`ChatTerminal.tsx` `submitPromptLine`).
- The Dictation button stays disabled until a recognizer feature is decided; design doc 21 owns its states.
- Theme is one file (`src/renderer/src/theme.css`, Tailwind v4 `@theme`); runtime theme switching does not exist yet.
- Window title bar: WCO (`titleBarStyle: 'hidden'` + `titleBarOverlay`); drag surfaces are the three top strips; their background is the base `--color-app`.
- Segmented divider: single 1px centered 16px hairline over the `bg-button` group surface; no two-tone groove (user rejected it as too intense).
- Project rows: no selection fill, no hover background on the name; chat rows keep the full-width highlight; the chat icon aligns with the project name text start.
- The prompt input frame is the only boundary above the input row; no separator line.
- Hand cursor on every enabled button; disabled controls keep `not-allowed`.
- Welcome/StartNewChat center in the middle column, not the whole window.

## Changed files

- `src/renderer/src/theme.css` - divider token simplified; earlier `--color-divider-light` added then removed in the same session
- `src/renderer/src/components/actions/ActionBar.tsx` - row padding, segmented groups (`h-control`, `bg-button` surface, centered hairline divider), `border-y` row borders
- `src/renderer/src/components/terminal/ChatTerminal.tsx` - xterm host padding
- `src/renderer/src/components/terminal/PromptInput.tsx` - labeled Dictation as the frame's right segment; no separator line above the row
- `src/renderer/src/components/layout/LeftNavigation.tsx` - uppercase project names, no selection fill/hover bg, full-width chat rows with icons, aligned "New Chat" row, drag-region header
- `src/renderer/src/components/files/FileTree.tsx` - tree rows 14px
- `src/renderer/src/components/files/ProjectFilesPanel.tsx` - drag-region header
- `src/renderer/src/components/tabs/TabStrip.tsx` - drag-region strip, no-drag tabs, caption-button clearance, no `border-b`
- `src/renderer/src/components/workspace/WelcomeSurface.tsx` - `h-full` vertical centering
- `src/renderer/src/components/workspace/StartNewChatSurface.tsx` - `h-full` vertical centering
- `src/renderer/src/index.css` - `.drag-region`/`.no-drag`; `button:not(:disabled)` pointer cursor
- `src/main/index.ts` - `titleBarStyle: 'hidden'` + `titleBarOverlay` + `backgroundColor`
- `docs/references/NeKode-Design-System.md` - sections 5, 7, 11.4, 14, 15, 19, 21, 23, 26.1, 26.2, 30
- `package.json` - working-copy line endings normalized to LF (no content change)

Resumed session (items 16-17, 2026-09-28):

- `src/renderer/src/components/actions/ActionBar.tsx` - right-end Actions control is icon-only: no default fill, hover fill, `aria-label`/`title` `Actions`
- `src/renderer/src/components/terminal/PromptInput.tsx` - Send submit button (paper plane `Icon.send` + label) between the input and Dictation, disabled while the input is empty, hairline divider before it
- `src/renderer/src/lib/icons.tsx` - `Icon.send` (Lucide `Send`)
- `src/renderer/src/lib/test-ids.ts` - `terminalPromptSend`
- `src/renderer/src/App.test.tsx` - action-row button list assertions prefer `aria-label` over `textContent` (icon-only Actions control)
- `src/renderer/src/components/terminal/ChatTerminal.test.tsx` - Send click-submit test and Send-disabled-when-empty test
- `docs/references/NeKode-Design-System.md` - sections 10 (`Icon.send`), 11.4 (icon-only Actions control), 15 (Send in the prompt frame), 21 (Dictation is the last segment after Send)

## Verification

| Check | Result | Notes |
|---|---|---|
| `python .agents/scripts/preflight` (baseline) | pass | exit 0, clean worktree at `8b6cbc6` |
| `pnpm test` (baseline, before edits) | 340/340 | 2026-09-28T21:12Z |
| `pnpm run lint` (affected) | fail then pass | first run failed on pre-existing CRLF endings in the `package.json` working copy (blob is LF, `eol=lf`; git diff showed no change). Fixed by rewriting the file from the index blob; no content change |
| `pnpm run typecheck` (affected) | pass | node + web, exit 0 |
| `pnpm test` (affected) | 340/340 | after all edits |
| `python .agents/scripts/verify-full` | pass | exit 0 (validate-config, lint, typecheck, vitest 340/340). First attempt exited 1 on the record gate (`current step is already checked: Phase 2.1`); frontmatter corrected, rerun passed. All product checks passed in both attempts |
| `pnpm build` | pass | exit 0 |
| Compiled CSS checks | pass | `out/renderer/assets/index-D8bnbCDD.css` contained `.drag-region`, `.no-drag`, `--color-divider-light`, both divider border colors, `.uppercase`; `env(titlebar-area-width, 100vw)` present in the renderer JS bundle. (Bundle rebuilt several times in Phase 6; later rebuilds exit 0.) |
| Electron runtime smoke | pass | built app ran 12s with the new `titleBarStyle`/`titleBarOverlay` options: window process tree alive, empty error log, stopped via `taskkill` |
| Post-close rounds (each) | pass | lint exit 0, typecheck exit 0, `pnpm test` 340/340; last full run 2026-09-28T22:50Z |
| Resumed session (items 16-17) | pass | baseline `pnpm test` 340/340 (first run hit the known flaky `terminal-service.test.ts:196` ConPTY spawn test, clean on rerun); after edits: `pnpm run lint` exit 0, `pnpm run typecheck` exit 0, `pnpm test` 342/342; `python .agents/scripts/verify-targeted -- cmd //c pnpm exec vitest run src/renderer/src/App.test.tsx src/renderer/src/components/terminal/ChatTerminal.test.tsx` exit 0 (91/91, two runs); verification subject 3 `check` exit 0 immediately before close |
| Alignment measurement | pass | DOM harness over the built CSS in the in-app browser: project name text x == chat icon x (diff 0), chat row height == New Chat row height (24px), plus icon at the chat-icon column x |

### Verification subject 1

```json
{
  "attempt": 1,
  "head": "8b6cbc6e8651eec1936d68fc37630b729b45a172",
  "paths": [
    "docs/references/NeKode-Design-System.md",
    "package.json",
    "src/main/index.ts",
    "src/renderer/src/components/actions/ActionBar.tsx",
    "src/renderer/src/components/files/FileTree.tsx",
    "src/renderer/src/components/files/ProjectFilesPanel.tsx",
    "src/renderer/src/components/layout/LeftNavigation.tsx",
    "src/renderer/src/components/tabs/TabStrip.tsx",
    "src/renderer/src/components/terminal/ChatTerminal.tsx",
    "src/renderer/src/components/terminal/PromptInput.tsx",
    "src/renderer/src/index.css",
    "src/renderer/src/theme.css"
  ],
  "schema_version": 1,
  "staged_diff_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "subject_sha256": "9d1bf20aa1ffd4dcaa627e7589421d0a80c46cae120e658c08d642e28c25b9b5",
  "unstaged_diff_sha256": "5428372f228374c1a29e41b36133967c4f47cea6b9d2274d7a5a6d480a2fb9ae",
  "untracked_files_sha256": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
}
```

### Verification subject 2

```json
{
  "attempt": 2,
  "head": "929f3f6bfbce1b4ceffd993776a005fe61595f49",
  "paths": [
    "docs/references/NeKode-Design-System.md",
    "src/renderer/src/App.test.tsx",
    "src/renderer/src/components/actions/ActionBar.tsx",
    "src/renderer/src/components/terminal/ChatTerminal.test.tsx",
    "src/renderer/src/components/terminal/PromptInput.tsx",
    "src/renderer/src/lib/icons.tsx",
    "src/renderer/src/lib/test-ids.ts"
  ],
  "schema_version": 1,
  "staged_diff_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "subject_sha256": "52abcdadfafd4c7c62e006e2f58925aa47a5e7e66db9592bb98dd82a06921cb3",
  "unstaged_diff_sha256": "976e18b7ed8c7c2842b49edbde432a62ed03edb07c9ff6ea46aed5f5aabfc792",
  "untracked_files_sha256": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
}
```

### Verification subject 3

```json
{
  "attempt": 3,
  "head": "929f3f6bfbce1b4ceffd993776a005fe61595f49",
  "paths": [
    ".agents/lessons/index.json",
    ".agents/lessons/items/verify-targeted-cmd-wrapper-gitbash.md",
    "docs/references/NeKode-Design-System.md",
    "src/renderer/src/App.test.tsx",
    "src/renderer/src/components/actions/ActionBar.tsx",
    "src/renderer/src/components/terminal/ChatTerminal.test.tsx",
    "src/renderer/src/components/terminal/PromptInput.tsx",
    "src/renderer/src/lib/icons.tsx",
    "src/renderer/src/lib/test-ids.ts"
  ],
  "schema_version": 1,
  "staged_diff_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "subject_sha256": "cb06645908ee9b267c91276e29100a482a549ad5bd9e1814f78dfe03e7ba6eac",
  "unstaged_diff_sha256": "377867132f08ffff503236113508bc32f11c0325be274e4b60241c287e1fb465",
  "untracked_files_sha256": "f571b0abd27f77c3c1452c72e0788d52992aeda29c0cb68a22c15d71558382e4"
}
```

## Timing

| Element | Kind | Started | Ended |
|---|---|---|---|
| intake | work | 2026-09-28T21:03:02Z | 2026-09-28T21:03:02Z |
| handoff | wait | 2026-09-28T21:03:02Z | 2026-09-28T21:12:03Z |
| intake | work | 2026-09-28T21:12:03Z | 2026-09-28T21:22:00Z |
| plan | work | 2026-09-28T21:22:00Z | 2026-09-28T21:22:00Z |
| implement | work | 2026-09-28T21:22:00Z | 2026-09-28T21:30:47Z |
| review | work | 2026-09-28T21:30:47Z | 2026-09-28T21:30:47Z |
| verify | work | 2026-09-28T21:30:47Z | 2026-09-28T21:33:55Z |
| retro | work | 2026-09-28T21:35:48Z | 2026-09-28T21:36:28Z |
| implement:followup | work | 2026-09-28T21:37:10Z | 2026-09-28T22:53:39Z |
| handoff | wait | 2026-09-28T22:53:39Z | 2026-09-28T22:58:26Z |
| intake | work | 2026-09-28T22:58:26Z | 2026-09-28T23:00:41Z |
| plan | work | 2026-09-28T23:00:41Z | 2026-09-28T23:02:38Z |
| implement:resumed | work | 2026-09-28T23:02:38Z | 2026-09-28T23:07:30Z |
| review | work | 2026-09-28T23:07:30Z | 2026-09-28T23:09:30Z |
| verify | work | 2026-09-28T23:09:30Z | 2026-09-28T23:13:20Z |
| retro | work | 2026-09-28T23:13:20Z | 2026-09-28T23:15:35Z |
| verify | work | 2026-09-28T23:15:35Z | 2026-09-28T23:17:38Z |

Record created retroactively at handoff (user pause after publishing 0.4.5): the intake row shares the record-creation instant instead of inventing a span. Phase 6 correction rounds share the single `implement:followup` row; each round's checks are in the Verification table.

## Risks and blockers

No active blockers. Notes: the app UI of the whole batch (0.4.5 slice plus this session's corrections) has not been visually accepted by the user in one walkthrough yet (`pnpm dev` pending; individual changes were confirmed by the user between rounds). The real dictation feature (recognizer choice and wiring) is an open product decision, not a defect. The custom title bar changes window startup options: dragging, resizing and the caption buttons should be confirmed on Windows during the next `pnpm dev` run.

## Resume instructions

Read `.agents/handoffs/ux-ui-polish-followup.md` (this task's live snapshot), resume the record via `task-record` (end the `handoff` wait, open Phase 7.1 intake), take the user's concrete change list, then plan the slice with `.agents/workflows/small-development.md` unless the scope says Standard. The checkpoint commit contains the full uncommitted batch; version stays 0.4.5 until the next publication offer. Repository evidence wins over the snapshot.
