# NeKode

Agent-first coding environment: a desktop workspace for coding agents on Windows 11.

## Constitution

Preserve these core qualities and architectural invariants:

1. **Architecture & boundaries** - preserve established module boundaries, contracts, and layer separation.
2. **Quality & reliability** - keep test coverage meaningful and verify non-breaking behavior.
3. **Maintainability & simplicity** - prefer proven, readable solutions over speculative abstractions.

## Branching

Trunk-based hybrid, decided 2026-10-02. Full text: `docs/operations/branching-model.md`.

- `main` is the single long-lived branch, always green and releasable. Releases are tags on `main`.
- Small maintainer changes go directly on `main` after `pnpm run lint` and `pnpm run typecheck`, or the full `pnpm run verify`. Larger or risky work uses a short-lived branch, target under 3 days, named `nekode-<number>-<slug>`, merged through a pull request with green CI.
- External pull requests target `main` from contributor forks. The maintainer merges them after review with green CI, squash per pull request.

## Language

- The user interface and the README are English. UI strings stay English when surrounding text is in another language.
- Product documents under `docs/` stay Polish.
- Leave identifiers, paths, and commands unchanged when writing in another language.

## Quality

- Preserve module boundaries, contracts, and layer separation.
- Keep tests meaningful. A change is finished only after `pnpm run lint` and `pnpm run typecheck`, or `pnpm run verify`, pass.
- Prefer a proven, readable change over a new abstraction.

## Precedence

Direct user instructions outrank this file. Repository evidence and executable configuration outrank assumptions. If sources conflict on a consequential choice, surface the conflict before proceeding.
