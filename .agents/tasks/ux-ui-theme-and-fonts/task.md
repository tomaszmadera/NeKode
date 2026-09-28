---
id: ux-ui-theme-and-fonts
schema_version: 2
status: completed
intent: feature
complexity: small
durability: recorded
current_phase: Phase 6
current_step: none
updated: 2026-09-28
branch: main
worktree: current
next_action: none
blockers: none
---

# UX/UI base theme, semantic tokens, and Recursive font pairing

## Objective

Apply the user's base palette (app `rgb(17 20 35)`, panels `rgb(26 29 44)`, highlight `rgb(31 44 63)`, buttons and active tab `rgb(30 42 66)`, ink `rgb(202 203 209)`, success/info/error per user values) as the NeKode renderer theme, migrate all components from raw Tailwind grays to semantic tokens, and adopt a mono/sans font pairing (Recursive Mono Casual + Recursive Sans Casual) selected from the user's candidate list. Affects the renderer UI and terminal surfaces only.

## Scope

Small development, no spec or plan file. In-session plan; source of truth for the visual contract: `docs/references/NeKode-Design-System.md` (updated in this task: sections 4, 5, 8, 11, 12, 26, 30, and new 6.5). Next slice (bigger buttons) is intentionally left to the follow-up session.

## Phase 0 - Intake

- [x] Phase 0.1 - Inspect repository, classify (feature/small/ephemeral at start, recorded at handoff), confirm no existing theme file (only `docs/references/NeKode-Design-System.md` with an older palette)

## Phase 1 - Plan

- [x] Phase 1.1 - In-session plan: update design doc palette; create Tailwind v4 `@theme` token file; migrate components; keep tests untouched (they assert test-ids and behavior, not colors)

## Phase 2 - Implement

- [x] Phase 2.1 - Theme tokens in `src/renderer/src/theme.css`, wired in `index.css`; 17 renderer components migrated; Recursive VF bundled in `src/renderer/src/fonts/`; terminal font set in `ChatTerminal.tsx`; design doc updated

## Phase 3 - Review

- [x] Phase 3.1 - Full diff review: scope limited to theme/doc/biome config/EOL fix; grep confirms zero leftover `neutral-*`/`red-*`/hex colors in renderer; tests unaffected

## Phase 4 - Verify

- [x] Phase 4.1 - lint, typecheck, build, unit tests, compiled-CSS token check, canvas axis measurement (evidence below)

## Phase 5 - Handoff

- [x] Phase 5.1 - Handoff snapshot and one scoped checkpoint commit; work preserved for the polish session (snapshot `.agents/handoffs/ux-ui-theme-and-fonts.md`, checkpoint commit 503b8da)

## Phase 6 - Polish slice (session 2026-09-28, user list)

- [x] Phase 6.1 - Plan the slice in-session. Findings and decisions: (a) the always-visible scroll is the xterm viewport (`overflow-y: scroll` forced by `@xterm/xterm/css/xterm.css:96`); fix with a themed `overflow-y: auto` override plus token-colored webkit scrollbar. (b) Tab visual height is 32px (`h-9` strip minus `pt-1`, `TabStrip.tsx:44`); introduce `--spacing-control: 2rem` and apply to filled `bg-button` buttons; ghost row controls (Edit/Delete/Close, tab close, tree chevron, Files hover) keep row scale. (c) Icon set: Lucide, already a dependency (`lucide-react@1.47.0`, unused) and prescribed by design doc §10; add `src/renderer/src/lib/icons.tsx` semantic mapping covering the user's full list (handoff/resume/stop/continue/preview/docker/chat/directory/files/git/kanban/projects/checkmarks/dictation/panel toggles/terminal/agent/search); status glyphs and micro-controls switch to icons; tests asserting `▶ Build`-style names updated to the label-only name. (d) Prompt input is feasible: same write path as ActionBar `sendFixed` (`app.terminals.write(chatId, data)`); render `PromptInput` under the xterm host inside `ChatTerminal` (outer display stays `block`/`none` per ChatTerminal.test.tsx:347); Enter sends `text + '\r'` through the in-component `sendToPty` (freezes the Ctrl+D prompt base); Dictation button rendered per design doc §21, disabled until the dictation feature exists (none found in src). (e) Theme tokens added: `--spacing-control`, `--radius-sm/md/lg` (doc §8), `--font-mono`, `--color-scrollbar`, `--color-scrollbar-active`; design doc sections 7, 8, 10, 11, 16, 21 updated.
- [x] Phase 6.2 - Implemented: xterm viewport `overflow-y: auto` override + token-colored webkit scrollbars (`index.css`), `--color-scrollbar`/`--color-scrollbar-active` tokens; filled buttons at `--spacing-control` (32px) across ActionBar, empty states, retries, dialogs, Add Project, New Chat, Open externally
- [x] Phase 6.3 - Implemented: `src/renderer/src/lib/icons.tsx` (Lucide, role-name mapping covering the full user list); applied to ActionBar fixed/status/settings buttons, tab and bottom-tab close, New chat/New terminal, project toggle and Files action, Add Project, Files-mode back, file-tree chevrons; status glyphs (`▶ ◌ ✓ ✕`) replaced by Play/LoaderCircle/CircleCheck/CircleX with aria-hidden icons; test names updated (`▶ Build` → `Build` etc.)
- [x] Phase 6.4 - Implemented: `PromptInput.tsx` rendered under the xterm host in `ChatTerminal` (`>` glyph, mono input, `--radius-md` frame, info focus border, disabled Dictation mic at the right end); Enter submits `line + '\r'` through `sendToPty` (freezes the Ctrl+D prompt base); xterm-mock focus walks to the `terminal-canvas-*` view container; 3 new PromptInput tests (340/340)
- [x] Phase 6.5 - Reviewed the complete slice diff. Findings, both corrected in-session: (1) prompt-input submission froze the Ctrl+D prompt base permanently; resubmission is now Enter semantics (`submitPromptLine` thaws the base so the shell's next prompt redraw re-collects it). (2) The `.xterm .xterm-viewport { overflow-y: auto }` override relied on bundle order; doubled-class selector removes the order dependency. Token discipline verified by grep: no raw palette colors introduced in renderer sources (the remaining xterm theme literals in ChatTerminal.tsx predate this task and are a recorded decision).
- [x] Phase 6.6 - Verify: `python .agents/scripts/verify-full` exit 0 (lint 0 errors, typecheck pass, vitest 340/340); `pnpm build` exit 0 with compiled-CSS checks for `.h-control`, `--font-mono`, `--spacing-control`, `--color-scrollbar`, radius tokens and the `.xterm .xterm-viewport.xterm-viewport { overflow-y: auto }` override

## Decisions

- Exact user-provided values are authoritative: app `rgb(17 20 35)`, panel `rgb(26 29 44)`, highlight `rgb(31 44 63)`, button `rgb(30 42 66)`, tab inactive `rgb(25 29 41)`, tab border `rgb(33 37 49)`, ink `rgb(202 203 209)`, success `rgb(147 189 161)`, info `rgb(83 134 188)`, error `rgb(151 65 80)`.
- Derived values delegated by the user (recorded in the design doc): button hover `rgb(38 52 80)`, double-button divider `rgb(17 20 35)`, terminal bg `rgb(13 15 26)`, terminal selection `rgb(49 66 95)`, ink secondary/muted/disabled `rgb(140 142 152)`/`rgb(106 108 118)`/`rgb(76 78 88)`, radius 6px (tabs top-only).
- Tabs: active = `bg-button`, no border; inactive = `bg-tab-inactive` + `border-edge`; tab strip sits on `bg-app` with `px-1 pt-1` so the top-rounded tabs read as tabs, not buttons.
- Buttons are borderless, filled `bg-button`, `rounded-md`; ActionBar double buttons use `border-l border-divider` as the separating bar; action status colors: success/warning(failed=error)/info per semantic tokens.
- Fonts: Recursive variable font (SIL OFL, `src/renderer/src/fonts/OFL.txt`) serves both families via `@font-face` `font-variation-settings` descriptors: `"Recursive Mono Casual"` (MONO 1, CASL 1) for terminals, `"Recursive Sans Casual"` (MONO 0, CASL 1) for UI. `ChatTerminal.tsx` `fontFamily` and the `@font-face` families must stay in sync. Candidate filter (no sans counterpart): Comic Mono, Cascadia Code, Maple Mono, Monospace Argon; retained: Fira Code, Source Code Pro, JetBrains Mono, Iosevka Charon Mono, Google Sans Code, Geist Mono (design doc 6.5).
- `biome.json` gained `css.parser.tailwindDirectives: true` (biome cannot parse `@theme` otherwise).
- `package.json` on-disk CRLF normalized to LF per `.gitattributes` (`eol=lf`); content unchanged versus HEAD.
- Components consume semantic Tailwind classes (`bg-panel`, `text-ink`, `border-edge`, ...); raw palette classes and hex colors stay out of renderer sources.

## Changed files

Product: `biome.json`, `docs/references/NeKode-Design-System.md`, `src/renderer/src/index.css`, `src/renderer/src/theme.css` (new), `src/renderer/src/fonts/recursive-latin-full-normal.woff2` (new), `src/renderer/src/fonts/recursive-latin-ext-full-normal.woff2` (new), `src/renderer/src/fonts/OFL.txt` (new), `src/renderer/src/App.tsx`, `src/renderer/src/components/actions/ActionBar.tsx`, `src/renderer/src/components/actions/ActionSettings.tsx`, `src/renderer/src/components/files/FilePreview.tsx`, `src/renderer/src/components/files/FileTree.tsx`, `src/renderer/src/components/files/MonacoPreview.tsx`, `src/renderer/src/components/files/ProjectFilesPanel.tsx`, `src/renderer/src/components/layout/LeftNavigation.tsx`, `src/renderer/src/components/layout/NoticeBanner.tsx`, `src/renderer/src/components/layout/ResizeHandle.tsx`, `src/renderer/src/components/layout/StatusBar.tsx`, `src/renderer/src/components/tabs/TabStrip.tsx`, `src/renderer/src/components/terminal/BottomPanel.tsx`, `src/renderer/src/components/terminal/ChatTerminal.tsx`, `src/renderer/src/components/workspace/ChatWorkspace.tsx`, `src/renderer/src/components/workspace/StartNewChatSurface.tsx`, `src/renderer/src/components/workspace/WelcomeSurface.tsx`.

Tracking: `.agents/tasks/ux-ui-theme-and-fonts/task.md` (this record), `.agents/handoffs/ux-ui-theme-and-fonts.md`.

## Verification

| Check | Result | Notes |
|---|---|---|
| `pnpm run lint` (biome) | pass | exit 0 |
| `pnpm run typecheck` (node+web) | pass | exit 0 |
| `pnpm test` (vitest) | 340/340 | 3 new PromptInput tests; ConPTY flake passed in the preflight baseline run (337/337 before edits) |
| `python .agents/scripts/verify-full` | pass | exit 0; runs validate-config + `cmd /c pnpm run verify` |
| `pnpm build` | pass | exit 0; fonts bundled; tokens and utilities present in compiled CSS |
| Canvas axis measurement (Phase 4, theme slice) | pass | Chromium measureText: Mono family `iiiiiiiiii` == `WWWWWWWWWW` (96px each), Sans 56px vs 152px; `@font-face` descriptors apply on canvas (xterm draws on canvas) |
| Compiled CSS checks | pass | `.h-control`, `--font-mono`, `--spacing-control`, `--color-scrollbar`, `--radius-*`, `.xterm .xterm-viewport.xterm-viewport { overflow-y: auto }` present in `out/renderer/assets/index-*.css` |

### Verification subject 1

```json
{
  "attempt": 1,
  "head": "88f6512ffefbb93fb76d83512d34ead7307614dc",
  "paths": [
    "biome.json",
    "docs/references/NeKode-Design-System.md",
    "src/renderer/src/App.tsx",
    "src/renderer/src/components/actions/ActionBar.tsx",
    "src/renderer/src/components/actions/ActionSettings.tsx",
    "src/renderer/src/components/files/FilePreview.tsx",
    "src/renderer/src/components/files/FileTree.tsx",
    "src/renderer/src/components/files/MonacoPreview.tsx",
    "src/renderer/src/components/files/ProjectFilesPanel.tsx",
    "src/renderer/src/components/layout/LeftNavigation.tsx",
    "src/renderer/src/components/layout/NoticeBanner.tsx",
    "src/renderer/src/components/layout/ResizeHandle.tsx",
    "src/renderer/src/components/layout/StatusBar.tsx",
    "src/renderer/src/components/tabs/TabStrip.tsx",
    "src/renderer/src/components/terminal/BottomPanel.tsx",
    "src/renderer/src/components/terminal/ChatTerminal.tsx",
    "src/renderer/src/components/workspace/ChatWorkspace.tsx",
    "src/renderer/src/components/workspace/StartNewChatSurface.tsx",
    "src/renderer/src/components/workspace/WelcomeSurface.tsx",
    "src/renderer/src/fonts/OFL.txt",
    "src/renderer/src/fonts/recursive-latin-ext-full-normal.woff2",
    "src/renderer/src/fonts/recursive-latin-full-normal.woff2",
    "src/renderer/src/index.css",
    "src/renderer/src/theme.css"
  ],
  "schema_version": 1,
  "staged_diff_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "subject_sha256": "8c0a699b913a9ef982b2b7c5dc437ab6a8428f8b05a2b24e6947f96e3e0b6ca6",
  "unstaged_diff_sha256": "9f4d42371b09ab838d2dfdeeb8e14e872a846094b63a2943e86a2d4997668223",
  "untracked_files_sha256": "14a10941a78d0b29c76bd12b8c1f442eb9010eefc339ebdb57eb8de1700a97e5"
}
```
### Verification subject 2

```json
{
  "attempt": 2,
  "head": "503b8daf1c0ab07acb6b5070a40a83e5597f2c15",
  "paths": [
    "docs/references/NeKode-Design-System.md",
    "src/renderer/src/App.test.tsx",
    "src/renderer/src/BottomPanel.test.tsx",
    "src/renderer/src/components/actions/ActionBar.tsx",
    "src/renderer/src/components/actions/ActionSettings.tsx",
    "src/renderer/src/components/files/FilePreview.tsx",
    "src/renderer/src/components/files/FileTree.tsx",
    "src/renderer/src/components/files/ProjectFiles.test.tsx",
    "src/renderer/src/components/files/ProjectFilesPanel.tsx",
    "src/renderer/src/components/layout/LeftNavigation.tsx",
    "src/renderer/src/components/tabs/TabStrip.tsx",
    "src/renderer/src/components/terminal/BottomPanel.tsx",
    "src/renderer/src/components/terminal/ChatTerminal.test.tsx",
    "src/renderer/src/components/terminal/ChatTerminal.tsx",
    "src/renderer/src/components/terminal/PromptInput.tsx",
    "src/renderer/src/components/workspace/ChatWorkspace.tsx",
    "src/renderer/src/components/workspace/StartNewChatSurface.tsx",
    "src/renderer/src/index.css",
    "src/renderer/src/lib/icons.tsx",
    "src/renderer/src/lib/test-ids.ts",
    "src/renderer/src/test/pending-bottom-command.lifecycle.test.tsx",
    "src/renderer/src/test/xterm-mock.ts",
    "src/renderer/src/theme.css"
  ],
  "schema_version": 1,
  "staged_diff_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "subject_sha256": "f3fd0967d6eea6f3e0908fc4c2bfb30b0086585a04e9d92d420db560bf005671",
  "unstaged_diff_sha256": "b530c65b5f62adb60869fdf7646cbd699e5a44eede6e4c57dda66a5d444bac37",
  "untracked_files_sha256": "43f351a5c20cd3f2f12def3c8f1c3f30ba43710448623d085a8309b9a414aeac"
}
```
## Timing

| Element | Kind | Started | Ended |
|---|---|---|---|
| intake | work | 2026-09-28T19:54:18Z | 2026-09-28T19:54:18Z |
| plan | work | 2026-09-28T19:54:18Z | 2026-09-28T19:54:18Z |
| implement | work | 2026-09-28T19:54:18Z | 2026-09-28T19:54:18Z |
| review | work | 2026-09-28T19:54:18Z | 2026-09-28T19:54:18Z |
| verify | work | 2026-09-28T19:54:18Z | 2026-09-28T19:54:18Z |
| handoff | wait | 2026-09-28T19:54:18Z | 2026-09-28T20:05:06Z |
| plan | work | 2026-09-28T20:05:06Z | 2026-09-28T20:06:00Z |
| preflight | work | 2026-09-28T20:06:00Z | 2026-09-28T20:13:55Z |
| implement | work | 2026-09-28T20:13:55Z | 2026-09-28T20:28:40Z |
| review | work | 2026-09-28T20:28:40Z | 2026-09-28T20:31:00Z |
| correction | work | 2026-09-28T20:31:00Z | 2026-09-28T20:33:28Z |
| verify | work | 2026-09-28T20:33:28Z | 2026-09-28T20:34:53Z |

Record created retroactively at handoff: the session's work phases predate the record, so all closed rows share the record-creation instant instead of invented spans.

## Risks and blockers

No active blockers. Notes for the next session: ~600 KB of woff2 assets added to the renderer bundle (license OFL, files local); visual acceptance of the new theme by the user is still pending; `pnpm test` ConPTY spawn test is flaky on this machine and unrelated to UI work.

## Resume instructions

Read `.agents/handoffs/ux-ui-theme-and-fonts.md`, then resume the record (activate `task-record`: end the `handoff` wait row, open `plan`/`implement`). First slice of the polish session: bigger buttons (ActionBar, empty-state and retry buttons, dialog buttons) against design doc sections 7 and 11; keep using semantic tokens from `src/renderer/src/theme.css`. Load `.agents/workflows/small-development.md` for the slice. Expected evidence: visibly larger control heights in the running app with lint/typecheck passing.
