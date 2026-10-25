# Releases

This is the maintainer's public release procedure. It uses Git, the package manifest, and public pnpm scripts, with no local agent harness. The [branching model](branching-model.md) owns integration; releases are tags on `main`. Perform publication only after explicit authorization for the exact change files, version, branch, remote, and selected tags.

NeKode releases are GitHub Releases in `tomaszmadera/NeKode` with a Windows installer and a Linux AppImage. Pushing a version tag starts [`.github/workflows/release.yml`](../../.github/workflows/release.yml), which builds both files and creates a draft release; the maintainer publishes the draft by hand. The behavioral contract is [`docs/features/github-releases/spec.md`](../features/github-releases/spec.md).

## Release policy

- Every version tag on `main` is a release with Windows and Linux binaries. One exception: a pushed tag whose release run failed because of a defect in the tagged commit, or whose draft the maintainer rejected, stays without a release. Its number is never reused, and the fix ships in the next patch version.
- `main` and the tag are pushed atomically (`git push --atomic`), so the tag never reaches `origin` without its commit on `main`.
- Changes accumulate on `main`. The version is bumped only when the maintainer explicitly requests a release, and one release includes all changes since the previous tag. A single fix gets its own release only when the maintainer requests it (for example a crash or data-loss fix).
- Tag names are numeric semver without a `v` prefix, for example `0.15.0`.
- A version `X.Y.Z` without a suffix is a regular release and becomes "Latest", also during 0.x. The release title, the notes, and the README communicate the beta status.
- A tag with a semver suffix, for example `0.15.0-rc.1`, creates a release marked as pre-release. It does not change "Latest".
- A draft is not a release for users until the maintainer publishes it.
- A pushed tag and a published release are never moved or deleted. A faulty release or a failed tag is fixed by the next patch version, and the failed tag's number is skipped.
- Only the maintainer pushes a release tag and publishes a draft.
- There is no `CHANGELOG.md`. The GitHub Release notes are the canonical change history.
- Releases are not code signed. An installed Windows build can update from App Settings. Linux updates by replacing the AppImage. There is no background updater.

## Release files

| File | Platform | Built on |
|---|---|---|
| `NeKode-Setup-<version>.exe` | Windows x64, NSIS installer | Windows (`windows-latest`) |
| `NeKode-<version>-x86_64.AppImage` | Linux x64, AppImage | Ubuntu 24.04 |
| `SHA256SUMS.txt` | both | the draft job, in `sha256sum` format |

The AppImage runs on Ubuntu 24.04 x64 or a distribution with the same or a newer glibc. The local scripts `pnpm run build:win` and `pnpm run build:linux` produce the same file names in `dist/`. Both run electron-builder with `--publish never`, so packaging never publishes; only the release workflow creates a release.

## Prerequisites

Run commands from the repository root. The examples use PowerShell and remote `origin`; confirm the configured destination with `git remote get-url origin`. Stop after any non-zero command, mismatched object id, conflicting tag, unexpected staged path, or changed authorization scope. Check `$LASTEXITCODE` immediately after each native command; do not paste a sequence that continues after failure.

Replace every `<...>` placeholder with the approved real value before executing a command, and quote paths containing spaces. The blocks are a reviewed sequence of individual steps, not a script with automatic error handling.

```powershell
git branch --show-current
git status --short
git diff
git diff --cached
```

Inspect and separate unrelated work. Use the [verification guidance](../development/ci.md#choosing-verification) for the change; code changes require the appropriate focused checks and `pnpm run verify`, and native/packaging changes also require real Electron/package smoke. Prose-only changes need document/link/reference checks. Record commands and exits before creating a scoped change commit. A failed check blocks publication; no bypass is part of this runbook.

## Change commit and integration

Stage only the authorized paths. Replace the example paths and message with the reviewed scope:

```powershell
git add -- <approved-path-1> <approved-path-2>
git diff --cached --name-only
git diff --cached --check
git diff --cached
git commit -m '<type>: <description>'
git show --stat --oneline HEAD
git show --format=fuller --name-only HEAD
```

Confirm the commit contains all and only the approved changes. Larger work reaches `main` through a reviewed PR with green CI; external PRs are squashed by the maintainer. Small maintainer work can be committed on `main` after local verification. Do not release a work-branch commit. Finish approved integration before the next steps; neither merge nor rebase is implicitly authorized here.

## Version commit and annotated tag

On the resulting verified `main`, require a clean worktree and select the approved semver. Bump only on the maintainer's explicit release request (see [Release policy](#release-policy)), and list the commits since the last tag with `git log --oneline <previous-tag>..HEAD` to choose the version from the most significant change. Existing tags use numeric names such as `0.14.0`, without a `v` prefix. For a pre-release, use a suffixed version such as `0.15.0-rc.1` in both `package.json` and the tag. Increment patch for a compatible fix, minor for compatible added functionality, and major for an incompatible release, with an explicit maintainer decision during the pre-1.0 period. Inspect the current manifest and local/remote tags before choosing a version.

```powershell
git branch --show-current
git status --short
git tag --list
git ls-remote --tags origin 'refs/tags/<version>' 'refs/tags/<version>^{}'
```

Require `main`, a clean worktree, and no existing local or remote tag with the selected name. Edit only `version` in `package.json` to that approved numeric semver. `pnpm-lock.yaml` currently has no root package version field; do not regenerate dependency resolutions for a version-only change. If future manifests acquire a version field, update and review those fields in the same version commit. Keep the version change separate from the contribution commit.

```powershell
git diff -- package.json
git add -- package.json
git diff --cached --name-only
git diff --cached --check
git diff --cached
git commit -m 'chore: bump version to <version>'
git tag -a <version> -m 'Release <version>'
git show --format=fuller --stat HEAD
git cat-file -t refs/tags/<version>
git rev-parse refs/tags/<version>
git rev-list -n 1 <version>
git rev-parse HEAD
```

Confirm the version commit changes only the manifest version, the tag object type is `tag` (annotated), and the tag's peeled commit is that version commit. Check the manifest on the tag with `git show <version>:package.json`. A tag failure leaves the version commit intact; inspect state before any retry. Never overwrite or move a conflicting or published tag.

## Publish exact refs

Before pushing, compare local `HEAD`, `refs/remotes/origin/main` when available, and the actual remote branch. Inspect any unpublished commits and ensure the remote branch is an ancestor of the local source. If the remote differs from the expected base, stop and resolve it; do not force push. Record the actual remote commit id and use `git merge-base --is-ancestor <remote-main-oid> HEAD` (exit 0 required). If remote-tracking evidence is stale, an explicitly authorized fetch can refresh it; do not rely on stale tracking alone.

```powershell
git rev-parse HEAD
git for-each-ref --format='%(objectname)' refs/remotes/origin/main
git ls-remote origin refs/heads/main
git ls-remote --tags origin 'refs/tags/<version>' 'refs/tags/<version>^{}'
```

If `origin/main` does not exist locally, use the actual remote branch result. Require the remote tag to be absent, or already match both the local annotated tag object and peeled commit. Push the branch and only the selected tag as explicit refspecs in one atomic push, so either both refs update or neither does:

```powershell
git push --atomic origin refs/heads/main:refs/heads/main refs/tags/<version>:refs/tags/<version>
git ls-remote origin refs/heads/main
git ls-remote --tags origin 'refs/tags/<version>' 'refs/tags/<version>^{}'
```

Confirm remote `refs/heads/main` equals the recorded local source commit, remote `refs/tags/<version>` equals the local annotated tag object, and the remote peeled tag equals the version commit. A reachable commit does not prove the tag was published. Do not use `--tags` to publish unrelated tags. If both refs already match, skip the redundant push. If the atomic push fails, inspect branch and tag separately to confirm neither changed, resolve the cause, and retry the same atomic push with unchanged object ids. Green CI on the published `main` is the final integration check; a failing run needs diagnosis and a forward fix, not tag movement or history rewriting.

## Release workflow

The tag push starts the release workflow. Follow it in the **Actions** tab under **Release**. The jobs run in this order, and any failure stops the run without creating a release or a partial draft:

1. `Validate release ref` (`node scripts/release.mjs gate`): the tag is numeric semver, the tag equals `version` in `package.json` at the tagged commit, and the tagged commit is reachable from `main`. The atomic push in [Publish exact refs](#publish-exact-refs) puts `main` and the tag on `origin` together, so the tagged commit is on remote `main` when the run starts.
2. The two `Verify` jobs (Windows and Linux): `pnpm run verify` and the release script tests on both systems.
3. `Build (win)` and `Build (linux)`: start after both verifications pass, run in parallel, and upload the named binaries. A missing file is an error.
4. `Create draft release`: runs only for a tag push and only when both builds succeeded. It refuses to overwrite an existing release for the tag, writes `SHA256SUMS.txt`, and creates a draft titled `NeKode <version>` with the three files. A suffixed version is marked as pre-release.

The notes list the commits since the previous version tag, without `chore: bump version` commits, grouped by conventional commit type. A fixed block states the beta status, that an installed Windows build can update from App Settings, that Linux updates by replacing the AppImage, that there is no background updater, that Windows SmartScreen may warn about the unsigned installer, and links to `SHA256SUMS.txt` and to this document for [checksum verification](#verify-checksums).

The workflow uses only `GITHUB_TOKEN`: `contents: read` for every job except the draft job, which has `contents: write`. It needs no other secrets. The required `verify` check on `main` is unchanged; the release workflow is separate from [CI](../development/ci.md).

A tag that does not start with a numeric `X.Y.Z` (for example `test`) does not start the workflow; other invalid tags (for example `1.2.3foo`) fail the first gate. A failed run names the failed gate in its log. Re-run the failed jobs of the same run only for an infrastructure failure, or for a `main` ancestry gate failure caused by push order. For a defect in the tagged commit, do not move or delete the tag: it stays without a release, its number is skipped, and the fix ships in the next patch version.

### Build without a release

To check packaging before tagging, start the workflow by hand on `main`: **Actions**, **Release**, **Run workflow**, or `gh workflow run release.yml --ref main`. A manual run checks that `package.json` has a valid version, verifies on both systems, and uploads the files as the run artifacts `windows-installer` and `linux-appimage`. It never creates a release and produces no `SHA256SUMS.txt`.

## Inspect and publish the draft

Open the draft from the run summary or the repository **Releases** page. Before publishing:

1. Confirm the title is `NeKode <version>`, the tag is the selected version, and the pre-release flag is set only for a suffixed version.
2. Confirm the draft has exactly `NeKode-Setup-<version>.exe`, `NeKode-<version>-x86_64.AppImage`, and `SHA256SUMS.txt`.
3. Review the notes; edit them if a commit subject needs context.
4. Download the files, [verify the checksums](#verify-checksums), and smoke test the installer on Windows 11 and the AppImage on Ubuntu 24.04 following [Download and install](../../README.md#download-and-install).

Publish the draft with **Publish release**. A regular version then shows as "Latest". Do not publish a draft whose files fail inspection. The rejected tag stays without a release and its number is skipped; fix the defect on `main` and release the next patch version.

## Verify checksums

`SHA256SUMS.txt` has one `sha256sum` line per release file. Download it into the directory that holds the downloaded release files.

On Linux:

```sh
sha256sum --check --ignore-missing SHA256SUMS.txt
```

Each downloaded file must report `OK`.

On Windows, in PowerShell:

```powershell
Get-FileHash .\NeKode-Setup-<version>.exe -Algorithm SHA256
Select-String -Path .\SHA256SUMS.txt -Pattern 'NeKode-Setup-'
```

The `Hash` value must equal the hash on the installer line of `SHA256SUMS.txt`. PowerShell prints the hash in uppercase and the file has lowercase; compare the characters, not the case. Do not install a file whose checksum differs.

## Local packaging

On Windows, `pnpm run build:win` builds `dist/NeKode-Setup-<version>.exe`; test the installer following [setup](../development/setup.md#running-the-installer--install-test). On Linux, run `pnpm rebuild node-pty` after `pnpm install`, then `pnpm run build:linux` builds `dist/NeKode-<version>-x86_64.AppImage`. Local builds are for testing; release files come only from the release workflow.
