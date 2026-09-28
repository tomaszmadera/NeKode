---
id: ux-ui-theme-and-fonts
schema_version: 2
status: active
intent: feature
complexity: small
durability: recorded
current_phase: Phase 5
current_step: Phase 5.1
updated: 2026-09-28
branch: main
worktree: current
next_action: Resume for the polish session: apply bigger buttons (see .agents/handoffs/ux-ui-theme-and-fonts.md)
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

- [ ] Phase 5.1 - Handoff snapshot and one scoped checkpoint commit; work preserved for the polish session

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
| `pnpm run lint` (biome) | pass | exit 0 after `css.parser.tailwindDirectives` and formatting |
| `pnpm run typecheck` (node+web) | pass | exit 0 |
| `pnpm test` (vitest) | 336/337 | single failure `terminal-service.test.ts:196` "conpty failed": main-process ConPTY spawn, flaky (full pass on rerun), unrelated to renderer change |
| `pnpm build` | pass | exit 0; both woff2 emitted to `out/renderer/assets/`; `--color-panel`/`.bg-panel`/`.text-ink` present in compiled CSS |
| Canvas axis measurement | pass | Chromium measureText: Mono family `iiiiiiiiii` == `WWWWWWWWWW` (96px each), Sans 56px vs 152px; `@font-face` descriptors apply on canvas (xterm draws on canvas) |

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
## Timing

| Element | Kind | Started | Ended |
|---|---|---|---|
| intake | work | 2026-09-28T19:54:18Z | 2026-09-28T19:54:18Z |
| plan | work | 2026-09-28T19:54:18Z | 2026-09-28T19:54:18Z |
| implement | work | 2026-09-28T19:54:18Z | 2026-09-28T19:54:18Z |
| review | work | 2026-09-28T19:54:18Z | 2026-09-28T19:54:18Z |
| verify | work | 2026-09-28T19:54:18Z | 2026-09-28T19:54:18Z |
| handoff | wait | 2026-09-28T19:54:18Z | |

Record created retroactively at handoff: the session's work phases predate the record, so all closed rows share the record-creation instant instead of invented spans.

## Risks and blockers

No active blockers. Notes for the next session: ~600 KB of woff2 assets added to the renderer bundle (license OFL, files local); visual acceptance of the new theme by the user is still pending; `pnpm test` ConPTY spawn test is flaky on this machine and unrelated to UI work.

## Resume instructions

Read `.agents/handoffs/ux-ui-theme-and-fonts.md`, then resume the record (activate `task-record`: end the `handoff` wait row, open `plan`/`implement`). First slice of the polish session: bigger buttons (ActionBar, empty-state and retry buttons, dialog buttons) against design doc sections 7 and 11; keep using semantic tokens from `src/renderer/src/theme.css`. Load `.agents/workflows/small-development.md` for the slice. Expected evidence: visibly larger control heights in the running app with lint/typecheck passing.
