# Project environment clarity

Status: Approved by the user on 2026-11-08; implementation in progress.
Path: `docs/features/project-environment-clarity/spec.md`.

This file is the behavioral contract for the feature. Agents implement from it. Execution progress and file checklists live in the task record and plan, not here.

## Goal

A project can reach its files and processes in three ways: a Local folder, a WSL project, or an SSH project. A shell setting and an agent profile add two more choices on top of that. You should be able to see, for any project, where its files are and where its terminals and agents run, without reading three specs. The code should decide that in one place.

This feature adds no new way to open or run a project. It makes the existing ones visible and consistent, and it removes duplicated environment detection.

## Related requirements

- Analysis of 2026-11-08 (chat): three overlapping entry points (project location, shell, agent profile) with unclear responsibility.
- User decision of 2026-11-08: keep the `WSL: <distribution>` shell for Local projects. A project may live on a Windows disk and still be worked on through WSL. Removing it is out of scope.
- [Project environments](../project-environments/spec.md), [SSH projects](../ssh-projects/spec.md), [project shell selection](../project-shell-selection/spec.md) (NEKODE-95 section), [session labels](../session-labels/spec.md), [global agent profiles](../global-agent-profiles/spec.md).

## Scope

1. One shared pure resolver, `projectEnvironment(path)`, that classifies a stored project path as `local`, `wsl` or `ssh`. Main services and the renderer call it instead of calling `parseWslPath` and `parseSshTarget` directly. Behavior stays identical.
2. One launch resolver in main that returns the environment kind for every spawn entry point. The WSL distribution check that now sits in `terminals.create` moves into it. Error messages stay identical.
3. An `SSH` badge in the project list, matching the existing `WSL` badge.
4. A read-only `Environment` group at the top of the project Shell settings tab that states where files live and where terminals and agents run.
5. The Shell tab decides what to show from the resolved environment kind, not from an `unsupported` error code. For an SSH project the tab hides the custom shell path input.
6. A non-blocking warning in the agent profile form when the command starts `ssh` or `wsl` as a host program.
7. Amendments to the session labels and global agent profiles contracts (see Compatibility).

## Non-goals

- Removing, hiding or renaming the `WSL: <distribution>` shell for Local projects, or changing NEKODE-95 behavior.
- Merging WSL projects and Local projects with a WSL shell into one concept, or converting a project between environments.
- New IPC channels, a database migration, a new setting, or a new project type.
- Disabling or hiding individual controls (Kanban Start/Resume, Actions, file context menu items) for SSH projects. The `Environment` group lists what is unavailable; per-control gating is separate work.
- Changing chat name prefixes (`PS7`, `WSL`, `SSH`) or the stored chat names.
- Rejecting or rewriting an agent profile because of its command.
- Environment-aware profiles or per-environment commands.
- Changing Git, files, terminal, action or Resume behavior for any environment.

## Behaviour

### Resolver

1. `projectEnvironment(path)` lives in `src/shared`, uses no filesystem, process or credential access, and returns one of:
   - `{ kind: 'local' }`
   - `{ kind: 'wsl', distribution, linuxPath }`
   - `{ kind: 'ssh', target }`, where `target` is the existing `SshTarget`.
2. It recognizes exactly what `parseWslPath` and `parseSshTarget` recognize today, including both `wsl$` and `wsl.localhost` aliases and every `ssh://` form the SSH parser accepts. For a value either parser rejects, each current call site keeps its current outcome. Implementation characterizes those outcomes with tests before replacing the call sites.
3. After the change no production file outside `src/shared` calls `parseWslPath` or `parseSshTarget` for project environment detection. Pure path conversion helpers stay where they are.
4. The persisted path remains the only thing that selects the transport. No renderer flag, shell label or per-operation option can override it.

### Launch resolver

5. `resolveLaunch` in `create-services.ts` returns the environment kind for local, WSL and SSH projects. Chat terminals, bottom terminals, agent launches, actions and Kanban launches keep resolving through it.
6. A WSL project still rejects a terminal whose cwd names a different distribution, with the existing message `A WSL terminal must use its project distribution.`. An SSH project still requires cwd to equal the project path, with the existing message.

### Project badge

7. A project with an SSH location shows a compact `SSH` badge immediately beside its name, styled like the `WSL` badge. Its tooltip is `SSH: [user@]host[:port]`, with the port shown only when it is not 22. Local projects keep no badge. WSL projects keep the `WSL` badge and its `WSL: <distribution>` tooltip.
8. The badge is derived from the stored path through `projectEnvironment`, not from a saved chat prefix or `runtimeLabel`.

### Environment group

9. The project Shell tab starts with an `Environment` group, read-only and visible before and after shell detection. It shows two lines:
   - Location: what the project path is.
   - Runs in: where new terminals and agents start.
10. The text for each case:
    - Local, default or host shell: `Local folder on this computer` and `Terminals and agents run on this computer.`
    - Local, `WSL: <distribution>` shell: `Local folder on this computer` and `Terminals and agents run in WSL: <distribution>. Files stay in the Windows folder.`
    - WSL project: `WSL project: <distribution>, <linuxPath>` and `Terminals and agents run in <distribution>.`
    - SSH project: `SSH project: [user@]host[:port], <path>` and `Terminals and agents run on that host.` followed by one line: `Read-only files and Git. Not available: Actions, Kanban Start and Resume, task progress, handoff files, opening files in other apps.`
11. For a Local project the second line follows the shell that new terminals will actually use: the saved choice when detection lists it, otherwise the default. A stale `wsl:<distribution>` choice therefore reads as a host shell, matching the spawn fallback in the shell selection contract. The line updates after the shell choice is saved.
12. The group never probes anything itself. It uses the stored path, the saved choice and the detection result the tab already loads.
13. For an SSH project the tab no longer relies on the `unsupported` error to learn the environment. It shows the single `Default (remote login shell)` entry and hides `Add a shell by absolute path`, because that action always fails for SSH. Other environments keep their current controls.

### Agent profile warning

14. When the profile form's `Command` parses to an executable whose base name, case-insensitive and without a `.exe` extension, is exactly `ssh` or `wsl`, the form shows a warning below the field. It does not block saving, change the stored command, or appear in the profile list.
    - For `wsl`: `This starts WSL as a host program, so NeKode does not choose the distribution or map the project directory. To run agents inside WSL, set the project's shell to WSL or add a WSL project.`
    - For `ssh`: `This starts ssh as a host program, so NeKode does not change into the project directory on the remote host. To work on a remote host, add the project as an SSH project.`
15. Other executables, including names that only contain these words (`sshpass`, `wsl-helper`), show no warning. A command that fails to parse shows the existing parse error and no warning. The warning follows edits live and disappears when the command changes.

## Business rules

- The stored project path is the single source of truth for the transport. This feature adds a reader, never a second writer.
- Shell choice remains a Local-project setting. WSL and SSH projects ignore host shell choices exactly as the existing contracts state.
- The agent profile library stays global and environment-agnostic. The warning is advice and never changes launch behavior.
- Environment text must not claim more than the existing contracts guarantee. It may not state Git routing for a WSL project or promise that a profile command works in a given environment.

## Authorization

None beyond the existing trusted-sender guards. This feature adds no IPC channel and exposes no new data: the renderer already receives each project's path.

## Data / API

- New: `src/shared/project-environment.ts` exporting `ProjectEnvironment` and `projectEnvironment(path)`, with a unit test file beside it.
- No change to `src/shared/ipc-contract.ts`, preload, the database schema, `app_state` keys or persisted data.
- The renderer reads the saved shell choice and detection list it already loads in `ShellTab`. The Shell tab receives the project path or its resolved environment as a prop instead of inferring SSH from an error.
- New test ids for the SSH badge, the Environment group and the profile warning in `src/renderer/src/lib/test-ids.ts`.

## Edge cases

- An SSH URL with an IPv6 host, a user, or a non-default port: the badge and group show it as `SSH: [user@]host[:port]` in the form the parser produced, with the brackets restored for IPv6.
- A UNC WSL path under either alias: both show `WSL` and the same distribution.
- A Local project path that merely contains `wsl` or `ssh` text: `local`.
- A malformed `ssh://` or WSL UNC path stored in the database: each call site keeps today's outcome (see Errors). The new badge and group show no environment line they cannot derive and never throw.
- Shell detection still running or failed: the Environment group shows the location line and, for Local, the line for the default shell until detection settles.
- A project without a path in tests or in an unloaded state: the group renders nothing instead of an error.
- A profile command with a quoted path to `wsl.exe` (`"C:\Windows\System32\wsl.exe" -d Ubuntu`): warns, because the base name is `wsl`.

## Errors

No new error paths. The resolver adds no failure mode of its own: every call site keeps the outcome it has today for a malformed location (a `null` from the SSH parser, a thrown error from the WSL parser, or a fall-through to local). Characterization tests record those outcomes first. If they differ between call sites, the resolver exposes the difference explicitly (for example a distinct malformed result) instead of mapping it silently to `local`; the plan records that choice. The profile warning shows beside the existing validation errors and never replaces them.

## Acceptance criteria

1. `projectEnvironment` classifies Local, WSL (both aliases) and SSH (user, port, IPv6) paths, and a table test pins its result for every malformed form the two parsers reject.
2. No production file outside `src/shared` calls `parseWslPath` or `parseSshTarget` to decide a project's environment.
3. The existing suites for services, terminals, files, Git, shell selection, SSH harness, handoffs and renderer run unchanged and pass. No expected string in them is edited to fit the refactor.
4. An SSH project shows an `SSH` badge with its tooltip, a WSL project keeps its `WSL` badge, a Local project shows none.
5. The Shell tab shows the Environment group for Local with a host shell, Local with `WSL: <distribution>`, a WSL project and an SSH project, each with the text in Behaviour 10. A stale `wsl:` choice reads as a host shell.
6. For an SSH project the Shell tab hides the custom shell path input and shows no error banner. Local and WSL projects keep their inputs.
7. The profile form warns for `ssh`, `ssh.exe`, `wsl`, `WSL.EXE` and a quoted full path to either, and does not warn for `sshpass`, `claude` or an unparsable command. Saving works with the warning shown, and the saved command is unchanged.
8. The session labels contract says that WSL and SSH projects display an environment badge, and the global agent profiles contract describes the warning. The shell selection contract describes the Environment group and links here.
9. A real-app check on Windows records the badge and the Environment group for a Local, a WSL and, when a host is available, an SSH project. An unavailable host is reported as unverified, not as passed.

## Required tests

- Shared: `projectEnvironment` for Local, both WSL aliases, SSH variants and every malformed input, asserting the same outcome as the parser it wraps.
- Main: existing `create-services.ssh.test.ts`, `shell-service`, `terminal-service`, files and Git suites unchanged. One test shows the WSL distribution mismatch still returns its message through `resolveLaunch`.
- Renderer, navigation: SSH badge and tooltip (default and non-default port, IPv6, user), WSL badge unchanged, no badge for Local.
- Renderer, Shell tab: the Environment group for the four cases, a stale `wsl:` choice, the group while detection runs, the SSH tab without a custom path input and without an error banner, and the existing ShellTab tests unchanged.
- Renderer, profile form: the warning cases in acceptance 7, live update on edit, non-blocking save, and the parse-error case.
- Real-app check as in acceptance 9, recorded in the task record Verification table.

## Relevant SDD / ADR

[SSH project transport](../../architecture/ssh-project-transport.md) (the path selects the transport) and [minimal WSL project integration](../../architecture/project-environment-adapters.md). No new ADR: the resolver centralizes the decision both documents already record.

## Compatibility

This contract amends three others. The amendment text is written into those files when the feature ships, so no source competes with another:

- [Session labels](../session-labels/spec.md): Behaviour 5 and AC4 change from "WSL badge only" to "WSL and SSH badges"; Local projects stay without a badge.
- [Global agent profiles](../global-agent-profiles/spec.md): the `Command` field gets the non-blocking warning in Behaviour 14. The rule that the library is global and a profile is never rejected for its command stays.
- [Project shell selection](../project-shell-selection/spec.md): the Shell tab gains the Environment group and an SSH-aware layout. The `WSL: <distribution>` shell for Local projects and its NEKODE-95 launch rules are unchanged.
