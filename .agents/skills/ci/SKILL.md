---
name: ci
description: Use when performing Git operations, versioning, releases, or deployments (commit, checkpoint, push, release, tag, deploy, bump).
---

# CI & Git Operations

Use this skill for all continuous integration, Git version control actions, SemVer versioning, automated releases, and deployments.

## Principles

1. **Unified Versioning:** Both `bump` and `tag` update project manifests and create the annotated Git tag and commit.
2. **Dirty Worktree Safety:** Never run `release` or `deploy` with uncommitted changes unless explicitly authorized via `--allow-dirty`.
3. **Safe Rollback:** Merge conflicts or quality gate failures during release automatically abort without corrupting the working tree.
4. **Explicit Authorization:** Commit, push, release, and deploy require clear scope and user intent.
5. **No Force Push:** Push operations verify remote refs and upstream tracking without force-pushing.

## Execution

Use the session-cached project profile. Read `.agents/project-profile.yaml` only when it has not yet been loaded in this session or repository evidence shows that it changed. Run the recorded `commands.ci` with the selected subcommand and options.

Subcommands: `commit`, `checkpoint`, `bump`, `tag`, `push`, `finish`, `release`, `deploy`, `status`, `publication-status`. Read exact flags by running `commands.ci` with `--help` or `<subcommand> --help`; this skill does not restate them.

For a completion offer, follow `references/publication.md`. It owns sequence selection and the accepted-sequence loop.

- `commit` for a scoped change with a conventional message. For a dirty pause or handoff, follow `handoff`; do not use `checkpoint` for that case.
- `bump` and `tag` are the same versioning path; pass `patch`, `minor`, `major`, or an explicit version, or `get` to inspect the current one.
- Preview `bump`, `release`, and `deploy` with `--dry-run` before the real run.
- `release` auto-detects the branch flow; use its explicit target or no-merge options instead of running Git steps by hand.
- `deploy` takes the target environment as its argument and runs the pre-deploy checks; do not bypass it with ad-hoc commands.
