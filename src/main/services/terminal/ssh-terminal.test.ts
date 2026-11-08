import { AppError } from '@shared/ipc-error'
import { parseSshTarget, type SshTarget } from '@shared/ssh-target'
import { describe, expect, it, vi } from 'vitest'
import { SshClient } from '../ssh/ssh-client'
import { prepareSshTerminal } from './ssh-terminal'
import type { PtyFactory, PtyProcessLike, PtySpawnOptions } from './terminal-service'
import { TerminalService } from './terminal-service'

// SSH terminal runtime (spec ssh-projects Required tests: SSH path detection,
// local PTY cwd, failed-state early exit, teardown unchanged, no local
// orphan). The PTY and the ssh client are both fakes: no process is spawned.

class FakePty implements PtyProcessLike {
  readonly pid: number
  readonly options: PtySpawnOptions
  readonly writes: string[] = []
  killCount = 0
  private dataListeners = new Set<(data: string) => void>()
  private exitListeners = new Set<(event: { exitCode: number }) => void>()

  constructor(pid: number, options: PtySpawnOptions) {
    this.pid = pid
    this.options = options
  }

  write(data: string): void {
    this.writes.push(data)
  }

  resize(): void {}

  kill(): void {
    this.killCount += 1
  }

  onData(listener: (data: string) => void): { dispose(): void } {
    this.dataListeners.add(listener)
    return { dispose: () => this.dataListeners.delete(listener) }
  }

  onExit(listener: (event: { exitCode: number }) => void): { dispose(): void } {
    this.exitListeners.add(listener)
    return { dispose: () => this.exitListeners.delete(listener) }
  }

  emitData(data: string): void {
    for (const listener of [...this.dataListeners]) listener(data)
  }

  emitExit(exitCode: number): void {
    for (const listener of [...this.exitListeners]) listener({ exitCode })
  }
}

function target(value: string): SshTarget {
  const parsed = parseSshTarget(value)
  if (parsed === null) throw new Error(`bad fixture: ${value}`)
  return parsed
}

const SSH_PATH = 'ssh://tomek@minipc/srv/My $ Project'

function harness() {
  const ptys: FakePty[] = []
  const spawn = vi.fn((options: PtySpawnOptions) => {
    const pty = new FakePty(1000 + ptys.length, options)
    ptys.push(pty)
    return pty
  })
  const isDirectory = vi.fn(() => true)
  const service = new TerminalService({
    createPty: spawn as unknown as PtyFactory,
    isDirectory,
    shell: { file: 'powershell.exe', args: ['-NoLogo'] },
    ssh: { client: new SshClient({ platform: 'linux' }), localCwd: 'D:/Users/tomek' },
  })
  const data: Array<{ chatId: string; data: string }> = []
  const exits: Array<{ chatId: string; exitCode: number }> = []
  service.onData((chatId, chunk) => data.push({ chatId, data: chunk }))
  service.onExit((chatId, exitCode) => exits.push({ chatId, exitCode }))
  return { service, ptys, spawn, isDirectory, data, exits }
}

describe('prepareSshTerminal', () => {
  const client = new SshClient({ platform: 'linux' })

  it('prepares the login shell with the local PTY directory', () => {
    const spec = prepareSshTerminal(target(SSH_PATH), {
      client,
      localCwd: 'D:/Users/tomek',
    })
    expect(spec.file).toBe('ssh')
    expect(spec.cwd).toBe('D:/Users/tomek')
    expect(spec.target.path).toBe('/srv/My $ Project')
    expect(spec.args.slice(0, 5)).toEqual(['-tt', '-o', 'RemoteCommand=none', '--', 'tomek@minipc'])
    expect(spec.args.slice(5, 8)).toEqual(['sh', '-c', expect.stringContaining('exec')])
    expect(spec.args.slice(8)).toEqual(['nekode', "'/srv/My $ Project'"])
  })

  it('prepares an agent command as positional arguments', () => {
    const spec = prepareSshTerminal(
      target(SSH_PATH),
      { client, localCwd: 'D:/Users/tomek' },
      { file: 'codex', args: ['--flag', 'a b'] },
    )
    expect(spec.args.slice(8)).toEqual([
      'nekode',
      "'/srv/My $ Project'",
      "'codex'",
      "'--flag'",
      "'a b'",
    ])
  })

  it('refuses to prepare a spawn without the client', () => {
    expect(() => prepareSshTerminal(target(SSH_PATH), undefined)).toThrow(AppError)
  })
})

describe('TerminalService SSH routing', () => {
  it('spawns ssh with the local home as cwd and never checks the SSH URL locally', async () => {
    const { service, ptys, isDirectory } = harness()
    await service.createAsync('chat-1', SSH_PATH)
    expect(isDirectory).not.toHaveBeenCalled()
    expect(ptys).toHaveLength(1)
    expect(ptys[0].options.file).toBe('ssh')
    expect(ptys[0].options.cwd).toBe('D:/Users/tomek')
    expect(ptys[0].options.args).toContain('tomek@minipc')
    service.terminateAll()
  })

  it('keeps the local shell path unchanged', async () => {
    const { service, ptys, isDirectory } = harness()
    await service.createAsync('chat-1', 'D:/code/app')
    expect(isDirectory).toHaveBeenCalledWith('D:/code/app')
    expect(ptys[0].options).toMatchObject({
      file: 'powershell.exe',
      args: ['-NoLogo'],
      cwd: 'D:/code/app',
    })
    service.terminateAll()
  })

  it('keeps the pane open with the sanitized message on an early 255 exit', async () => {
    const { service, ptys, data, exits } = harness()
    await service.createAsync('chat-1', SSH_PATH)
    ptys[0].emitData('ssh: connect to host minipc port 22: Connection refused\r\n')
    ptys[0].emitExit(255)

    // The typed message is written into the pane and no exit event closes the chat.
    expect(data.at(-1)?.data).toContain('The SSH host is unreachable.')
    expect(exits).toEqual([])
    // The session stays recorded but refuses input like an ended session.
    expect(() => service.write('chat-1', 'ls\n')).toThrow(/terminal session has ended/i)
    expect(ptys[0].killCount).toBe(0)

    // Closing the tab tears the failed session down without a second kill.
    service.terminate('chat-1')
    expect(ptys[0].killCount).toBe(0)
    // A later attach spawns a fresh client (retry after fixing the host).
    await service.createAsync('chat-1', SSH_PATH)
    expect(ptys).toHaveLength(2)
    service.terminateAll()
  })

  it('classifies an unknown host key from the captured output', async () => {
    const { service, ptys, data } = harness()
    await service.createAsync('chat-1', SSH_PATH)
    ptys[0].emitData('Host key verification failed.\r\n')
    ptys[0].emitExit(255)
    expect(data.at(-1)?.data).toContain(
      'The SSH host key is not trusted. Verify the host key in known_hosts.',
    )
    service.terminateAll()
  })

  it('keeps exit 127 open without hiding the remote error output', async () => {
    const { service, ptys, data, exits } = harness()
    await service.createAsync('chat-1', SSH_PATH)
    ptys[0].emitData('sh: 1: codex: not found\r\n')
    ptys[0].emitExit(127)
    expect(exits).toEqual([])
    expect(data.map((entry) => entry.data).join('')).toBe('sh: 1: codex: not found\r\n')
    service.terminateAll()
  })

  it('keeps exit 126 open without hiding the remote error output', async () => {
    const { service, ptys, data, exits } = harness()
    await service.createAsync('chat-1', SSH_PATH)
    ptys[0].emitData('sh: 1: /srv/agent: Permission denied\r\n')
    ptys[0].emitExit(126)
    expect(exits).toEqual([])
    expect(data.map((entry) => entry.data).join('')).toBe(
      'sh: 1: /srv/agent: Permission denied\r\n',
    )
    service.terminateAll()
  })

  it('keeps the pane open with the not_found message when the remote cd fails', async () => {
    const { service, ptys, data, exits } = harness()
    await service.createAsync('chat-1', SSH_PATH)
    ptys[0].emitExit(111)

    // A remote directory removed after registration never closes the chat.
    expect(data.at(-1)?.data).toContain('The remote directory does not exist or is not accessible.')
    expect(exits).toEqual([])
    expect(() => service.write('chat-1', 'ls\n')).toThrow(/terminal session has ended/i)
    service.terminateAll()
  })

  it('keeps the normal exit-close behavior', async () => {
    const { service, ptys, exits } = harness()
    await service.createAsync('chat-1', SSH_PATH)
    ptys[0].emitExit(0)
    expect(exits).toEqual([{ chatId: 'chat-1', exitCode: 0 }])
    service.terminateAll()
  })

  it('kills a live ssh child on terminate and emits no exit', async () => {
    const { service, ptys, exits } = harness()
    await service.createAsync('chat-1', SSH_PATH)
    service.terminate('chat-1')
    expect(ptys[0].killCount).toBe(1)
    expect(exits).toEqual([])
  })
})
