# Engineering policy

Core rules live in `AGENTS.md`. This file defines reusable engineering policy. Project-specific commands, paths, evidence, and conventions belong to project rules or the project profile.

## Design

- Apply the established conventions of the selected language and framework. Do not preserve a poor pattern merely for consistency when it materially harms the requested result.
- Keep interface adapters thin and domain behavior near the module that owns it, so contract changes stay local and testable.
- Prefer clear code and reuse sound existing patterns, stack features, and mature libraries.
- Add no dependency, service, queue, repository abstraction, cache, compatibility layer, infrastructure, or abstraction without a current requirement.
- Validate and authorize non-trivial input at an established boundary.
- Keep schema changes backward-compatible when staged deployment requires it. Never modify an already deployed migration; existing environments applied it, so use a forward migration unless repository evidence proves the migration is unreleased.
- Fail clearly and fix the cause of missing, invalid, or unexpected required data unless fallback behavior is an explicit design requirement.
- Authorize every mutation target at its write or delete site, and validate all failure-producing candidates before the first mutation.

## Execution evidence

- Run scripted commands in a non-interactive, non-login shell; load interactive shell initialization only when explicitly required.
- Command output and command termination are separate evidence. If terminal-looking output appears but the shell remains live, check whether a child process is active; wait or diagnose an active child, stop only a proven orphaned shell, and report a manual-interrupt exit separately from the operation's real effect.
- Treat a wrapper's exit code as evidence of the wrapped operation only when the wrapper ran to completion. After interruption, or for a background job, verify the operation through its own status or completion evidence and check for a surviving child in the actual execution environment before starting conflicting work.
- In diagnostic shell pipelines, capture and return the primary check's exit status explicitly so trailing reporting/formatting cannot mask failures.

## Integrations

- When API documentation uses SPA routes or nonstandard ports that fail to render in browser connectors, fetch the official URL directly over HTTPS and inspect its embedded OpenAPI contract instead of guessing response fields.
- For informational integrations, derive refresh cadence explicitly from the freshness requirement rather than defaulting to session start.
- In cross-process filesystem caches, cleanup and pruning must acquire the same per-entry lock as refresh, re-validate before deletion, tolerate acceptable clock skew (`abs(now - refreshed_at) < WINDOW`), and evaluate current time dynamically, so a stale reader cannot delete a just-refreshed entry.

## Tests and verification

- For testable new behavior and bug fixes, use red, green, refactor. Test behavior and contracts rather than implementation details, and do not add artificial low-value tests for changes that are not meaningfully testable at that level.
- Test changed behavior at the lowest useful level. Add a regression test for a proven bug when practical, and add relevant missing tests when they reasonably belong to the task.
- For an external integration, prefer an official sandbox, test environment, emulator, or equivalent over mocks alone, because mocks encode assumptions, not the real contract. Do not test against production when an appropriate test environment exists.
- Validate executable workflows and Mermaid diagrams by testing parsed graph structure (edges, reachability, mandatory gates, terminal paths) rather than substring presence.
- A regression test for a fixed bug must be shown to fail without the fix. Record the failing red run when test-driven development already provides it; otherwise revert the fix temporarily, run the test, and restore the fix before final verification.
- Before asserting that an operation left state unchanged, prove that the operation ran successfully. A negative state assertion alone can pass when the operation never executed.
- Do not claim that work passes or is complete until the relevant final verification has run successfully. Report failed, skipped, unavailable, and unverified checks exactly.
- Review the complete final diff for scope, failure paths, regressions, generated noise, and documentation impact.

## Documentation

- Keep one canonical source per concern and link instead of copying instructions.
- Keep intuitive navigation: make the next relevant file, instruction, and action easy to discover without prior repository knowledge.
- Keep the harness readable by every supported agent. Runtime adapters may expose capabilities or pointers to canonical sources, but they must not own a behavioral rule.
- Follow the repository's documented layout for requirements, architecture decisions, development guidance, and runbooks. If none exists, agree one before creating it.
