# Releases

This is the maintainer's public release procedure. It uses Git, the package manifest, and public pnpm scripts, with no local agent harness. The [branching model](branching-model.md) owns integration; releases are tags on `main`. Perform publication only after explicit authorization for the exact change files, version, branch, remote, and selected tags.

## Prerequisites

Run commands from the repository root. The examples use PowerShell and remote `origin`; confirm the configured destination with `git remote get-url origin`. Stop after any non-zero command, mismatched object id, conflicting tag, unexpected staged path, or changed authorization scope. Check `$LASTEXITCODE` immediately after each native command; do not paste a sequence that continues after failure.

Replace every `<...>` placeholder with the approved real value before executing a command, and quote paths containing spaces. The blocks are a reviewed sequence of individual steps, not a script with automatic error handling.

```powershell
git branch --show-current
git status --short
git diff
git diff --cached
```

Inspect and separate unrelated work. Use the [verification guidance](../development/ci.md#dobór-weryfikacji) for the change; code changes require the appropriate focused checks and `pnpm run verify`, and native/packaging changes also require real Electron/package smoke. Prose-only changes need document/link/reference checks. Record commands and exits before creating a scoped change commit. A failed check blocks publication; no bypass is part of this runbook.

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

On the resulting verified `main`, require a clean worktree and select the approved semver. Existing tags use numeric names such as `0.12.6`, without a `v` prefix. Increment patch for a compatible fix, minor for compatible added functionality, and major for an incompatible release, with an explicit maintainer decision during the pre-1.0 period. Inspect the current manifest and local/remote tags before choosing a version.

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

If `origin/main` does not exist locally, use the actual remote branch result. Require the remote tag to be absent, or already match both the local annotated tag object and peeled commit. Push the branch and only the selected tag as explicit refspecs:

```powershell
git push origin refs/heads/main:refs/heads/main refs/tags/<version>:refs/tags/<version>
git ls-remote origin refs/heads/main
git ls-remote --tags origin 'refs/tags/<version>' 'refs/tags/<version>^{}'
```

Confirm remote `refs/heads/main` equals the recorded local source commit, remote `refs/tags/<version>` equals the local annotated tag object, and the remote peeled tag equals the version commit. A reachable commit does not prove the tag was published. Do not use `--tags` to publish unrelated tags. If both refs already match, skip the redundant push. After any partial failure, inspect branch and tag separately; retry only the missing authorized ref with unchanged object ids. Green CI on the published `main` is the final integration check; a failing run needs diagnosis and a forward fix, not tag movement or history rewriting.

## Build artifacts

Git tag publication does not build or upload an installer or create a GitHub Release. For an explicitly requested Windows artifact, build from the tagged version with `pnpm run build:win`, test the installer following [setup](../development/setup.md#uruchomienie-instalatora--test-instalacji), and name the tested commit/version in the result. Artifact upload, deployment, and GitHub Release creation are separate authorized actions. CI currently runs checks and does not publish artifacts.
