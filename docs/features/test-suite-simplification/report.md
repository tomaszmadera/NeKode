# Test suite audit and simplification - final report

Status: Delivered (audit, staged simplification, one behavior-preserving source extraction; NEKODE-75 maintainer decisions and C.1-C.9 recommendations completed).
Path: `docs/features/test-suite-simplification/report.md`.

Task: `test-suite-audit-and-simplification` (2026-10-12 to 2026-10-13) and `nekode-75-test-suite-decisions-recommendations` (2026-10-14). Contract: [spec](spec.md). Audit evidence: task record `.agents/tasks/test-suite-audit-and-simplification/` (`audit/area-*.json`, `consolidated.json`, `inventory.json`, per-stage work orders), archived with the task record at closure.

## A. Before and after

| Metric | Before audit | After audit (Stage 3) | After NEKODE-75 |
|---|---|---|---|
| Test files | 77 | 77 | 87 |
| Test definitions | 1131 | 1101 | 1195 |
| Executed parameterized cases | 1239 | 1235 | 1383 |
| Full-suite execution time | 13.2 s | 13.4 s | 13.3 s |
| Flaky tests | 0 | 0 | 0 |
| Skipped / focused / todo tests | 0 | 0 | 0 |
| Significant issues | Busy-guard choreography copy-pasted per handler in 4 panels (8 near-identical ~55-line tests); full AppApi stub copy-pasted into 8 test files (~500-700 diverging lines); message-copy and Tailwind-class pinning; implementation-detail assertions (DOM order, mock call order as behavior) | Classified items resolved (B); remaining recommendations in C | All recommendations C.1-C.9 resolved; maintainer decisions confirmed |

Definitions count declarations; executed cases count parameterized rows. The gap between the two grows where tables replace repeated tests (every original scenario survives as a named row).

Audit classification: 463 groups over 1135 named tests: KEEP 1021, MERGE 41, REWRITE 20, MOVE 11, REFACTOR-SOURCE 39, REMOVE 3. Every changed or deleted group carries a rationale in the audit JSON with either a named retained protection or an explicit value judgment.

## B. Changes implemented

Stage 1 - removals and merges (32 items, test files only). 29 MERGE consolidations keep one named test per original scenario; each audit entry names the surviving test that protects the removed regression. Trust-boundary suites (IPC validation and sender guard, media permissions, preload surface, database integrity and migrations) kept every negative case; their coverage counts did not drop. 3 REMOVE value judgments, confirmed by maintainer decision on 2026-10-14 (nothing survives to protect them because they detected no realistic regression):

1. `src/main/sample.test.ts` - self-comparison with zero contracts and zero failure modes; every other main-process test proves the harness runs.
2. `src/main/services/kanban/adapter-host.test.ts` default-timeout construction test - asserts that a constructor does not throw; the exported `ADAPTER_TIMEOUT_MS` constant or a fake-timer behavior test is the right assertion if the value ever matters.
3. `src/renderer/src/hooks/useResizableRegion.test.tsx` unmount smoke test - cannot detect its named regression under jsdom (listeners live on the handle; React ignores the stale callback after unmount, so it passes either way); the cleanup contract is observable only in a real browser.

Stage 2 - rewrites, moves, fixture consolidation, gap-fills (items W1-W20). REWRITE groups now assert observable contracts (roles, names, typed error payloads, persistence outcomes) instead of utility classes, DOM order, and pinned copy; each rewrite keeps its scenario's failure mode provable. Pure-helper tests moved to `kanban-board-logic.test.ts`; the diverging AppApi stub copies collapsed into `src/renderer/src/test/app-api-stub.ts` (one factory plus per-suite overrides) and clipboard stubbing into `stubClipboard`. Gap-fills added only audit-named missing boundaries (preload rejection decoding, WAV merge and guards, controller cancel/ignore paths, the worktree short-form wiring). One independent-review blocking finding (the tab-strip frame contract lost its assertion in a rewrite) was corrected and re-reviewed clean.

Stage 3 - behavior-preserving source simplification (production diff, independently reviewed: pass, no blocking findings). The copy-pasted `busyRef` + try/finally unlock choreography (~120 lines across `ActionSettings.tsx`, `ShellTab.tsx`, `KanbanSettings.tsx`, `AgentProfilesSettings.tsx`) extracted into `src/renderer/src/hooks/useMutationGuard.ts` (59 lines) owning the in-flight ref, the busy state that drives button `disabled`, and release-on-settle including the superseded-run case. The 8 guard tests collapsed into 3 named-row parameterized contracts (8 rows, generated titles byte-identical to the originals). Discrimination probed before the review: neutralizing the busy state fails exactly the 8 rows at the disabled-during-mutation assertion; neutralizing the exclusivity check fails none, because jsdom suppresses clicks on disabled buttons - a pre-existing property of the original click choreography, not a loss introduced by the collapse.

Execution time and maintenance cost: runtime unchanged (13.2 s vs 13.4 s, within noise). Maintenance: one fix site for double-submit guards instead of eight, one stub factory instead of eight copies, 30 fewer definitions for the same 1235 executed scenarios, and error-message or class-name pinning reduced to named constants with documented jsdom limits.

## C. Architectural recommendations (resolved in NEKODE-75)

All recommendations C.1 through C.9 resolved on 2026-10-14 under task `nekode-75-test-suite-decisions-recommendations`.

1. Machine-readable renderer error kinds (error rule codes) - Resolved (NEKODE-75 Stage 2). Introduced typed error kinds on `nekodeAppError` / IPC error transport (`AppRuleCode`, typed kind union, wire transport, helper `appRuleCode()`) and exposed machine-readable hooks (`data-error-kind`) in `DictationDictionary.tsx`. The 7-code matrix in `DictationDictionary.test.tsx` maps through a concise table asserting rule codes instead of pinning user-facing alert copy.
2. DOM state hooks for the slide track - Resolved (NEKODE-75 Stage 1). Added declarative `data-slide-state` and `data-panel-visibility` attributes to `LeftPanelTrack.tsx` and `StatusBar.tsx`, eliminating brittle pixel width and CSS transform string assertions in `LeftPanelTrack.test.tsx` and `StatusBar.test.tsx`.
3. Submit-gap call-site race test - Resolved (NEKODE-75 Stage 1). Confirmed cancel semantics (second submit cancels pending CR of first line within 150 ms gap) by maintainer decision on 2026-10-14, pinned with real-timer race test (`gap=100`, two parallel chats) in `src/renderer/src/lib/pty-submit.test.ts`.
4. `Ctrl+D` gate state machine in ChatTerminal - Resolved (NEKODE-75 Stage 3). Extracted the prompt-state `Ctrl+D` gate logic from `ChatTerminal.tsx` into a pure decision function in `src/renderer/src/components/terminal/ctrl-d-gate.ts`, tested by a parameterized table covering prompt buffers, cursor positions, and modes in `ctrl-d-gate.test.ts`.
5. KanbanBoard reconciliation extraction - Resolved (NEKODE-75 Stage 3). Extracted pure state reconciliation of concurrent IPC responses out of `KanbanBoard.tsx` into `src/renderer/src/components/kanban/kanban-board-logic.ts`, testing promise race orderings as pure unit tests in `kanban-board-logic.test.ts`.
6. KanbanService schema port - Resolved (NEKODE-75 Stage 4). Ported `KanbanService` persistence to established schema conventions (`KanbanStoredConfig`, `parseKanbanStoredConfig`, `serializeKanbanStoredConfig`, `DEFAULT_KANBAN_STORED_CONFIG`), added injectable `discoverAdapters` dependency, and simplified 16 tests in `src/main/services/kanban/kanban-service.test.ts` by replacing disk filesystem fixtures with in-memory adapter manifests.
7. App-suite shape parameterization and the attention-settings split - Resolved (NEKODE-75 Stage 4). Collapsed repetitive boots in `src/renderer/src/App.test.tsx` into parameterized tables with named rows for Git status forms, typed error routing, and theme storage errors. Removed 4 redundant per-variant attention boots, consolidating detailed attention signal matrix ownership in `src/renderer/src/components/workspace/ChatWorkspace.test.tsx`.
8. Small pure-lib boundary gaps - Resolved (NEKODE-75 Stage 1). Added missing edge-case unit tests for pure libraries: `git-decoration` precedence tail (`added > untracked > ignored`), `markdown-path` Windows backslash handling, `tree-refresh` multi-failure notice priority, `terminal-font` boundary sizes, and `chime` throw / suspended-context resume paths.
9. Minor improvements - Resolved (NEKODE-75 Stage 1). Documented the latched-release contract in `useMutationGuard.ts` JSDoc, and added a cross-button mutual exclusion test on a shared guard in `useMutationGuard.test.tsx`.

## D. Final assessment

1. Is the current number of tests justified? Yes for the current risk surface. After the audit, 1021 of 1135 named tests classify KEEP; the removed or consolidated material was demonstrably duplicated or regression-blind (B). The count is driven by trust boundaries (multi-level negative coverage kept by contract), PTY byte contracts, and concurrent-IPC race orderings, not by parameter padding.
2. Which areas are still overtested? Overtesting is now marginal and structural, not scenario-level: `App.test.tsx` repeats heavyweight boots for scenarios that differ in one dimension (three parameterizable shapes in C.7), and the attention-settings matrix is asserted at two levels where one would do. No suite remains where scenario-level redundancy was found and not acted on.
3. Which critical behaviors remain insufficiently protected? The pending-submit interleavings (C.3, resolved by cancel semantics and pinned by real-timer test); visual layout and real-browser pointer capture (no E2E harness exists, so `BottomPanel` claims are scoped to DOM structure and the `useResizableRegion` cleanup contract is untestable under jsdom; deferred by maintainer decision with documented rationale); cross-button guard interleaving on a shared guard (pre-existing, resolved in C.9).
4. What prevents further safe test reduction? Spec Behaviour 5 (trust boundaries keep independent verification per level), the race-ordering tests that guard genuinely different failure modes (audit `area-d1`), the PTY byte-sequence contract (audit `area-c2`), and jsdom limits: double-submit discrimination rides on the disabled attribute because disabled buttons swallow clicks, so weakening the guard tests further would buy no real detection.
5. Which architectural improvements would provide the greatest benefit? C.1 (error rule codes) and C.2 (DOM state hooks) remove the two remaining churn-prone assertion classes at modest cost; C.4 and C.5 convert the two most expensive test clusters into tables; C.3 needs one product decision first.
6. Is the resulting suite a reasonable minimum, or does further simplification remain possible? It is a reasonable minimum for the current architecture. Further simplification is possible only through the recommendations above (mostly by moving assertions to stable contracts) or by adding a real E2E level that would let browser-observable checks leave jsdom. No further safe reduction was identified from the audit classification without losing named regression protection.

Validation limitations: no E2E harness exists in the repository (real-Electron verification is a manual CDP smoke), so visual layout and browser-only cleanup contracts have no automated verification; no coverage or mutation tooling was installed (out of scope by decision), with discrimination checked instead by targeted neutralization probes (B, Stage 3); recorded tests-before-edits and per-stage gate evidence live in the task record's Verification table. Both product decisions were resolved by maintainer decision on 2026-10-14: `submit-gap-double-submit` confirmed cancel semantics (pinned by gap-real race test in C.3), and `visual-layout-verification` was deferred with documented rationale (no Electron E2E harness in repository, no new dependencies allowed; unit DOM structure tests remain sufficient under jsdom).
