# Git Sync Button in Status Bar

Status: Draft (feature specification).
Path: `docs/features/git-sync-button/spec.md`.

This file is the behavioral contract for a feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

## Goal

Provide a one-click "Sync" action in the status bar for the currently active project that runs a full git sync (`git pull --no-edit`, `git push`, `git push --tags`), with clear in-progress feedback and error reporting.

Target user: A developer working in NeKode who wants to synchronize local work with the remote repository quickly without opening a separate terminal tab or typing git commands manually.

## Related requirements

- Task NEKODE-1: Sync button in the status bar (user request 2026-10-01).
- `docs/features/center-layout-tabs-actions/spec.md` §18 (status bar layout and project context).
- `docs/UX-UI.md` §14-16 (status bar presentation and git status).

## Scope

- Main process: `GitService.sync(projectId)` method executing `git pull --no-edit`, `git push`, and `git push --tags` sequentially against the project path (supporting Windows native and WSL distributions via `execFileRunner`).
- IPC contract: `IPC_CHANNEL.gitSync` (`git:sync`), validated with `['string']` (project ID), exposed over the preload bridge as `window.app.git.sync(projectId): Promise<void>`.
- Renderer UI: A "Sync" button located in the Git section of `StatusBar.tsx`, immediately next to the Git branch and worktree status indicator.
- Execution feedback: While sync is running, the button displays a spinning/busy state and is disabled to prevent concurrent executions.
- Post-sync update: Upon completion (whether success or error), the status bar triggers an immediate refresh of Git status (`app.git.getStatus(projectId)`).
- Error handling: If any git step fails (non-zero exit code), execution stops immediately; subsequent steps are not executed. The error message from stderr (or stdout) is surfaced via the standard application notice banner.

## Non-goals

- Background auto-sync or timer-based periodic sync.
- Conflict resolution UI or interactive merge/rebase tools.
- Staging, committing, or discarding changes from the status bar.
- Selecting specific remotes or target branches; sync strictly acts on the current branch and its configured tracking upstream.

## Behaviour

1. The Sync button is displayed in the bottom status bar inside the Git section, immediately next to the Git branch and worktree status indicators.
2. The Sync button is visible only when an active project is loaded and has a valid Git repository (`status.branch !== null`). When no project is active, or the active project has no Git repository ("no git" state), the Sync button is not rendered.
3. Clicking the Sync button triggers synchronization:
   - The button enters an in-progress state: icon turns into a spinner (e.g. `Icon.running` / spinning `RefreshCw`), and the button becomes disabled.
   - The renderer invokes `app.git.sync(projectId)`.
4. In the main process:
   - Resolves the project's path.
   - Runs `git pull --no-edit`. If it exits with non-zero code, execution halts and throws an `AppError` carrying the trimmed stderr/stdout message.
   - Runs `git push`. If it exits with non-zero code, execution halts and throws an `AppError`.
   - Runs `git push --tags`. If it exits with non-zero code, execution halts and throws an `AppError`.
5. On completion:
   - If successful, the button returns to its idle state, and `app.git.getStatus(projectId)` is called to refresh branch ahead/behind counters and worktree status.
   - If an error occurs, the button returns to its idle state, the error message is displayed on the workspace notice banner, and `app.git.getStatus(projectId)` is still refreshed (so any conflicts or pulled changes are accurately reflected in the status bar).
6. Clicking the button while a sync is already in flight for that project is prevented by the disabled state. The service rejects a concurrent sync for the same project with a `conflict` error, allows other projects to sync independently, and releases the project lock on every outcome.

## Business rules

1. Sequential execution: `git pull --no-edit` -> `git push` -> `git push --tags`. Any non-zero exit code immediately halts the sequence.
2. Platform compatibility: Uses `execFileRunner` so that WSL paths are dispatched through `wsl.exe --distribution ... --exec git` and Windows paths are dispatched directly to `git`.
3. Timeouts: Each command execution respects `GIT_TIMEOUT_MS` (15,000 ms) and `GIT_MAX_BUFFER_BYTES` (16 MB).
4. Unmerged/dirty worktrees: `git sync` does not stash or force-modify uncommitted files. If `git pull --no-edit` or `git push` fails due to local changes, conflicts, or missing upstream, Git's honest exit message is surfaced to the user.

## Authorization

`none`. Local single-user desktop application.

## Data / API

### Shared IPC contract (`src/shared/ipc-contract.ts`)

```typescript
export const IPC_CHANNEL = {
  ...
  gitSync: 'git:sync',
} as const

export interface AppApi {
  ...
  git: {
    getStatus(projectId: string): Promise<GitStatus>
    fileStatuses(projectId: string): Promise<GitFileStatuses>
    sync(projectId: string): Promise<void>
  }
}
```

### Preload bridge (`src/preload/app-api.ts`)

```typescript
git: {
  getStatus: (projectId) => invoke<GitStatus>(IPC_CHANNEL.gitStatus, projectId),
  fileStatuses: (projectId) => invoke<GitFileStatuses>(IPC_CHANNEL.gitFileStatuses, projectId),
  sync: (projectId) => invoke<void>(IPC_CHANNEL.gitSync, projectId),
}
```

## Edge cases

1. **No upstream configured**: `git push` or `git pull --no-edit` exits non-zero (e.g. `fatal: The current branch ... has no upstream branch`). The error message is presented in the notice banner.
2. **Merge conflicts during pull**: `git pull --no-edit` exits non-zero with conflict details. Error surfaces in notice, and Git status refresh updates worktree status to `! N conflicts`.
3. **Detached HEAD**: `git push` or `git pull --no-edit` fails appropriately with Git CLI message.
4. **Network offline / Remote unreachable / Authentication failure**: Git CLI times out or exits non-zero; error surfaces in notice banner.
5. **Project switch during sync**: If the user switches projects while sync is in flight, the background sync continues, but UI state resets to the newly active project.

## Errors

Concurrent sync requests for the same project reject with `AppError('conflict', message, IPC_CHANNEL.gitSync)`. All failures from the git CLI commands result in a rejected Promise transporting an `AppError('git_error', message, IPC_CHANNEL.gitSync)`. No raw exceptions or stack traces cross the IPC boundary.

## Acceptance criteria

- AC1: Sync button renders in status bar Git section when an active project has a valid Git repository (`status.branch !== null`).
- AC2: Sync button does not render when no project is active or the project is in the "no git" state.
- AC3: Clicking Sync executes `git pull --no-edit`, `git push`, and `git push --tags` in order.
- AC4: If any step fails, subsequent steps are skipped and an error banner appears with the Git CLI error message.
- AC5: While sync is in flight, the button displays a spinning indicator and is disabled.
- AC6: After sync completes (success or failure), the status bar Git status is refreshed.
- AC7: WSL projects execute git commands inside the distribution via `wsl.exe`.

## Required tests

1. **Unit tests (`GitService.test.ts`)**:
   - Executes pull, push, push --tags in order when all succeed.
   - Halts on `git pull --no-edit` failure and does not call push or push --tags.
   - Halts on `git push` failure and does not call push --tags.
   - Throws `AppError` with exit details when any command fails.
   - Dispatches via WSL runner when project is in WSL.
   - Rejects concurrent syncs for the same project, permits independent projects, and releases the lock after success or failure.
2. **IPC validation tests (`ipc-validation.test.ts`)**:
   - `git:sync` accepts non-empty string project ID and rejects missing/invalid payloads.
3. **Component tests (`StatusBar.test.tsx`)**:
   - Renders Sync button when branch is present.
   - Does not render Sync button when branch is null ("no git").
   - Shows spinning/busy state and disables button during sync.
   - Invokes `app.git.sync(projectId)` and refreshes status on completion.
   - Surfaces error notification on rejection.

## Relevant SDD / ADR

- `docs/architecture/sdd.md` §5 (service architecture), §6 (IPC bridge).
- `docs/features/center-layout-tabs-actions/spec.md` (status bar layout).
