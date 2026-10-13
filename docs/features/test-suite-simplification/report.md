# Test suite audit and simplification - final report

Status: Delivered (audit, staged simplification, and one behavior-preserving source extraction).
Path: `docs/features/test-suite-simplification/report.md`.

Task: `test-suite-audit-and-simplification` (2026-10-12 to 2026-10-13). Contract: [spec](spec.md). Audit evidence: task record `.agents/tasks/test-suite-audit-and-simplification/` (`audit/area-*.json`, `consolidated.json`, `inventory.json`, per-stage work orders), archived with the task record at closure.

## A. Before and after

| Metric | Before | After |
|---|---|---|
| Test files | 77 | 77 |
| Test definitions | 1131 | 1101 |
| Executed parameterized cases | 1239 | 1235 |
| Full-suite execution time | 13.2 s | 13.4 s |
| Flaky tests | 0 | 0 |
| Skipped / focused / todo tests | 0 | 0 |
| Significant issues | Busy-guard choreography copy-pasted per handler in 4 panels (8 near-identical ~55-line tests); full AppApi stub copy-pasted into 8 test files (~500-700 diverging lines); message-copy and Tailwind-class pinning; implementation-detail assertions (DOM order, mock call order as behavior) | Classified items resolved (B); remaining recommendations in C |

Definitions count declarations; executed cases count parameterized rows. The gap between the two grows where tables replace repeated tests (every original scenario survives as a named row).

Audit classification: 463 groups over 1135 named tests: KEEP 1021, MERGE 41, REWRITE 20, MOVE 11, REFACTOR-SOURCE 39, REMOVE 3. Every changed or deleted group carries a rationale in the audit JSON with either a named retained protection or an explicit value judgment.

## B. Changes implemented

Stage 1 - removals and merges (32 items, test files only). 29 MERGE consolidations keep one named test per original scenario; each audit entry names the surviving test that protects the removed regression. Trust-boundary suites (IPC validation and sender guard, media permissions, preload surface, database integrity and migrations) kept every negative case; their coverage counts did not drop. 3 REMOVE value judgments, listed here for maintainer confirmation (nothing survives to protect them because they detected no realistic regression):

1. `src/main/sample.test.ts` - self-comparison with zero contracts and zero failure modes; every other main-process test proves the harness runs.
2. `src/main/services/kanban/adapter-host.test.ts` default-timeout construction test - asserts that a constructor does not throw; the exported `ADAPTER_TIMEOUT_MS` constant or a fake-timer behavior test is the right assertion if the value ever matters.
3. `src/renderer/src/hooks/useResizableRegion.test.tsx` unmount smoke test - cannot detect its named regression under jsdom (listeners live on the handle; React ignores the stale callback after unmount, so it passes either way); the cleanup contract is observable only in a real browser.

Stage 2 - rewrites, moves, fixture consolidation, gap-fills (items W1-W20). REWRITE groups now assert observable contracts (roles, names, typed error payloads, persistence outcomes) instead of utility classes, DOM order, and pinned copy; each rewrite keeps its scenario's failure mode provable. Pure-helper tests moved to `kanban-board-logic.test.ts`; the diverging AppApi stub copies collapsed into `src/renderer/src/test/app-api-stub.ts` (one factory plus per-suite overrides) and clipboard stubbing into `stubClipboard`. Gap-fills added only audit-named missing boundaries (preload rejection decoding, WAV merge and guards, controller cancel/ignore paths, the worktree short-form wiring). One independent-review blocking finding (the tab-strip frame contract lost its assertion in a rewrite) was corrected and re-reviewed clean.

Stage 3 - behavior-preserving source simplification (production diff, independently reviewed: pass, no blocking findings). The copy-pasted `busyRef` + try/finally unlock choreography (~120 lines across `ActionSettings.tsx`, `ShellTab.tsx`, `KanbanSettings.tsx`, `AgentProfilesSettings.tsx`) extracted into `src/renderer/src/hooks/useMutationGuard.ts` (59 lines) owning the in-flight ref, the busy state that drives button `disabled`, and release-on-settle including the superseded-run case. The 8 guard tests collapsed into 3 named-row parameterized contracts (8 rows, generated titles byte-identical to the originals). Discrimination probed before the review: neutralizing the busy state fails exactly the 8 rows at the disabled-during-mutation assertion; neutralizing the exclusivity check fails none, because jsdom suppresses clicks on disabled buttons - a pre-existing property of the original click choreography, not a loss introduced by the collapse.

Execution time and maintenance cost: runtime unchanged (13.2 s vs 13.4 s, within noise). Maintenance: one fix site for double-submit guards instead of eight, one stub factory instead of eight copies, 30 fewer definitions for the same 1235 executed scenarios, and error-message or class-name pinning reduced to named constants with documented jsdom limits.

## C. Remaining architectural problems

Ordered by expected benefit-to-cost ratio.

1. Machine-readable renderer error kinds (error rule codes). Location: `src/shared/ipc-error.ts` transport shapes plus the alert rendering in settings and dictation components. Root cause: tests pin user-facing message copy because no error kind is exposed. Proposed: a typed error-kind union on the existing `nekodeAppError` payloads or a `data-error-kind` hook; tests assert the kind and smoke-check the message. Benefit: copy edits stop breaking tests; the DictationDictionary 7-code matrix becomes a thin mapping table. Cost: medium. Risk: medium (cross-cutting contract change; own stage).
2. DOM state hooks for the slide track. Location: `src/renderer/src/components/layout/LeftPanelTrack.tsx` (asserted in `LeftPanelTrack.test.tsx`), `StatusBar.tsx:112`. Root cause: tests pin transform and width strings and a CSS hook class because no behavioral attribute exists. Proposed: `data-*` slide-state hooks asserted instead of pixels. Benefit: animation restyling stops breaking unit tests. Cost: small. Risk: low-medium (the attributes become a quasi-API).
3. Submit-gap call-site race test. Location: `src/renderer/src/lib/pty-submit.ts` gap seam and `App.tsx` submit call sites. Root cause: the whole suite pins the submit gap to 0 ms except two files, so interleavings during a pending CR are untested. Proposed: one gap-real race test (two chats submitting concurrently). Blocked on the open product decision `submit-gap-double-submit` (a second submit within the 150 ms gap currently cancels the first line; maintainer must choose cancel vs queue). Benefit: closes the only known uncovered interleaving in a contract-bearing area. Cost: one ~40-line test. Risk: low.
4. `Ctrl+D` gate state machine in ChatTerminal. Root cause: the gate's decision table is implicit in branchy prompt-state checks, forcing per-branch byte-level tests. Proposed: extract the decision table; tests become one table over prompt states. Benefit: the byte-contract tests shrink and new gate rules stop needing new branch tests. Cost: medium. Risk: medium (terminal semantics; byte assertions must stay).
5. KanbanBoard reconciliation extraction. Root cause: reconciliation of concurrent IPC promise orderings is embedded in the component, so each ordering needs a ~60-line render setup. Proposed: extract the pure reconciliation step. Benefit: the race-ordering matrix becomes unit tests. Cost: medium-high. Risk: medium (race semantics).
6. KanbanService schema port. Root cause: service state shape predates the current schema conventions, inflating setup in service tests. Proposed: port to the established schema pattern. Benefit: simpler service tests and one persistence idiom. Cost: high. Risk: medium.
7. App-suite shape parameterization and the attention-settings split. Location: `App.test.tsx` (128 tests in ~24 distinct contracts), `ChatWorkspace.test.tsx` vs `App.test.tsx` attention matrix. Proposed: three table shapes (git status forms, typed-error routing, theme storage errors) with named rows; move the attention matrix to one owner. Benefit: lower fixture churn. Cost: low-medium. Risk: low (row names must keep scenario identity).
8. Small pure-lib boundary gaps (audit `area-d1`/`area-d2` answers): git-decoration precedence tail (`added > untracked > ignored` pairwise), markdown-path Windows backslash branch, tree-refresh multi-failure notice priority, terminal-font boundary sizes, chime throw and suspended-context resume paths. Benefit: each guards a named reorder or boundary regression. Cost: a few rows each. Risk: low.
9. Trivial: extend the `useMutationGuard.run()` JSDoc with the latched-release contract (a skipped release keeps the guard locked until `reset()`); optionally one cross-button guard test (Save in flight, then Delete on the shared guard).

## D. Final assessment

1. Is the current number of tests justified? Yes for the current risk surface. After the audit, 1021 of 1135 named tests classify KEEP; the removed or consolidated material was demonstrably duplicated or regression-blind (B). The count is driven by trust boundaries (multi-level negative coverage kept by contract), PTY byte contracts, and concurrent-IPC race orderings, not by parameter padding.
2. Which areas are still overtested? Overtesting is now marginal and structural, not scenario-level: `App.test.tsx` repeats heavyweight boots for scenarios that differ in one dimension (three parameterizable shapes in C.7), and the attention-settings matrix is asserted at two levels where one would do. No suite remains where scenario-level redundancy was found and not acted on.
3. Which critical behaviors remain insufficiently protected? The pending-submit interleavings (C.3, blocked on the `submit-gap-double-submit` product decision); visual layout and real-browser pointer capture (no E2E harness exists, so `BottomPanel` claims are scoped to DOM structure and the `useResizableRegion` cleanup contract is untestable under jsdom); cross-button guard interleaving on a shared guard (pre-existing, see B, Stage 3).
4. What prevents further safe test reduction? Spec Behaviour 5 (trust boundaries keep independent verification per level), the race-ordering tests that guard genuinely different failure modes (audit `area-d1`), the PTY byte-sequence contract (audit `area-c2`), and jsdom limits: double-submit discrimination rides on the disabled attribute because disabled buttons swallow clicks, so weakening the guard tests further would buy no real detection.
5. Which architectural improvements would provide the greatest benefit? C.1 (error rule codes) and C.2 (DOM state hooks) remove the two remaining churn-prone assertion classes at modest cost; C.4 and C.5 convert the two most expensive test clusters into tables; C.3 needs one product decision first.
6. Is the resulting suite a reasonable minimum, or does further simplification remain possible? It is a reasonable minimum for the current architecture. Further simplification is possible only through the recommendations above (mostly by moving assertions to stable contracts) or by adding a real E2E level that would let browser-observable checks leave jsdom. No further safe reduction was identified from the audit classification without losing named regression protection.

Validation limitations: no E2E harness exists in the repository (real-Electron verification is a manual CDP smoke), so visual layout and browser-only cleanup contracts have no automated verification; no coverage or mutation tooling was installed (out of scope by decision), with discrimination checked instead by targeted neutralization probes (B, Stage 3); recorded tests-before-edits and per-stage gate evidence live in the task record's Verification table. Two product decisions stay open and are recorded in the task record: `submit-gap-double-submit` (cancel vs queue within the submit gap) and `visual-layout-verification` (real-layout check or recorded manual CDP smoke).
