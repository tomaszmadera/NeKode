# Test suite audit and simplification

Status: Delivered (audited and simplified suite, one behavior-preserving source extraction, final report at `report.md`).
Path: `docs/features/test-suite-simplification/spec.md`.

This file is the behavioral contract for a feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

## Goal

Keep the smallest practical NeKode test suite that gives strong confidence in application correctness and protects against meaningful regressions, at the lowest maintenance cost. This contract governs a behavior-preserving engineering change: the application's user-visible behavior must not change.

Target user: the maintainer and contributing agents who read, run, and extend the test suite.

## Related requirements

- User directive 2026-10-12: test-suite audit, simplification, and code refactoring protocol (test-value classification, minimal effective suite, Electron trust boundaries, staged implementation, final report).
- [Public documentation contract](../public-documentation-contract/spec.md) behaviour rule 12: verification guidance owns what each check proves; regression coverage must demonstrate the reported defect; no tests that only mirror documentation wording.
- [Product requirements](../../product/requirements.md), [architecture](../../architecture/sdd.md).

## Scope

- Test-value audit of every vitest suite (main, preload, shared, renderer).
- Removal or consolidation of test groups with insufficient independent value or verified duplicate protection.
- Rewriting of tests that assert implementation details instead of observable contracts.
- Simplification of fixtures, helpers, and test setup.
- Moving verification to the testing level with the best diagnostic value at the lowest cost.
- Small, safe, behavior-preserving production-code refactorings where module design inflates testing cost.
- Written recommendations (not executed) for major architectural changes.

## Non-goals

- Any user-visible behavior change, feature work, or dependency additions.
- Arbitrary test-count or coverage reduction targets.
- Removing tests that protect trust boundaries (IPC input and sender validation, preload surface, media permissions, database integrity and migrations) on the grounds that a similar scenario exists at another testing level.
- Executing major architectural changes; those are recommendations only.
- Installing mutation-testing or coverage tooling as a requirement.

## Behaviour

1. Product behavior is unchanged: the same application behaviors pass the suite before and after the change.
2. Every retained test or logical test group states the behavior, contract, or invariant it verifies and the regression it protects against.
3. A test group is removed only when (a) a named remaining test protects the same regression, or (b) its value is judged insufficient against its maintenance cost, with the judgment recorded in the audit.
4. Superficially similar tests are not treated as redundant without evidence; two similar tests may guard different failure modes.
5. Security-boundary and data-integrity behavior keeps independent verification at each level where it exists today.
6. Tests are never weakened, disabled, skipped, or loosened to obtain passing results; quality thresholds do not move.
7. Test rewrites preserve the scenario's protection while asserting observable outcomes.
8. Reported metrics distinguish test definitions from executed parameterized cases.

## Business rules

Domain constraints the retained suite must cover:

- Typed IPC contract, channel validation, input validation, and sender/permission guards between main, preload, and renderer, negative cases included.
- SQLite schema migrations and persistence integrity (forward migrations, WAL behavior).
- Terminal/PTY lifecycle: session retention across chat switches, termination, exit semantics (including `Ctrl+D` at an empty prompt line), split line submission (`src/renderer/src/lib/pty-submit.ts`).
- WSL path translation and WSL-backed service selection.
- Git status and decoration computation, worktree detection.
- Kanban adapter protocol, manifest validation, and the adapter host execution boundary.
- Dictation pipeline: WAV encoding, settings, service, and desktop sender behavior.
- Handoff matching and resume-flow state.
- File tree building and refresh, markdown path handling, theme and font settings logic.
- Renderer journeys that cross component boundaries (workspace assembly, settings persistence flows).

## Authorization

None. The change grants no new capability and alters no access control.

## Data / API

Public contracts that must not change: the `window.app` preload surface and the shared typed IPC contract, database schema and migrations, the Kanban adapter JSON protocol (`adapters/plane/adapter.json`), and renderer/main typed error transport shapes.

## Edge cases

- A regression test written for a fixed defect is never removed as redundant without a named substitute.
- Flaky or slow tests are diagnosed (root-cause fix or rewrite), not deleted for convenience unless their value is insufficient.
- Executed parameterized cases outnumber test definitions; both numbers are reported separately.

## Errors

## NEKODE-75 Amendment: Maintainer decisions and recommendations C.1–C.9

Governs the follow-up work on NEKODE-75 resolving open maintainer decisions and executing architectural recommendations C.1 through C.9.

### Resolved decisions

1. 3 REMOVE deletions confirmed: `src/main/sample.test.ts` (trivial sanity assertion), `src/main/services/kanban/adapter-host.test.ts` (default-timeout constructor non-throw), `src/renderer/src/hooks/useResizableRegion.test.tsx` (unmount smoke test with jsdom limitation). None protected against realistic regressions; confirmation recorded in report.
2. `submit-gap-double-submit`: cancel semantics preserved. When a second submit occurs within the 150 ms submit gap in the same chat session, the pending CR of the first line is cancelled, and the second line is written immediately with its own scheduled CR. A gap-real race test with real timers (`gap=100`, two parallel chats) pins this contract.
3. `visual-layout-verification`: deferred with recorded rationale (no Electron E2E harness in repository, no new dependencies allowed). Unit DOM structure tests remain sufficient under jsdom.

### Architectural recommendations C.1–C.9

1. C.1 (Machine-readable error rule codes): Introduce typed error kinds on `nekodeAppError` / IPC error transport and expose machine-readable hooks (e.g. `data-error-kind`) in renderer components so tests assert typed contracts rather than fragile user-facing strings. Map the DictationDictionary 7-code matrix through a concise table.
2. C.2 (DOM state hooks for slide track): Add declarative `data-*` state hooks to `LeftPanelTrack.tsx` and `StatusBar.tsx` to assert panel animation and visibility states without coupling tests to exact pixel widths and CSS transform strings.
3. C.3 (Submit-gap call-site race test): Implement a test with real timers (`gap=100`, two concurrent chats) verifying PTY submit-gap interleaving and cancel-on-double-submit semantics.
4. C.4 (`Ctrl+D` gate state machine): Extract the prompt-state `Ctrl+D` gate logic from `ChatTerminal.tsx` into a pure decision function, tested via a parameterized table covering prompt buffers, cursor positions, and modes.
5. C.5 (KanbanBoard reconciliation extraction): Extract the pure state reconciliation of concurrent IPC responses out of `KanbanBoard.tsx` into `kanban-board-logic.ts`, testing promise race orderings as pure unit tests.
6. C.6 (KanbanService schema port): Port KanbanService state and persistence handling to the established schema pattern used across other services.
7. C.7 (App-suite parameterization and attention matrix split): Collapse repetitive boot suites in `App.test.tsx` into parameterized tables (git status forms, typed-error routing, theme storage errors) and consolidate the attention-settings matrix to a single owner.
8. C.8 (Pure-lib boundary gaps): Add missing edge-case unit tests for pure libraries: `git-decoration` precedence tail (`added > untracked > ignored`), `markdown-path` Windows backslash handling, `tree-refresh` multi-failure notice priority, `terminal-font` boundary clamping, and `chime` throw / suspended-context resume paths.
9. C.9 (Minor improvements): Document the latched-release contract in `useMutationGuard.ts` JSDoc, and add a test verifying mutual exclusion across different buttons sharing the same guard instance.

### Acceptance criteria

- Every decision and recommendation C.1–C.9 is completed and its resolution recorded in `docs/features/test-suite-simplification/report.md`.
- Behavior-preserving: all application user-visible behavior remains unchanged except where explicit contracts were added (error codes, DOM state hooks).
- Full suite green: `cmd /c pnpm run test`, `cmd /c pnpm run lint`, and `cmd /c pnpm run typecheck` pass cleanly after each stage.
- Independent review passes for each stage.

## Relevant SDD / ADR

- `docs/architecture/sdd.md` (service architecture, renderer boundaries, layout).

