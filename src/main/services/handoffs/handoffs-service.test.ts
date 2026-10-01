import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../../shared/ipc-error'
import { type HandoffsFsAdapter, HandoffsService } from './handoffs-service'

function fakeFs(
  entries: Record<string, Array<{ name: string; kind: 'file' | 'directory' | 'symlink' }>>,
  mtimes: Record<string, number> = {},
): HandoffsFsAdapter {
  return {
    async readdir(dirPath) {
      const list = entries[dirPath]
      if (list === undefined) {
        throw new Error('ENOENT')
      }
      return list
    },
    async stat(path) {
      const mtime = mtimes[path]
      if (mtime === undefined) {
        return null
      }
      return { isFile: true, mtimeMs: mtime }
    },
  }
}

function service(options: {
  projectPath?: string | null
  configured?: string | null
  entries?: Record<string, Array<{ name: string; kind: 'file' | 'directory' | 'symlink' }>>
  mtimes?: Record<string, number>
}): HandoffsService {
  return new HandoffsService({
    projects: {
      get: (projectId: string) =>
        projectId === 'p1' ? { path: options.projectPath ?? 'D:/code/demo' } : null,
    },
    state: { get: vi.fn(() => options.configured ?? null) },
    handoffDirKey: (projectId) => `project.handoffDir:${projectId}`,
    fs: fakeFs(options.entries ?? {}, options.mtimes),
  })
}

describe('handoffs service', () => {
  it('rejects unknown projects as not_found', async () => {
    const handoffs = service({ configured: '.agents/handoffs' })
    await expect(handoffs.list('missing')).rejects.toMatchObject({
      code: 'not_found',
      message: 'Project not found.',
    })
  })

  it('rejects an unconfigured project as a validation error', async () => {
    const handoffs = service({ configured: null })
    await expect(handoffs.list('p1')).rejects.toMatchObject({
      code: 'validation',
      message: 'Handoff directory is not configured for this project.',
    })
  })

  it('resolves a relative directory against the project root and lists files newest first', async () => {
    const dir = 'D:/code/demo/.agents/handoffs'
    const handoffs = service({
      configured: '.agents/handoffs',
      entries: {
        [dir]: [
          { name: 'old.md', kind: 'file' },
          { name: 'new.md', kind: 'file' },
          { name: 'notes', kind: 'directory' },
          { name: 'link.md', kind: 'symlink' },
        ],
      },
      mtimes: { [`${dir}/old.md`]: 1000, [`${dir}/new.md`]: 2000 },
    })
    const entries = await handoffs.list('p1')
    expect(entries).toEqual([
      { name: 'new.md', path: `${dir}/new.md`, modifiedAt: new Date(2000).toISOString() },
      { name: 'old.md', path: `${dir}/old.md`, modifiedAt: new Date(1000).toISOString() },
    ])
  })

  it('uses an absolute configured directory as-is', async () => {
    const dir = 'D:/handoffs-elsewhere'
    const handoffs = service({
      configured: dir,
      entries: { [dir]: [{ name: 'a.md', kind: 'file' }] },
      mtimes: { [`${dir}/a.md`]: 5 },
    })
    const entries = await handoffs.list('p1')
    expect(entries).toEqual([
      { name: 'a.md', path: `${dir}/a.md`, modifiedAt: new Date(5).toISOString() },
    ])
  })

  it('reports a missing configured directory as not_found naming the resolved path', async () => {
    const handoffs = service({ configured: 'missing-dir' })
    const failure = await handoffs.list('p1').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AppError)
    expect((failure as AppError).code).toBe('not_found')
    expect((failure as AppError).message).toContain('D:/code/demo/missing-dir')
  })

  it('skips broken symlinks and non-file targets', async () => {
    const dir = 'D:/code/demo/h'
    const handoffs = service({
      configured: 'h',
      entries: { [dir]: [{ name: 'broken.md', kind: 'symlink' }] },
      mtimes: {},
    })
    const entries = await handoffs.list('p1')
    expect(entries).toEqual([])
  })

  it('breaks mtime ties by case-insensitive name order', async () => {
    const dir = 'D:/code/demo/h'
    const handoffs = service({
      configured: 'h',
      entries: {
        [dir]: [
          { name: 'Beta.md', kind: 'file' },
          { name: 'alpha.md', kind: 'file' },
        ],
      },
      mtimes: { [`${dir}/Beta.md`]: 7, [`${dir}/alpha.md`]: 7 },
    })
    const entries = await handoffs.list('p1')
    expect(entries.map((entry) => entry.name)).toEqual(['alpha.md', 'Beta.md'])
  })
})
