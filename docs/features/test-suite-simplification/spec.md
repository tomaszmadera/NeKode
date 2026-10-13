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

An audit finding that implies a product behavior change becomes a recommendation in the final report, not an implementation change. A test that cannot stay green for a reason other than the intended change is restored and investigated.

## Acceptance criteria

1. The recorded full verification command passes before and after the change (lint, typecheck, full vitest suite).
2. Every changed or deleted test group appears in the audit classification with a rationale and either a named retained protection or an explicit recorded value judgment.
3. Trust-boundary test files (IPC validation, sender guard, media permissions, preload API, database) retain independent negative-case coverage at least equal to today's.
4. The final report answers the required assessment questions and reports before/after metrics that distinguish test definitions from executed cases.
5. Production-code diffs are limited to listed behavior-preserving refactorings, confirmed by independent review.

## Required tests

The retained suite keeps at least one dedicated test file or group per business-rule constraint listed above, with negative cases for the IPC and permission boundaries, and the cross-component renderer journeys at the level where they are cheapest and most diagnostic.

## Relevant SDD / ADR

- `docs/architecture/sdd.md` (service architecture, renderer boundaries, layout).
