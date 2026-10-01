---
id: nekode-3-sidebar-selection-container
schema_version: 2
status: completed
intent: feature
complexity: small
durability: recorded
current_phase: Phase 5
current_step: none
updated: 2026-10-02
branch: main
worktree: current
next_action: none
blockers: none
---

# NEKODE-3 Cozy Dark sidebar: project selection container and soft header

## Objective

Make the selected project unmistakable and the sidebar hierarchy readable: a rounded, highlighted selection container with a narrow left accent stripe (lavender in default-beta-1, blue in default), a softer "Projects" section header without uppercase, a clearly clickable expand/collapse chevron, and distinct project vs chat row shapes. Visual/structural change in `src/renderer/src/components/layout/LeftNavigation.tsx` only; no logic, data, or palette changes.

## Scope

Small development, in-session plan; source of truth: Plane card NEKODE-3 (brief Cozy Dark UI r3.2 + execution analysis appended 2026-10-01), approved by the user in chat. Implementation strategy (card analysis): common markup for both themes — container radius from `--radius-md`, highlight from `bg-highlight`, left stripe from the NEW token `--color-accent` (default: rgb(83 134 188); default-beta-1: rgb(182 161 250)); soft header = drop uppercase; project rows rounded-md vs chat rows rounded-sm. Out of scope: chat-row redesign beyond the radius distinction, palette changes, logic changes, other Cozy Dark cards.

## Phase 0 - Intake

- [x] Phase 0.1 - Inspected repository at 8fe2609 (clean tree): LeftNavigation structure read; second agent's PanelFooter lands as `children` after the list — no conflict; theme clone test (`lib/theme.test.ts`) requires both theme files to declare identical token names; App.test asserts header text `Projects` (text kept, styling only changes)

## Phase 1 - Plan (in-session)

- [x] Phase 1.1 - Plan fixed per approved card: (a) new token `--color-accent` in both theme files (clone test guards the pair); (b) project row wrapper becomes the selection container — rounded-md, bg-highlight when selected, 3px left accent stripe when selected, overflow-hidden keeps the stripe inside the radius; (c) header and project title drop `uppercase`; (d) chevron button gets an explicit hit area and hover surface; (e) chat rows keep their shape but get rounded-sm to read as children. All test-ids, handlers, and aria attributes unchanged.

## Phase 2 - Implementation

- [x] Phase 2.1 - Token `--color-accent` in `themes/default.css` and `themes/default-beta-1.css`
- [x] Phase 2.2 - LeftNavigation selection container, soft header, merged title-chevron toggle, row radii; "No chats yet." removed; companion tests updated (App.test collapse/stale-list scenarios, CenterTabs p2-expansion scenario)
- [x] Phase 2.3 - Affected checks: theme clone + App + CenterTabs + ProjectFiles + BottomPanel suites (135/135 passed); lint/typecheck blocked by the concurrent agent's in-flight files (see Risks)

## Phase 3 - Review

- [x] Phase 3.1 - Full diff review: scope (exactly the approved card + two user additions), failure paths (fold keeps selection/chat; empty expanded project renders nothing), regressions (companion tests updated with preserved intent; retention paths untouched), test quality (assertions via stable test-ids; no new mocks). Commit `5647c4d`.

## Phase 4 - Verify

- [x] Phase 4.1 - Targeted final verification via `commands.verify_targeted`: `python .agents/scripts/verify-targeted -- cmd /c "pnpm vitest run src/renderer/src/lib/theme.test.ts src/renderer/src/App.test.tsx src/renderer/src/components/tabs/CenterTabs.test.tsx"` → exit 0, 3 files, 104/104 tests (2026-10-02T01:16Z). Full gates green earlier the same hour: lint (biome, 114 files), typecheck (node+web), test 413/413.

## Phase 5 - Close

- [x] Phase 5.1 - Record closed 2026-10-02; NEKODE-3 moved to Done on the Plane board. Deviation note: the final commit was created with plain `git commit` on a pre-partitioned index instead of recorded `commands.ci`, because `ci.py commit -f` stages whole files (`.agents/skills/ci/scripts/git_ops.py:98-110`, `commit_paths`) and `App.test.tsx` interleaved this task's hunks with the concurrent agent's Shortcuts hunks — the tool has no hunk-level scope and the first attempt (`489ca92`, discarded via `git reset --soft` before publication) leaked 112 lines of the other agent's uncommitted work into this task's commit.

## Decisions

- One new token only (`--color-accent`); stripe geometry is component-level, not tokenized — no second consumer exists yet (avoid speculative vocabulary).
- Selection container = the outer project row `div` (testid `testIdFor.projectRow`), so `data-selected` styling lands on the element tests already assert on.
- The stripe is decorative → `aria-hidden`; selection stays announced by `data-selected` + highlight.
- Uppercase removal touches header AND project titles (brief: "miększy nagłówek", rows must read as the tree, not shout).
- Chat rows: padding/hover/heights unchanged (compact height is a card requirement); only the radius differentiates.
- User additions mid-implementation (2026-10-02, chat): (1) the "No chats yet." empty-state paragraph is removed — an expanded project with zero chats renders nothing under the title; (2) chevron and title merge into ONE toggle surface (testid keeps `projectSelect`): clicking an unselected project selects it (select path also expands), clicking the selected project's title folds/unfolds its subtree in place — selection and the active chat survive folding. `aria-expanded` moved to the merged button; `projectToggle` testid is now unused (cleanup deferred — `lib/test-ids.ts` is being edited by the concurrent agent).
- Companion-test updates preserve intent: all three replaced clicks acted on the already-selected project, where old title-click and old toggle-click had identical observable effects.

## Changed files

- src/renderer/src/themes/default.css
- src/renderer/src/themes/default-beta-1.css
- src/renderer/src/components/layout/LeftNavigation.tsx
- src/renderer/src/App.test.tsx
- src/renderer/src/components/tabs/CenterTabs.test.tsx

## Verification

| Check | Result | Notes |
|---|---|---|
| Baseline before edits: theme clone + LeftNavigation suites | 80/80 passed | `pnpm vitest run theme.test.ts App.test.tsx` at 8fe2609, clean tree |
| Affected suites after edits: theme, App, CenterTabs, ProjectFiles, BottomPanel | 135/135 passed | 2026-10-02T01:04Z, with the concurrent agent's partial edits present in other files |
| Full gates lint + typecheck + test | blocked → passed | second agent was mid-write during implementation; after their completion: lint 114 files OK, typecheck OK, 413/413 tests (2026-10-02T01:11Z) |
| Final: `commands.verify_targeted` (theme, App, CenterTabs) | 104/104, exit 0 | 2026-10-02T01:16Z, after commit `5647c4d` |
| Final (verification subject 1) | 104/104, exit 0 | 2026-10-02T01:18Z at HEAD `8c70cf1`; subject covers the five task-owned code paths |

### Verification subject 1

```json
{
  "attempt": 1,
  "head": "8c70cf154f6a71ad2b056c5f2a74b0a2c78da389",
  "paths": [
    "src/renderer/src/App.test.tsx",
    "src/renderer/src/components/layout/LeftNavigation.tsx",
    "src/renderer/src/components/tabs/CenterTabs.test.tsx",
    "src/renderer/src/themes/default-beta-1.css",
    "src/renderer/src/themes/default.css"
  ],
  "schema_version": 1,
  "staged_diff_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "subject_sha256": "45785f8013b5ff4f167602e6a8aecca9016755c2df0cb6c57f57930c61f1ba12",
  "unstaged_diff_sha256": "1c746d3c53088e929a5b76f28e502448cf4145a22c259ce78a007b04930af7c3",
  "untracked_files_sha256": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
}
```

## Timing

| Element | Kind | Started | Ended |
|---|---|---|---|
| intake | work | 2026-10-01T22:48:17Z | 2026-10-01T22:48:40Z |
| plan | work | 2026-10-01T22:48:40Z | 2026-10-01T22:49:00Z |
| implement | work | 2026-10-01T22:49:00Z | 2026-10-02T01:04:00Z |
| review | work | 2026-10-02T01:04:00Z | 2026-10-02T01:14:00Z |
| verify | work | 2026-10-02T01:14:00Z | 2026-10-02T01:16:30Z |
| close | work | 2026-10-02T01:16:30Z | 2026-10-02T01:18:00Z |

## Risks and blockers

- Theme clone test fails if the token lands in only one file — intentional guard, both files edited together.
- App.test line ~1206 asserts header text `Projects` — kept; only classes change. No test asserts uppercase.
- No blocker.

## Resume instructions

Phase 2.1: add `--color-accent` to both theme files (default rgb(83 134 188), beta rgb(182 161 250)), then Phase 2.2 per Phase 1.1 plan. Evidence to inspect before editing: `git log -1` shows 8fe2609 or later with clean tree; `lib/theme.test.ts` clone contract.
