import { lstatSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  HARNESS_RESUME_SOURCE,
  type ResumeCommandSource,
} from '@shared/contracts/resume-sources-contract'
import { AppError } from '@shared/ipc-error'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { discoverResumeCommand, killWslSource, runResumeCommand } from './resume-source-command'
import { resumeCommandInvocation, resumePathContext } from './resume-source-files'
import { resolveWindowsExecutable, windowsResumeInvocation } from './resume-source-supervisor'
import { ResumeSourcesService } from './resume-sources-service'

const lstatExists = (path: string) => {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

describe('Resume command sources', () => {
  let root: string
  const source = (program: string, ...args: string[]): ResumeCommandSource => ({
    kind: 'command',
    protocol: 'generic',
    executable: process.execPath,
    args: ['-e', program, ...args],
  })
  const signal = () => new AbortController().signal
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'nekode-resume-command-')))
    await writeFile(join(root, 'task.txt'), 'task')
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('executes argv literally in the project cwd and accepts strict JSON without exposing bodies', async () => {
    const response = {
      success: true,
      tasks: [{ id: 'TASK-1', title: 'Current task', path: 'task.txt', status: 'active' }],
    }
    const command = source(
      'if(process.cwd()!==process.argv[2])process.exit(2);process.stdout.write(process.argv[1])',
      JSON.stringify(response),
      root,
    )
    const candidates = await discoverResumeCommand(root, command, signal())
    expect(candidates).toEqual([
      expect.objectContaining({
        id: 'TASK-1',
        displayPath: 'task.txt',
        path: join(root, 'task.txt'),
      }),
    ])
    expect(candidates[0]).not.toHaveProperty('content')
    const data = '$HOME; echo hacked & `x` {taskPath}'
    expect(
      await runResumeCommand(
        root,
        source('process.stdout.write(JSON.stringify({value:process.argv[1]}))', data),
        signal(),
      ),
    ).toEqual({ value: data })
    const argumentsWithQuotes = ['', 'quote " here', 'trail\\', 'spaces \\\\', 'żółć']
    expect(
      await runResumeCommand(
        root,
        source(
          'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
          ...argumentsWithQuotes,
        ),
        signal(),
      ),
    ).toEqual(argumentsWithQuotes)
  })

  it('computes displayPath relative to canonical root when projectPath is accessed via an alias or link', async () => {
    const linkRoot = join(root, 'link-alias')
    await symlink(root, linkRoot, process.platform === 'win32' ? 'junction' : 'dir')
    const response = {
      success: true,
      tasks: [{ id: 'TASK-1', title: 'Current task', path: 'task.txt', status: 'active' }],
    }
    const command = source(
      'process.stdout.write(process.argv[1])',
      JSON.stringify(response),
      linkRoot,
    )
    const candidates = await discoverResumeCommand(linkRoot, command, signal())
    expect(candidates).toEqual([
      expect.objectContaining({
        id: 'TASK-1',
        displayPath: 'task.txt',
        path: join(root, 'task.txt'),
      }),
    ])
  })

  it('validates one complete envelope and every optional metadata field', async () => {
    const task = { id: 'TASK-1', title: 'Task', path: 'task.txt' }
    for (const response of [
      null,
      [],
      { success: false, tasks: [] },
      { success: true, tasks: [{ ...task, id: ' ' }] },
      { success: true, tasks: [{ ...task, status: 1 }] },
      { success: true, tasks: [{ ...task, awaiting_resumption: 'yes' }] },
      { success: true, tasks: [task, { ...task, id: 'task-1' }] },
      { success: true, tasks: [task, { ...task, id: 'TASK-2' }] },
      { success: true, tasks: [{ ...task, path: '../outside.txt' }] },
      { success: true, tasks: [{ ...task, path: 'absent.txt' }] },
    ])
      await expect(
        discoverResumeCommand(
          root,
          source(''),
          signal(),
          vi.fn(async () => response),
        ),
      ).rejects.toThrow()
  })

  it('reports failed commands, invalid JSON/UTF-8 and bounded stdout without leaking source output', async () => {
    await expect(runResumeCommand(root, source('process.exit(2)'), signal())).rejects.toThrow(
      /command failed/,
    )
    await expect(
      runResumeCommand(root, source('process.stdout.write("sensitive-body")'), signal()),
    ).rejects.toThrow(/one valid/)
    await expect(
      runResumeCommand(root, source('process.stdout.write(Buffer.from([255]))'), signal()),
    ).rejects.toThrow(/UTF-8/)
    await expect(
      runResumeCommand(
        root,
        source('process.stdout.write("x".repeat(1000));setInterval(()=>{},1000)'),
        signal(),
        { maxBytes: 32 },
      ),
    ).rejects.toThrow(/10 MiB/)
    await expect(
      runResumeCommand(
        root,
        {
          kind: 'command',
          protocol: 'generic',
          executable: 'nekode-missing-resume-executable-142',
          args: [],
        },
        signal(),
      ),
    ).rejects.toThrow(/Cannot start/)
  }, 15000)

  it('reserves supervisor exit codes only for supervised sources', async () => {
    // The Windows Job-object supervisor owns native Windows sources; elsewhere 254 is the source's own code.
    await expect(runResumeCommand(root, source('process.exit(254)'), signal())).rejects.toThrow(
      process.platform === 'win32' ? /containment failed/ : /command failed/,
    )
  }, 15000)

  it('starts the fixed Windows supervisor from the system directory only', () => {
    const command = source('')
    const invocation = windowsResumeInvocation(command, 'C:\\Windows', 'C:\\node\\node.exe')
    expect(invocation.file).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    const config = {
      application: 'C:\\node\\node.exe',
      executable: command.executable,
      args: command.args,
    }
    expect(invocation.stdin).toContain(
      Buffer.from(JSON.stringify(config), 'utf8').toString('base64'),
    )
    expect(() => windowsResumeInvocation(command, undefined, 'C:\\node\\node.exe')).toThrow(
      /system directory/,
    )
  })

  it('resolves Windows executables like Node: cwd, then PATH, exact name, then .com and .exe', () => {
    const present = new Set([
      'C:\\project\\tool.exe',
      'C:\\bin\\tool.com',
      'C:\\bin\\python.exe',
      'C:\\bin\\run.py',
      'C:\\project\\sub\\local.exe',
    ])
    const exists = (path: string) => present.has(path)
    const path = 'C:\\Windows\\System32;"C:\\bin";;'
    expect(resolveWindowsExecutable('tool', 'C:\\project', path, exists)).toBe(
      'C:\\project\\tool.exe',
    )
    expect(resolveWindowsExecutable('python', 'C:\\project', path, exists)).toBe(
      'C:\\bin\\python.exe',
    )
    expect(resolveWindowsExecutable('run.py', 'C:\\project', path, exists)).toBe('C:\\bin\\run.py')
    expect(resolveWindowsExecutable('sub\\local', 'C:\\project', path, exists)).toBe(
      'C:\\project\\sub\\local.exe',
    )
    // A name with a path component never searches PATH.
    expect(resolveWindowsExecutable('x\\python', 'C:\\project', path, exists)).toBeNull()
    expect(resolveWindowsExecutable('missing', 'C:\\project', path, exists)).toBeNull()
  })

  const storeAlias =
    process.platform === 'win32' && process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'winget.exe')
      : ''
  it.skipIf(storeAlias === '' || !lstatExists(storeAlias))(
    'resolves a real app execution alias that stat rejects',
    () => {
      expect(resolveWindowsExecutable(storeAlias, root, '')).toBe(storeAlias)
    },
  )

  it('runs a real source with an empty argument list', async () => {
    // Node with no arguments reads EOF from stdin, exits 0 and prints nothing.
    await expect(
      runResumeCommand(
        root,
        { kind: 'command', protocol: 'generic', executable: process.execPath, args: [] },
        signal(),
      ),
    ).rejects.toThrow(/one valid/)
  }, 15000)

  it('cancels a real owned child and completes cleanup before shutdown returns', async () => {
    const values = new Map<string, string>()
    const service = new ResumeSourcesService({
      state: {
        get: (key) => values.get(key) ?? null,
        set: (key, value) => {
          values.set(key, value)
        },
      },
      projects: { get: () => ({ path: root }) },
    })
    const template = service
      .put({
        id: null,
        revision: null,
        name: 'Slow',
        prompt: '{taskPath}',
        source: source('setInterval(()=>{},1000)'),
      })
      .templates.slice(-1)[0]
    const pending = service.test(template.id, 'project', template.revision, 'cancel')
    const rejection = expect(pending).rejects.toThrow(/cancelled/)
    await service.shutdown()
    await rejection
  }, 15000)

  it.each(['complete', 'cancel'])(
    'reaps the real source tree on %s',
    async (mode) => {
      const controller = new AbortController()
      let descendant = 0
      const pidPath = join(root, 'descendant.pid')
      const scriptPath = join(root, 'source.ps1')
      const descendantPath = join(root, 'descendant.cjs')
      const readyPath = join(root, 'source-ready.pid')
      await writeFile(
        descendantPath,
        'require("node:fs").writeFileSync(process.argv[2],String(process.pid));setTimeout(()=>{},10000)',
      )
      await writeFile(
        scriptPath,
        '$ErrorActionPreference="Stop"\nStart-Process -FilePath $args[0] -ArgumentList @($args[1],$args[2]) -NoNewWindow\nwhile (!(Test-Path -LiteralPath $args[2])) { Start-Sleep -Milliseconds 10 }\n$childId=[int](Get-Content -LiteralPath $args[2]); if (!(Get-Process -Id $childId)) { exit 2 }\n[IO.File]::WriteAllText($args[3],[string]$PID)\nif ($args[4] -eq "cancel") { Start-Sleep -Seconds 10 }\n[Console]::Out.Write(\'{"success":true,"tasks":[]}\')\n',
      )
      const command: ResumeCommandSource =
        process.platform === 'win32'
          ? {
              kind: 'command',
              protocol: 'generic',
              executable: 'powershell.exe',
              args: [
                '-NoProfile',
                '-NonInteractive',
                '-File',
                scriptPath,
                process.execPath,
                descendantPath,
                pidPath,
                readyPath,
                mode,
              ],
            }
          : source(
              'const {spawn}=require("node:child_process");const fs=require("node:fs");const child=spawn(process.execPath,process.argv.slice(1,3),{stdio:"inherit"});const ready=setInterval(()=>{if(!fs.existsSync(process.argv[2]))return;clearInterval(ready);process.kill(child.pid,0);fs.writeFileSync(process.argv[3],String(process.pid));if(process.argv[4]==="cancel")setTimeout(()=>{},10000);else{process.stdout.write(JSON.stringify({success:true,tasks:[]}));process.exit(0)}},10)',
              descendantPath,
              pidPath,
              readyPath,
              mode,
            )
      const started = Date.now()
      try {
        const pending = runResumeCommand(root, command, controller.signal)
        if (mode === 'cancel') {
          const rejection = expect(pending).rejects.toThrow(/cancelled/)
          while (true) {
            try {
              await readFile(readyPath)
              break
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
              if (Date.now() - started > 5000) throw new Error('Source did not become ready.')
              await new Promise((resolve) => setTimeout(resolve, 25))
            }
          }
          controller.abort(new AppError('conflict', 'cancelled'))
          await rejection
        } else await expect(pending).resolves.toEqual({ success: true, tasks: [] })
        descendant = Number(await readFile(pidPath, 'utf8'))
        const leader = Number(await readFile(readyPath, 'utf8'))
        expect(() => process.kill(leader, 0)).toThrow()
        expect(Date.now() - started).toBeLessThan(6000)
        expect(() => process.kill(descendant, 0)).toThrow()
      } finally {
        if (descendant === 0) descendant = Number(await readFile(pidPath, 'utf8'))
        try {
          process.kill(descendant, 'SIGKILL')
        } catch {
          // The expected successful cleanup already terminated this process.
        }
      }
    },
    15000,
  )

  it('times out and invalidates in-flight Test on template edit and project removal', async () => {
    const values = new Map<string, string>()
    const runner = vi.fn(
      async (_root: string, _source: ResumeCommandSource, abort: AbortSignal) =>
        new Promise<never>((_resolve, reject) => {
          if (abort.aborted) reject(abort.reason)
          else abort.addEventListener('abort', () => reject(abort.reason), { once: true })
        }),
    )
    const service = new ResumeSourcesService({
      state: {
        get: (key) => values.get(key) ?? null,
        set: (key, value) => {
          values.set(key, value)
        },
      },
      projects: { get: () => ({ path: root }) },
      timeoutMs: 20,
      runCommand: runner,
    })
    let template = service
      .put({ id: null, revision: null, name: 'Slow', prompt: '{taskPath}', source: source('') })
      .templates.slice(-1)[0]
    await expect(service.test(template.id, 'p', template.revision, 'timeout')).rejects.toThrow(
      /30 seconds/,
    )
    const changed = service.test(template.id, 'p', template.revision, 'changed')
    template = service.put({ ...template, name: 'Updated' }).templates.slice(-1)[0]
    await expect(changed).rejects.toThrow(/changed/)
    const removed = service.test(template.id, 'p', template.revision, 'removed')
    service.dropProject('p')
    await expect(removed).rejects.toThrow(/cancelled/)
    await service.shutdown()
  })

  it('consumes captured real Harness output and accepts archived unfinished and interrupted records', async () => {
    // Captured read-only taskctl list --json, agent-harness e342c90, 2026-10-29.
    const response = JSON.parse(
      await readFile(new URL('./fixtures/harness-list.json', import.meta.url), 'utf8'),
    )
    const original = response.tasks[0]
    response.tasks.push({
      ...original,
      id: 'ARCHIVED-1',
      path: '.agents/tasks/archive/ARCHIVED-1/task.md',
      status: 'blocked',
      awaiting_resumption: false,
    })
    response.tasks.push({
      ...original,
      id: 'INTERRUPTED-1',
      path: '.agents/tasks/INTERRUPTED-1/task.md',
      awaiting_resumption: false,
    })
    await mkdir(join(root, '.agents', 'scripts'), { recursive: true })
    await writeFile(join(root, '.agents', 'scripts', 'taskctl'), '')
    for (const task of response.tasks) {
      await mkdir(join(root, task.path, '..'), { recursive: true })
      await writeFile(join(root, task.path), 'fixture task record')
    }
    const rows = await discoverResumeCommand(
      root,
      HARNESS_RESUME_SOURCE,
      signal(),
      vi.fn(async () => response),
    )
    expect(rows.map((row) => row.id)).toEqual(['ARCHIVED-1', 'INTERRUPTED-1', original.id])
    for (const patch of [
      { status: 'completed' },
      { current_phase: undefined },
      { current_step: undefined },
      { next_action: undefined },
      { awaiting_resumption: undefined },
    ]) {
      await expect(
        discoverResumeCommand(
          root,
          HARNESS_RESUME_SOURCE,
          signal(),
          vi.fn(async () => ({ success: true, tasks: [{ ...original, ...patch }] })),
        ),
      ).rejects.toThrow(/Agent Harness/)
    }
  })

  it('uses the selected runtime and pins TASKCTL_ROOT without shell interpolation', () => {
    const native = resumeCommandInvocation(
      root,
      'python',
      ['.agents/scripts/taskctl', 'list', '--json'],
      true,
      'linux',
    )
    expect(native).toEqual({
      file: 'python',
      args: ['.agents/scripts/taskctl', 'list', '--json'],
      cwd: root,
    })
    const wsl = resumeCommandInvocation(
      '\\\\wsl.localhost\\Ubuntu\\home\\user\\repo',
      'python',
      ['.agents/scripts/taskctl', 'list', '--json'],
      true,
      'win32',
    )
    expect(wsl.file).toBe('wsl.exe')
    expect(wsl.args).toEqual([
      '--distribution',
      'Ubuntu',
      '--cd',
      '/home/user/repo',
      '--exec',
      'env',
      'TASKCTL_ROOT=/home/user/repo',
      'python',
      '.agents/scripts/taskctl',
      'list',
      '--json',
    ])
    expect(() =>
      resumeCommandInvocation(
        '\\\\wsl.localhost\\Ubuntu\\home\\user\\repo',
        'C:\\python.exe',
        [],
        false,
        'win32',
      ),
    ).toThrow(/Linux executable/)
    expect(() =>
      resumeCommandInvocation(
        '\\\\wsl.localhost\\Ubuntu\\home\\user\\repo',
        'python',
        [],
        true,
        'linux',
      ),
    ).toThrow(/running on Windows/)
    expect(() => resumeCommandInvocation(root, 'script.cmd', [], false, 'win32')).toThrow(
      /executable/,
    )
    const paths = resumePathContext('\\\\wsl.localhost\\Ubuntu\\home\\user\\repo', 'win32')
    expect(paths.filesystem('/tmp/context.txt')).toBe('\\\\wsl.localhost\\Ubuntu\\tmp\\context.txt')
    expect(paths.display('\\\\wsl.localhost\\Ubuntu\\tmp\\context.txt')).toBe('/tmp/context.txt')
    expect(() => paths.filesystem('C:\\context')).toThrow(/Linux paths/)
  })

  it('pins the native Harness root instead of inheriting TASKCTL_ROOT', async () => {
    const before = process.env.TASKCTL_ROOT
    process.env.TASKCTL_ROOT = 'wrong-root'
    try {
      const command = {
        ...source('process.stdout.write(JSON.stringify({root:process.env.TASKCTL_ROOT}))'),
        protocol: 'agent-harness' as const,
      }
      expect(await runResumeCommand(root, command, signal())).toEqual({ root })
    } finally {
      if (before === undefined) delete process.env.TASKCTL_ROOT
      else process.env.TASKCTL_ROOT = before
    }
  })

  // Opt-in: needs a real Windows-hosted WSL distribution with sh, setsid, pgrep, ps and sleep.
  const wslDistribution = process.env.NEKODE_WSL_SMOKE_DISTRO
  it.skipIf(process.platform !== 'win32' || !wslDistribution).each(['complete', 'cancel'])(
    'reaps a real WSL source descendant on %s and passes argv literally',
    async (mode) => {
      const distribution = wslDistribution as string
      const linuxRoot = `/tmp/nekode-resume-wsl-${Date.now()}-${mode}`
      const project = `\\\\wsl.localhost\\${distribution}${linuxRoot.replaceAll('/', '\\')}`
      await mkdir(project, { recursive: true })
      const alive = async (pid: number) => {
        const { spawnSync } = await import('node:child_process')
        return (
          spawnSync(
            'wsl.exe',
            ['--distribution', distribution, '--exec', 'kill', '-0', String(pid)],
            {
              windowsHide: true,
            },
          ).status === 0
        )
      }
      try {
        const literal = 'a b " \\ $HOME `x` ; * żółć'
        expect(
          await runResumeCommand(
            project,
            {
              kind: 'command',
              protocol: 'generic',
              executable: 'printf',
              args: ['{"value":"%s"}', literal.replaceAll('\\', '\\\\').replaceAll('"', '\\"')],
            },
            signal(),
          ),
        ).toEqual({ value: literal })
        // The descendant inherits stdout and would hold the pipe open for 10 seconds.
        const script =
          'sleep 10 & echo $! > descendant.pid; echo $$ > ready.pid; ' +
          'if [ "$1" = cancel ]; then sleep 10; fi; printf %s "{\\"success\\":true,\\"tasks\\":[]}"'
        const controller = new AbortController()
        const started = Date.now()
        const pending = runResumeCommand(
          project,
          {
            kind: 'command',
            protocol: 'generic',
            executable: 'sh',
            args: ['-c', script, 'sh', mode],
          },
          controller.signal,
        )
        if (mode === 'cancel') {
          const rejection = expect(pending).rejects.toThrow(/cancelled/)
          while (true) {
            try {
              await readFile(join(project, 'ready.pid'))
              break
            } catch (error) {
              if (Date.now() - started > 8000) throw error
              await new Promise((resolve) => setTimeout(resolve, 50))
            }
          }
          controller.abort(new AppError('conflict', 'cancelled'))
          await rejection
        } else await expect(pending).resolves.toEqual({ success: true, tasks: [] })
        expect(Date.now() - started).toBeLessThan(9000)
        const descendant = Number(await readFile(join(project, 'descendant.pid'), 'utf8'))
        const leader = Number(await readFile(join(project, 'ready.pid'), 'utf8'))
        expect(await alive(descendant)).toBe(false)
        expect(await alive(leader)).toBe(false)
      } finally {
        await rm(project, { recursive: true, force: true })
      }
    },
    30000,
  )

  it('cancels the retained WSL group before wrappers regardless of process ordering', async () => {
    const runner = vi.fn(async (_file: string, args: string[]) => {
      const utility = args.slice(3)
      if (utility[0] === 'pgrep') return { stdout: '22\n11\n' }
      if (utility[0] === 'ps') return { stdout: utility.at(-1) === '22' ? '22\n' : '1\n' }
      return { stdout: '' }
    })
    await killWslSource('Ubuntu', 'request-marker', runner)
    expect(runner.mock.calls.map((call) => call[1])).toEqual([
      ['--distribution', 'Ubuntu', '--exec', 'pgrep', '-f', 'NEKODE_RESUME_REQUEST=request-marker'],
      ['--distribution', 'Ubuntu', '--exec', 'ps', '-o', 'pgid=', '-p', '22'],
      ['--distribution', 'Ubuntu', '--exec', 'ps', '-o', 'pgid=', '-p', '11'],
      ['--distribution', 'Ubuntu', '--exec', 'kill', '-KILL', '--', '-22'],
      ['--distribution', 'Ubuntu', '--exec', 'kill', '-KILL', '--', '22'],
      ['--distribution', 'Ubuntu', '--exec', 'kill', '-KILL', '--', '11'],
    ])
  })
})
