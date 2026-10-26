# Agent-friendly renderer and IPC architecture

Status: Draft (NEKODE-128, package P4 of `docs/architecture/architecture-agent-review.md` section 8).
Path: `docs/features/agent-friendly-architecture/spec.md`.

This file is the behavioral contract for a feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

## Goal

Restructure the renderer state, the largest UI components, the IPC contracts, IPC payload validation, and import paths so that an agent can change one domain by reading a small, local set of files, and can test a UI component without mounting the whole application. This is a behavior-preserving engineering change: user-visible behavior, persisted data, and the IPC wire contract must not change.

Target users: the maintainer and contributing agents who read, change, and test NeKode code.

## Related requirements

- Kanban item NEKODE-128, package P4 (stages A-E) of [architecture-agent-review.md](../../architecture/architecture-agent-review.md) section 8, proposals 1-5 in section 4.
- Out of this contract, owned by other items: P0 packaging (NEKODE-134), P1 trust boundaries including fail-open special channels (NEKODE-135), P2 timeouts (NEKODE-136), P3 renderer interaction fixes (NEKODE-137), P5 tool hygiene including unused dependencies (NEKODE-138), test mock isolation (NEKODE-139).
- [Architecture](../../architecture/sdd.md), [test suite simplification](../test-suite-simplification/spec.md).

## Scope

1. Path aliases `@shared/*`, `@main/*`, `@renderer/*` resolved identically by typecheck, the electron-vite build (main, preload, renderer), and Vitest.
2. Domain IPC contracts in `src/shared/contracts/`, one file per domain, including the existing `usage-contract.ts`, `dictation-contract.ts`, and `desktop-dictation-contract.ts`.
3. Schema-first IPC payload validation with Zod: each validated payload type is inferred from its schema, and the main-process validator uses those schemas instead of hand-written `assert*` functions.
4. `CenterTabs.tsx` as a real component with its own component test; component and hook tests stop mounting `App`.
5. `KanbanBoard.tsx` split into list, item review, create form, and header components, with logic in `kanban-board-logic.ts`.
6. Zustand domain stores for projects, chats, tabs, and settings; `App.tsx` becomes composition.

## Non-goals

- New features, visual changes, or interaction fixes (P3 owns those).
- Changing the IPC wire format, channel names, argument order, or error codes.
- Fixing the fail-open validation of special channels in `ipc-handlers.ts` (NEKODE-135); this work keeps their current behavior.
- Persistence schema or migration changes.
- Removing unused dependencies other than what this work replaces.

## Behaviour

Rules every stage must preserve:

1. The application behaves the same for the user: same screens, flows, keyboard shortcuts, focus behavior, persisted state keys and values, and terminal lifecycle.
2. Every IPC channel accepts exactly the payloads it accepted before and rejects exactly the payloads it rejected before, with the same arity rules (`requireArgs`), path rules (`assertSafePath`, `assertRelativePath`, NUL rejection), protected state keys (`isSecretStateKey`, `isTaskProgressStateKey`), and strict unknown-field rejection.
3. Rejected payloads raise `ValidationError`/`AppError` with code `validation` as today; the renderer receives the same serialized error shape (`ipc-error.ts`).
4. `window.app` (`AppApi`) keeps its method names, signatures, and channel mapping.
5. Imports resolve the same module in typecheck, build, and tests; no alias resolves differently between tools.
6. Zod is a main-process and shared-schema dependency only for runtime validation; the renderer imports contract types and channel constants, and does not call schema parsing.

## Business rules

- One source of truth per payload: a validated payload has one Zod schema, and its TypeScript type is `z.infer`/`z.output` of that schema. No parallel hand-written interface for the same payload.
- Security rules (safe path, relative path, protected state keys, NUL bytes, strict object keys, exact arity) are expressed as schema refinements or channel-level checks and keep dedicated tests.
- A domain store owns the domain state it names; `App.tsx` must not add new domain `useState` for projects, chats, tabs, or settings.
- Store state that is persisted today (via `app.state` IPC or `localStorage`) keeps the same key, value format, and write timing.

## Authorization

None. Trust boundary rules for IPC senders stay as implemented in `ipc-handlers.ts`.

## Data / API

- Public contract unchanged: `IPC_CHANNEL` names, `AppApi`, serialized `AppError`.
- `src/shared/ipc-contract.ts` remains the aggregation point for `AppApi` and `IPC_CHANNEL` (re-exporting domain contracts), so preload and existing callers keep one entry point.
- New dependency: `zod` (runtime). `zustand` (already declared in `package.json`) becomes used.

## Edge cases

- Optional and nullable fields (`relativePath?`, nullable `projectId`, optional revision) keep their exact accepted forms: `null` versus absent stays distinguished where it is today.
- Numeric fields keep finite-number rules (no `NaN`, no `Infinity`).
- Extra object keys stay rejected where today's validator rejects them, and stay accepted where it accepts them.
- Store hydration order: a store that loads from `app.state` must not render a default that a later load overwrites with a visible flash where today there is none.

## Errors

No silent fallback. A schema failure is a `validation` error naming the channel and argument, as today; message text may change only where no test or user-visible string depends on it, and such changes are listed in the stage result.

## Acceptance criteria

1. `pnpm run typecheck`, `pnpm run build`, and `pnpm run test` resolve `@shared/*`, `@main/*`, `@renderer/*`; no import in `src` climbs into another top-level area with `../` (for example `../../../shared`); relative imports remain only within the same area.
2. `src/shared/contracts/` holds one contract file per domain; `src/shared/ipc-contract.ts` holds no domain payload types of its own, only aggregation (`AppApi`, `IPC_CHANNEL`, re-exports).
3. `src/main/ipc/ipc-validation.ts` has no hand-written `assert<Payload>` functions for object payloads; each validated object payload is a Zod schema in its domain contract, and its exported type is inferred from it. Every existing case in `ipc-validation.test.ts` and `ipc-handlers.test.ts` passes, with assertions unchanged except error-message regexes listed in the stage result.
4. `src/renderer/src/components/tabs/CenterTabs.tsx` exists and `CenterTabs.test.tsx` mounts it, not `App`. No test file under `src/renderer/src/components/` or `src/renderer/src/hooks/` renders `App`; tests that need application wiring live in `App.test.tsx` or `src/renderer/src/test/`. Every behavior asserted by a moved test is still asserted.
5. `KanbanBoard.tsx` is under 600 lines and composes `KanbanListView`, `KanbanItemReview`, `KanbanCreateTaskForm`, and `KanbanHeader`; `KanbanBoard.tsx` has no manual re-export of logic from `kanban-board-logic.ts`.
6. Zustand stores exist for projects, chats, tabs, and settings under `src/renderer/src/stores/`, each with unit tests; `App.tsx` is under 800 lines; `LeftNavigation` and `AppSettings` read their domain state from stores instead of receiving it through props.
7. `pnpm run verify` passes after each stage.

## Required tests

- Validation: the existing `ipc-validation.test.ts` and `ipc-handlers.test.ts` suites as regression proof; a test that every validated channel in `IPC_CHANNEL` has a parser entry.
- Aliases: typecheck, build, and test suites as proof of resolution in all three tools.
- Components: component tests for `CenterTabs` and each new Kanban component covering the behavior previously asserted through `App` or `KanbanBoard`.
- Stores: unit tests for each store's actions and persistence (key, format, timing).
- Application wiring: `App.test.tsx` keeps integration coverage of cross-component flows.

## Relevant SDD / ADR

- [sdd.md](../../architecture/sdd.md)
- [architecture-agent-review.md](../../architecture/architecture-agent-review.md) sections 4 and 8
