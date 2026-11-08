# SSH project transport

Status: accepted with the NEKODE-33 Stage 2 implementation (remote files, read-only Git, transport ADR).

## Decision

An SSH project is a project whose stored `path` column holds an `ssh://[user@]host[:port]/absolute/path` location. That stored path alone selects the transport: `FilesService`, `GitService`, `TerminalService`, the launch resolver and `ShellService` parse it and take the remote branch, with no renderer flag, shell label or per-operation option able to override it.

The transport is the system OpenSSH client, invoked through `src/main/services/ssh/ssh-client.ts`. NeKode ships no SSH client library, no SFTP layer and no mount:

- No stored or prompted credential. The client's `ssh_config`, keys, `ssh-agent` and `known_hosts` apply unchanged, and NeKode never logs a credential, a remote command line or raw remote stderr.
- One invocation per operation. No ControlMaster, persistent tunnel, background agent or connection pool exists, so every operation owns its process and its exit code.
- The executable is resolved deterministically: on Windows `%SystemRoot%\System32\OpenSSH\ssh.exe` when that file exists, otherwise `ssh` from `PATH`; on other platforms `ssh` from `PATH`. The resolver is injected through the service graph, so tests supply a fake client.

The [feature specification](../features/ssh-projects/spec.md) owns behavior; this document records why the transport looks like this.

## Contract

### Argument assembly

Non-interactive calls (`scriptArgs`) run with `-o BatchMode=yes -o RemoteCommand=none -o ConnectTimeout=10 -T`, the port when it is not 22, then `--` before the destination. A host that needs an interactive password fails with a typed `auth` error instead of hanging. A terminal session uses `-tt -o RemoteCommand=none` and the same `--` destination, and may authenticate inside its PTY. Host key verification is never disabled and never auto-accepted; an unknown or changed key fails with a message naming the `known_hosts` remedy. A local invocation that exceeds the 20 s script timeout (`SSH_SCRIPT_TIMEOUT_MS`) or is killed by a signal fails with the typed `timeout` error, which is distinct from the `ConnectTimeout=10` connection failure that stays `network`.

### Three quoting layers

A remote argument crosses the local argv (node-pty or `execFile`), the local process command line, and the remote login shell. ssh joins the words after the destination with single spaces and hands that string to the remote login shell. Therefore:

- The remote execution form is fixed: `sh -c '<script>' nekode <positional args>` (`remoteWords`). The script text is constant per operation and never contains a host, user, path or agent argument.
- Every remote word is POSIX single-quote escaped (`quotePosix`), so a quote, `$`, backtick, whitespace, newline or non-ASCII byte survives unchanged.
- Scripts read their data from positional parameters only (`$1`, `$2`, `shift`, `"$@"`). Agent executables and their argv stay positional arguments, never interpolated into script text.
- No local shell parses a remote-only value, and the destination follows `--` so a hostile value cannot become an option.

### Payload framing

Each script emits a per-call nonce marker (`printf '%s\0' <marker>`) before its payload and separates the payload fields with NUL bytes. The client searches for `<marker>` plus a NUL, so login-script chatter on stdout is dropped instead of being read as data. A missing marker is the explicit `unknown` error "The remote host did not run the command with a POSIX shell." Binary reads use the same framing on bytes, so NUL content and invalid UTF-8 survive.

### Portable remote baseline

Scripts stay inside POSIX `sh` plus `pwd -P`, `readlink`, `wc`, `head`, `cat`, `printf`, `test` and shell parameter expansion. There is no `find -maxdepth`, no `stat`, no `readlink -f` and no GNU-only flag, so GNU coreutils, BusyBox and BSD/macOS userland all work. A host without `/bin/sh` fails with the marker error; a missing `git` degrades only the Git surface.

### Read cap

A remote file read is capped on the host at 2 MB plus one byte (`head -c`), after `wc -c` reports the full size. A file that grows between the size report and the read therefore cannot exceed the limit, and the local capture buffer always has room for the marker, the field separators and the capped payload. That buffer is 16 MiB, the same cap as the local Git runner (`GIT_MAX_BUFFER_BYTES`), so a remote status or decoration read of a large repository does not fail the capture where the same repository works locally; the read cap itself stays unchanged. The service classifies `too-large` from the reported size, binary from a NUL byte in the first 8 KB or a non-UTF-8 body, and text otherwise, exactly as for a local file.

### Containment

The adapter canonicalizes with `pwd -P`: one listing returns the canonical root and the canonical requested directory, one read resolves a final-component symlink chain with `readlink` and canonicalizes each parent, and a script exits 111 when the canonical target leaves the canonical root. The service checks the returned pair again and maps an escape to the same `not_found` error as a missing file. A `:` in a remote name is a valid name; the NTFS alternate-data-stream rule applies to local paths only.

### Read-only surfaces and the unsupported set

SSH projects are read-only. Files listing and preview, Git status and decorations, terminals and agent launches are supported. `openExternal`, `openRoot`, `showInFolder`, `trash`, `previewTarget` and `fingerprint` answer `unsupported` with "This action is not available for SSH projects.", as do `git:sync`, shell detection and custom shell paths, `actions:execute` and the Kanban launch. No local path is derived from the SSH URL anywhere.

### Git and the no-git fallback

Read-only Git runs `GIT_OPTIONAL_LOCKS=0 git <args>` on the remote host in the project directory, one invocation per call, through the same `sh -c` form. Parsers are shared with the local path. Any failure (not a repository, missing `git`, connection error) resolves with a non-zero exit and the service returns the existing no-git state, so a remote directory outside Git is indistinguishable from a local one. Writing operations are `unsupported`.

### Teardown

Closing a terminal kills only the local `ssh` child; the remote login shell exits when the channel closes, which depends on the remote `sshd` configuration. No local orphan process is left behind.

## Alternatives considered

- **An `ssh2` or SFTP Node dependency.** Rejected: it adds a dependency and a second trust policy (its own key loading, agent and host-key handling), duplicates `ssh_config` and `known_hosts` semantics, and the spec's non-goals exclude an in-app SSH client library or SFTP dependency. It would also bypass the user's existing OpenSSH setup, which is the main reason terminals already work.
- **An sshfs mount or a tunnel.** Rejected: platform-specific (FUSE on Windows), invisible failure modes, no per-operation error mapping, and it turns every remote read into a local filesystem call that cannot report the remote size or the 2 MB cap honestly.
- **ControlMaster or a persistent connection.** Rejected: a long-lived process needs lifecycle, cleanup and reconnection handling that one invocation per operation avoids; the read-only Git poll interval and event-driven file panels do not justify the complexity.
- **A single multiplexed RPC channel (a remote helper process).** Rejected: it needs a remote component to install and version, which the spec's non-goals exclude, and it would make the failure surface a protocol instead of a captured exit code.
- **Interpolating validated values into script text.** Rejected: validation would have to be perfect across three quoting layers, and a single missed case becomes remote code execution. Positional parameters plus POSIX single-quote escaping remove the class.
- **Reading the whole file and capping locally.** Rejected: a remote file larger than the buffer would fail the capture instead of returning `too-large`, and the transfer cost would be unbounded.

## Consequences

- A host must be trusted once outside NeKode before it can be registered, because registration is non-interactive. The dialog says so.
- A host that accepts only password authentication cannot serve a non-interactive operation; the user opens a terminal for that project. This is a typed error, not a hang.
- Each operation pays a connection handshake. That is acceptable for an event-driven tree, a polled Git status and explicit previews, and it keeps failure classification per operation.
- The remote host must provide `/bin/sh` and the documented utility baseline, plus `git` for the Git surface. A missing tool is an explicit error; only `git` degrades silently, and only to the documented no-git state.
- Windows resolution can pick either the system client or a `PATH` client when the system one is absent, and the two can have different agents. The resolution order is fixed and recorded, so the smoke names the binary that ran.
- Tests never need a host: the SSH runner and the adapter client are injected, and `src/main/test-support/fake-ssh.cjs` joins its argv like `sshd` and runs the joined line through a real POSIX shell.
- The transport stays replaceable. Everything above is concentrated in one client, one files adapter and one Git runner behind interfaces the services already own.
