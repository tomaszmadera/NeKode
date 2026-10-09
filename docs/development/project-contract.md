# Public project contract

This document owns contribution rules for NeKode. It applies to human and agent-assisted contributions and requires no particular agent, task tracker, skill package, or local harness. Application behavior remains in the product and feature contracts.

## Sources and authority

| Concern | Canonical owner |
|---|---|
| Approved product scope and terminology | [Product requirements](../product/requirements.md) |
| Feature behavior, errors, acceptance, and future scope | The relevant [feature specification](../features/) |
| Process boundaries, persistence, IPC, terminal ownership, security | [Architecture](../architecture/sdd.md), including [current implementation obligations](../architecture/sdd.md#current-implementation-obligations) |
| Interaction and English-only UI | [UX/UI contract](../UX-UI.md) |
| Visual tokens, typography, controls, and motion | [Design system](../references/NeKode-Design-System.md) |
| Toolchain, install policy, native modules, smoke setup | [Setup](setup.md) |
| Checks, test scope, and CI | [CI and verification](ci.md) |
| Branches and contribution integration | [Branching model](../operations/branching-model.md) |
| Version commits, tags, and publication | [Releases](../operations/releases.md) |
| Action-button configuration | [Action runbook](../operations/custom-action-buttons.md) |
| Optional Plane adapter installation and protocol usage | [Plane adapter guide](../../adapters/plane/README.md) and [adapter contract](../features/kanban-adapter-interface/spec.md) |

Resolve behavioral requirements in this order: an explicit current user decision, an accepted product decision or ADR, a canonical product document, a feature specification, an execution plan, a task record, a handoff, then an analytical/reference document. Record contributor-relevant decisions in their public owner, with their date and consequences. A private chat or local execution record must not be needed to understand the accepted behavior. A lower source cannot silently change a higher one: resolve the conflict and update the affected contract before implementation. There is no separate ADR register today; accepted dated decisions can live in the relevant public contract.

Executable configuration and named source own implementation facts, including dependency versions, scripts, build policy, and test discovery. Use [package.json](../../package.json), [pnpm-lock.yaml](../../pnpm-lock.yaml), [pnpm-workspace.yaml](../../pnpm-workspace.yaml), [electron-builder.yml](../../electron-builder.yml), [Vitest configuration](../../vitest.config.ts), and the [CI workflow](../../.github/workflows/ci.yml). A mismatch between code and approved behavior is a defect to resolve; it does not authorize changing the product requirement. Dated setup measurements describe the tested version/target pair, not every future release.

The architecture and UX documents include future designs. A feature specification records its own scope and accepted decisions; its existence alone does not prove implementation. The [bootstrap prompt](../references/NEW_SESSION_BOOTSTRAP_PROMPT.md), [mockup pack](../references/agentic-coding-ui-mockup-prompts/README.md), and [prototype](../references/prototype-v1-claude/README.md) are historical or visual references, not behavior contracts. The design system is the visual owner despite its location under `references`.

## Planning and review

Inspect the exact affected path, symbol, test, and configuration before choosing a change. Use named evidence for claims and decisions. If a named target is absent, report it; do not silently substitute a similar target. Read the smallest scope needed for the next safe change and ask only about consequential choices the existing contracts cannot resolve.

- Direct, local, reversible work can be implemented directly.
- One bounded change with clear acceptance needs a short plan and one direct validation path; an in-session plan is sufficient.
- A coordinated change crossing behavior boundaries needs an approved feature specification and execution plan, one demonstrable stage, and independent review of the complete stage diff.
- Larger work uses two or more independently demonstrable stages under the approved plan. Finish checks and independent review for each stage before advancing.

Tracking, a checkpoint, or handoff does not make a small change larger. Keep execution state separate from requirements; retain real evidence for resumable work in a format of your choice. When resuming, compare the recorded branch, commit, owned changes, and prior checks with the repository before editing. Preserve partial work and failed approaches. A handoff does not authorize a commit or publication. Implementation approval covers only the approved scope; ask before expanding it. A reviewer must be distinct from the implementation owner for coordinated work; self-review cannot replace that gate. Unavailable or interrupted review and verification remain incomplete. Correct blocking findings and re-review before declaring completion.

## Implementation discipline

Preserve module boundaries, contracts, reliability, and readable established solutions. Keep interface adapters thin and domain behavior in the owning service. Add APIs, abstractions, dependencies, and infrastructure only for a concrete current requirement. Do not add an ORM or another repository layer without a demonstrated need.

Validate and authorize non-trivial input at the established boundary and each write/delete site. Validate all failure-producing candidates before the first mutation. Fix root causes; do not hide errors in broad catch blocks or silent fallbacks unless the accepted contract requires the fallback. Preserve unrelated edits and scope commits to the contribution.

For a visual or theme defect, inspect the cascade, specificity, tokens, and style registration first. A presentation-only change belongs in the owning stylesheet and tokens; it does not require a wrapper component without a behavioral reason. Use the design system for UI details.

For informational integrations, choose refresh cadence from the freshness requirement, not session start. Confirm an edit's intended anchor is unique, preserve the surrounding structure and indentation, and inspect the written region after the tool returns; tool success alone is not evidence of a correct change.

Domain changes follow the architecture's IPC, database, and terminal obligations and the setup guide's native-runtime obligations. Keep staged schema changes backward-compatible. Applied migrations stay intact; add forward migrations and exercise empty and populated databases. No renderer gains direct filesystem, database, PTY, or Electron privilege.

## Evidence and verification

Select checks by what the change can affect, using [CI and verification](ci.md#dobór-weryfikacji). A bug regression must fail without the fix: record a red run or temporarily revert and restore the fix before final verification. Test behavior at the lowest useful level; avoid tests that merely repeat implementation or documentation wording. Before asserting unchanged state, prove the operation under test actually ran.

Review the whole final diff for scope, error paths, regressions, generated noise, and documentation impact. Run affected checks after changes that can invalidate their result. Do not override a failed gate or describe an unrun check as passed. Report the exact target, command, exit, and limitation. Unit or jsdom tests cannot prove native Electron or ConPTY behavior.

Run short checks synchronously in a non-interactive, non-login shell. Use asynchronous execution for servers, watchers, or genuinely long work; collect termination evidence before concluding. Output alone is not completion. After interruption or background work, check the actual process and surviving children. Preserve the primary failing exit code when reporting a pipeline; a later reporting command must not turn failure into success. On Windows, use an explicit `cmd /c pnpm ...` wrapper if the shell cannot invoke the pnpm script correctly. Avoid assuming Bash quoting or wildcard expansion works in PowerShell; pass explicit paths and quote Git refs containing braces.

Quote search patterns containing backticks so a POSIX shell cannot run command substitution. Quote optional shell globs or let the owning tool expand them; an empty or unexpanded glob is not evidence that files are absent. Confirm with a bounded directory inventory. Keep alternate Git index setup, scoped checks, and cleanup as separate commands with validated explicit paths so one compound command cannot hide which mutation was authorized.

Use scratch data or a test environment for external integrations; do not exercise production when a test environment exists. The setup guide owns Electron data isolation and teardown. Never log terminal input, credentials, or private keys.

## Authorization and publication

Commits, pushes, tags/version publication, merge, rebase, PR creation, deployment, destructive filesystem/database operations, and production/external writes require an explicit maintainer/user decision naming the operation and exact paths, refs, or data target. Credentials and hooks do not grant authorization. A local implementation plan or handoff grants no publication authority. A commit request alone does not imply push. Keep irreversible and external effects under human control; stop on a failed prerequisite or changed scope and obtain a revised decision. Do not silently override a blocked hook or check.

Protect secrets from documents, logs, argv, commits, and diagnostic output. For real user-database destruction or manual migration, confirm the exact resolved database and obtain separate authorization. For recursive deletion or moving workspaces, verify the resolved target first. Ask the user to perform privileged commands; do not substitute a toolchain, package source, installation scope, or foreign binary to bypass that decision.

The [branching model](../operations/branching-model.md) owns integration. The [release runbook](../operations/releases.md) owns scoped change commits, separate version commits, annotated numeric semver tags, and exact remote-ref verification. No force push or history rewrite is implied. If another process already published a ref, verify the object ids instead of pushing redundantly. After a partial publication failure, check branch and tag independently; never move a published tag.

If you use multiple worktrees, record one owner and branch for each, inspect status and existing worktrees before creating one, and run commands in its explicit working directory. Do not edit another owner's files or index. Validate the base commit and resulting branch after creation. Remove a worktree only when clean or after authorization to discard its exact changes; branch deletion is a separate decision. Worktree tooling must not create a competing task or handoff system.

Before removing a worktree, run its relevant checks. After removal, confirm the path is absent from `git worktree list` and any retained branch still resolves to its recorded commit. State which worktree each verification ran in.

## Documentation and local configuration

Keep one canonical owner per concern and link to it. Requirements belong in product/feature contracts, architecture decisions in architecture or an accepted ADR, development guidance here and in setup/CI, and operational procedures in runbooks. Keep the next document and action discoverable. Use exact tracked spelling and repository-relative links; examples must work in a contributor's clone rather than rely on a maintainer's private path.

The application UI is English-only. Literal terminal commands are data and remain as contracted even when their language differs. Follow the language of the document you edit, retain identifiers/commands, use sentence-case headings, straight quotes, and plain wording without em dashes. Use bold only for scanning, omit decorative emoji and redundant bold list prefixes, and prefer concrete measured statements over filler. Support repository claims with named paths and, where useful, line numbers or command evidence. State unresolved facts once with the evidence needed to settle them. Structured data, code, identifiers, and defined error-message contracts follow their own correctness rules.

`AGENTS.md`, `.agents/`, and agent-specific runtime configuration are ignored local working configuration. Their absence must not prevent building, testing, contributing, or releasing from a public clone. You may build your own locally ignored guide from this source map; link to project rules rather than duplicating them. Personal chat style, question tools, skills, phase/timing record formats, account settings, and orchestration are optional local choices. Configuration adapters may expose capabilities and point at your guide, but should not become another behavior contract.

An optional handoff-directory example or an explicitly excluded local path can mention `.agents`; no public instruction may require that directory as a command source, authority link, or hidden runtime prerequisite. The app's handoff directory is user-configured and has no harness-specific default. External agent notification configuration remains user-managed and optional, as described in [README](../../README.md#agent-notification-setup-attention-badge).
