# SSH projects

Status: Delivered (registration, terminals, agent launches, remote files, read-only Git and typed errors; the transport decision is recorded in the [SSH project transport](../../architecture/ssh-project-transport.md) ADR).

This file is the behavioral contract for working in a project that lives on a remote machine reached over SSH.

Path: `docs/features/ssh-projects/spec.md`.

## Goal

Open a project stored on a remote SSH host and work in it from NeKode: browse its files, run chat and bottom terminals, and launch agent CLIs on that host in the project directory. The user configures the location once; afterwards the project behaves like any other project, with every remote failure visible instead of silently falling back to the local machine.

## Related requirements

- NEKODE-33 "Obsługa projektów przez SSH", the work item this contract implements.
- [Project environments: opening WSL projects](../project-environments/spec.md) delivers the boundary between the filesystem location and the process runtime. SSH reuses that boundary: the persisted path selects the transport. Its non-goal "SSH" stays owned by this contract.
- [Project files view](../project-files-view/spec.md) owns listing, preview, exclusions and containment rules. This contract keeps them and adds the remote transport.
- [Project shell selection](../project-shell-selection/spec.md) owns shell discovery, selection and chat labels.
- SDD sections that list SSH sessions and a future runtime host over SSH (deferred there, implemented here in the minimal form below).

## Scope

1. An `SSH` project location in the Add Project dialog: host, optional user, optional port, absolute POSIX remote directory.
2. Persist the location in the existing project `path` column as `ssh://[user@]host[:port]/absolute/path`; no database migration.
3. Read-only file tree listing and preview over SSH, using the existing files contract.
4. Chat and bottom terminals that run the remote login shell in the project directory.
5. Agent chat launches whose executable and argv run on the remote host in the project directory.
6. Read-only Git status and file decorations computed over SSH.
7. Explicit, typed errors for every connection, authentication, host-key, path and capability failure, including a terminal that cannot start or dies at once.

## Non-goals

- Storing or prompting for passwords, key passphrases or any other credential.
- An in-app SSH client library, SFTP dependency, sshfs mount, tunnel, port forwarding or connection multiplexing.
- Managing `~/.ssh/config`, hosts, keys, `known_hosts` or ProxyJump. The system OpenSSH client owns all of it.
- Writing, creating, renaming, deleting or trashing remote files; the file surface stays read-only like today.
- Opening a remote file in a local OS application, revealing it in a local file manager, opening the remote root externally, or opening a remote file preview window.
- Remote Git writes (`git:sync`, pull, push, tags).
- Local-file features keyed on a project directory: Kanban task launch, task progress sidecars, handoff files, agent-skill files.
- Custom remote shell paths, remote shell installation, remote agent installation, remote MCP/ACP integration.
- Remote project environments beyond files, terminals, agents and read-only Git.
- Changes to Local or WSL behavior, storage, shells or IPC.

## Behaviour

1. The Add Project location selector offers `Local`, `WSL` and `SSH` on every platform. Selecting SSH shows `Host` (required), `User` (optional), `Port` (optional, 22 when empty) and `Remote directory` (required, absolute POSIX path with `/`). The renderer validates shape and shows per-field messages, disables submit while a request is in flight, and shows an inline error when it fails. Main validates again, then checks that the host answers and that the directory exists before any row is written.
2. Host, user and port are validated by character class, not only by presence. The host is a DNS name, an IPv4 literal, a single-label `ssh_config` alias or a bracketed IPv6 literal: letters, digits, `.`, `-`, `_`, and `:` only inside brackets. The user may contain letters, digits, `.`, `_`, `-`. Neither may start with `-`, and neither may contain whitespace, control characters, `@`, `/` or NUL. The port is an integer from 1 to 65535.
3. The canonical stored path is `ssh://host/path`, `ssh://user@host/path`, `ssh://host:2222/path` or `ssh://user@host:2222/path`; an IPv6 literal host is written in brackets, `ssh://user@[2001:db8::1]:2222/path`. The host is lowercased, the user and the remote path keep their case and characters, and a trailing slash is dropped. Port 22 is omitted from the canonical form, so `ssh://host:22/p` and `ssh://host/p` are the same identity. A second project with the same canonical path is a conflict.
4. The remote directory must exist and be a directory at registration. Its canonical identity is the `pwd -P` result of the directory, so two spellings that resolve to the same directory conflict. The project name is the last path segment of the entered path, computed with POSIX rules. A filesystem root (`/`) is rejected because it has no usable name.
5. The persisted path alone selects the transport, and the transport is resolved from the project row. Every spawn entry point (chat terminal, bottom terminal, agent launch, task action, Kanban launch) resolves through one launch resolver that requires the renderer-supplied cwd to equal the project path for an SSH project and rejects an `ssh://` cwd that no project owns. A renderer cannot select a host, a user or a port.
6. Terminal sessions for an SSH project run the local OpenSSH client under a PTY, change to the project directory on the remote host and execute the remote login shell there. The local working directory passed to the PTY is an existing local directory (the user's home) and never the SSH URL. The client runs with forced remote TTY allocation, `RemoteCommand=none`, and the destination after `--`.
7. Agent launches pass the same executable and argv to the remote host, changed into the project directory. Arguments survive unchanged, including spaces, quotes, `$`, backticks and non-ASCII characters. There is no fallback to a local shell or a local command for an SSH project and no remote preflight of the executable.
8. A terminal whose SSH child exits with a connection failure (255), a missing remote directory (111), a permission failure (126) or a missing remote executable (127) keeps its pane open with the sanitized message instead of closing the chat or the tab; 126 and 127 keep the remote error output visible as the explanation. The classification is by exit code and applies whenever the remote command returns it, because that command is one short-lived invoker whose exit code reports the failure. A normal process exit keeps today's close behavior.
9. Shell settings for an SSH project list one `Default` entry that means the remote user's login shell. Opening Shell settings, detecting shells and adding a custom shell path never probe Windows or WSL shells and never write the host custom-shell list for an SSH project; the SSH entry is returned without host or WSL probes and the detect and add operations report `unsupported`.
10. File listing and preview work over SSH with the rules of the files contract: one directory level per request, excluded directory names filtered, symlink entries classified by target, containment enforced on canonical remote paths, text at or below 2 MB, `too-large` above it, NUL or non-UTF-8 content classified as binary. The NTFS alternate-data-stream rule for `:` in relative paths does not apply to SSH projects; a remote name containing `:` is a valid name.
11. Local-only file actions on an SSH project (open in OS application, open root, reveal in folder, move to trash) fail with an `unsupported` error and a clear message. No local path is derived from the SSH URL and no local operation runs. The same error applies to a remote preview window.
12. Git status and per-path decorations for an SSH project are read with `git` on the remote host in the project directory, in one invocation per call, with optional locks disabled. A failure degrades to the existing no-git state, exactly like a local non-repository directory. `git:sync` and every writing Git operation report `unsupported`.
13. Local and WSL projects keep their current behavior in every channel, dialog and service. UI text stays English.

## Business rules

- The persisted project path alone selects the transport. No renderer flag, stored shell label or per-operation option can override it.
- Authentication is the system OpenSSH client's responsibility: its configuration, keys, ssh-agent and `known_hosts` apply unchanged. NeKode stores no credential and logs none.
- The SSH executable is resolved deterministically: on Windows `%SystemRoot%\System32\OpenSSH\ssh.exe` when that file exists, otherwise `ssh` from `PATH`; on other platforms `ssh` from `PATH`. The resolver is a dependency of the service graph, so tests can inject a fake client. No environment variable or settings field overrides it.
- Non-interactive remote operations run with `BatchMode=yes`, `RemoteCommand=none`, `ConnectTimeout=10` and no remote TTY, so a host that needs an interactive password fails with a clear message instead of hanging. A terminal session allocates a remote TTY and may authenticate interactively inside its PTY.
- Host key verification is never disabled and never auto-accepted. An unknown or changed host key fails with a message naming the host and the `known_hosts` remedy. The dialog states that a host must be trusted once outside NeKode (an ordinary `ssh host` session, or copying its key) before it can be added.
- Remote commands are assembled from validated values only. Every remote argument is POSIX single-quote escaped, the destination follows `--`, and no local shell ever parses a path, host, user or agent argument. Remote execution uses the fixed form `sh -c '<script>' nekode <positional args>`; agent executables and their argv are positional arguments, never interpolated into the script text.
- Remote scripts emit a per-call nonce marker before their payload and NUL-delimited fields after it. A missing marker is an explicit error, so login-script chatter on stdout is not mistaken for data.
- Remote scripts stay inside a portable baseline: POSIX `sh` and `pwd -P`, `readlink`, `wc`, `head`, `cat`, `printf`, `test`. No `find -maxdepth`, no `stat`, no `readlink -f`, no GNU-only flag. The documented baseline is GNU coreutils, BusyBox and BSD/macOS userland.
- Remote reads are capped on the remote side (2 MB plus one byte) and returned as a buffer, so a file that grows between stat and read cannot exceed the limit and no output buffer overflows.
- Each operation opens its own SSH invocation. No ControlMaster, persistent tunnel or agent process is required. Read-only Git polling keeps the existing interval and never runs faster; file panels stay event-driven.
- The remote host must provide `/bin/sh`, the utilities listed above and `git` for the Git surface. A missing tool is an explicit error, never a silent degradation beyond the documented no-git fallback.
- Raw `ssh` stderr, remote command lines, agent argv and remote paths beyond the project path are not forwarded to the renderer and are not written to logs. Each failure is mapped from a captured stderr fixture or an exit code to a sanitized message.

## Authorization

None beyond the existing trusted-sender guards. Every new IPC channel validates its payload shape and passes the same sender check as the WSL channels. At registration the renderer supplies a host, user, port and path, never a raw command line or destination. Afterwards it supplies a project id; a command that carries a cwd must carry that project's path, and a mismatched or unowned `ssh://` cwd is rejected before any process starts.

## Data / API

- `src/shared/ssh-target.ts`: pure parse, format, validation and identity of `ssh://` project paths, shared by main and renderer. Rejects a leading `-`, whitespace, control characters, `@` in the host and non-POSIX paths before any process is spawned.
- `src/main/services/ssh/ssh-client.ts`: resolves the executable, assembles the argument word array for a login-shell terminal, an agent launch and a non-interactive script, and classifies exit codes and captured stderr into typed errors. Injected through the service graph.
- `projects:addSsh` with `{ host, user, port, path }`: new typed channel with an object payload parser, validator entry, service-registry method, preload mapping and `AppApi` type.
- `ProjectsService.addSsh`: validates, checks the remote directory through the injected client, writes the canonical path and path identity. Registration is async and runs in `create-services.ts` before a synchronous insert, following the `addWsl` precedent. `projectPathIdentity` gains an SSH branch before the local branch (lowercase host, omitted default port, preserved user and path) so duplicates cannot bypass the unique path column.
- `create-services.ts` owns one launch resolver used by `terminals.create`, agent terminals, `actions:execute` and Kanban launch: it reads the project row, requires cwd equality for SSH and rejects a foreign `ssh://` cwd. `actions:execute` returns `unsupported` for an SSH project, with no local shell and no background action.
- `TerminalService` recognizes an SSH project path and prepares a local `ssh` spawn instead of a local shell spawn, with the local PTY cwd from the resolver and a failed-state path for an early exit. The existing PTY, IO, resize and teardown behavior is unchanged.
- `FilesService` keeps its adapter interface and gains an optional per-request batch capability the SSH adapter implements, plus a remote-aware containment check and a transport-selected adapter. The `:` alternate-data-stream rule is skipped for SSH paths. Preview window polling is unsupported for SSH.
- `ShellService` answers a single Default entry for SSH projects, resolves it without host or WSL probes, and reports `unsupported` for detection and custom-shell writes.
- `GitService` runs its read-only status and decoration commands through an SSH runner for SSH projects, in one invocation each, with `GIT_OPTIONAL_LOCKS=0`; `git:sync` is `unsupported`.
- No database schema change; `projects.path` and `path_identity` carry the location.

## Edge cases

- Host names, IPv4 and bracketed IPv6 literals, single-label aliases, user names with dots or hyphens, ports 1 to 65535, empty optional fields, `:22` spelled explicitly, host spelled in another case.
- A host absent from `known_hosts`, a changed host key, a host that accepts only password authentication, two local OpenSSH clients with different agents.
- Remote paths with spaces, quotes, `$`, `;`, backticks, newlines and Unicode; trailing slash; repeated slashes; `.` and `..` segments; NUL; relative paths; the root `/`; a path whose real directory differs from its spelling.
- Unknown host, refused connection, connect timeout, missing or unreadable key, key requiring a passphrase, agent unavailable.
- Remote directory removed after registration; host reachable but `/bin/sh` missing or not POSIX; `git` missing; permission denied on a directory or file.
- A login shell that is not POSIX (fish, csh) or a remote login script that prints to stdout.
- Directory entries that disappear between listing and stat; broken symlinks; symlinks leaving the project root; a file that grows over 2 MB between stat and read.
- Duplicate registration of the same host, user, port and path in different spellings, including a trailing slash and `:22`.
- A terminal closed while the SSH process is starting; application quit with live SSH sessions; an SSH child that exits with 255 immediately.
- A renderer payload whose cwd is a foreign `ssh://` path, a local path inside an SSH project, or the project path of another host.

## Errors

Each failure is a typed `AppError` with a sanitized message; raw `ssh` stderr and command lines are not forwarded to the renderer or written to logs.

- Missing OpenSSH client: `unknown`, "The OpenSSH client is not available on this machine."
- Unresolvable host: `network`, "The SSH host could not be resolved."
- Refused or timed out connection: `network`, "The SSH host is unreachable."
- Local invocation timeout: `timeout`, "The SSH command did not finish in time or was interrupted." This is the 20 s local process limit (`SSH_SCRIPT_TIMEOUT_MS`) or a signal kill, not the remote `ConnectTimeout=10` connection failure, which stays `network`. It surfaces from `files:list`, `files:read` and `projects:addSsh`; the read-only Git path degrades to the no-git state and logs only the code.
- Authentication failure in a non-interactive operation: `auth`, "The SSH host requires interactive authentication. Open a terminal for this project or configure a key or agent."
- Unknown or changed host key: `auth`, "The SSH host key is not trusted. Verify the host key in known_hosts."
- Missing, non-directory or inaccessible remote directory: `not_found`, "The remote directory does not exist or is not accessible."
- Invalid input shape, including a leading `-` in the host or user: `validation` with a field-specific message; no project row is written.
- Duplicate canonical path: `conflict`, "This remote directory is already registered as a project."
- Local-only action, preview window, Git write, shell detection or custom shell on an SSH project: `unsupported`, "This action is not available for SSH projects."
- A cwd that does not match the SSH project path: `validation`, "The working directory does not belong to this project."
- Remote file disappeared or escaped containment: `not_found`, "File not found." (the same message as local containment failures).
- Remote script marker missing or remote `sh` not POSIX: `unknown`, "The remote host did not run the command with a POSIX shell."
- Remote tool missing: the documented Git no-git fallback for `git`; an explicit `unknown` error naming the missing tool otherwise.

## Acceptance criteria

1. An SSH project can be added through the dialog to a reachable host, survives an application restart, and its chat and bottom terminals start the remote login shell in the remote project directory.
2. An agent chat started in an SSH project runs a remote argv-echo script with unchanged argv (spaces, quotes, `$`, backticks and non-ASCII characters appear byte-identical in the recorded output) in the project directory.
3. The file tree browses nested remote directories and previews text files; files over 2 MB and binary files are classified as such; the fixture contains a symlink to a path outside the project root and a `..` request, and neither escapes the project root.
4. Open external, open root, reveal in folder, trash, preview window, `git:sync` and Kanban launch return the explicit unsupported error for an SSH project, and no local operation runs.
5. Unknown host, refused connection, authentication required, unknown host key and missing directory each produce their distinct message, and no project row is created. Authentication, host-key and resolution cases are verified from captured stderr fixtures; the live smoke covers success, a missing directory and a closed port.
6. Read-only Git status and file decorations appear for a fixture repository on the remote host with one known branch, one modified and one untracked file, and the counts match; a non-repository directory degrades to the no-git state.
7. Shell settings show a single Default entry for an SSH project, no Windows or WSL shell is probed, the host custom-shell list is unchanged, and the chat label identifies the session as SSH (the shell itself cannot be named without probing, which is a non-goal).
8. A terminal that cannot connect exits with 255 and keeps the tab open with the sanitized message; closing a terminal or the application leaves no live local `ssh` child and no remote login shell for the project.
9. Local and WSL registration, files, shells, terminals and Git behavior pass the existing regression suites.
10. A real smoke against a reachable SSH host is recorded, including a terminal session, an agent launch and file browsing; if no host is reachable, the exact missing evidence is recorded.

## Required tests

- Pure SSH target parsing, formatting and identity: host, user, port, IPv6, `:22`, trailing slash, mixed case, path with spaces, quotes, newlines and Unicode; rejection of relative paths, NUL, traversal, invalid ports, an empty host, a leading `-` in host or user, whitespace and control characters in host or user, and `@` in host.
- Project registration: success, remote directory check, name derivation, root rejection, conflict, canonical directory identity, error mapping, no row on failure, async check before insert.
- SSH client assembly: terminal word array, non-interactive script word array, `--` before the destination, `RemoteCommand=none`, `BatchMode` only for non-interactive calls, forced TTY only for terminals, agent argv as positional arguments with hostile values, no local shell interpolation.
- Failure mapping: captured stderr fixtures per case (unresolvable, refused, timeout, auth, unknown key, changed key, missing client, non-POSIX shell) and exit code 255 classification, with no raw stderr in the result.
- Launch routing: cwd equal to the project path, mismatched cwd, foreign `ssh://` cwd, local path inside an SSH project, actions and Kanban launch rejection.
- Terminal preparation: SSH path detection, local PTY cwd, failed-state early exit, teardown unchanged, no local orphan.
- Shell service: single Default entry for SSH, no host or WSL probes, unchanged host custom-shell list, `unsupported` detection and custom shell, chat label.
- Files remote adapter and service: nonce marker, NUL parsing, kinds, symlinks, exclusions, containment through `pwd -P`, 2 MB cap, binary rules, `:` names accepted, error mapping, unsupported local actions and preview window.
- Git over SSH: command assembly, one invocation per call, `GIT_OPTIONAL_LOCKS=0`, unchanged status parsing, no-git fallback, sanitized logging, `git:sync` unsupported.
- Fake SSH harness: an executable that joins its arguments and runs them through `sh -c` like `sshd`, used to assert the joined remote command line for hostile argv, a login script that prints to stdout, and a non-POSIX login shell.
- IPC validation, sender guards, object payload parser, preload mapping and `AppApi` stub updates across the test tree.
- Renderer Add Project: SSH option on every platform, four fields, per-field validation, busy and error states, Local and WSL flows unchanged.
- Real SSH smoke with an isolated fixture directory, plus a BusyBox or Alpine run of the file scripts when such a host or container is reachable.

## Relevant SDD / ADR

- SDD: "SSH sessions" as terminal content and the deferred "runtime host via SSH/RPC"; this contract implements the minimal transport for project files, terminals, agents and read-only Git.
- [Minimal WSL project integration](../../architecture/project-environment-adapters.md) records the location-versus-runtime boundary this contract reuses.
- [SSH project transport](../../architecture/ssh-project-transport.md) records the transport decision (system OpenSSH client, path-based location, no credential storage, one invocation per operation) and is written in the same change as the implementation.
