# Completion publication

Use after recorded `publication-status --json` returns for a successful `Done` response. The command reports facts and does not recommend an action. Relate those facts to current-task evidence. If facts are incomplete or contradictory, report the uncertainty and make no offer.

`Done` means the requested task is complete. It does not claim a clean worktree, a current version, published refs, or a deployed environment.

## First-offer configuration

If `publication.strategy` or `publication.versioning` is `not-configured`, ask one unnumbered configuration question with numbered response options after `Done` and before any action. Offer only valid remaining values. If both are missing, the only combined choices are:

1. `linear` with semver
2. `linear` without versioning
3. `git-flow` with semver

The answer authorizes only that scoped profile update. Persist it, rerun publication status, and then offer the complete publication sequence separately.

## Selection

Distinguish task-owned changes and commits from unrelated or pre-existing worktree state. Select the complete remaining publication sequence through the last applicable Git or deployment action whose exact scope can be named. Do not stop at the first action when later steps follow deterministically from the configured strategy.

Actions that may be offered: `commit` (user alias `checkpoint`), `bump`, `push`, `finish`, `release`, `deploy test`, and `deploy prod`. `tag` is never a separate offer; `bump` creates the annotated semver tag. `checkpoint` in this conversation means scoped `commit`; never run `ci checkpoint` for the publication offer.

`push` is legal in both strategies when the user names it. It pushes the selected current branch and explicitly included unpublished local semver tags. It does not stand in for `finish` or `release`. `finish` and `release` are git-flow-only. `bump` is linear-only. Git-flow requires semver.

Apply these rules in order:

1. If the current task owns uncommitted files, put a scoped `commit` for exactly those files first. Do not include unrelated staged, unstaged, or untracked paths. If ownership cannot be established, report the uncertainty and do not offer to commit those paths.
2. If the current task made no repository change, do not offer `commit`, `bump`, `finish`, or `release` solely because older repository state exists. Report unrelated dirty paths so `Done` does not imply a clean worktree.
3. For `linear`, include `bump` when `publication.versioning` is `semver` and the current or planned task commit is not included in a local semver tag. Name the candidate version. When versioning is `none`, omit `bump`.
4. For `linear`, include `push` when the task branch or a semver tag already exists only locally or will be created by an earlier step in the sequence. Name the remote branch and tag refs.
5. For `git-flow`, include `finish` after the task commit when work is on a feature branch, then include `release`. Work already on develop omits `finish` and includes `release`. Name the affected branches and candidate version.
6. After required Git publication, append every configured deployment target that is relevant to the task and can be named exactly. When both test and prod apply, order test before prod. Do not infer an unconfigured target.
7. Include only actions that will remain legal after the preceding listed steps. If unrelated dirty state or another known blocker prevents a later action, show the full intended sequence and blocker, but offer only the longest executable prefix. Require a new answer after the blocker is resolved.
8. If no action applies, make no offer. If unrelated dirty paths exist, report them without presenting them as work completed by this task.

A read-only analysis or review does not cause `bump` or another task publication action.

## Ask and execute

When a sequence applies:

1. Ask one unnumbered question with numbered response options. Put the complete recommended sequence, or the longest executable prefix under rule 7, in the first option and include decline. Add shorter safe-prefix options only when they are useful.
2. Name every action in execution order and give its exact file scope, Git refs and remote, semver, and deploy targets supplied by publication status or determined by an earlier listed step. Explain why the sequence applies to this task.
3. An unanswered or declined offer leaves the completion status as `Done`.
4. Selecting an option authorizes every action in that sequence and only the stated scopes. It does not authorize an omitted action or a changed scope.
5. Before the first mutation and before each later action, confirm the applicable authorization, rerun publication status, and verify that the next scope still matches the accepted sequence and the preceding results. Do not ask again while it still matches.
6. Stop at the first failure, legality refusal, or scope, ref, version, remote, or target change. Report completed and remaining actions, then require a fresh answer for any revised sequence.
7. Preview `bump` and `deploy` with `--dry-run`. Preview `push` when supported. Execute every accepted action only through recorded `commands.ci`.
8. After the full sequence succeeds, rerun publication status. Offer another sequence only for an action that became applicable and could not be named in the accepted option.
9. If the user names an action or sequence instead of accepting an option, evaluate it through the same task-scope and safety rules. Let each action command perform final legality checks and honor its refusal.

If the user replies `checkpoint`, treat it as scoped `commit`.
