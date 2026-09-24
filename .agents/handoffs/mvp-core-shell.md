---
task_id: mvp-core-shell
created: 2026-09-22T20:26:32Z
schema_version: 2
from: Main (Hermes coordinator session)
to: Main (next session)
branch: main
worktree: current
checkpoint_subject: 939ef4308a1d007a09762b31ada5e33938ae898b+sha256:168de24a1007d2b8653654d061053dccada7c25eba0014a35f7ebc1038f64b3f
current_step: Phase 2.3
next_action: Fix typecheck error in src/preload/app-api.test.ts (projects.add no longer takes an argument), then run full gates and dispatch independent review of Stage 2
blockers: provider rate-limit (HTTP 429) interrupted Stage 2 implementer mid-stage; work paused by user request
---

# Handoff: NeKode MVP Core Shell — paused mid Stage 2

## Repository snapshot

Linked task record: `.agents/tasks/mvp-core-shell/task.md` (current_step: Phase 2.3, plan: `.agents/tasks/mvp-core-shell/plan.md` status approved). Spec: `docs/features/mvp-core-shell/spec.md`. Transferred role: Main to Main. Reason: user-requested pause during Stage 2 (provider rate limits keep interrupting subagents; user wants handoff now and a skills-gap discussion next session).

### Working

- Stage 1 complete and accepted: five-region shell, typed IPC contract (`src/shared/ipc-contract.ts`), preload bridge (`src/preload/app-api.ts`, `window.app.*`), Electron hardening (sandbox true, contextIsolation true, nodeIntegration false), resizable regions via Pointer Events (`src/renderer/src/hooks/useResizableRegion.ts`, re-reviewed pass). Full cycle: implementer -> coordinator verify -> independent review (1 blocking) -> correction -> re-review pass (round 1). Evidence in task record Verification table.
- Stage 2 partial (interruption at ~70% by my estimate, NOT verified as complete): `src/main/db/connection.ts`, `src/main/db/migrations.ts`, `src/main/services/{project-service,task-service,app-state-service,create-services}.ts` (359 lines services + 84 db), `src/main/ipc/{ipc-validation,ipc-handlers,service-registry}.ts` (250 lines), `src/preload/bridge-types.ts`. ~714 new lines in main process.
- Gates at handoff time (run by coordinator): lint PASS (after `pnpm exec biome check --write src/main/services src/main/ipc src/shared` — implementer left 5 organizeImports/format errors), tests 16/16 PASS (service tests for db NOT yet present — only Stage 1 suites), typecheck FAIL (exactly one error, see Broken), build not re-run after interruption.

### Broken

- `pnpm run typecheck`: `src/preload/app-api.test.ts(39,28): error TS2554: Expected 0 arguments, but got 1.` — Stage 1 test calls `api.projects.add('D:/code/demo')` but the Stage 2 contract changed `add()` to take no arguments (native directory dialog moved to main process; renderer calls `window.app.projects.add()` argument-less). The test must be updated to the new contract; check whether other Stage 1 preload tests (lines 54, 73, 91 of the same file) need the same treatment.
- `pnpm run build` unverified since interruption; last green build was Stage 1 closure.
- Missing from Stage 2 scope (was not written before interruption): service unit tests on `:memory:` DB (CRUD, unique constraints, cascade delete, path/name validation, stale-state cleanup), payload-validation typed-rejection tests, region-size hydrate/persist wiring + renderer test with mocked `window.app`, renderer wiring for real project/task lists (Add Project dialog flow, New Task input, Remove Project, persisted selection, context header from record). `src/main/index.ts` and `src/preload/index.ts` diffs are small (10+2 / 13-11 lines) — wiring may be incomplete; inspect before resuming.

## Decisions

- Follows spec `docs/features/mvp-core-shell/spec.md` Data/API verbatim; deviations from the stub contract are allowed only when the spec requires them and must be reported.
- DB path: Electron `app.getPath('userData')/nekode.db`, but services take path/handle via DI so tests can use `:memory:`.
- better-sqlite3 12.x (prebuilt, works on Node 24, no VS Build Tools needed); vitest node env handles the native module; jsdom only for `src/renderer/**/*.test.tsx` via `environmentMatchGlobs`.
- Workflow SDD: Large task -> Main coordinates only; every stage runs fresh implementer + independent reviewer subagents (never self-review); max 2 correction/re-review rounds per stage.
- Stage 1 review carry-over items owned by Stage 2 (see plan.md "Review carry-over"): IPC payload validation layer (in progress: `ipc-validation.ts` exists, untested), region-size persistence via `state.set`.

## Failed approaches

- Provider rate limit (HTTP 429, Z.AI/GLM) killed the first Stage 2 implementer (deleg_16af3668) at 22:04 after 3 retry attempts; a second implementer (deleg_ae9d097b) was dispatched with an inventory-first instruction and was stopped by user request at ~22:25 while rewriting `ipc-handlers.ts` (injected dialog for testability, replacing the stub registry — its partial result described the intent but the stop landed mid-work). Do not assume the partial files are consistent with each other — typecheck currently fails with exactly one error and cross-file wiring was not finished.
- Note: the second implementer's last edits landed AFTER the coordinator's first diff inventory; the checkpoint_subject hash in this snapshot's frontmatter was recomputed after the stop and reflects the final disk state.

## Verification

- `pnpm run lint`: pass (38 files, after biome autofix of implementer leftovers).
- `pnpm run test`: pass 16/16 (Stage 1 suites only; sample, app-api 4, App 4, useResizableRegion 7).
- `pnpm run typecheck`: FAIL — single error in `src/preload/app-api.test.ts:39` (stale Stage 1 test vs new add() contract).
- `pnpm run build`: NOT RUN since interruption (last pass at Stage 1 close).
- `python .agents/scripts/task-status --check .agents/tasks/mvp-core-shell/task.md`: pass (record updated to Phase 2.3 before pause).
- `python .agents/scripts/handoff-status --check`: run after writing this snapshot — see Resume instructions.

## Open product invariants

- SDD §6 "Renderer must not own OS capabilities": status open by design, unaffected so far — renderer bundle verified clean of `electron` requires at Stage 1; re-verify after Stage 2/3 renderer changes (`grep -rl "require('electron')" out/renderer/assets/` must stay empty).

## Unresolved assumptions

- Assumption: partial Stage 2 files are internally consistent enough to finish from (typecheck shows only one error). Evidence needed: run full gates after the test fix; if more errors surface, re-inventory `src/main/**` before editing.
- Assumption: user approves stopping Stage 2 mid-flight (they requested the handoff explicitly). Consequence: Stage 2 has NO review evidence yet; the next session must complete implementation, then run the full verify + independent-review cycle before Stage 3.
- Provider (Z.AI/GLM) rate limits may recur; subagent dispatches may need retry or fallback provider (`hermes fallback add` was suggested by the runtime).

## Resume instructions

1. Fix `src/preload/app-api.test.ts` for the new `projects.add()` contract (no argument; the native dialog opens in main). Expected evidence: `pnpm run typecheck` exit 0.
2. Inventory the partial Stage 2 files against the Stage 2 list in this snapshot; write the missing service/payload-validation/renderer tests and the missing renderer wiring (Add Project dialog flow, New Task, Remove Project, persisted selection, context header, region-size hydrate/persist). Expected evidence: lint + typecheck + test + build all exit 0, with new db/service tests present.
3. Dispatch an independent reviewer subagent for Stage 2 (fresh context; scope: spec compliance + carry-over items), then correction/re-review if blocking.
4. Checkpoint commit (commands.ci checkpoint), then Stage 3 (Task terminal with session preservation) per plan.
5. Next skill to load: `handoff` (this snapshot), then continue with `implement` flow from `.agents/tasks/mvp-core-shell/plan.md` Stage 2.
