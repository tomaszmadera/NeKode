import { spawn } from 'node-pty'
import type { PtyFactory, PtyProcessLike, PtySpawnOptions } from './terminal-service'
import { resolveWindowsExecutable } from './windows-executable'

// Production PTY spawner: node-pty in the main process only (SDD §6). Kept in
// its own module so the TerminalService never imports node-pty directly and
// tests can inject a fake PTY instead.

export const createNodePty: PtyFactory = (options: PtySpawnOptions): PtyProcessLike => {
  // ConPTY's PATH lookup adds only the native executable suffix, so an
  // extensionless profile name is resolved here the way the shell resolves it
  // (spec global-agent-profiles Behaviour 4): an npm command shim such as
  // `opencode.cmd` starts from the bare profile name.
  const file =
    process.platform === 'win32'
      ? resolveWindowsExecutable(options.file, options.env)
      : options.file
  const pty = spawn(file, options.args, {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: options.env,
  })
  return {
    pid: pty.pid,
    write: (data) => {
      pty.write(data)
    },
    resize: (cols, rows) => {
      pty.resize(cols, rows)
    },
    kill: () => {
      pty.kill()
    },
    onData: (listener) => pty.onData(listener),
    onExit: (listener) => pty.onExit(listener),
  }
}
