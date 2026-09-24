# NeKode - Agent Guide

Agent-First Coding Environment

## Core rules

- Follow the repository's recorded language policy; otherwise match the user and surrounding material.
- Address the user in the second-person singular, never plural, formal, or first-person plural.
- Number multiple questions. With options, leave the question unnumbered and number only its options. Leave a single open question unnumbered.
- Use named repository evidence, not assumptions. Name the source and claim; drop unsupported statements.
- Read only what the next safe change needs. Ask only about material decisions evidence cannot resolve.
- Run in-scope actions. Ask before those needing approval; do not tell the user to run them except `.agents/safety.md` privileged actions.
- Prefer simple, proven solutions and existing project conventions.
- Fix root causes; never mask errors with silent fallbacks or broad catch blocks unless fallback is required.
- Preserve unrelated user changes. Ask before destructive Git or scope expansion.
- Never use em dashes anywhere; use hyphens, colons, or parentheses. Use straight quotes, never typographic ones.
- Tool-specific configs may set permissions and point to `AGENTS.md`, but must not duplicate behavioral rules.
- Check a literally named target (path, ref, id, repository, environment) in the exact given form. An absent target never authorizes the nearest similar name; similar candidates are read-only evidence. Substitute only after explicit user confirmation or an unambiguous repository alias mapping; name similarity or a single candidate is not a mapping. If the remaining result can stay correctly parameterized, prepare it and leave the target unresolved without claiming it ran on the user's target.
- Resolve product requirements by truth-source precedence: explicit current user decision, accepted product decision or ADR, canonical product document, feature spec, plan, task record, handoff, analytical document. A lower source never silently changes a higher one; correct the lower contract or record an explicit decision with its consequences.

### Prose and documents

Applies to chat, prose documents, and commit messages in every language.

- Answer first, then the evidence. No preamble, restated question, or closing summary that repeats the answer. Keep the required completion report.
- Use the plainest wording that preserves meaning. Cut puffery, filler, empty conclusions, formality, and decoration; prefer direct `is` and `has`.
- State what happened, the actual plan, or the measured result. Support repository claims with `file:line` or command output.
- State uncertainty once, plainly, with what would resolve it. Do not hedge every sentence or present an unverified claim as fact.
- Avoid these tics: `not just X, but Y`, forced groups of three, false `from X to Y` ranges, abstract metaphors, and weak adverbs where a precise verb or measurement belongs. Prefer active voice when the actor matters.
- In documents: sentence-case headings, no decorative emoji, bold only to aid scanning, no redundant bold list prefixes.
- Keep repository terms, identifiers, paths, and commands unchanged when writing in another language.

Structured records, orchestration, YAML, code, identifiers, and defined error-message contracts follow their own correctness rules; do not apply prose rules to them mechanically.

## Completion report

Every task response includes exactly one of these three statuses:

1. Done: the work is finished.
2. Unfinished: remaining steps in order, plus the immediate next action or question required to continue.
3. Stopped: what is missing, remaining steps, and the immediate next action or question required to continue.

Before `Done`, activate `ci`, load its publication reference, and run recorded `publication-status --json`. Render `Done: the work is finished.` first, then the offer. Do not offer publication on `Unfinished`, `Stopped`, or `handoff`.

## Classify

Classify `intent`, `complexity`, `risk`, and `durability` independently. Before creating durable state, use a bounded classification probe: inspect only the smallest named path, symbol, related test, config, route, service, interface, or Git evidence needed. If consequential ambiguity remains, ask one concrete question; do not use broad discovery to classify.

### Intent

Choose one owning intent:

- `feature`: add or change user-visible behavior.
- `refactor`: change structure while preserving behavior.
- `debug`: diagnose a defect; may include a bounded root-cause fix.
- `review`: inspect code or a diff without implementing fixes.
- `analysis`: produce an evidence-backed technical or business answer without implementation.
- `documentation`: edit documentation; contract-changing documentation routes as development work.
- `repository-operation`: inspect state or run an explicitly requested existing repository/recorded command (status, diff, tests/checks, commit, tag, push, release, deploy) without owning a new product change.

### Complexity

Decide by consequence, in this order:

1. `trivial`: direct, local, reversible work.
2. `small`: one bounded change, investigation, or operation with clear acceptance and one direct validation path. An in-session plan suffices.
3. `standard`: one coordinated unit involving several behavior boundaries or investigation checkpoints. Development requires an approved specification and plan, one demonstrable stage, and independent review.
4. `large`: two or more independently resumable or demonstrable units, or staged coordination; development uses multiple stages with the same gates as Standard.

File count, risk, tracking, checkpoints, and handoff do not raise complexity by themselves.

### Risk

Set any applicable flag. Risk is orthogonal to complexity.

- `external-side-effect`: publication, deployment, external API mutation, or other state outside the local worktree.
- `destructive-or-irreversible`: data loss, history rewrite, destructive migration, volume deletion, or equivalent.
- `sensitive-boundary`: auth, payments, secrets, personal data, privilege changes, or security-sensitive public contracts.

Risk may emerge later; load `.agents/safety.md` before the risky action.

## Durable task state

`durability` is `ephemeral` or `recorded`. Trivial and Small default to ephemeral. Standard, Large, explicit tracking, resumable or multisession work, durable checkpoints, and context/session transfer require recorded state.

Tracking, checkpoint, and handoff change durability to recorded, not complexity. For recorded work, activate `task-record` after the bounded probe and before broad discovery; keep the record through completion. Reuse and refresh an existing record in place. Ephemeral work creates no record. Recorded Trivial and Small keep their proportional route without a spec, plan file, or independent review.

## Route

| Situation | Next instruction |
|---|---|
| Trivial `feature` / `refactor` / `documentation` | Execute directly |
| Small development | Read `.agents/workflows/small-development.md` |
| Standard or Large development | Read `.agents/workflows/spec-driven-development.md` |
| Trivial `debug` | Activate `systematic-debugging`; activate `verify` only if code/config changes |
| Ephemeral `review` | Activate `code-review` |
| Ephemeral bounded `analysis` | Analyze directly from relevant evidence |
| Non-trivial `debug`; recorded `review` / `analysis`; multi-checkpoint investigation | Read `.agents/workflows/investigation.md` |
| `repository-operation` | Execute directly; activate `ci` for commit/tag/push/release/deploy; load `.agents/safety.md` before state changes/publication. For recorded work, activate `task-close` with `already-complete` after verification or `none` if none is required. |
| Backlog/Kanban mention or backlog URL | Activate `kanban` |
| Pause, user stop, or ownership transfer | Activate `handoff` |
| Context pressure | Read `.agents/workflows/references/context-succession.md`, then activate `handoff` |

Recorded direct work uses `task-record` for state and `task-close` after its required checks, with `already-complete` or `none` when no verification is needed.

Skills are discovered from harness metadata; do not read skill bodies to find one.

NeKode domain skills live in `.agents/skills/` (electron-ipc, electron-native, terminal-lifecycle, database, electron-e2e, git-worktrees) together with vendored React/UI skills. Activate at most the one whose description matches the current domain; `docs/development/agent-skills.md` owns routing, provenance, and maintenance.

## Conditional policy and reference loading

Load only the applicable item:

| Situation | Load |
|---|---|
| Designing/changing/debugging code, reviewing code for correctness, tests, schemas, migrations, integrations, executable config, or selecting verification | `.agents/engineering.md` |
| Any risk flag; commit/tag/push/merge/rebase/deploy; destructive action; privilege/secret boundary | `.agents/safety.md` |
| Stack, environment, harness version, or recorded project commands are needed | `.agents/project-profile.yaml` |
| Executing project commands in a Windows or WSL runtime | `.agents/environments/windows.md`, `.agents/environments/wsl.md` |
| Starting an extra agent session | `.agents/workflows/references/extra-session.md` |

Read `.agents/project-profile.yaml` at most once per session; treat its facts as session facts unless you changed it; treat unrecorded commands/gates as unavailable.

## Lessons

On an unexpected operational error, required-tool unavailability needing another method, or user correction, activate `lesson-select` and record/update only the concrete repository-grounded lesson. Do not load lesson history when no candidate exists.

## Project rules

### Constitution

Preserve these core qualities and architectural invariants of this project:

1. **Architecture & boundaries** - preserve established module boundaries, contracts, and layer separation.
2. **Quality & reliability** - keep test coverage meaningful and verify non-breaking behavior.
3. **Maintainability & simplicity** - prefer proven, readable solutions over speculative abstractions.

## Precedence

Direct user instructions outrank repository guidance. Repository evidence and executable configuration outrank assumptions. If sources conflict on a consequential choice, surface the conflict before proceeding. A `## Project rules` entry outranks a general rule elsewhere in this file.

## Terminal execution (for projects that have to run in Windows runtime)

- Prefer synchronous execution for short-lived commands. Use asynchronous execution only for watchers, development servers, and genuinely long-running processes.
- Do not background Git inspection, short scripts, filesystem checks, or small-scope linters.
- In PowerShell, stdout may complete while a background runner remains active; check task/process status once instead of passively polling.
- Run related short Git inspections sequentially in one non-login PowerShell process.
- Run recorded Python harness commands from non-login PowerShell. Switch to `cmd.exe` only after evidence shows it resolves the configured Python interpreter correctly.
- Keep alternate Git index setup, scoped checks, and cleanup as separate commands with explicit validated paths so a compound command cannot hide which mutation was authorized.
- In PowerShell Git inspections, pass an annotated-tag dereference such as `'refs/tags/<tag>^{}'` as a quoted literal, or use `git rev-list -n 1 <tag>`, so PowerShell does not consume the brace expression.
- When a harness record needs a UTC timestamp, use `[DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')`. Do not assume `Get-Date -AsUTC` exists.
- When a recorded `{python}` command runs and `python` is unavailable, resolve `py` with `Get-Command py` and use that launcher.
- In a WSL session, run the harness with the WSL interpreter; the Windows launcher `py` and a Windows venv are not prerequisites there. See `wsl.md`.
