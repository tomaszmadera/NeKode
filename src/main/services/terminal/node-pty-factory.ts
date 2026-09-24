import { spawn } from 'node-pty'
import type { PtyFactory, PtyProcessLike, PtySpawnOptions } from './terminal-service'

// Production PTY spawner: node-pty in the main process only (SDD §6). Kept in
// its own module so the TerminalService never imports node-pty directly and
// tests can inject a fake PTY instead.

export const createNodePty: PtyFactory = (options: PtySpawnOptions): PtyProcessLike => {
  const pty = spawn(options.file, options.args, {
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
