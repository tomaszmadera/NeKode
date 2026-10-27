# NeKode releases on GitHub Releases

Path: `docs/features/github-releases/spec.md`.

Behavioral contract of task NEKODE-104. Work progress is kept in the task record, not in the specification.

## Goal

The public `tomaszmadera/NeKode` repository offers ready-to-download releases of the app for Windows and Linux. A user without developer tools downloads the newest version from the "Latest release" page, checks the checksum and installs it. The maintainer creates a release with one tag and checks the built files before publishing.

## Related requirements

- Work item NEKODE-104 (Plane), decisions of 2026-10-22 in a comment on the work item.
- `docs/operations/branching-model.md` (NEKODE-15): releases are tags on `main`.
- `docs/features/ci-pipeline/spec.md` (NEKODE-12): the existing `verify` and `verify-linux` workflow.
- NEKODE-13 (Linux): the scope is Ubuntu 22.04 and 24.04, x64. The maintainer's decision of 2026-10-22 narrows the scope of binary releases to Ubuntu 24.04 and newer: an AppImage built on 24.04 does not start on 22.04 (older glibc). Ubuntu 26.04 will be added later as a test platform, without changing the build system.

## Scope

1. Packaging configuration in `electron-builder.yml` and the `package.json` scripts for Windows (NSIS x64) and Linux (AppImage x64).
2. A `.github/workflows/release.yml` workflow that builds the release files from a tag and creates a draft GitHub Release.
3. Release rules and the procedure in `docs/operations/releases.md`.
4. A download and install section in `README.md`; updates to `docs/development/setup.md` and `docs/development/ci.md`.
5. The first release made with the new process.

## Non-goals

- A background updater, an update check at startup, and any update prompt outside App Settings. The manual Windows update from App Settings is `docs/features/in-app-update/spec.md`.
- Code signing (Windows Authenticode, Linux GPG).
- macOS, ARM, deb, rpm, Snap and Flatpak packages, a portable Windows version.
- Retroactive releases for existing tags (up to and including `0.14.19`).
- A `CHANGELOG.md` file: the GitHub Release notes are the canonical change history.
- Changing the required `verify` check in the `main` branch protection.

## Behaviour

### Release rules

- Every version tag on `main` is a release with Windows and Linux binaries. Exception: a tag whose release run failed because of a defect in the tagged commit, or whose draft the maintainer rejected, stays without a release; its number is not reused, and the fix goes into the next patch version.
- The `main` branch and the tag are pushed atomically (`git push --atomic`), so the tag does not reach origin without the commit on `main`. An infrastructure error or a failure of the `main` ancestry gate caused by the push order allows rerunning the failed jobs of the same run.
- Changes accumulate on `main`; the version is bumped only on the maintainer's explicit request. One release covers all changes since the previous tag. A single fix gets its own release only on the maintainer's request (for example a crash or data loss).
- Tag names are numeric semver without a `v` prefix (for example `0.15.0`), following the existing convention.
- `X.Y.Z` versions without a suffix are regular releases (shown as "Latest"), also during 0.x. The beta status is communicated by the release title, the notes and the README.
- A tag with a semver suffix (for example `0.15.0-rc.1`) creates a release marked as a pre-release.

### Packaging

- Windows: an NSIS x64 installer named `NeKode-Setup-<version>.exe`.
- Linux: an x64 AppImage named `NeKode-<version>-x86_64.AppImage`, built on Ubuntu 24.04 (`ubuntu-24.04`, the same version as `verify-linux`). The minimum system is Ubuntu 24.04 or a distribution with the same or a newer glibc.
- Packaging never publishes by itself: electron-builder runs with `--publish never`, and only the workflow creates a release.
- Local scripts: the existing `build:win` and the new `build:linux` give the same file names as CI.

### Package contents (NEKODE-134)

- Local and CI packages include application files only through `files: [out/**/*, package.json]`. electron-builder adds production dependencies and their runtime dependencies. Source files belonging to required native dependencies are allowed; project source directories are not.
- `dependencies` contains only `better-sqlite3` and `node-pty`. Other application JavaScript dependencies are build dependencies bundled into `out/`, including the renderer libraries and the main process validation library. Native modules remain external and load in the packaged Electron runtime.
- A content check runs automatically during Windows and Linux packaging, before CI uploads a binary. It also accepts an explicit `app.asar` path for local inspection. A missing, unreadable, or malformed archive fails with a diagnostic and a nonzero exit code.
- The check rejects project-root `.agents`, `.claude`, `.codex`, `.grok`, `.opencode`, `src`, `docs`, and `tmp` entries, and `.env` files at any depth. It inspects archive metadata only and never reads or prints environment file contents. A failing check names the offending paths and stops packaging.
- The allowlist also excludes project lockfiles and TypeScript build metadata. The check validates required compiled main, preload, and renderer entry points and the presence of the two native runtime dependencies, so an empty or incomplete archive cannot pass.
- Existing `extraResources` (dictation helper and usage adapters), Windows and Linux icons, NSIS settings, artifact names, `npmRebuild: false`, and Electron fuse behavior remain compatible. Bundled usage adapters require the RunAsNode fuse to stay enabled.
- Verification records the old and new archive sizes in bytes, entry counts, and the size reduction. It runs the packaged Windows app and the app installed by NSIS against an isolated profile and fixture project, verifies SQLite persistence and PTY output, and reaps every process started by the smoke.

### Release workflow

- Trigger: a push of a tag that matches numeric semver (with an optional suffix). In addition, a manual run (`workflow_dispatch`) builds the files as run artifacts, without creating a release.
- Gates before the build; failing any of them stops the workflow without creating a release:
  1. the version in `package.json` in the tagged commit equals the tag name;
  2. the tagged commit is reachable from `main`;
  3. `pnpm run verify` passes on Windows and on Linux.
- The Windows and Linux builds run in parallel. A release is created only when both builds succeeded.
- The release gets: the Windows installer, the AppImage and `SHA256SUMS.txt` with the checksums of both files in the `sha256sum` format.
- The release is created as a draft. The maintainer publishes it by hand after checking the files.
- Release title: `NeKode <version>`. The notes contain the list of commits since the previous tag (without `chore: bump version` commits), grouped by conventional commit type, and a fixed block: the beta status, that an installed Windows build can update from App Settings when a newer release is published, that Linux updates by replacing the AppImage, that there is no background updater, the SmartScreen warning for the unsigned installer, and a link to checksum verification.
- The workflow does not overwrite an existing release or files with the same name.

### Documentation

- `README.md` has a download section with a link to `releases/latest`, install instructions for both systems, the Windows update from App Settings, manual update by replacing the AppImage on Linux, checksum verification and a description of the SmartScreen warning. The Status section stops claiming that there are no ready installers only once the first release is published.
- `docs/operations/releases.md` describes the release rules from this specification and the procedure: bump, tag, tag push, draft check, publication.

## Business rules

- A tag is a release; there is no version without binaries, except for a failed or rejected tag described in "Release rules" (the number is skipped, the fix goes into the next patch version).
- A draft is not a release for users until the maintainer publishes it.
- A pushed tag or a published release is not moved or deleted. A faulty release or a failed tag is fixed with the next patch version; the number of the failed tag is skipped.

## Authorization

- Only the maintainer pushes a tag and publishes a draft.
- The workflow uses `GITHUB_TOKEN` with the `contents: write` permission only in the job that creates the release; the build jobs have `contents: read`. No additional secrets.

## Data / API

- Input: a Git tag, `package.json` (`version`).
- Output: a GitHub Release (draft) with three files: `NeKode-Setup-<version>.exe`, `NeKode-<version>-x86_64.AppImage`, `SHA256SUMS.txt`.

## Edge cases

- The first tag after the rollout: the previous tag is `0.14.19` or a newer existing one; the notes cover the commits since it.
- A tag with a suffix: a release marked pre-release, which does not change "Latest".
- Rerunning the workflow for a tag whose release already exists: the workflow fails with a readable message and overwrites nothing.
- A tag that does not start with a numeric `X.Y.Z` (for example `test`): the workflow does not start; the first gate stops another invalid tag (for example `1.2.3foo`).

## Errors

- A version mismatch, a tag outside `main`, a red `verify`, a failed build on either system: the workflow fails, creates no release and no partial draft, and the message names the failed gate.
- No silent fallbacks: a missing file to upload is an error.

## Acceptance criteria

1. `pnpm run build:win` creates `dist/NeKode-Setup-<version>.exe`; the installer installs and starts the app on Windows 11.
2. `pnpm run build:linux` on Ubuntu 24.04 creates `dist/NeKode-<version>-x86_64.AppImage`; the file starts the app on Ubuntu 24.04 with a terminal working in the session.
3. A manual run of the release workflow produces both files as run artifacts and creates no release.
4. A push of a tag with a version that does not match `package.json` makes the workflow fail without a release.
5. A push of a valid tag creates a draft with three files; the checksums in `SHA256SUMS.txt` match the downloaded files.
6. `docs/operations/releases.md` and `README.md` describe the behavior from this specification.
7. The first release made with the new process is published and shown as "Latest", and the files downloaded from it install and start on both systems.
8. Local Windows packaging produces an archive without the forbidden paths listed in "Package contents (NEKODE-134)"; the same content check gates CI packaging on both platforms.
9. The packaged and installed Windows application starts with its renderer mounted, SQLite persists fixture data, and a real PTY emits expected fixture output. Extra resources and icons are present, and a bundled usage adapter can run through the packaged executable.
10. The NEKODE-134 verification evidence measures the archive size reduction, confirms only the two native direct production dependencies, and includes a passing `pnpm run verify`.

## Required tests

- A local smoke of the Windows installer (criterion 1) and the AppImage (criterion 2).
- A `workflow_dispatch` run (criterion 3) and a run with a deliberately wrong tag on a fork (criterion 4), agreed with the maintainer.
- A smoke of the files downloaded from the published release (criterion 7).
- `pnpm run verify` without regressions.
- Package-content regression cases: clean archive, each forbidden project-root entry, nested `.env`, permitted native dependency source paths, incomplete archive, and missing or malformed input. The archive check must fail against the pre-fix local archive without reading its file payloads.
- NEKODE-134 packaging and runtime checks from acceptance criteria 8-10. No new release or workflow dispatch is required for this packaging change; the local equivalent exercises the CI packaging gate.

## Relevant SDD / ADR

none
