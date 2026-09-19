# Safety and authorization policy

## Destructive and external operations

- Example files are safe. The secrets prohibition also covers printing credentials and private keys.
- Do not run destructive filesystem, database, migration, Docker-volume, deployment, or production commands without explicit authorization and an exact target, because these actions can destroy data or state that no retry restores.
- Do not commit, push, force-push, merge, rebase, deploy, open a pull request, or contact an external system unless requested or covered by an explicit user-controlled standing authorization defined in this policy for the named operations and data scope. Credentials and hooks alone are not authorization. Publication creates effects outside the repository that the user cannot locally undo. For an operation not already covered by such authorization, propose each exact action and scope, explain why, and ask for approval. One answer may authorize an explicitly listed sequence; stop before any omitted or changed action. Keep requested commits scoped and never rewrite unrelated history. A request for only a commit never implies push.
- Keep irreversible actions and external side effects under explicit human control.
- Treat hooks as defense in depth, not a complete security boundary. A blocked action requires user authorization before a narrowly scoped override.

## Automatic task reporting authorization

`AGENT_TASKS_AUTO_REPORT=1` in this repository's user-controlled, Git-ignored `.agents/.env` grants standing authorization for automatic task snapshot POSTs only for the canonical `task-report` event after a successful write to `.agents/tasks/<id>/task.md` and for its session-end safety net. The authorized destination is only the `/api/v1/agent-tasks/snapshot` endpoint derived from the explicit `AGENT_TASKS_API_URL` or `HUB_URL` in that same file; the localhost default and CLI overrides are not covered. The authorized data is only the complete JSON snapshot produced for this repository by `.agents/scripts/task-status --json`, including its project metadata and task records. No other repository files, payloads, endpoints, or external contacts are authorized.

Any other or missing value leaves automatic reporting unauthorized. The configured token is a credential, not authorization or an expansion of this scope. This standing authorization does not cover manual reporting, which still requires a current user request.

## Handoff checkpoint authorization

The user's choice to start or continue repository work under this harness grants standing authorization for `handoff` create mode to make exactly one local checkpoint commit containing all and only changes owned by the current task, including its task-record updates. This authorization exists before and independently of the stop, pause, transfer, or context-succession event that triggers handoff; that event does not create or broaden it. No additional approval is required while the operation remains within this exact scope.

The checkpoint must use the recorded scoped commit mechanism required by handoff with explicit task-owned paths. It does not authorize a whole-worktree checkpoint, unrelated or inseparable user changes, push, force-push, merge, rebase, tag, release, deploy, or history rewrite. If the task-owned changes cannot be separated safely, preserve them uncommitted and report the blocked checkpoint.

## Git publication checks

- Before an authorized commit, tag, or push, record the exact paths or refs in scope and inspect the relevant diff.
- Verify a created commit or tag from its object and included paths.
- Before a branch push, compare the local source commit, its remote-tracking ref when present, and the actual remote branch ref.
- Before a tag push, compare the local tag object with the exact remote tag ref; remote reachability of its commit is not tag publication.
- After push, verify the same actual remote ref.
- If another process already published or changed the target ref, do not issue a redundant, conflicting, or force push. Report the observed object ids and remaining uncertainty.
- After any release failure, verify the branch ref and the tag ref independently. Never rewrite a published tag through rebase or tag movement.

## Privilege boundaries

- Assume administrator privileges are unavailable. If the best solution requires a privileged command or the preferred install, give the exact action and ask the user to perform it.
- Use a non-privileged alternative without asking only when it is equivalent or better; do not switch installation scope, download source, package source, or tool merely to avoid authorization.

## Canonical guidance changes

Do not modify `AGENTS.md`, `.agents/engineering.md`, `.agents/safety.md`, canonical workflows, or canonical skill contracts as self-improvement without explicit user approval; these files are shared agent contracts.
