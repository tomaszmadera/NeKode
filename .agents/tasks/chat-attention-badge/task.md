---
id: chat-attention-badge
schema_version: 2
status: active
intent: feature
complexity: standard
durability: recorded
current_phase: Phase 3
current_step: Phase 3.1
updated: 2026-10-01
branch: main
worktree: current
next_action: On user release - Phase 3.1 preflight (tests-before-edits `pnpm run test` + `pnpm run typecheck`), then Phase 4.1 implementation stage
blockers: none
---

# Chat attention badge

## Objective

When an agent CLI running inside a chat terminal rings the terminal bell or emits an OSC 9 notification, the chat shows an amber badge in the left chat tree, so a developer running several agent sessions in parallel sees which one needs attention without switching chats. Affects the renderer UI and chat terminal views only.

## Scope

Standard development. Contract: `docs/features/chat-attention-badge/spec.md`. Execution strategy: `.agents/tasks/chat-attention-badge/plan.md` (single stage). Detection in chat terminals' xterm parser (`onBell`, `registerOscHandler(9)`), per-chat in-memory renderer state, amber badge on the chat row in LeftNavigation with OSC 9 tooltip, cleared on chat selection and on `terminals:write` to that chat. No IPC contract, main-service, or database changes; no persistence.

## Phase 0 - Intake

- [x] Phase 0.1 - Inspected repository and existing evidence (spec and draft plan already on `main` since b16bc76; no implementation present, no `onBell`/OSC handler in renderer); confirmed classification feature/standard/recorded; branch `main`

## Phase 1 - Specification

- [x] Phase 1.1 - Spec authored in the 2026-10-01 analysis session, committed b16bc76, approved by the user (this session)

## Phase 2 - Plan

- [x] Phase 2.1 - Plan `.agents/tasks/chat-attention-badge/plan.md` created as draft in the analysis session, committed b16bc76
- [x] Phase 2.2 - User approved the plan 2026-10-01 (chat approval; implementation explicitly deferred - see Decisions)

## Phase 3 - Preflight

- [ ] Phase 3.1 - Tests-before-edits: `pnpm run test` and `pnpm run typecheck` on the clean checkpoint; record results in Verification

## Phase 4 - Implementation stage 1 - Signal detection and chat-list badge

- [ ] Phase 4.1 - Implement Stage 1 per plan (AC1-AC10): xterm parser callbacks, per-chat attention state in App, amber dot + tooltip in LeftNavigation, clearing on selection and on `terminals:write`; discriminating AC2 test, cross-chat isolation test, hidden-chat retention, no-DB-writes assertion; verify with lint, typecheck, test, build

## Phase 5 - Review

- [ ] Phase 5.1 - Full stage-diff self-review against spec ACs, error paths, scope, regressions, test quality

## Phase 6 - Retro, verification, close

- [ ] Phase 6.1 - Retrospective checkpoint; write reusable lessons if any
- [ ] Phase 6.2 - Final verification with recorded verification subject
- [ ] Phase 6.3 - Close the record

## Decisions

- Detection only via xterm parser callbacks (`onBell`, `registerOscHandler(9)`); never raw byte scanning - the AC2 discriminating test guards this (BEL inside an OSC terminator is not a bell).
- ConPTY forwards BEL/OSC 9 byte-for-byte on this machine (measured 2026-10-01 probe, fact recorded in skill `terminal-lifecycle`); older hosts degrade to BEL-only, tolerated by spec.
- Hidden (deselected) chat terminals stay mounted and keep detecting; key for all attention state is chat id only.
- In-memory renderer state only; no new IPC channels, no `app_state` writes, no schema changes.
- Amber marks attention per Design System section 2.4.
- User hold (2026-10-01): plan approved, implementation explicitly deferred until the user releases it.

## Changed files

None yet (implementation deferred).

## Verification

| Check | Result | Notes |
|---|---|---|
| Planned: `pnpm run lint` + `pnpm run typecheck` + `pnpm run test` + `pnpm run build` | pending | Stage 1 gate per plan; baseline `pnpm run verify` green on checkpoint ccb7410 (409/409 tests, 2026-10-01) |

## Timing

| Element | Kind | Started | Ended |
|---|---|---|---|
| intake | work | 2026-10-01T21:56:22Z | 2026-10-01T21:57:00Z |
| spec | work | 2026-10-01T21:57:00Z | 2026-10-01T21:57:20Z |
| plan | work | 2026-10-01T21:57:20Z | 2026-10-01T21:57:40Z |
| approval | wait | 2026-10-01T21:57:40Z | 2026-10-01T21:58:30Z |

## Risks and blockers

- xterm mock must model parser semantics faithfully (`onBell` not fired by BEL inside an OSC terminator), otherwise tests verify the mock, not behavior.
- False positives from BEL-terminated window-title sequences (e.g. PowerShell setting titles) - mitigated by the AC2 discriminating test.
- Hidden-chat retention tests (mvp-core-shell) guard against "fixing" detection by unmounting hidden views.
- No blocker recorded; implementation pause is a user decision, not a blocker.

## Resume instructions

On user release: run Phase 3.1 preflight (`pnpm run test`, `pnpm run typecheck`) on a clean tree, then load skill `implement` and execute Phase 4.1 from `.agents/tasks/chat-attention-badge/plan.md` Stage 1. Expected evidence: green baseline gates recorded in Verification before any product edit.
