import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppError } from '@shared/ipc-error'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverResumeCommand } from './resume-source-command'
import { discoverResumeFiles, inspectResumeFile, resumePathContext } from './resume-source-files'

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof fs>()
  return {
    ...actual,
    open: vi.fn(actual.open),
    realpath: vi.fn(actual.realpath),
    lstat: vi.fn(actual.lstat),
    opendir: vi.fn(actual.opendir),
  }
})

const signal = () => new AbortController().signal
const source = {
  kind: 'files' as const,
  directory: '.',
  pattern: '*.md',
  recursive: false,
  identity: 'stem' as const,
}
const command = {
  kind: 'command' as const,
  protocol: 'generic' as const,
  executable: 'tool',
  args: [],
}
const wslRoot = '\\\\wsl.localhost\\Ubuntu\\home\\u\\repo'

afterEach(async () => {
  const actual = await vi.importActual<typeof fs>('node:fs/promises')
  vi.mocked(fs.open).mockReset().mockImplementation(actual.open)
  vi.mocked(fs.realpath).mockReset().mockImplementation(actual.realpath)
  vi.mocked(fs.lstat).mockReset().mockImplementation(actual.lstat)
  vi.mocked(fs.opendir).mockReset().mockImplementation(actual.opendir)
})

describe('Resume source path boundaries', () => {
  it('allows WSL source distribution roots while preserving project and distribution boundaries', () => {
    const context = resumePathContext(wslRoot, 'win32')
    for (const root of ['\\\\wsl.localhost\\Ubuntu', '\\\\wsl$\\Ubuntu\\']) {
      expect(context.contains(root, context.filesystem('/task.md'))).toBe(true)
      expect(context.pathIdentity(root)).toBe('/')
      expect(context.display(root)).toBe('/')
    }
    expect(() =>
      context.contains('\\\\wsl.localhost\\Debian\\', context.filesystem('/task.md')),
    ).toThrow(/project WSL distribution/)
    expect(() =>
      context.contains(context.filesystem('/'), '\\\\wsl.localhost\\Debian\\task.md'),
    ).toThrow(/project WSL distribution/)
    expect(() => resumePathContext('\\\\wsl.localhost\\Ubuntu\\', 'win32')).toThrow(
      /absolute Linux project directory/,
    )
  })

  it.runIf(process.platform === 'win32')(
    'discovers a file under an explicit WSL distribution-root source',
    async () => {
      const root = '\\\\wsl.localhost\\Ubuntu\\'
      const path = `${root}task.md`
      vi.mocked(fs.lstat).mockResolvedValue({
        isSymbolicLink: () => false,
        isDirectory: () => false,
        isFile: () => true,
      } as Awaited<ReturnType<typeof fs.lstat>>)
      vi.mocked(fs.realpath).mockResolvedValueOnce(root).mockResolvedValueOnce(path)
      vi.mocked(fs.opendir).mockResolvedValue({
        async *[Symbol.asyncIterator]() {
          yield { name: 'task.md' }
        },
      } as unknown as Awaited<ReturnType<typeof fs.opendir>>)
      vi.mocked(fs.open).mockResolvedValue({
        stat: async () => ({ isFile: () => true, size: 0, mtime: new Date(0) }),
        read: async () => ({ bytesRead: 0 }),
        close: async () => undefined,
      } as unknown as fs.FileHandle)
      await expect(
        discoverResumeFiles(wslRoot, { ...source, directory: '/' }, signal()),
      ).resolves.toEqual({
        candidates: [
          {
            id: 'task',
            title: 'task.md',
            path,
            displayPath: '/task.md',
            modifiedAt: new Date(0).toISOString(),
          },
        ],
        rejections: [],
      })
      expect(fs.opendir).toHaveBeenCalledWith(root)
      expect(fs.open).toHaveBeenCalledOnce()
    },
  )

  it('keeps WSL Linux path case significant for containment and canonical identity', () => {
    const context = resumePathContext(wslRoot, 'win32')
    expect(context.contains(wslRoot, context.filesystem('../Repo/task.md'))).toBe(false)
    expect(context.contains(wslRoot, context.filesystem('task.md'))).toBe(true)
    expect(context.pathIdentity(context.filesystem('Task.md'))).not.toBe(
      context.pathIdentity(context.filesystem('task.md')),
    )
    const native = resumePathContext('C:\\repo', 'win32')
    expect(native.contains('C:\\repo', 'c:\\REPO\\task.md')).toBe(true)
    expect(native.pathIdentity('C:\\repo\\Task.md')).toBe(native.pathIdentity('c:\\REPO\\task.md'))
  })

  it.runIf(process.platform === 'win32')(
    'rejects a WSL command sibling with different case before filesystem access',
    async () => {
      vi.mocked(fs.realpath).mockResolvedValue(wslRoot)
      await expect(
        discoverResumeCommand(wslRoot, command, signal(), async () => ({
          success: true,
          tasks: [{ id: 'one', title: 'One', path: '/home/u/Repo/task.md' }],
        })),
      ).rejects.toThrow(/outside the project/)
      expect(fs.realpath).toHaveBeenCalledTimes(1)
    },
  )

  it.runIf(process.platform === 'win32')(
    'rejects canonical WSL command escapes and generic relative roots',
    async () => {
      const sibling = '\\\\wsl.localhost\\Ubuntu\\home\\u\\Repo'
      vi.mocked(fs.realpath)
        .mockResolvedValueOnce(wslRoot)
        .mockResolvedValueOnce(`${sibling}\\task.md`)
      await expect(
        discoverResumeCommand(wslRoot, command, signal(), async () => ({
          success: true,
          tasks: [{ id: 'one', title: 'One', path: 'task.md' }],
        })),
      ).rejects.toThrow(/outside the project/)
      await expect(
        discoverResumeFiles(wslRoot, { ...source, directory: '../Repo' }, signal()),
      ).rejects.toThrow(/within the project/)
    },
  )

  it.runIf(process.platform === 'win32')(
    'keeps distinct case-sensitive WSL canonical files in a command inventory',
    async () => {
      const first = `${wslRoot}\\Task.md`
      const second = `${wslRoot}\\task.md`
      vi.mocked(fs.realpath)
        .mockResolvedValueOnce(wslRoot)
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second)
      const file = {
        stat: async () => ({ isFile: () => true, size: 0, mtime: new Date(0) }),
        read: async () => ({ bytesRead: 0 }),
        close: async () => undefined,
      }
      vi.mocked(fs.open).mockResolvedValue(file as unknown as fs.FileHandle)
      await expect(
        discoverResumeCommand(wslRoot, command, signal(), async () => ({
          success: true,
          tasks: [
            { id: 'one', title: 'One', path: 'Task.md' },
            { id: 'two', title: 'Two', path: 'task.md' },
          ],
        })),
      ).resolves.toEqual([
        expect.objectContaining({ path: first, displayPath: 'Task.md' }),
        expect.objectContaining({ path: second, displayPath: 'task.md' }),
      ])
    },
  )

  it.runIf(process.platform === 'win32')(
    'rejects case-only canonical escapes of generic WSL roots and files',
    async () => {
      const sibling = '\\\\wsl.localhost\\Ubuntu\\home\\u\\Repo'
      vi.mocked(fs.lstat).mockResolvedValue({
        isSymbolicLink: () => false,
        isDirectory: () => false,
        isFile: () => true,
      } as Awaited<ReturnType<typeof fs.lstat>>)
      vi.mocked(fs.realpath).mockResolvedValueOnce(sibling).mockResolvedValueOnce(wslRoot)
      await expect(discoverResumeFiles(wslRoot, source, signal())).rejects.toThrow(
        /leaves the project/,
      )
      vi.mocked(fs.realpath)
        .mockResolvedValueOnce(wslRoot)
        .mockResolvedValueOnce(wslRoot)
        .mockResolvedValueOnce(`${sibling}\\task.md`)
      vi.mocked(fs.opendir).mockResolvedValue({
        async *[Symbol.asyncIterator]() {
          yield { name: 'task.md' }
        },
      } as unknown as Awaited<ReturnType<typeof fs.opendir>>)
      const result = await discoverResumeFiles(wslRoot, source, signal())
      expect(result.candidates).toEqual([])
      expect(result.rejections).toEqual([
        { path: 'task.md', reason: 'File leaves the configured Resume directory.' },
      ])
      expect(fs.open).not.toHaveBeenCalled()
    },
  )
})

describe('bounded Resume file inspection', () => {
  it.each(['*********.md', '*a*a*a*a*a*a*a*a*a*.md'])(
    'bounds repeated and interleaved wildcard work for %s',
    async (pattern) => {
      const root = await fs.mkdtemp(join(tmpdir(), 'nekode-wildcard-'))
      try {
        await fs.writeFile(join(root, `${'a'.repeat(35)}.txt`), 'no match')
        await fs.writeFile(join(root, 'aaaaaaaaaa.md'), 'match')
        const started = performance.now()
        const result = await discoverResumeFiles(root, { ...source, pattern }, signal())
        expect(result.candidates.map((row) => row.id)).toEqual(['aaaaaaaaaa'])
        expect(performance.now() - started).toBeLessThan(750)
      } finally {
        await fs.rm(root, { recursive: true, force: true })
      }
    },
    15000,
  )

  it('matches literals, one-code-point wildcards and empty star matches', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'nekode-pattern-'))
    try {
      for (const name of ['a.md', 'aa.md', '[a].md', 'ż.md', '😀.md'])
        await fs.writeFile(join(root, name), 'task')
      for (const [pattern, expected] of [
        ['?.md', ['a', 'ż', '😀']],
        ['a*.md', ['a', 'aa']],
        ['[a].md', ['[a]']],
        ['a??.md', []],
      ] as const) {
        const result = await discoverResumeFiles(root, { ...source, pattern }, signal())
        expect(result.candidates.map((row) => row.id).sort()).toEqual([...expected].sort())
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('opens with nonblocking flags and rejects a nonregular handle before reading', async () => {
    const file = {
      stat: vi.fn(async () => ({ isFile: () => false })),
      read: vi.fn(),
      close: vi.fn(async () => undefined),
    }
    vi.mocked(fs.open).mockResolvedValueOnce(file as unknown as fs.FileHandle)
    await expect(inspectResumeFile('pipe', signal())).rejects.toThrow(/regular readable file/)
    expect(fs.open).toHaveBeenCalledWith('pipe', constants.O_RDONLY | constants.O_NONBLOCK)
    expect(file.read).not.toHaveBeenCalled()
    expect(file.close).toHaveBeenCalledOnce()
  })

  it('aborts post-command inspection and closes a late handle without reading it', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'nekode-abort-file-'))
    let release!: (file: fs.FileHandle) => void
    let opened!: () => void
    const opening = new Promise<void>((resolve) => {
      opened = resolve
    })
    const file = { stat: vi.fn(), read: vi.fn(), close: vi.fn(async () => undefined) }
    vi.mocked(fs.open).mockImplementationOnce(() => {
      opened()
      return new Promise((resolve) => {
        release = resolve
      })
    })
    try {
      await fs.writeFile(join(root, 'task.md'), 'task')
      const controller = new AbortController()
      const pending = discoverResumeCommand(root, command, controller.signal, async () => ({
        success: true,
        tasks: [{ id: 'one', title: 'One', path: 'task.md' }],
      }))
      await opening
      const result = Promise.race([
        pending.catch((error: unknown) => error),
        new Promise((resolve) => setTimeout(() => resolve('blocked'), 100)),
      ])
      controller.abort(new AppError('conflict', 'inspection cancelled'))
      expect(await result).toMatchObject({ message: 'inspection cancelled' })
    } finally {
      release(file as unknown as fs.FileHandle)
      await vi.waitFor(() => expect(file.close).toHaveBeenCalledOnce())
      await fs.rm(root, { recursive: true, force: true })
    }
    expect(file.stat).not.toHaveBeenCalled()
    expect(file.read).not.toHaveBeenCalled()
  })
})
