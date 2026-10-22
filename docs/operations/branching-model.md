# Branching model: trunk-based hybrid

Decision of 2026-10-02 (work item NEKODE-15). The model is trunk-based hybrid: one permanent `main` branch, short-lived work branches for larger work, and releases as tags on `main`.

## Rules

- `main` is the only permanent branch. It is always green (CI runs on every push to `main` and on every PR) and always releasable.
- Small maintenance changes (fixes, small features): commit directly on `main`. Before pushing, run the recorded verification: `cmd /c pnpm run lint && cmd /c pnpm run typecheck` or the full `cmd /c pnpm run verify`.
- Larger or risky work: a work branch from the current `main`, merged through a PR with green CI. Branch lifetime: target up to about 3 days; split longer work into smaller parts or rebase regularly on `main`.
- Work branch name: `nekode-<number>-<short-description>` (for example `nekode-20-terminal-shell-choice`) when the work has a backlog item; without one: `<short-description>`.
- The maintainer merges. The `main` history stays linear; external PRs are squashed (one commit per PR).
- External PRs target `main`, from contributor forks. They are merged after review and green CI.
- Release: a separate version commit and an annotated semver tag without a `v` prefix, following the [public release procedure](releases.md). Publishing branches and selected tags is explicit. The tag points to the version commit on `main`; there is no `develop` branch.

## Protecting main on GitHub

The repository is public (`github.com:tomaszmadera/NeKode`). Target configuration: a ruleset on `main` that requires a PR and a green CI check for everyone, with a bypass for the administrator, so the maintainer can still commit directly. Turning on the ruleset is a separate action in the repository settings.

## Why not git-flow

Git-flow (main plus develop, merged into main at release) pays off with parallel releases, several people on the team, or a long release stabilization. In NeKode the work is solo, releases are linear, and CI has run on `main` from the start; develop would double the merge of every change and add a second branch to maintain. Revisit this decision when a second active maintainer or parallel release versions appear.

Related: CI is described in [docs/development/ci.md](../development/ci.md).
