import { constants } from 'node:fs'
import { lstat, open, opendir, realpath } from 'node:fs/promises'
import { basename, dirname, extname, join, posix, resolve, win32 } from 'node:path'
import type {
  ResumeSourceCandidate,
  ResumeSourcePreview,
} from '@shared/contracts/resume-sources-contract'
import { AppError } from '@shared/ipc-error'
import { parseWslPath } from '@shared/wsl-path'

export const MAX_RESUME_FILE_BYTES = 1024 * 1024
export const MAX_RESUME_VISITED = 10000

export function checkResumeCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason
}

/** Filesystem calls cannot all be interrupted; release their handles when they settle. */
export async function abortableResumeInspection<T>(
  inspect: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  checkResumeCancelled(signal)
  let abort!: () => void
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
  })
  try {
    return await Promise.race([inspect(), cancelled])
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

/** Linux prompt paths and Windows filesystem paths stay separate for WSL projects. */
export function resumePathContext(
  projectPath: string,
  platform: NodeJS.Platform = process.platform,
) {
  const wsl = parseWslPath(projectPath)
  if (wsl !== null && platform !== 'win32')
    throw new AppError('config', 'WSL Resume sources require NeKode running on Windows.')
  const native = platform === 'win32' ? win32 : posix
  const linuxLocation = (path: string) => {
    // A source may use the distribution root even though a registered project may not.
    const root = /^\/\/(?:wsl\$|wsl\.localhost)\/([^/]+)\/?$/i.exec(path.replaceAll('\\', '/'))
    const location = root === null ? parseWslPath(path) : { distribution: root[1], linuxPath: '/' }
    if (
      location === null ||
      location.distribution.toLowerCase() !== wsl?.distribution.toLowerCase()
    )
      throw new AppError('config', 'Resume files must use the project WSL distribution.')
    return location.linuxPath
  }
  const contains = (root: string, path: string) => {
    const paths = wsl === null ? native : posix
    const rel = paths.relative(
      wsl === null ? root : linuxLocation(root),
      wsl === null ? path : linuxLocation(path),
    )
    return (
      rel === '' || (rel !== '..' && !rel.startsWith(`..${paths.sep}`) && !paths.isAbsolute(rel))
    )
  }
  return {
    wsl,
    contains,
    pathIdentity: (path: string) =>
      wsl !== null
        ? posix.normalize(linuxLocation(path))
        : platform === 'win32'
          ? win32.normalize(path).toLowerCase()
          : posix.normalize(path),
    filesystem: (path: string): string => {
      if (wsl !== null) {
        if (/[\\:]/.test(path))
          throw new AppError('config', 'Use Linux paths for a WSL Resume source.')
        const linuxPath = posix.resolve(wsl.linuxPath, path)
        return `\\\\wsl.localhost\\${wsl.distribution}${linuxPath.replaceAll('/', '\\')}`
      }
      return native.resolve(projectPath, path)
    },
    display: (path: string): string => {
      if (wsl !== null) {
        const linuxPath = linuxLocation(path)
        const rel = posix.relative(wsl.linuxPath, linuxPath)
        return rel !== '..' && !rel.startsWith('../') && !posix.isAbsolute(rel) ? rel : linuxPath
      }
      return contains(projectPath, path) ? native.relative(projectPath, path) : path
    },
    absolute: (path: string) => (wsl === null ? native.isAbsolute(path) : path.startsWith('/')),
  }
}

/** Reject links including a configured root or a parent directory junction. */
export async function assertNoResumeLinks(path: string, signal: AbortSignal): Promise<void> {
  const ancestors: string[] = []
  for (let current = resolve(path); dirname(current) !== current; current = dirname(current))
    ancestors.push(current)
  for (const ancestor of ancestors.reverse()) {
    checkResumeCancelled(signal)
    if ((await lstat(ancestor)).isSymbolicLink())
      throw new AppError('config', 'Symlinks and directory junctions are excluded.')
  }
}

/** Bound the actual read, including a file that grows after stat. Never return its body. */
export async function inspectResumeFile(path: string, signal: AbortSignal): Promise<string> {
  checkResumeCancelled(signal)
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    checkResumeCancelled(signal)
    const stat = await file.stat()
    if (!stat.isFile()) throw new AppError('config', 'Expected a regular readable file.')
    if (stat.size > MAX_RESUME_FILE_BYTES)
      throw new AppError('config', 'File exceeds the 1 MiB limit.')
    const bytes = Buffer.alloc(MAX_RESUME_FILE_BYTES + 1)
    let size = 0
    while (size < bytes.length) {
      checkResumeCancelled(signal)
      const result = await file.read(bytes, size, bytes.length - size)
      if (result.bytesRead === 0) break
      size += result.bytesRead
    }
    if (size > MAX_RESUME_FILE_BYTES) throw new AppError('config', 'File exceeds the 1 MiB limit.')
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size))
    } catch {
      throw new AppError('config', 'File is not valid UTF-8.')
    }
    return stat.mtime.toISOString()
  } finally {
    await file.close()
  }
}

/** O(pattern code points * filename code points), without regex backtracking. */
function matchesResumeName(pattern: string, name: string): boolean {
  const characters = [...name]
  const matches = new Uint8Array(characters.length + 1)
  matches[0] = 1
  for (const token of pattern) {
    let previous = matches[0]
    if (token !== '*') matches[0] = 0
    for (let index = 1; index < matches.length; index++) {
      const current = matches[index]
      matches[index] =
        token === '*'
          ? Number(current !== 0 || matches[index - 1] !== 0)
          : Number(previous !== 0 && (token === '?' || token === characters[index - 1]))
      previous = current
    }
  }
  return matches[characters.length] !== 0
}

export function resumeReadError(error: unknown): string {
  return error instanceof AppError
    ? error.message
    : 'Cannot read this path. Check that it exists and is readable.'
}

export async function discoverResumeFiles(
  projectPath: string,
  source: import('@shared/contracts/resume-sources-contract').ResumeFileSource,
  signal: AbortSignal,
): Promise<Pick<ResumeSourcePreview, 'candidates' | 'rejections'>> {
  const context = resumePathContext(projectPath)
  const root = context.filesystem(source.directory)
  if (!context.absolute(source.directory) && !context.contains(projectPath, root))
    throw new AppError('config', 'A relative Resume directory must stay within the project.')
  let canonicalRoot: string
  try {
    await assertNoResumeLinks(root, signal)
    canonicalRoot = await realpath(root)
    if (
      !context.absolute(source.directory) &&
      !context.contains(await realpath(projectPath), canonicalRoot)
    )
      throw new AppError('config', 'The Resume directory leaves the project.')
  } catch (error) {
    checkResumeCancelled(signal)
    throw new AppError('config', `Resume directory ${source.directory}: ${resumeReadError(error)}`)
  }
  const candidates: ResumeSourceCandidate[] = []
  const rejections: ResumeSourcePreview['rejections'] = []
  const pending = [root]
  let visited = 0
  while (pending.length > 0) {
    checkResumeCancelled(signal)
    const directory = pending.pop()
    if (directory === undefined) break
    let entries: Awaited<ReturnType<typeof opendir>>
    try {
      entries = await opendir(directory)
    } catch {
      throw new AppError(
        'config',
        `Cannot list Resume directory ${context.display(directory)}. Check its permissions.`,
      )
    }
    try {
      for await (const entry of entries) {
        const name = entry.name
        checkResumeCancelled(signal)
        if (++visited > MAX_RESUME_VISITED)
          throw new AppError(
            'config',
            'Resume search exceeds 10,000 visited entries. Narrow the directory or disable recursion.',
          )
        const path = join(directory, name)
        let stat: Awaited<ReturnType<typeof lstat>>
        try {
          stat = await lstat(path)
        } catch {
          if (entry.isDirectory())
            throw new AppError(
              'config',
              `Cannot inspect Resume directory ${context.display(path)}.`,
            )
          if (matchesResumeName(source.pattern, name))
            rejections.push({
              path: context.display(path),
              reason: 'Cannot inspect this file. Check that it still exists and is readable.',
            })
          continue
        }
        if (stat.isSymbolicLink()) continue
        if (stat.isDirectory()) {
          if (source.recursive) pending.push(path)
          continue
        }
        if (!stat.isFile() || !matchesResumeName(source.pattern, name)) continue
        try {
          await assertNoResumeLinks(path, signal)
          if (!context.contains(canonicalRoot, await realpath(path)))
            throw new AppError('config', 'File leaves the configured Resume directory.')
          const modifiedAt = await inspectResumeFile(path, signal)
          const id =
            source.identity === 'parent' ? basename(directory) : basename(name, extname(name))
          if (id.trim().length === 0)
            throw new AppError('config', 'File has no candidate identity.')
          candidates.push({ id, title: name, path, displayPath: context.display(path), modifiedAt })
        } catch (error) {
          checkResumeCancelled(signal)
          rejections.push({ path: context.display(path), reason: resumeReadError(error) })
        }
      }
    } catch (error) {
      checkResumeCancelled(signal)
      if (error instanceof AppError) throw error
      throw new AppError(
        'config',
        `Cannot list Resume directory ${context.display(directory)}. Check its permissions.`,
      )
    }
  }
  candidates.sort(
    (a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.path.localeCompare(b.path),
  )
  return { candidates, rejections }
}

/** Lexical WSL invocation is testable without invoking another distribution. */
export function resumeCommandInvocation(
  projectPath: string,
  executable: string,
  args: string[],
  harness: boolean,
  platform: NodeJS.Platform = process.platform,
) {
  const { wsl } = resumePathContext(projectPath, platform)
  if (wsl !== null) {
    if (
      /[\\:]/.test(executable) ||
      /\.(exe|com|cmd|bat)$/i.test(executable) ||
      executable.startsWith('-')
    )
      throw new AppError('config', 'A WSL Resume source requires a Linux executable.')
    return {
      file: 'wsl.exe',
      args: [
        '--distribution',
        wsl.distribution,
        '--cd',
        wsl.linuxPath,
        '--exec',
        ...(harness ? ['env', `TASKCTL_ROOT=${wsl.linuxPath}`] : []),
        executable,
        ...args,
      ],
      cwd: process.cwd(),
    }
  }
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(executable))
    throw new AppError(
      'config',
      'Use an executable for Resume discovery. Shell scripts are not run through cmd.exe.',
    )
  return { file: executable, args, cwd: projectPath }
}
