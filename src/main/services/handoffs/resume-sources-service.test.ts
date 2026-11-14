import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResumeSourcesService } from './resume-sources-service'

const RESUME_KEY = 'instructions.resume'
const MIGRATION_KEY = 'instructions.resumeMigration'

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
      resumeInstruction: () => values.get(RESUME_KEY) ?? 'Resume task {taskPath}',
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

  it('reports the registered projects using a template without changing state', () => {
    const templates = service.put(fileInput()).templates
    const template = templates[templates.length - 1]
    service.bind('two', template.id)
    service.bind('one', template.id)

    expect(service.usage(template.id)).toEqual({
      templateId: template.id,
      projects: [
        { id: 'one', name: 'Project one' },
        { id: 'two', name: 'Project two' },
      ],
    })
    expect(service.list().revision).toBe(template.revision)
    expect(() => service.usage('missing')).toThrow(/not found/)
  })

  it('revalidates bytes even with the same mtime and consumes each opaque selection once', async () => {
    const file = join(root, 'one', 'progress.txt')
    await writeFile(file, 'before')
    values.set(RESUME_KEY, 'A {taskPath}\n{handoffPath} $& {other}')
    const templates = service.put(fileInput()).templates
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
    expect(() => service.put({ ...updated, prompt: 'Resume {taskPath}' } as never)).toThrow()
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

  it('does not accept invalid source edits or a prompt and requires the saved revision for Test', async () => {
    const template = service.put(fileInput()).templates.slice(-1)[0]
    for (const patch of [
      { prompt: 'Resume {taskPath}' },
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

  it('prepares with the current application instruction and never reads a template prompt', async () => {
    await writeFile(join(root, 'one', 'progress.txt'), 'one')
    const template = service.put(fileInput()).templates.slice(-1)[0]
    service.bind('one', template.id)
    const stored = JSON.parse(values.get('resume.sources') ?? '')
    stored.templates = stored.templates.map((row: { id: string }) =>
      row.id === template.id ? { ...row, prompt: 'Legacy {taskPath}' } : row,
    )
    values.set('resume.sources', JSON.stringify(stored))

    const first = await service.discover('one', 'first')
    expect(await service.prepare('one', first.candidates[0].token, 'p1')).toBe(
      'Resume task progress.txt',
    )
    values.set(RESUME_KEY, 'Continue from {taskPath}\nRead it first.')
    const second = await service.discover('one', 'second')
    expect(await service.prepare('one', second.candidates[0].token, 'p2')).toBe(
      'Continue from progress.txt\nRead it first.',
    )
  })

  it('lists legacy rows with a prompt without exposing it and drops it only from the saved row', () => {
    values.set(
      'resume.sources',
      JSON.stringify({
        revision: 3,
        templates: [
          {
            id: 'legacy',
            revision: 2,
            name: 'Legacy',
            prompt: 'Old {taskPath}',
            source: fileInput().source,
          },
          {
            id: 'other',
            revision: 1,
            name: 'Other',
            prompt: 'Other {taskPath}',
            source: fileInput().source,
          },
        ],
      }),
    )
    const listed = service.list()
    expect(listed.templates).toEqual([
      { id: 'legacy', revision: 2, name: 'Legacy', source: fileInput().source },
      { id: 'other', revision: 1, name: 'Other', source: fileInput().source },
    ])
    const returned = service.put({ ...listed.templates[0], name: 'Renamed' })
    for (const row of returned.templates) expect(row).not.toHaveProperty('prompt')
    const saved = JSON.parse(values.get('resume.sources') ?? '')
    const renamed = saved.templates.find((row: { id: string }) => row.id === 'legacy')
    expect(renamed).not.toHaveProperty('prompt')
    expect(renamed.name).toBe('Renamed')
    expect(saved.templates.find((row: { id: string }) => row.id === 'other').prompt).toBe(
      'Other {taskPath}',
    )
    const legacyRevision = returned.templates.find((row) => row.id === 'legacy')?.revision ?? 0
    const afterDelete = service.delete('legacy', legacyRevision)
    expect(afterDelete.templates).toEqual([
      { id: 'other', revision: 1, name: 'Other', source: fileInput().source },
    ])
  })

  describe('NEKODE-187 Resume instruction migration', () => {
    const library = (rows: Array<{ id: string; name: string; prompt?: string }>) =>
      JSON.stringify({
        revision: 1,
        templates: rows.map((row) => ({ revision: 1, source: fileInput().source, ...row })),
      })

    it('writes nothing when no library is saved', () => {
      service.migrateResumeInstruction()
      expect(values.has(RESUME_KEY)).toBe(false)
      expect(values.has(MIGRATION_KEY)).toBe(false)
    })

    it('keeps one identical common prompt', () => {
      values.set(
        'resume.sources',
        library([
          { id: 'a', name: 'A', prompt: 'Mine {taskPath}\nmore' },
          { id: 'b', name: 'B', prompt: 'Mine {taskPath}\nmore' },
        ]),
      )
      service.migrateResumeInstruction()
      expect(values.get(RESUME_KEY)).toBe('Mine {taskPath}\nmore')
      expect(values.has(MIGRATION_KEY)).toBe(false)
    })

    it('uses the default and lists differing prompts with their template names', () => {
      values.set(
        'resume.sources',
        library([
          { id: 'a', name: 'A', prompt: 'One {taskPath}' },
          { id: 'b', name: 'B', prompt: 'Two {taskPath}' },
          { id: 'c', name: 'C', prompt: 'One {taskPath}' },
        ]),
      )
      service.migrateResumeInstruction()
      expect(values.get(RESUME_KEY)).toBe('Resume task {taskPath}')
      expect(JSON.parse(values.get(MIGRATION_KEY) ?? '')).toEqual({
        prompts: [
          { prompt: 'One {taskPath}', templates: ['A', 'C'] },
          { prompt: 'Two {taskPath}', templates: ['B'] },
        ],
      })
    })

    it('prefers the prompts of templates bound to registered projects', () => {
      values.set(
        'resume.sources',
        library([
          { id: 'a', name: 'A', prompt: 'Bound {taskPath}' },
          { id: 'b', name: 'B', prompt: 'Other {taskPath}' },
        ]),
      )
      values.set('project.resumeTemplate:one', 'a')
      values.set('project.resumeTemplate:gone', 'b')
      service.migrateResumeInstruction()
      expect(values.get(RESUME_KEY)).toBe('Bound {taskPath}')
      expect(values.has(MIGRATION_KEY)).toBe(false)
    })

    it('runs once and does not rewrite stored template rows', () => {
      const raw = library([
        { id: 'a', name: 'A', prompt: 'One {taskPath}' },
        { id: 'b', name: 'B', prompt: 'Two {taskPath}' },
      ])
      values.set('resume.sources', raw)
      service.migrateResumeInstruction()
      values.set(MIGRATION_KEY, '')
      values.set(RESUME_KEY, 'Edited {taskPath}')
      service.migrateResumeInstruction()
      expect(values.get(RESUME_KEY)).toBe('Edited {taskPath}')
      expect(values.get(MIGRATION_KEY)).toBe('')
      expect(values.get('resume.sources')).toBe(raw)
    })

    it('leaves the marker unset when a write fails so the next start retries', () => {
      values.set(
        'resume.sources',
        library([
          { id: 'a', name: 'A', prompt: 'One {taskPath}' },
          { id: 'b', name: 'B', prompt: 'Two {taskPath}' },
        ]),
      )
      const failing = new ResumeSourcesService({
        state: {
          get: (key) => values.get(key) ?? null,
          set: (key) => {
            throw new Error(`write failed: ${key}`)
          },
        },
        projects: { get: () => null, list: () => [] },
      })
      expect(() => failing.migrateResumeInstruction()).toThrow(/write failed/)
      expect(values.has(RESUME_KEY)).toBe(false)
    })
  })
})
