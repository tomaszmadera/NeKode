# Public documentation contract independent of the local harness

This file is the behavioral contract for a feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

## Goal

Give a contributor a complete, public source of project requirements and contribution rules. A clean clone must contain enough information to build, test, change, and maintain NeKode, and to create a personal `AGENTS.md` suited to the contributor's tools and workflow.

The project's local agent harness and `AGENTS.md` remain local and unchanged. Public documentation owns project rules; personal agent instructions may refer to that documentation without becoming a competing source of truth.

## Related requirements

- User decision 2026-10-07: retain the ignored local harness and `AGENTS.md`; explain the choice in README; make all project requirements discoverable in public documentation.
- User-approved scope 2026-10-07: README, CONTRIBUTING, a public project contract, architecture and verification guidance, an independent release procedure, and repaired source hierarchy and references.
- Work item: NEKODE-27, Publiczny kontrakt projektu i dokumentacja niezależna od harnessu.
- [Product requirements](../../product/requirements.md).
- [Architecture](../../architecture/sdd.md).
- [UX/UI contract](../../UX-UI.md).
- [Setup](../../development/setup.md), [CI](../../development/ci.md), and [branching model](../../operations/branching-model.md).

## Scope

- Explain the local-harness policy in README and add a direct contribution entry point.
- Add `CONTRIBUTING.md` as a short navigation document, and `docs/development/project-contract.md` as the canonical contribution contract.
- Audit the project requirements recorded in the existing local guide, engineering/safety policy, project profile, and relevant domain guidance. Give every audited rule an explicit disposition and canonical destination.
- Complete public architecture and development guidance for IPC, persistence, terminal lifecycle, native modules, and verification using current contracts and implementation evidence.
- Add `docs/operations/releases.md` with a release/versioning procedure that needs no local harness; update the branching model to link it.
- Repair public links, local-machine paths, and references that require unpublished execution records to understand a project decision.
- Clarify the authority and status of product documents, feature specifications, design references, and historical bootstrap prompts.

## Non-goals

- Editing `AGENTS.md`, template-owned harness files, runtime adapters, or the ignore policy that already excludes them.
- Publishing the harness, local task records, handoffs, lessons, account settings, credentials, or machine configuration.
- Changing application behavior, architecture boundaries, dependencies, schema, native build policy, supported platforms, or existing secret-storage behavior.
- Implementing future features described by the architecture or UX documents.
- Changing repository visibility, GitHub branch protection, hosting, or Git history.
- Prescribing one agent, personal communication style, task tracker, skill installation, or local harness layout.
- Adding executable release automation or a new documentation tool dependency. A self-contained documented procedure is sufficient.

## Behaviour

1. A reader starting at README can find CONTRIBUTING, the public project contract, setup, verification, feature requirements, and release instructions without knowing the maintainer's local workflow.
2. README explains that `AGENTS.md`, the harness, and tool-specific agent configuration are local working configuration, while project requirements and contribution rules are public. Their absence must not prevent building or contributing. README links to the project contract and explains that a contributor can create a locally ignored personal guide from it.
3. Each concern has one canonical owner. CONTRIBUTING and README link to detailed owners instead of copying their rules. The project contract includes an explicit source map for product behavior, architecture, UI/design, development commands, verification, branching, and releases.
4. Product requirements follow this authority order: an explicit current user decision, an accepted product decision or ADR, a canonical product document, a feature specification, an execution plan, a task record, a handoff, then an analytical/reference document. Decisions that affect contributors must be recorded in a public canonical owner. A lower source cannot silently change a higher contract; conflicts require a documented resolution.
5. Executable configuration is authoritative for implementation facts such as versions, scripts, build policy, and test discovery. Distinguish those facts from approved product behavior; a code/document mismatch does not by itself authorize a behavior change.
6. The public contract preserves module boundaries, minimal privileged APIs, meaningful verification, simple established solutions, root-cause fixes, and preservation of unrelated work. It explains proportional change planning: a local plan for bounded changes, a specification and plan plus independent review for coordinated changes, and demonstrable stages for larger work. No requirement depends on a particular agent or local record format.
7. Publication and destructive actions remain explicit maintainer decisions. Contributor instructions preserve scoped commits, review and green-CI merge requirements, credential protection, and the prohibition on silently overriding a failed check. Avoid turning personal agent approval mechanics into application behavior.
8. Public IPC guidance identifies main/preload/renderer ownership, `window.app` and the shared typed contract, input and sender validation before service work, typed sanitized error transport, and the established Electron isolation settings. It links current implementation and required negative-test patterns.
9. Persistence guidance covers forward migrations, transactions and validation before mutation, foreign-key integrity, stale-state cleanup, database location, and the existing connection pragmas. Explain which test setups exercise file/WAL behavior. Destructive operations on a real user database require an exact target and separate authorization.
10. Terminal guidance distinguishes xterm view, PTY, agent CLI child, and application lifetimes; session retention, termination, subscription cleanup, bounded buffering, clipboard behavior, and split line submission. Derive current behavior from the feature contracts and source, including `src/renderer/src/lib/pty-submit.ts`; do not copy obsolete stub/service snapshots from local skills.
11. Native-module and setup guidance uses `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and `electron-builder.yml` as implementation evidence. Preserve the current prebuild/build-script policy and explain when real Electron or packaged smoke is required. Distinguish the Windows application target from optional WSL shell integration and from historically verified toolchain snapshots.
12. Verification guidance identifies the public commands, what each proves, and when a change needs focused tests, the complete suite, or real Electron smoke. Regression coverage must demonstrate the reported defect where applicable. Do not present unit tests as proof of native runtime behavior or add tests that only mirror documentation wording.
13. Release instructions are reproducible without `.agents/`: a verified scoped change commit, a manifest version update, a separate version commit, an annotated semver tag on that commit, and explicit publication of the branch and selected tags. Preserve the established tag naming without a `v` prefix, verify the exact remote references, and stop on a conflicting tag or failed prerequisite. No force push or history rewrite is implied.
14. Public links use repository-relative targets with exact tracked spelling, including `docs/architecture/sdd.md`. Replace machine-specific paths with portable examples. Move consequential decisions out of references to unavailable task/handoff records and into their existing feature contract or a justified ADR.
15. References to `.agents` may remain as an explicit exclusion, historical context, or an optional user-configured path example. They must not be required commands, canonical behavior sources, links expected to resolve after cloning, or hidden runtime prerequisites. Existing optional handoff-path examples and external agent notification configuration remain compatible.
16. Preserve the English-only application UI and existing literal terminal command strings. Follow the language of the document being edited, keep identifiers and commands unchanged, and use plain documentation prose. Personal chat formatting and the maintainer's local agent orchestration remain optional preferences.

## Business rules

- Full coverage means every rule in the audited local sources has a disposition: public project requirement with an exact canonical destination, local preference, template mechanism, or obsolete implementation snapshot with evidence. No rule is silently omitted and no unresolved project requirement is counted as covered.
- Store the detailed audit/coverage matrix with the local task record. Publish the resulting project rules and source map without requiring readers to possess the audited private/local files.
- Review domain facts against current source and accepted public contracts. An obsolete guide is evidence of documentation drift, not a new product requirement.
- Keep one owner per concern. Existing documents should be updated in place; create a separate ADR only for a consequential decision that lacks a suitable durable owner.
- The audit does not claim to detect secrets outside its named file scope or to change already published history.

## Authorization

The user authorized preparing this contract and continuing its implementation in a later session. The local plan requires approval before implementation starts. The requested Kanban item may be created and moved to In Progress; it remains there during the handoff.

This contract authorizes no commit, bump, push, release, deployment, history rewrite, harness edit, or application behavior change. A future publication action needs its own applicable authorization.

## Data / API

No application API, IPC, database, or configuration change. Outputs are Markdown documentation. The public project contract describes contribution obligations and links to each detailed owner; local records describe execution state only.

## Edge cases

- A clean public clone has no local harness or Python harness runner. Core application setup, verification, and release documentation still work. Python required by the optional Plane adapter remains documented separately.
- A specification references an unavailable local decision record. Preserve the accepted decision in its public owner and replace the unavailable authority reference.
- A source describes a future or proposed feature. Label it as such and retain its scope; do not imply that it is implemented.
- A local rule conflicts with an accepted public product contract. Record and resolve the conflict using the authority order before declaring coverage complete; do not change behavior to make the text agree.
- A referenced tool version changed. Use the manifests/lockfile for current facts and label measured snapshots with their original date.

## Errors

Broken canonical links, unresolved project-rule coverage, reliance on an unpublished command, or an unsupported claim block acceptance. Report the exact source and the missing decision/evidence; do not substitute a similarly named target or silently invent a fallback.

## Acceptance criteria

1. README explains the local-harness policy and directly links CONTRIBUTING and the public project contract.
2. CONTRIBUTING provides a complete reading/action path for a new contributor without duplicating detailed rules.
3. The project contract has a complete canonical source map and the documented authority order; product-document metadata and historical/reference status agree with it.
4. The audit matrix covers 100% of the rules in the named local sources, with no unresolved project requirement and an exact destination for every public requirement.
5. Public architecture/development documentation contains the IPC, persistence, terminal, native-runtime, and verification obligations described above, supported by current named source/contracts.
6. Public setup, checks, and release instructions have no mandatory dependency on `.agents`, local task records, or personal agent configuration.
7. All affected local document links resolve against tracked/proposed public files with correct case; local-machine links and paths are replaced. The public-reference audit records and justifies any retained harness mentions.
8. Branching and release guidance preserve the current linear model and annotated numeric semver tags, without referring to the unavailable local release helper.
9. The implementation changes only the approved documentation scope; `AGENTS.md`, template-owned harness files, application code, dependency manifests, and existing ignore behavior are unchanged.
10. Independent review and the documentation-specific final checks pass, with real command/exit and coverage evidence recorded locally.

## Required tests

- Documentation/path checks: `git diff --check`; validate affected relative Markdown links and exact target case against the public file inventory. An ad-hoc read-only checker may produce evidence without adding a tool dependency.
- Reference audit: inventory public `.agents`, agent-guide, local-machine URI/path, and `SDD.md` mentions; classify legitimate optional/examples/exclusion mentions separately from broken authority or command dependencies.
- Coverage review: compare every audited rule and its disposition with the final canonical destination and supporting source. Missing or conflicting rules fail this check.
- Public-clone review: follow the contributor path using only public files; verify commands against existing scripts/configuration and the documented release semantics. Validate publication commands without performing publication.
- No new unit/component test is required for prose-only changes. Existing application test evidence is supporting evidence, not a replacement for documentation/link/coverage checks. If implementation unexpectedly needs executable changes, stop and obtain a scope decision first.

## Relevant SDD / ADR

- [Architecture](../../architecture/sdd.md), especially process boundaries, persistence, IPC, terminal lifecycle, logging, and security.
- [Branching decision 2026-10-02](../../operations/branching-model.md).
- No new architecture decision is required by this behavior-preserving documentation task.
