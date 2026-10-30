import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResumeSourcesService } from './resume-sources-service'

describe('reusable Resume sources', () => {
  let root: string
  let values: Map<string, string>
  let service: ResumeSourcesService
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'nekode-resume-sources-'))
    await mkdir(join(root, 'one'))
    await mkdir(join(root, 'two'))
    values = new Map()
    service = new ResumeSourcesService({
      state: {
        get: (key) => values.get(key) ?? null,
        set: (key, value) => {
          values.set(key, value)
        },
      },
      projects: {
        get: (id) => (['one', 'two'].includes(id) ? { path: join(root, id) } : null),
        list: () => ['one', 'two'].map((id) => ({ id, name: `Project ${id}` })),
      },
    })
  })
  afterEach(async () => {
    await service.shutdown()
    await rm(root, { recursive: true, force: true })
  })

  const fileInput = () => ({
    id: null,
    revision: null,
    name: 'Progress files',
    prompt: 'Resume from {taskPath}',
    source: {
      kind: 'files' as const,
      directory: '.',
      pattern: 'progress.txt',
      recursive: true,
      identity: 'parent' as const,
    },
  })

  it('shares persisted bindings and protects templates used by named projects', () => {
    const templates = service.put(fileInput()).templates
    const template = templates[templates.length - 1]
    service.bind('one', template.id)
    service.bind('two', template.id)
    expect(service.binding('one').templateId).toBe(template.id)
    expect(values.get('project.resumeTemplate:two')).toBeTruthy()
    expect(() => service.delete(template.id, template.revision)).toThrow(/Project one.*Project two/)
    service.bind('one', null)
    service.bind('two', null)
    expect(service.delete(template.id, template.revision).templates).not.toContainEqual(template)
  })

  it('revalidates bytes even with the same mtime and consumes each opaque selection once', async () => {
    const file = join(root, 'one', 'progress.txt')
    await writeFile(file, 'before')
    const templates = service.put({
      ...fileInput(),
      prompt: 'A {taskPath}\n{handoffPath} $& {other}',
    }).templates
    const template = templates[templates.length - 1]
    service.bind('one', template.id)
    const inventory = await service.discover('one', 'inventory')
    const token = inventory.candidates[0].token
    expect(token).not.toContain(file)
    const stamp = new Date(inventory.candidates[0].modifiedAt)
    await writeFile(file, 'after!')
    await utimes(file, stamp, stamp)
    await expect(service.prepare('one', token, 'changed')).rejects.toThrow(/changed|Refresh/)
    const fresh = await service.discover('one', 'fresh')
    const selected = fresh.candidates[0].token
    expect(await service.prepare('one', selected, 'prepare')).toBe(
      'A progress.txt\nprogress.txt $& {other}',
    )
    await expect(service.prepare('one', selected, 'duplicate')).rejects.toThrow(/selection|Refresh/)
  })

  it('rejects old project inventories, binding changes, template changes and cross-project tokens', async () => {
    await writeFile(join(root, 'one', 'progress.txt'), 'one')
    const templates = service.put(fileInput()).templates
    const template = templates[templates.length - 1]
    service.bind('one', template.id)
    service.bind('two', template.id)
    const first = await service.discover('one', 'first')
    const second = await service.discover('one', 'second')
    await expect(service.prepare('one', first.candidates[0].token, 'old')).rejects.toThrow()
    await expect(service.prepare('two', second.candidates[0].token, 'cross')).rejects.toThrow()
    service.bind('one', null)
    service.bind('one', template.id)
    await expect(service.prepare('one', second.candidates[0].token, 'binding')).rejects.toThrow()
    const third = await service.discover('one', 'third')
    service.put({ ...template, name: 'Edited' })
    await expect(service.prepare('one', third.candidates[0].token, 'edited')).rejects.toThrow()
  })

  it('persists CRUD, stable identity, duplicate identity and revision notifications', () => {
    const changed = vi.fn()
    service.onChanged(changed)
    const template = service.put(fileInput()).templates.slice(-1)[0]
    expect(service.list().templates).toContainEqual(template)
    expect(JSON.parse(values.get('resume.sources') ?? '').templates).toContainEqual(template)
    const copy = service.duplicate(template.id, template.revision).templates.slice(-1)[0]
    expect(copy.id).not.toBe(template.id)
    const updated = service
      .put({ ...template, name: 'Changed' })
      .templates.filter((row) => row.id === template.id)[0]
    expect(updated.revision).toBeGreaterThan(template.revision)
    expect(() => service.put({ ...template, name: 'Stale' })).toThrow(/changed/)
    expect(() => service.put({ ...updated, prompt: 'no path' })).toThrow()
    expect(service.delete(copy.id, copy.revision).templates.some((row) => row.id === copy.id)).toBe(
      false,
    )
    expect(changed).toHaveBeenCalledTimes(4)
  })

  it('rejects new Tests during shutdown and after shutdown completes', async () => {
    let release!: () => void
    let started!: () => void
    const running = new Promise<void>((resolve) => {
      started = resolve
    })
    let first = true
    const runCommand = vi.fn(async (_project, _source, signal: AbortSignal) => {
      if (!first) return { success: true, tasks: [] }
      first = false
      started()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      if (signal.aborted) throw signal.reason
      return { success: true, tasks: [] }
    })
    service = new ResumeSourcesService({
      state: {
        get: (key) => values.get(key) ?? null,
        set: (key, value) => {
          values.set(key, value)
        },
      },
      projects: { get: () => ({ path: root }), list: () => [] },
      runCommand,
    })
    const template = service
      .put({
        ...fileInput(),
        source: { kind: 'command', protocol: 'generic', executable: 'tool', args: [] },
      })
      .templates.slice(-1)[0]
    const pending = service.test(template.id, 'one', template.revision, 'initial')
    const rejected = expect(pending).rejects.toThrow(/cancelled/)
    await running
    const stopping = service.shutdown()
    try {
      await expect(service.test(template.id, 'one', template.revision, 'late')).rejects.toThrow(
        /shutting down/,
      )
      expect(runCommand).toHaveBeenCalledOnce()
    } finally {
      release()
      await rejected
      await stopping
    }
    await expect(service.test(template.id, 'one', template.revision, 'after')).rejects.toThrow(
      /shutting down/,
    )
    expect(runCommand).toHaveBeenCalledOnce()
  })

  it('tests one saved template against isolated roots and arbitrary filenames/parent identities', async () => {
    for (const id of ['one', 'two']) {
      await mkdir(join(root, id, `${id}-task`))
      await writeFile(join(root, id, `${id}-task`, 'progress.txt'), id)
    }
    const template = service.put(fileInput()).templates.slice(-1)[0]
    const one = await service.test(template.id, 'one', template.revision, 'one-test')
    const two = await service.test(template.id, 'two', template.revision, 'two-test')
    expect(one.candidates.map((row) => row.id)).toEqual(['one-task'])
    expect(two.candidates.map((row) => row.id)).toEqual(['two-task'])
    expect(one.candidates[0].displayPath).toBe(join('one-task', 'progress.txt'))
    expect(one.candidates[0]).not.toHaveProperty('content')
    await expect(service.test(template.id, 'missing', template.revision, 'bad')).rejects.toThrow(
      /Project/,
    )
  })

  it('retains CRUD after restart and rejects corrupt persistence without overwriting it', () => {
    const saved = service.put(fileInput())
    const restarted = new ResumeSourcesService({
      state: {
        get: (key) => values.get(key) ?? null,
        set: (key, value) => {
          values.set(key, value)
        },
      },
      projects: { get: () => null, list: () => [] },
    })
    expect(restarted.list()).toEqual(saved)
    values.set('resume.sources', '{broken')
    expect(() => restarted.put(fileInput())).toThrow(/invalid/)
    expect(values.get('resume.sources')).toBe('{broken')
  })

  it('does not accept invalid source or prompt edits and requires the saved revision for Test', async () => {
    const template = service.put(fileInput()).templates.slice(-1)[0]
    for (const patch of [
      { prompt: 'missing path' },
      { prompt: ' \n{unknown}' },
      { prompt: 'x\u0000{taskPath}' },
      { source: { ...fileInput().source, directory: '../outside' } },
      { source: { ...fileInput().source, pattern: '../progress.txt' } },
      { extra: true },
    ])
      expect(() => service.put({ ...template, ...patch })).toThrow()
    await expect(service.test(template.id, 'one', template.revision + 1, 'stale')).rejects.toThrow(
      /changed/,
    )
    expect(service.list().templates.at(-1)).toEqual(template)
  })

  it('honors recursion, stem identity, stable sort, UTF-8 and file-size limits with visible rejections', async () => {
    const project = join(root, 'one')
    await mkdir(join(project, 'nested'))
    await writeFile(join(project, 'first.txt'), 'first')
    await writeFile(join(project, 'second.txt'), 'second')
    await writeFile(join(project, 'nested', 'third.txt'), 'third')
    await writeFile(join(project, 'invalid.txt'), Buffer.from([0xff]))
    await writeFile(join(project, 'large.txt'), Buffer.alloc(1024 * 1024 + 1))
    const stamp = new Date('2026-01-01T00:00:00Z')
    await utimes(join(project, 'first.txt'), stamp, stamp)
    await utimes(join(project, 'second.txt'), stamp, stamp)
    const template = service
      .put({
        ...fileInput(),
        source: {
          kind: 'files',
          directory: '.',
          pattern: '*.txt',
          recursive: false,
          identity: 'stem',
        },
      })
      .templates.slice(-1)[0]
    const result = await service.test(template.id, 'one', template.revision, 'files')
    expect(result.candidates.map((row) => row.id)).toEqual(['first', 'second'])
    expect(result.rejections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'invalid.txt', reason: expect.stringContaining('UTF-8') }),
        expect.objectContaining({ path: 'large.txt', reason: expect.stringContaining('1 MiB') }),
      ]),
    )
    const recursive = service
      .put({
        ...template,
        source: {
          kind: 'files',
          directory: '.',
          pattern: '*.txt',
          recursive: true,
          identity: 'stem',
        },
      })
      .templates.slice(-1)[0]
    expect(
      (await service.test(recursive.id, 'one', recursive.revision, 'recursive')).candidates.map(
        (row) => row.id,
      ),
    ).toContain('third')
  })

  it('permits an explicit external root, excludes junctions and reports missing directories', async () => {
    const external = join(root, 'external')
    await mkdir(external)
    await writeFile(join(external, 'progress.txt'), 'external')
    await symlink(
      external,
      join(root, 'one', 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    const template = service.put(fileInput()).templates.slice(-1)[0]
    expect((await service.test(template.id, 'one', template.revision, 'links')).candidates).toEqual(
      [],
    )
    const outside = service
      .put({ ...template, source: { ...fileInput().source, directory: external } })
      .templates.slice(-1)[0]
    expect(
      (await service.test(outside.id, 'one', outside.revision, 'outside')).candidates[0]
        .displayPath,
    ).toBe(join(external, 'progress.txt'))
    const linked = service
      .put({ ...outside, source: { ...fileInput().source, directory: 'linked' } })
      .templates.slice(-1)[0]
    await expect(service.test(linked.id, 'one', linked.revision, 'linked')).rejects.toThrow(
      /junctions/,
    )
    const missing = service
      .put({ ...linked, source: { ...fileInput().source, directory: 'missing' } })
      .templates.slice(-1)[0]
    await expect(service.test(missing.id, 'one', missing.revision, 'missing')).rejects.toThrow(
      /directory/,
    )
  })

  it('returns a visible missing-Harness error without reading the legacy directory', async () => {
    values.set('project.handoffDir:one', '.')
    const harness = service.list().templates[0]
    await expect(service.test(harness.id, 'one', harness.revision, 'harness')).rejects.toThrow(
      /Install Agent Harness/,
    )
    expect(values.get('project.handoffDir:one')).toBe('.')
  })

  it('fails visibly at the 10,000-entry traversal limit instead of returning a partial inventory', async () => {
    const project = join(root, 'one')
    for (let offset = 0; offset < 10001; offset += 100) {
      await Promise.all(
        Array.from({ length: Math.min(100, 10001 - offset) }, (_, index) =>
          writeFile(join(project, `entry-${offset + index}.bin`), ''),
        ),
      )
    }
    const template = service.put(fileInput()).templates.slice(-1)[0]
    await expect(service.test(template.id, 'one', template.revision, 'bounded')).rejects.toThrow(
      /10,000/,
    )
  }, 30000)
})
