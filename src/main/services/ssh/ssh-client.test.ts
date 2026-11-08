import { AppError } from '@shared/ipc-error'
import { parseSshTarget, type SshTarget } from '@shared/ssh-target'
import { describe, expect, it, vi } from 'vitest'
import {
  quotePosix,
  remoteCommandLine,
  remoteWords,
  SshClient,
  type SshClientOptions,
  type SshRunner,
  sshFailure,
} from './ssh-client'

// SSH client assembly and failure mapping (spec ssh-projects Required tests:
// terminal word array, script word array, `--`, RemoteCommand=none,
// BatchMode only for non-interactive calls, forced TTY only for terminals,
// hostile agent argv as positional arguments, stderr classification).

const LOGIN_SCRIPT =
  'cd "$1" || exit 111; if test -n "$SHELL"; then exec "$SHELL" -l; fi; exec /bin/sh -l'
const AGENT_SCRIPT = 'cd "$1" || exit 111; shift; exec "$@"'

function target(value: string): SshTarget {
  const parsed = parseSshTarget(value)
  if (parsed === null) throw new Error(`bad fixture: ${value}`)
  return parsed
}

function client(options: SshClientOptions = {}) {
  const run = vi.fn<SshRunner>(async () => ({ stdout: '', stderr: '', exitCode: 0 }))
  const instance = new SshClient({
    platform: 'linux',
    run,
    marker: () => 'nekode-test',
    ...options,
  })
  return { client: instance, run }
}

const encoder = new TextEncoder()

/** Payload bytes for a runner result, so the byte path is explicit. */
function bytes(text: string): Uint8Array {
  return encoder.encode(text)
}

describe('executable resolution', () => {
  it('uses the Windows system client when the file exists', () => {
    const { client: ssh } = client({
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows' },
      exists: (path) => path === 'C:\\Windows\\System32\\OpenSSH\\ssh.exe',
    })
    expect(ssh.executable()).toBe('C:\\Windows\\System32\\OpenSSH\\ssh.exe')
  })

  it('falls back to ssh from PATH on Windows without the system client', () => {
    const { client: ssh } = client({
      platform: 'win32',
      env: { SystemRoot: 'D:\\Win' },
      exists: () => false,
    })
    expect(ssh.executable()).toBe('ssh')
    const probed: string[] = []
    new SshClient({
      platform: 'win32',
      env: { SystemRoot: 'D:\\Win' },
      exists: (path) => {
        probed.push(path)
        return false
      },
    }).executable()
    expect(probed).toEqual(['D:\\Win\\System32\\OpenSSH\\ssh.exe'])
  })

  it('uses ssh from PATH on other platforms without probing', () => {
    const exists = vi.fn(() => true)
    const { client: ssh } = client({ platform: 'darwin', exists })
    expect(ssh.executable()).toBe('ssh')
    expect(exists).not.toHaveBeenCalled()
  })
})

describe('terminal assembly', () => {
  it('forces a remote TTY, sets RemoteCommand=none and puts the destination after --', () => {
    const { client: ssh } = client({ platform: 'linux' })
    expect(ssh.terminalArgs(target('ssh://tomek@minipc:2222/home/tomek/app'))).toEqual([
      '-tt',
      '-o',
      'RemoteCommand=none',
      '-p',
      '2222',
      '--',
      'tomek@minipc',
    ])
    expect(ssh.terminalArgs(target('ssh://minipc/srv/app'))).toEqual([
      '-tt',
      '-o',
      'RemoteCommand=none',
      '--',
      'minipc',
    ])
  })

  it('builds the exact login-shell spawn word array with the local home cwd', () => {
    const { client: ssh } = client({ platform: 'linux' })
    const spawn = ssh.terminalCommand(target('ssh://tomek@minipc/home/tomek/app'))
    expect(spawn).toEqual({
      file: 'ssh',
      args: [
        '-tt',
        '-o',
        'RemoteCommand=none',
        '--',
        'tomek@minipc',
        'sh',
        '-c',
        `'${LOGIN_SCRIPT}'`,
        'nekode',
        "'/home/tomek/app'",
      ],
    })
  })

  it('never batches, never sets a connect timeout and never uses -T for a terminal', () => {
    const { client: ssh } = client({ platform: 'linux' })
    const spawn = ssh.terminalCommand(target('ssh://host/p'))
    expect(spawn.args).not.toContain('BatchMode=yes')
    expect(spawn.args).not.toContain('-T')
    expect(spawn.args).not.toContain('ConnectTimeout=10')
  })

  it('passes agent argv as positional arguments, byte-identical after quoting', () => {
    const { client: ssh } = client({ platform: 'linux' })
    const command = {
      file: 'codex',
      args: ['--flag', 'a b', "it's", '$(rm -rf /)', '`id`', 'ünïcode', '', 'trailing '],
    }
    const spawn = ssh.terminalCommand(target('ssh://host/srv/My $ Project'), command)
    expect(spawn.args.slice(5)).toEqual([
      'sh',
      '-c',
      `'${AGENT_SCRIPT}'`,
      'nekode',
      "'/srv/My $ Project'",
      "'codex'",
      "'--flag'",
      "'a b'",
      "'it'\\''s'",
      "'$(rm -rf /)'",
      "'`id`'",
      "'ünïcode'",
      "''",
      "'trailing '",
    ])
    expect(ssh.terminalCommandLine(target('ssh://host/srv/My $ Project'), command)).toBe(
      [
        'sh',
        '-c',
        `'${AGENT_SCRIPT}'`,
        'nekode',
        "'/srv/My $ Project'",
        "'codex'",
        "'--flag'",
        "'a b'",
        "'it'\\''s'",
        "'$(rm -rf /)'",
        "'`id`'",
        "'ünïcode'",
        "''",
        "'trailing '",
      ].join(' '),
    )
  })
})

describe('script assembly', () => {
  it('runs non-interactively: BatchMode, RemoteCommand=none, ConnectTimeout, -T, --', () => {
    const { client: ssh } = client({ platform: 'linux' })
    expect(ssh.scriptArgs(target('ssh://user@[2001:db8::1]:2200/srv/app'))).toEqual([
      '-o',
      'BatchMode=yes',
      '-o',
      'RemoteCommand=none',
      '-o',
      'ConnectTimeout=10',
      '-T',
      '-p',
      '2200',
      '--',
      'user@[2001:db8::1]',
    ])
  })

  it('never allocates a remote TTY for a script', () => {
    const { client: ssh } = client({ platform: 'linux' })
    expect(ssh.scriptArgs(target('ssh://host/p'))).not.toContain('-tt')
  })

  it('marks the payload and reads positional arguments only', async () => {
    const { client: ssh, run } = client({ platform: 'linux' })
    run.mockResolvedValue({ stdout: 'nekode-test\u0000/home/real path\n', stderr: '', exitCode: 0 })
    const result = await ssh.runScript(target('ssh://host/p'), 'cd "$1" || exit 1; pwd -P', ['/p'])
    expect(result).toEqual({ exitCode: 0, fields: ['/home/real path\n'] })
    expect(run).toHaveBeenCalledExactlyOnceWith('ssh', [
      '-o',
      'BatchMode=yes',
      '-o',
      'RemoteCommand=none',
      '-o',
      'ConnectTimeout=10',
      '-T',
      '--',
      'host',
      'sh',
      '-c',
      quotePosix("printf '%s\\0' 'nekode-test'; cd \"$1\" || exit 1; pwd -P"),
      'nekode',
      "'/p'",
    ])
  })

  it('ignores login-script chatter before the marker', async () => {
    const { client: ssh, run } = client({ platform: 'linux' })
    run.mockResolvedValue({
      stdout: 'Welcome to minipc\nLast login: yesterday\nnekode-test\u0000/srv/app\n',
      stderr: '',
      exitCode: 0,
    })
    await expect(ssh.runScript(target('ssh://host/p'), 'pwd -P')).resolves.toEqual({
      exitCode: 0,
      fields: ['/srv/app\n'],
    })
  })

  it('rejects a missing marker as a non-POSIX remote shell', async () => {
    const { client: ssh, run } = client({ platform: 'linux' })
    run.mockResolvedValue({ stdout: '/srv/app\n', stderr: '', exitCode: 0 })
    await expect(ssh.runScript(target('ssh://host/p'), 'pwd -P')).rejects.toMatchObject({
      code: 'unknown',
      message: 'The remote host did not run the command with a POSIX shell.',
    })
  })

  it('rejects a marker without its NUL terminator instead of returning empty fields', async () => {
    const { client: ssh, run } = client({ platform: 'linux' })
    run.mockResolvedValue({ stdout: 'nekode-test', stderr: '', exitCode: 0 })
    await expect(ssh.runScript(target('ssh://host/p'), 'pwd -P')).rejects.toMatchObject({
      code: 'unknown',
      message: 'The remote host did not run the command with a POSIX shell.',
    })
  })

  it('reads an empty payload as one empty field', async () => {
    const { client: ssh, run } = client({ platform: 'linux' })
    run.mockResolvedValue({ stdout: 'nekode-test\u0000', stderr: '', exitCode: 0 })
    await expect(ssh.runScript(target('ssh://host/p'), 'pwd -P')).resolves.toEqual({
      exitCode: 0,
      fields: [''],
    })
  })
})

describe('binary script framing', () => {
  it('rejects a missing marker as a non-POSIX remote shell', async () => {
    const { client: ssh, run } = client({ platform: 'linux' })
    run.mockResolvedValue({
      stdout: '/srv/app\n',
      stdoutBytes: bytes('/srv/app\n'),
      stderr: '',
      exitCode: 0,
    })
    await expect(ssh.runScriptBytes(target('ssh://host/p'), 'pwd -P')).rejects.toMatchObject({
      code: 'unknown',
      message: 'The remote host did not run the command with a POSIX shell.',
    })
  })

  it('rejects a marker without its NUL terminator instead of returning empty fields', async () => {
    const { client: ssh, run } = client({ platform: 'linux' })
    run.mockResolvedValue({
      stdout: 'nekode-test',
      stdoutBytes: bytes('nekode-test'),
      stderr: '',
      exitCode: 0,
    })
    await expect(ssh.runScriptBytes(target('ssh://host/p'), 'pwd -P')).rejects.toMatchObject({
      code: 'unknown',
      message: 'The remote host did not run the command with a POSIX shell.',
    })
  })

  it('reads an empty payload as one empty field', async () => {
    const { client: ssh, run } = client({ platform: 'linux' })
    run.mockResolvedValue({
      stdout: 'nekode-test\u0000',
      stdoutBytes: bytes('nekode-test\u0000'),
      stderr: '',
      exitCode: 0,
    })
    await expect(ssh.runScriptBytes(target('ssh://host/p'), 'pwd -P')).resolves.toEqual({
      exitCode: 0,
      fields: [new Uint8Array()],
    })
  })

  it('splits fields on NUL and keeps a trailing NUL as an empty field', async () => {
    const { client: ssh, run } = client({ platform: 'linux' })
    run.mockResolvedValue({
      stdout: 'nekode-test\u0000/srv/app\u0000/srv/app/src\u0000',
      stdoutBytes: bytes('nekode-test\u0000/srv/app\u0000/srv/app/src\u0000'),
      stderr: '',
      exitCode: 0,
    })
    await expect(ssh.runScriptBytes(target('ssh://host/p'), 'pwd -P')).resolves.toEqual({
      exitCode: 0,
      fields: [bytes('/srv/app'), bytes('/srv/app/src'), new Uint8Array()],
    })
  })

  it('keeps NUL field boundaries and invalid UTF-8 bytes from the raw stdout', async () => {
    const { client: ssh, run } = client({ platform: 'linux' })
    run.mockResolvedValue({
      // The decoded text is lossy on purpose: the byte form must win.
      stdout: 'nekode-test\u0000A\u0000B\u0000\ufffd\ufffd',
      stdoutBytes: Uint8Array.from([
        ...bytes('nekode-test'),
        0x00,
        0x41,
        0x00,
        0x42,
        0x00,
        0xff,
        0xfe,
      ]),
      stderr: '',
      exitCode: 0,
    })
    const result = await ssh.runScriptBytes(target('ssh://host/p'), 'cat "$1"', ['/p'])
    expect(result.fields).toEqual([bytes('A'), bytes('B'), Uint8Array.from([0xff, 0xfe])])
  })

  it('falls back to the decoded text when the runner captures no bytes', async () => {
    const { client: ssh, run } = client({ platform: 'linux' })
    run.mockResolvedValue({ stdout: 'nekode-test\u0000/srv/app\n', stderr: '', exitCode: 0 })
    await expect(ssh.runScriptBytes(target('ssh://host/p'), 'pwd -P')).resolves.toEqual({
      exitCode: 0,
      fields: [bytes('/srv/app\n')],
    })
  })
})

describe('failure mapping', () => {
  const cases: Array<[string, string, string, string]> = [
    [
      'unresolvable host',
      'ssh: Could not resolve hostname nope: Name or service not known',
      'network',
      'The SSH host could not be resolved.',
    ],
    [
      'refused connection',
      'ssh: connect to host minipc port 22: Connection refused',
      'network',
      'The SSH host is unreachable.',
    ],
    [
      'connect timeout',
      'ssh: connect to host minipc port 22: Connection timed out',
      'network',
      'The SSH host is unreachable.',
    ],
    [
      'authentication required',
      'tomek@minipc: Permission denied (publickey,password).',
      'auth',
      'The SSH host requires interactive authentication. Open a terminal for this project or configure a key or agent.',
    ],
    [
      'unknown host key',
      'No ED25519 host key is known for [minipc]:22 and you have requested strict checking.',
      'auth',
      'The SSH host key is not trusted. Verify the host key in known_hosts.',
    ],
    [
      'changed host key',
      '@@@@@@@@\nWARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!',
      'auth',
      'The SSH host key is not trusted. Verify the host key in known_hosts.',
    ],
    [
      'host key verification',
      'Host key verification failed.',
      'auth',
      'The SSH host key is not trusted. Verify the host key in known_hosts.',
    ],
  ]

  it.each(cases)('classifies %s from exit 255', (_label, stderr, code, message) => {
    const error = sshFailure(255, stderr)
    expect(error).toMatchObject({ code, message })
    // The raw stderr never reaches the message.
    expect(error?.message).not.toContain('minipc')
    expect(error?.message).not.toContain('Permission denied')
  })

  it('falls back to a sanitized unknown error for an unmapped 255', () => {
    expect(sshFailure(255, 'some new ssh diagnostic with /home/user/path')).toMatchObject({
      code: 'unknown',
      message: 'The SSH connection failed.',
    })
  })

  it('does not classify a successful or ordinary non-zero exit', () => {
    expect(sshFailure(0, 'Host key verification failed.')).toBeNull()
    expect(sshFailure(1, 'cd: no such file or directory')).toBeNull()
  })

  it('throws the classified error from a script run', async () => {
    const { client: ssh, run } = client({ platform: 'linux' })
    run.mockResolvedValue({
      stdout: '',
      stderr: 'tomek@minipc: Permission denied (publickey).',
      exitCode: 255,
    })
    await expect(ssh.runScript(target('ssh://host/p'), 'pwd -P')).rejects.toMatchObject({
      code: 'auth',
    })
  })

  it('maps a spawn failure to the missing client error', async () => {
    const { client: ssh, run } = client({ platform: 'linux' })
    run.mockRejectedValue(Object.assign(new Error('spawn ssh ENOENT'), { code: 'ENOENT' }))
    const error = await ssh.runScript(target('ssh://host/p'), 'pwd -P').catch((cause) => cause)
    expect(error).toBeInstanceOf(AppError)
    expect(error).toMatchObject({
      code: 'unknown',
      message: 'The OpenSSH client is not available on this machine.',
    })
  })

  it('maps a timed-out or signal-killed script to the timeout error, never not_found', async () => {
    const { client: ssh, run } = client({ platform: 'linux' })
    // The shape execFile reports when the SSH_SCRIPT_TIMEOUT_MS timeout kills
    // the child: a null exit code, killed set and the terminating signal.
    run.mockRejectedValue(
      Object.assign(new Error('Command failed'), { code: null, killed: true, signal: 'SIGTERM' }),
    )
    const error = await ssh.runScript(target('ssh://host/p'), 'pwd -P').catch((cause) => cause)
    expect(error).toBeInstanceOf(AppError)
    expect(error).toMatchObject({
      code: 'timeout',
      message: 'The SSH command did not finish in time or was interrupted.',
    })
    await expect(ssh.runScriptBytes(target('ssh://host/p'), 'pwd -P')).rejects.toMatchObject({
      code: 'timeout',
    })
  })

  it('keeps an ordinary runner rejection as the sanitized connection error', async () => {
    const { client: ssh, run } = client({ platform: 'linux' })
    run.mockRejectedValue(
      Object.assign(new Error('Command failed'), { killed: false, signal: null }),
    )
    await expect(ssh.runScript(target('ssh://host/p'), 'pwd -P')).rejects.toMatchObject({
      code: 'unknown',
      message: 'The SSH connection failed.',
    })
  })
})

describe('requireDirectory', () => {
  it('returns the canonical pwd -P result', async () => {
    const { client: ssh, run } = client({ platform: 'linux' })
    run.mockResolvedValue({ stdout: 'nekode-test\u0000/srv/real app\n', stderr: '', exitCode: 0 })
    await expect(ssh.requireDirectory(target('ssh://host/srv/link'))).resolves.toBe('/srv/real app')
    expect(run.mock.calls[0][1]).toEqual(
      expect.arrayContaining([expect.stringContaining('cd "$1" || exit 1; pwd -P'), "'/srv/link'"]),
    )
  })

  it('rejects a missing or inaccessible directory as not_found', async () => {
    const { client: ssh, run } = client({ platform: 'linux' })
    run.mockResolvedValue({
      stdout: 'nekode-test\u0000',
      stderr: 'cd: can not cd to /srv/missing',
      exitCode: 1,
    })
    await expect(ssh.requireDirectory(target('ssh://host/srv/missing'))).rejects.toMatchObject({
      code: 'not_found',
      message: 'The remote directory does not exist or is not accessible.',
      channel: 'projects:addSsh',
    })
  })

  it('rejects a payload that is not an absolute path', async () => {
    const { client: ssh, run } = client({ platform: 'linux' })
    run.mockResolvedValue({ stdout: 'nekode-test\u0000not-a-path\n', stderr: '', exitCode: 0 })
    await expect(ssh.requireDirectory(target('ssh://host/srv/app'))).rejects.toMatchObject({
      code: 'not_found',
    })
  })
})

describe('POSIX quoting helpers', () => {
  it('quotes every hostile value into one word', () => {
    expect(quotePosix('plain')).toBe("'plain'")
    expect(quotePosix("it's")).toBe("'it'\\''s'")
    expect(quotePosix('')).toBe("''")
    expect(quotePosix('a b\tc\nd')).toBe("'a b\tc\nd'")
  })

  it('assembles the fixed remote form', () => {
    expect(remoteWords('pwd -P', ['/a b'])).toEqual(['sh', '-c', "'pwd -P'", 'nekode', "'/a b'"])
    expect(remoteCommandLine('pwd -P', ['/a b'])).toBe("sh -c 'pwd -P' nekode '/a b'")
  })
})
