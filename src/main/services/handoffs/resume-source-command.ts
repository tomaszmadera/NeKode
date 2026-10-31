import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { promisify } from 'node:util'
import type {
  ResumeCommandSource,
  ResumeSourceCandidate,
} from '@shared/contracts/resume-sources-contract'
import { AppError } from '@shared/ipc-error'
import { z } from 'zod'
import { killTree } from '../kanban/adapter-host'
import {
  abortableResumeInspection,
  checkResumeCancelled,
  inspectResumeFile,
  resumeCommandInvocation,
  resumePathContext,
} from './resume-source-files'
import {
  resolveWindowsExecutable,
  SUPERVISOR_CONTAINMENT_FAILED,
  SUPERVISOR_START_FAILED,
  WSL_RESUME_SUPERVISOR,
  windowsResumeInvocation,
} from './resume-source-supervisor'

export const MAX_RESUME_STDOUT_BYTES = 10 * 1024 * 1024
const nonblank = z
  .string()
  .max(32768)
  .refine((text) => text.trim().length > 0 && !text.includes('\u0000'))
const taskSchema = z.object({
  id: nonblank,
  title: nonblank,
  path: nonblank,
  status: nonblank.optional(),
  current_phase: nonblank.optional(),
  current_step: nonblank.optional(),
  next_action: nonblank.optional(),
  awaiting_resumption: z.boolean().optional(),
})
const envelopeSchema = z.object({ success: z.literal(true), tasks: z.array(taskSchema) })
const run = promisify(execFile)

const startFailure = (source: ResumeCommandSource, harness: boolean) =>
  new AppError(
    'config',
    harness
      ? 'Agent Harness discovery cannot start Python. Install Python in the project runtime and retry.'
      : `Cannot start Resume discovery executable ${source.executable}. Install it in the project runtime or edit the template.`,
  )
const stopFailure = () =>
  new AppError(
    'config',
    'Cannot stop owned Resume discovery processes. Close the source processes and retry.',
  )

/** Fixed utility argv only; no source text is interpreted by a shell. */
export async function killWslSource(
  distribution: string,
  marker: string,
  runner: (
    file: string,
    args: string[],
    options: { timeout: number; windowsHide: boolean; signal: AbortSignal },
  ) => Promise<{ stdout: string }> = run,
): Promise<void> {
  const signal = AbortSignal.timeout(3000)
  const utility = async (...args: string[]) => {
    try {
      return (
        await runner('wsl.exe', ['--distribution', distribution, '--exec', ...args], {
          timeout: 3000,
          windowsHide: true,
          signal,
        })
      ).stdout.trim()
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 1)
        return ''
      throw new AppError(
        'config',
        'Cannot stop WSL Resume discovery. Install the WSL setsid, pgrep, ps and kill utilities.',
      )
    }
  }
  // Read all group identities before stopping any wrapper. Shell and setsid parents
  // can appear in either order; killing one must not erase the other's group identity.
  const parents = await utility('pgrep', '-f', `NEKODE_RESUME_REQUEST=${marker}`)
  const pids = parents.split(/\s+/).filter((value) => /^\d+$/.test(value))
  const groups = new Set<string>()
  for (const pid of pids) {
    const group = await utility('ps', '-o', 'pgid=', '-p', pid)
    if (group === pid) groups.add(group)
  }
  for (const group of groups) await utility('kill', '-KILL', '--', `-${group}`)
  for (const pid of pids) {
    await utility('kill', '-KILL', '--', pid)
  }
}

export async function runResumeCommand(
  projectPath: string,
  source: ResumeCommandSource,
  signal: AbortSignal,
  deps: { spawnProcess?: typeof spawn; maxBytes?: number } = {},
): Promise<unknown> {
  checkResumeCancelled(signal)
  const harness = source.protocol === 'agent-harness'
  const context = resumePathContext(projectPath)
  const runtimeInvocation = resumeCommandInvocation(
    projectPath,
    source.executable,
    source.args,
    harness,
  )
  let windows: ReturnType<typeof windowsResumeInvocation> | null = null
  if (context.wsl === null && process.platform === 'win32') {
    const application = resolveWindowsExecutable(source.executable, projectPath, process.env.PATH)
    if (application === null) throw startFailure(source, harness)
    windows = windowsResumeInvocation(source, process.env.SystemRoot, application)
  }
  const invocation = windows === null ? runtimeInvocation : { ...windows, cwd: projectPath }
  const marker = randomUUID()
  if (context.wsl !== null) {
    // A separate Linux session permits cancelling the full source process group.
    const execAt = invocation.args.indexOf('--exec') + 1
    invocation.args.splice(
      execAt,
      0,
      'setsid',
      '--fork',
      '--wait',
      'sh',
      '-c',
      WSL_RESUME_SUPERVISOR,
      `NEKODE_RESUME_REQUEST=${marker}`,
    )
  }
  const spawner = deps.spawnProcess ?? spawn
  const child = spawner(invocation.file, invocation.args, {
    cwd: invocation.cwd,
    windowsHide: true,
    shell: false,
    stdio: [windows === null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...(harness ? { TASKCTL_ROOT: context.wsl?.linuxPath ?? projectPath } : {}),
    },
    ...(process.platform === 'win32' ? {} : { detached: true }),
  })
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let output = ''
  let bytes = 0
  let failure: AppError | null = null
  let cleanup: Promise<void> | null = null
  let stopped!: () => void
  const stopping = new Promise<void>((resolve) => {
    stopped = resolve
  })
  const killNative = () => {
    if (process.platform !== 'win32' && child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGKILL')
        return
      } catch (error) {
        // ESRCH: the group is already empty. Any other failure leaves owned processes alive.
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw stopFailure()
      }
    }
    killTree(child, spawner)
  }
  const terminate = () => {
    if (cleanup !== null) return
    cleanup = (
      context.wsl === null ? Promise.resolve() : killWslSource(context.wsl.distribution, marker)
    ).finally(killNative)
    void cleanup.then(stopped, stopped)
    // The promise is awaited below; attach a handler now to avoid an unhandled rejection.
    void cleanup.catch(() => undefined)
  }
  const abort = () => {
    terminate()
  }
  signal.addEventListener('abort', abort, { once: true })
  child.stdout?.on('data', (chunk: Buffer) => {
    if (failure !== null || signal.aborted) return
    bytes += chunk.length
    if (bytes > (deps.maxBytes ?? MAX_RESUME_STDOUT_BYTES)) {
      failure = new AppError('config', 'Resume discovery stdout exceeds the 10 MiB limit.')
      terminate()
      return
    }
    try {
      output += decoder.decode(chunk, { stream: true })
    } catch {
      failure = new AppError('config', 'Resume discovery must output valid UTF-8 JSON.')
      terminate()
    }
  })
  // Drain stderr without retaining potentially sensitive source data.
  child.stderr?.resume()
  const closed = new Promise<{ code: number | null; error?: Error }>((resolve) => {
    child.once('close', (code) => resolve({ code }))
    child.once('error', (error) => resolve({ code: null, error }))
    if (signal.aborted) abort()
  })
  child.once('exit', () => {
    if (process.platform !== 'win32') terminate()
  })
  // A failed spawn can close stdin early; the process error below owns that diagnostic.
  child.stdin?.on('error', () => undefined)
  if (windows !== null) child.stdin?.end(windows.stdin)
  let result: { code: number | null; error?: Error }
  try {
    result = await Promise.race([
      closed,
      stopping.then(async () => {
        await cleanup
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          return await Promise.race([
            closed,
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => reject(stopFailure()), 3000)
            }),
          ])
        } finally {
          clearTimeout(timer)
        }
      }),
    ])
  } finally {
    signal.removeEventListener('abort', abort)
  }
  if (cleanup !== null) await cleanup
  checkResumeCancelled(signal)
  if (failure !== null) throw failure
  // Reserved codes are meaningful only when a fixed supervisor owns the source process.
  const supervised = windows !== null || context.wsl !== null
  if (supervised && result.code === SUPERVISOR_CONTAINMENT_FAILED)
    throw new AppError(
      'config',
      'Resume source process containment failed. Check Windows PowerShell or the WSL supervisor utilities and retry.',
    )
  if (result.error !== undefined || (windows !== null && result.code === SUPERVISOR_START_FAILED))
    throw startFailure(source, harness)
  if (result.code !== 0)
    throw new AppError(
      'config',
      harness
        ? 'Agent Harness discovery failed. Check .agents/scripts/taskctl exists and update Agent Harness to a version supporting taskctl list --json.'
        : context.wsl !== null
          ? 'WSL Resume discovery failed. Install setsid (util-linux), pgrep and ps (procps), sh and kill in the distribution, and check the saved executable and arguments.'
          : 'Resume discovery command failed. Run the saved executable and arguments in the project runtime to diagnose it.',
    )
  try {
    return JSON.parse(output + decoder.decode())
  } catch {
    throw new AppError('config', 'Resume discovery must output one valid UTF-8 JSON object.')
  }
}

export async function discoverResumeCommand(
  projectPath: string,
  source: ResumeCommandSource,
  signal: AbortSignal,
  runner: typeof runResumeCommand = runResumeCommand,
): Promise<ResumeSourceCandidate[]> {
  const context = resumePathContext(projectPath)
  if (source.protocol === 'agent-harness') {
    // Distinguish a missing producer from an unsupported command or malformed output.
    try {
      await abortableResumeInspection(
        () => realpath(context.filesystem('.agents/scripts/taskctl')),
        signal,
      )
    } catch {
      checkResumeCancelled(signal)
      throw new AppError(
        'config',
        'Agent Harness script .agents/scripts/taskctl is missing. Install Agent Harness in this project.',
      )
    }
  }
  const response = envelopeSchema.safeParse(await runner(projectPath, source, signal))
  if (!response.success)
    throw new AppError(
      'config',
      source.protocol === 'agent-harness'
        ? 'Incompatible Agent Harness output. Update Agent Harness to a version supporting taskctl list --json.'
        : 'Invalid Resume discovery output. Expected success: true and tasks with id, title and path; optional metadata must have valid types.',
    )
  return abortableResumeInspection(async () => {
    const ids = new Set<string>()
    const paths = new Set<string>()
    const candidates: ResumeSourceCandidate[] = []
    const root = await realpath(projectPath)
    const canonicalContext = resumePathContext(root)
    for (const task of response.data.tasks) {
      checkResumeCancelled(signal)
      if (
        source.protocol === 'agent-harness' &&
        (!['active', 'blocked'].includes(task.status ?? '') ||
          task.current_phase === undefined ||
          task.current_step === undefined ||
          task.next_action === undefined ||
          task.awaiting_resumption === undefined)
      )
        throw new AppError(
          'config',
          'Incompatible Agent Harness task metadata. Update Agent Harness; only unfinished active or blocked tasks are accepted.',
        )
      const path = context.filesystem(task.path)
      if (!context.contains(projectPath, path))
        throw new AppError('config', 'Resume discovery reported a path outside the project.')
      try {
        const canonical = await realpath(path)
        if (!canonicalContext.contains(root, canonical))
          throw new AppError('config', 'Resume discovery reported a path outside the project.')
        const identity = task.id.toLowerCase()
        const pathIdentity = canonicalContext.pathIdentity(canonical)
        if (ids.has(identity) || paths.has(pathIdentity))
          throw new AppError(
            'config',
            'Resume discovery reported duplicate or conflicting identities or paths.',
          )
        ids.add(identity)
        paths.add(pathIdentity)
        const modifiedAt = await inspectResumeFile(canonical, signal)
        candidates.push({
          ...task,
          path: canonical,
          displayPath: canonicalContext.display(canonical),
          modifiedAt,
        })
      } catch (error) {
        checkResumeCancelled(signal)
        if (error instanceof AppError) throw error
        throw new AppError(
          'config',
          'Resume discovery reported an unreadable or missing file. Fix the source and retry.',
        )
      }
    }
    candidates.sort((a, b) => a.id.localeCompare(b.id))
    return candidates
  }, signal)
}
