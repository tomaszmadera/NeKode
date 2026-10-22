# CI: automatic verification on GitHub Actions

Status: Delivered (GitHub Actions runs `pnpm run verify` on every change).
Path: `docs/features/ci-pipeline/spec.md`.

Behavioral contract of task NEKODE-12. The implementation uses this file; work progress is kept in the task record, not in the specification.

## Goal

Every change in the repository is checked automatically on GitHub Actions with the same command as locally (`pnpm run verify`: Biome lint, typecheck of both projects, Vitest). The maintainer (a user who does not know CI standards) also gets a self-explanatory document, `docs/development/ci.md`, which explains what CI checks, when, on which system, how GitHub Actions differs from GitLab CI, and why the pipeline does not need VS C++ Build Tools.

## Related requirements

- Work item NEKODE-12 (Plane): "CI: a sensible GitLab CI + documentation of what CI should look like" (title translated from Polish).
- Related, out of scope: NEKODE-13 (Linux), NEKODE-15 (branching model), NEKODE-17 (what to publish).

## Scope

1. A `.github/workflows/ci.yml` workflow (GitHub Actions) that follows "Behaviour".
2. A `docs/development/ci.md` document in Polish, self-explanatory, following "Behaviour".
3. A link to `docs/development/ci.md` in `docs/development/setup.md` (discoverable without prior knowledge).

Note (NEKODE-110, 2026-10-22): on the maintainer's decision, `docs/development/ci.md` and this specification were later translated to English. The language requirement in Scope 2, "Document" and acceptance criterion 2 describes the delivered state.

## Non-goals

- Installer build / smoke outside dev in CI (NSIS, `build:win`): unchanged.
- Release and publication of artifacts from CI.
- Linux/macOS runners and support for them (NEKODE-13).
- GitLab CI configuration in the repository: GitLab is only discussed in the document as an alternative.
- The branching model decision (NEKODE-15); the pipeline must work both with `main` alone and with a future `develop` + feature branches.
- A CI badge in the README.
- Running harness scripts (`.agents/` is not published).

## Behaviour

### Workflow (`.github/workflows/ci.yml`)

- Trigger: `push` to `main` and `pull_request` (any source branch).
- A `verify` job on `runs-on: windows-latest` (the required check of the `main` protection, name unchanged); a 20-minute time limit.
- An advisory `verify-linux` job on `runs-on: ubuntu-24.04` (phase 0 of the Linux version, 2026-10-20; since 2026-10-22 the same Ubuntu version as the AppImage build in the release workflow, NEKODE-104): it installs `build-essential` and `python3`, compiles `node-pty` after `pnpm install --frozen-lockfile` (`pnpm rebuild node-pty`) and runs `pnpm run verify`; a 20-minute limit; branch protection does not require it.
- Concurrency: a new push to the same ref cancels a run that is still in progress (`concurrency` with `cancel-in-progress`).
- Steps in order: checkout; installing pnpm from the `packageManager` field (`pnpm@12.5.1`); installing Node 24 with the pnpm store cache; `pnpm install --frozen-lockfile`; `pnpm run verify`.
- The `verify` job does not install VS C++ Build Tools or any compiler (exception: `verify-linux`, see above); it uses no secrets; it does not set `continue-on-error` on any step.
- The CI job sets Node 24 (`node-version: 24` in `.github/workflows/ci.yml`). The `engines` field in `package.json` is `^22.22.2 || ^24.15.0 || >=26.0.0` (`package.json:10`, the same in `docs/development/setup.md:13`). The verified host 24.18.0 is in `docs/development/setup.md:14`.
- Native modules must not be compiled in the Windows job: the `allowBuilds` policy in `pnpm-workspace.yaml` (tracked by git) forces N-API prebuilds (`better-sqlite3: false`, `node-pty` prebuild staging), and Electron 44.x has no install scripts.

### Document (`docs/development/ci.md`)

In Polish, understandable without prior knowledge of CI. It must explain:

1. What CI is and what it checks in this project (lint, typecheck, tests = `pnpm run verify`) and why exactly these.
2. When the pipeline runs (PR, push to `main`; cancelling superseded runs).
3. Which system it runs on (`windows-latest`) and why (a Windows-first project, verified `win32-x64` prebuilds), and what would have to be added for Linux (NEKODE-13).
4. Why without VS C++ Build Tools: N-API prebuilds, the `allowBuilds` policy, no Electron rebuild.
5. The pnpm cache: what is cached and how it affects the run time.
6. GitHub Actions vs GitLab CI differences: repository hosting (origin = GitHub), the pipeline file (`.github/workflows/` vs `.gitlab-ci.yml`), syntax, runners (including the Windows limits on GitLab), when a mirror would make sense. The document recommends GitHub Actions and gives the cost of changing the decision.
7. How to read the result (commit marks, logs, what to do on a red run).
8. What CI deliberately does not do (non-goals).

## Business rules

- CI verifies exactly the same as the local `pnpm run verify`; no check may be skipped or sugar-coated (`continue-on-error` is forbidden).
- `pnpm install --frozen-lockfile`: a mismatch between `pnpm-lock.yaml` and `package.json` must fail the job.
- The pipeline must not need secrets or a compiler.

## Authorization

`none` (a job without secrets; fork PRs get read-only at most).

## Data / API

No persistent data and no public contracts. The new `.github/workflows/ci.yml` file is the contract for GitHub Actions; `docs/development/ci.md` is a reference document linked from `docs/development/setup.md`.

## Edge cases

- The first run without a warm pnpm cache: it must pass (the cache is only an optimization).
- A PR from a fork: the job runs without secrets (there are none anyway).
- A lockfile mismatch (`--frozen-lockfile`): installation fails, the job is red; the author of the change fixes it.
- A missing N-API prebuild for the platform/Node pair in use: the job fails; according to `docs/development/setup.md` section 5 this is a blocker to analyze, not a reason to install Build Tools.

## Errors

A red job (exit != 0 from lint, typecheck or test) blocks the change: the PR check is required for merging, and a red commit on `main` signals a regression. No silent fallbacks.

## Acceptance criteria

1. `.github/workflows/ci.yml` exists, parses as valid YAML and meets "Behaviour" (triggers, windows-latest, Node 24, pnpm from `packageManager`, cache, `--frozen-lockfile`, `pnpm run verify`, no compiler and no secrets, no `continue-on-error`).
2. `docs/development/ci.md` exists, is in Polish and covers all 8 points of the "Document" section.
3. `docs/development/setup.md` links to `docs/development/ci.md`.
4. The local `pnpm run verify` is green on the working tree with the changes.
5. No app behavior changes: the diff does not touch `src/`.

## Required tests

No new unit tests (the change does not touch app code). Verification: the local `pnpm run verify`, a check that the workflow YAML parses, a review of the document against criteria 2-3. The real proof that the pipeline works (a green run on GitHub) comes after a separately approved push and is not part of this contract.

## Relevant SDD / ADR

- CI system decision: GitHub Actions; it comes from the recorded publication decision of 2026-10-02 (the repository published on GitHub, CI "after publication, in a separate commit", the `windows-latest` runner, `pnpm run verify`). The work item title ("GitLab CI") gives way to this decision; the GitLab alternative stays discussed in `docs/development/ci.md`.
- No separate ADR; the above is the binding record of the decision for this contract.
