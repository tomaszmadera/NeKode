---
id: ctrl-n-new-chat-and-shortcuts-tab
schema_version: 2
status: completed
intent: feature
complexity: small
durability: recorded
current_phase: Phase 3
current_step: none
updated: 2026-10-01
branch: main
worktree: current
next_action: none
blockers: none
---

# Ctrl+N new chat and App Settings shortcuts tab

## Objective

Add a global Ctrl+N shortcut that starts a new chat in the active project and
switches the view to it, and add a dedicated "Shortcuts" tab in App Settings
documenting every keyboard shortcut. Affects the renderer only (App-level
chord, AppSettings dialog, tests, design doc).

## Scope

Small development, no spec or plan file. The shortcut reuses the exact
`handleCreateChat` path (spec Behaviour 3), so selection, persistence, and
tab activation come for free. The shortcuts tab is the single place where
users can discover the growing shortcut set.

## Phase 0 - Intake

- [x] Phase 0.1 - Inspect repository: chord idiom (`bottom-panel-chord.ts`,
  `chat-switch-chord.ts` + App capture-phase effects), `handleCreateChat`
  (App.tsx:944), AppSettings dialog and its Tab-cycle test contract,
  ChatTerminal swallow points

## Phase 1 - Plan

- [x] Phase 1.1 - In-session plan:
  1. `src/renderer/src/lib/new-chat-chord.ts` — pure matcher on `event.code === 'KeyN'` + ctrlOnly
  2. App.tsx: capture-phase keydown effect, ref-revalidated handler, modal guard, ChatTerminal swallow
  3. AppSettings: second tab "Shortcuts" (read-only table), existing settings stay on "General"; focus-trap order updated
  4. App tests: chord creates chat via `handleCreateChat` path; ignores repeat/modals; settings tab shows all shortcuts
  5. docs/UX-UI.md §32 update

## Phase 2 - Implement

- [x] Phase 2.1 - Chord module, App effect, ChatTerminal swallow, Shortcuts tab, tests, design doc

## Phase 3 - Review

- [x] Phase 3.1 - Review pass, then verification subject + final verification and close (after the user's GUI acceptance gate)

## Decisions

- Ctrl+N is a plain toggle-less action chord: no settings on/off switch (unlike
  chat switch) — it duplicates the always-visible "+ New chat" affordance.
- The Shortcuts tab is read-only documentation; no rebinding (post-MVP).
- Tab naming: "General" (existing controls) + "Shortcuts" (new), English UI
  per repo convention.

## Changed files

- src/renderer/src/lib/new-chat-chord.ts (new)
- src/renderer/src/App.tsx (chord effect after the Ctrl+Tab effect)
- src/renderer/src/components/terminal/ChatTerminal.tsx (swallow)
- src/renderer/src/components/settings/AppSettings.tsx (tabs: General + Shortcuts)
- src/renderer/src/lib/test-ids.ts (3 new settings tab/table ids)
- src/renderer/src/App.test.tsx (4 new tests + Tab-cycle update)
- docs/UX-UI.md (§32 App Settings tabs, §53 shortcut table)

## Verification

| Check | Result | Notes |
|---|---|---|
| Implement-slice: vitest App.test.tsx | pass | 83/83 (4 new: chord create path, notice+modal guard, auto-repeat, Shortcuts tab) |
| Full verify (shared tree, mid-parallel-agent) | pass (code gates) | lint 114 files, typecheck node+web, vitest 413/413 (28 files); verify-full EXIT=1 only on the parallel agent's in-progress nekode-3 task record, unrelated |
| verify-full rerun after nekode-3 fix | code gates pass | lint/typecheck/413 tests green; final gate for close runs after the GUI acceptance gate with a fresh subject |
| GUI acceptance gate (user) | pass | "Działa": Ctrl+N create+navigate, notice without project, PTY swallow, Shortcuts tab |
| Final gate attempt 1 (subject 1) | invalid - superseded | gate itself green, but subject went stale before check: parallel agent committed (489ca92 -> 8fe2609) mid-sequence; per contract a new subject was captured (append-only) |
| Final gate attempt 2 (subject 2) | pass | `pnpm run verify` EXIT=0 (lint, typecheck node+web, vitest 413/413 in 28 files, 2026-10-01T23:20:58Z - 01:21:08Z); `verification_subject check` EXIT=0 "matches: attempt 2" |
| Review (implementation gate, code-review skill) | pass | "No significant issues found." — chord matcher guards, effect order, tab focus-trap, table accuracy checked |

### Retro

Closed without a lesson: the only incident (CRLF in `package.json` after the
parallel bump commit) is already covered by `.agents/lessons/items/windows-biome-package-json-eol.md`
and the `.gitattributes` fix is already in place; no new reusable procedure or
pitfall emerged.

### Verification subject 1

```json
{
  "attempt": 1,
  "head": "489ca921f17a596b1000046ee25d94bacd373ae6",
  "paths": [
    "docs/UX-UI.md",
    "src/renderer/src/App.test.tsx",
    "src/renderer/src/App.tsx",
    "src/renderer/src/components/settings/AppSettings.tsx",
    "src/renderer/src/components/terminal/ChatTerminal.tsx",
    "src/renderer/src/lib/new-chat-chord.ts",
    "src/renderer/src/lib/test-ids.ts"
  ],
  "schema_version": 1,
  "staged_diff_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "subject_sha256": "2db9cf666564e148169674cfbc9c9ccf7e16b7cc63322226de3d68c287517c49",
  "unstaged_diff_sha256": "d1694b76ba7bd45a054ceebaf9352b0a893ad85dc7caf2a83b991e8b2a3d0026",
  "untracked_files_sha256": "c006d163181d9fba2a344455ed413d719e5048f51d03d396762ad82b795221bd"
}
```

### Verification subject 2

```json
{
  "attempt": 2,
  "head": "978fca5b82861438ead4cbc701fad6ed2ecfbfaa",
  "paths": [
    "docs/UX-UI.md",
    "src/renderer/src/App.test.tsx",
    "src/renderer/src/App.tsx",
    "src/renderer/src/components/settings/AppSettings.tsx",
    "src/renderer/src/components/terminal/ChatTerminal.tsx",
    "src/renderer/src/lib/new-chat-chord.ts",
    "src/renderer/src/lib/test-ids.ts"
  ],
  "schema_version": 1,
  "staged_diff_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "subject_sha256": "5d9518b283d65650a36773420ffb44c97f2f4b2aa81d718bb9fbf962bb350a02",
  "unstaged_diff_sha256": "d450825d82215f18d6c448a3996e6a24908fa6a15a80d5f233c26ef2faa7570c",
  "untracked_files_sha256": "c006d163181d9fba2a344455ed413d719e5048f51d03d396762ad82b795221bd"
}
```

## Timing

| Element | Kind | Started | Ended |
|---|---|---|---|
| intake | work | 2026-10-01T22:45:00Z | 2026-10-01T22:50:00Z |
| plan | work | 2026-10-01T22:50:00Z | 2026-10-01T22:55:00Z |
| implement | work | 2026-10-01T22:55:00Z | 2026-10-01T23:05:00Z |
| review | work | 2026-10-01T23:05:00Z | 2026-10-01T23:15:00Z |
| retro | work | 2026-10-01T23:15:00Z | 2026-10-01T23:16:00Z |
| verify | work | 2026-10-01T23:18:00Z | 2026-10-01T23:20:58Z |
| verify | work | 2026-10-01T23:20:58Z | 2026-10-01T23:21:28Z |

## Risks and blockers

- ChatTerminal's custom key handler must swallow Ctrl+N before it types `n`
  into the PTY (same class as Ctrl+Tab); test both surfaces.

## Resume instructions

Read this record, then App.tsx chord effects (~line 1218-1271) and
AppSettings.tsx. Implement per the Phase 1.1 plan; keep the Tab-cycle
assertions in App.test.tsx in sync with the new focus order.
