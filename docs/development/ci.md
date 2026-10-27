# CI: automatic verification of changes (GitHub Actions)

## Choosing verification

The [project contract](project-contract.md) defines the contributor's obligations;
[package.json](../../package.json) and [vitest.config.ts](../../vitest.config.ts)
are the source of the current commands and test scope. In the report, give the command,
the exact target, the exit code and the limitations. A failure of any required check blocks
acceptance; a check that was not run is not a pass.

| Command or check | What it confirms and when to use it |
|---|---|
| `pnpm run lint` | Static Biome rules, including the format of supported files; not runtime behavior |
| `pnpm run typecheck` | Types of main/preload/shared and of the renderer; both TypeScript projects |
| `pnpm run test <confirmed-test-path>` | A focused Vitest test of an existing scope; first check the exact file, and after the run the number of selected tests |
| `pnpm run test` | The whole suite: the `node` project for main/preload/shared and `renderer` with jsdom for the renderer |
| `pnpm run verify` | Lint, both typechecks and the whole suite; the local equivalent of the CI gate for code changes |
| `pnpm run format` | Changes file formatting; this is an edit, not a test. Review the result and keep the scope of the change |
| Documentation/links and `git diff --check` | For prose-only changes: links against the public Git inventory, exact letter case, portable paths, consistent rules and no dependency on private records. The diff check alone does not judge content or untracked files |
| Dev, packaged or installer smoke | Real Electron, native modules and ConPTY; [setup](setup.md) defines isolation and teardown |

Choose focused tests for the behavior you change; do not derive a test name
from a module name without checking the inventory. A regression test for a reported defect must
fail without the fix: keep the red result, or revert and restore the fix
before the final verification. An assertion that nothing changed needs proof that the operation
ran. Do not add a test only to repeat the code or the words of the documentation.

For IPC changes, check positive routing and rejection of payload/sender; for the database,
migrations, transactions and integrity; for the terminal, session switching, spawn errors
and closing without orphaned processes. The details have one owner:
[architecture obligations](../architecture/sdd.md#current-implementation-obligations).
Integration, security or broad contract changes need the whole
suite and the matching smoke. Native or packaging changes need real
Electron even when Vitest passes; jsdom is not e2e. For prose-only changes, do not
treat the app tests as proof that the text is correct.

Before acceptance, review the whole final diff and run the required scope after
the last change that could invalidate the result. Do not mask the exit code
with a reporting command. Check integrations against a sandbox or fixture when
one is available; do not use production data. When the environment cannot run
the required smoke, record the target and the reason, and leave the result as not run.

CI (Continuous Integration) is an automated system that, after every submitted change, fetches the repository on a clean machine and runs the checks. Nobody has to remember to run the tests by hand, and an error that shows up on a clean machine is found within a minute, not by someone who has just cloned the project.

This project has one verification pipeline, defined in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). It runs on GitHub Actions (the CI system built into GitHub) and runs exactly the same command you use locally: `pnpm run verify`. The separate release workflow [`.github/workflows/release.yml`](../../.github/workflows/release.yml) is described in the [Release workflow](#release-workflow) section.

## What we check and why

`pnpm run verify` is a set of three checks from `package.json`:

| Check | Command | What it catches |
|---|---|---|
| Lint | `biome check .` | style errors, unused variables, suspicious patterns |
| Typecheck | `tsc --noEmit` (the `node` and `web` projects) | TypeScript type errors before anyone runs the app |
| Tests | `vitest run` | logic regressions (the `node` and `renderer` projects, `jsdom` environment, from `vitest.config.ts`) |

The order matters: lint and typecheck are faster than the tests, so the cheapest errors fail first. All three must pass; one red result ends the whole pipeline.

## When the pipeline runs

Two events trigger CI:

1. **Pull request**: regardless of the source branch. The result shows on the PR page as a check; a red check means "do not merge".
2. **Push to `main`**: a check that the main branch itself is always green.

A new push to the same PR or branch cancels a run that is still in progress (the `concurrency` section in the workflow): we do not spend time checking code that is already outdated. A single run has a 20-minute limit; going over it counts as a failure.

## Which system it runs on

Two jobs run in parallel on every trigger:

- `verify` on `windows-latest`: a Windows virtual machine hosted by GitHub, with Node and Visual Studio Build Tools preinstalled (Build Tools are available, but this project does not need them, see below). This is the **required** check: the protection of the `main` branch requires exactly this name, so the job and its name do not change.
- `verify-linux` on `ubuntu-24.04`: the same `pnpm run verify` on Linux, on the same Ubuntu version as the AppImage build in the [release workflow](#release-workflow). For now this check is **advisory**: branch protection does not require it, but a red result still has to be explained before merging.

Why Windows, when most projects choose Linux? NeKode is a Windows-first project: the target platform is Windows 11, the native modules have verified `win32-x64` prebuilds, and the tests check behavior specific to this environment (ConPTY, paths). CI should mirror the environment where the app actually runs. The Linux job (phase 0 of the Linux version plan) keeps the code and tests from drifting toward Windows-only; it does not replace the Windows job, because a green Linux run proves nothing about Windows. Windows-specific tests (WSL, PowerShell/cmd candidates) are skipped on Linux (`skipIf`), and paths in fixtures go through `hostPath` (`src/main/test-support/host-path.ts`), which returns the literal unchanged on Windows.

## Why without VS C++ Build Tools

The native modules (`better-sqlite3`, `node-pty`) use ready N-API binaries instead of compiling. The build policy is recorded in `pnpm-workspace.yaml` (the `allowBuilds` section) and is tracked by git, so CI gets it automatically:

- `better-sqlite3: false`: the package has built-in prebuilds (including `win32-x64.node`); a forced `node-gyp` is unnecessary and would fail without Build Tools.
- `node-pty: true`: the install script only moves the prebuilds to the place the runtime expects.
- `electron`: has no install scripts; the binaries are downloaded only on the first app start, which CI does not do.

The practical result: `pnpm install` in the Windows job compiles nothing, so this job does not depend on a compiler.

Exception: the `verify-linux` job. `node-pty` 1.1.0 has no Linux prebuilds, so the job installs `build-essential` and `python3` and then compiles the module from source (`pnpm rebuild node-pty`, a few seconds; the module is N-API, so the same binary works in Node and in Electron). This is a deliberate decision for Linux, described in [setup.md](setup.md) (the "Native modules" section). If an error such as "Could not find any Visual Studio installation" or "NODE_MODULE_VERSION" ever appears on CI, it means someone added a dependency without prebuilds: that is a blocker to analyze according to [setup.md](setup.md) (the "Native modules" section), not a reason to add Build Tools to the pipeline.

## pnpm cache

The `actions/setup-node` step with the `cache: pnpm` option keeps the pnpm package store between runs. After a change to `pnpm-lock.yaml`, only new packages are downloaded. The first run (and every run after the cache key changes) is slower, because it downloads everything from scratch; that is normal. The cache is an optimization: its absence never changes the result.

Installation always runs with `--frozen-lockfile`: if `pnpm-lock.yaml` does not match `package.json`, installation fails immediately. This is intended: a dependency mismatch must be fixed in a commit, not ignored.

## GitHub Actions vs GitLab CI

Both systems do the same thing (continuous verification); they differ in the integration with repository hosting, the pipeline definition and runner availability:

| Feature | GitHub Actions (current choice) | GitLab CI |
|---|---|---|
| Repository hosting | the origin of this project: `github.com:tomaszmadera/NeKode` | needs a repository on GitLab (push mirror from GitHub or a move) |
| Pipeline file | `.github/workflows/*.yml` | `.gitlab-ci.yml` in the root directory |
| Definition | jobs with a list of `steps` (uses/run) | `stages` and scripts per job |
| Windows runners | `windows-latest` available right away, free for a public repository | shared Windows runners on GitLab.com have limited availability (beta, limited availability); in practice you attach your own machine (self-hosted) |
| Initial setup | none: the workflow in the repository works after a push | a GitLab account, a mirror, possibly your own runner |

The recommendation stays GitHub Actions while the repository lives on GitHub: the pipeline lives next to the code, runs without any extra configuration and is free for a public repository. The cost of a possible move to GitLab is small: `ci.yml` is about 70 lines, and `pnpm run verify` carries over 1:1; the real work is the mirror and the Windows runner.

## How to read the result

- The **Actions** tab on GitHub: a list of runs, each with the commit name and status (green check mark = ok, red cross = error).
- On a PR: the **Checks** section shows the `verify` (required, Windows) and `verify-linux` (advisory) jobs; clicking a job shows the log step by step.
- Marks next to commits in the history: a check mark or cross next to the hash.

On a red run: open the log, find the first step with an error (the step order matches the diagnosis order: checkout, pnpm, Node, install, verify), and then reproduce the same command locally (`pnpm run verify`). CI uses a clean machine, so a red result without a local reproduction usually means a lockfile mismatch (`--frozen-lockfile`), a missing prebuild or a system difference.

## Release workflow

[`.github/workflows/release.yml`](../../.github/workflows/release.yml) builds the release files and is independent of `ci.yml`; the required `verify` check on `main` does not change. The release rules and procedure are described in [releases.md](../operations/releases.md).

- Trigger: a push of a tag with numeric semver without a `v` prefix (for example `0.15.0` or `0.15.0-rc.1`). A tag that does not start with a numeric `X.Y.Z` (for example `test`) does not start the workflow; the gate stops other invalid tags (for example `1.2.3foo`).
- Gates before the build: the tag equals `version` in `package.json` of the tagged commit, the tagged commit is reachable from `main` (both are checked by `node scripts/release.mjs gate`), and `pnpm run verify` passes on Windows and on Linux.
- The Windows build (`pnpm run build:win`) and the Linux build (`pnpm run build:linux`, Ubuntu 24.04) run in parallel; electron-builder runs with `--publish never`.
- Both builds run the `scripts/check-package.cjs` `afterPack` hook before creating distributables or uploading artifacts. The hook rejects forbidden ASAR content and incomplete packages; its regression tests run in `pnpm run verify`. See [package contents](../features/github-releases/spec.md#package-contents-nekode-134) and the [local inspection and smoke commands](setup.md#3-installation-and-smoke-tests).
- The `Create draft release` job runs only for a tag push and only when both builds succeeded. It creates a draft `NeKode <version>` with `NeKode-Setup-<version>.exe`, `NeKode-<version>-x86_64.AppImage` and `SHA256SUMS.txt`, and notes from the commits since the previous tag. It does not overwrite an existing release. The maintainer publishes the draft by hand.
- Permissions: only `GITHUB_TOKEN`; only the draft job has `contents: write`, the other jobs have `contents: read`.
- A manual run (`workflow_dispatch`, for example `gh workflow run release.yml --ref main`) builds both files as run artifacts (`windows-installer`, `linux-appimage`) and does not create a release.

## What CI deliberately does not do

- The `ci.yml` workflow does not build the installer (`build:win`), the AppImage (`build:linux`) or the package (`build:unpack`): the verification pipeline should be fast, and the release files are built by the [release workflow](#release-workflow).
- `ci.yml` does not make releases or publish artifacts: releases are created only by the release workflow from a tag.
- It does not run on macOS: there is no target support. Linux has the advisory `verify-linux` job (see above).
- It does not run harness scripts (`.agents/` is not part of the published repository).
- The README has a latest-release badge, but no CI status badge: one can be added with one line.
