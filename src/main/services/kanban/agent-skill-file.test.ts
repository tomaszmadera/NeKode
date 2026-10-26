import {
  mkdirSync,
  mkdtempSync,
  promises as nodeFs,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AGENT_SKILL_FILE_PATH } from '@shared/ipc-contract'
import { AppError } from '@shared/ipc-error'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdapterInvocation, AdapterRequest } from './adapter-host'
import { AgentSkillFile, buildAgentSkill } from './agent-skill-file'
import { KanbanService } from './kanban-service'
import { LocalTaskFile, parseLocalTaskDocument } from './local-task-file'

// `Teach agents` (project-home spec Behaviour 11-12, AC8, Business rules,
// Errors). Real temp directories stand in for a project root; the adapter
// host and discovery are spies that must never run.

let root: string
let projectExists: boolean

const LOCAL = { 'project.kanbanAdapter:p1': 'local-file' }
const PLANE = { 'project.kanbanAdapter:p1': 'plane' }
/** U+2014, kept out of the source text (repository prose rules). */
const EM_DASH = String.fromCharCode(0x2014)

function skillFile(): string {
  return join(root, '.agents', 'skills', 'nekode-tasks', 'SKILL.md')
}

function makeService(store: Record<string, string> = {}) {
  const values = new Map(Object.entries(store))
  const state = {
    get: vi.fn((key: string) => values.get(key) ?? null),
    set: vi.fn((key: string, value: string) => void values.set(key, value)),
    delete: vi.fn((key: string) => void values.delete(key)),
  }
  const invoke = vi.fn(async (_adapter: AdapterInvocation, _request: AdapterRequest) => {
    throw new Error('the adapter host must not run for Teach agents')
  })
  const discover = vi.fn(() => ({ adapters: [], warnings: [] }))
  const projects = {
    get: (projectId: string) => (projectId === 'p1' && projectExists ? { path: root } : null),
  }
  let counter = 0
  const service = new KanbanService({
    projects,
    state,
    adaptersDir: () => 'unused-dir',
    host: { invoke } as unknown as ConstructorParameters<typeof KanbanService>[0]['host'],
    discoverAdapters: discover,
    localFile: new LocalTaskFile({ projects }),
    skillFile: new AgentSkillFile({ projects, newId: () => `tmp-${++counter}` }),
  })
  return { service, state, invoke, discover }
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    return error as AppError
  }
  throw new Error('expected a rejection')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nekode-skill-'))
  projectExists = true
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

function frontmatter(text: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text)
  expect(match).not.toBeNull()
  const fields: Record<string, string> = {}
  for (const line of (match as RegExpExecArray)[1].split('\n')) {
    const index = line.indexOf(':')
    fields[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return fields
}

describe('skill text (Behaviour 11, Business rules)', () => {
  it('local-file names the task file, the revision rule, and forbids a second list', () => {
    const text = buildAgentSkill('local-file')
    expect(frontmatter(text)).toEqual({
      name: 'nekode-tasks',
      description: expect.stringContaining('.nekode/tasks.json'),
    })
    expect(text).toContain('`.nekode/tasks.json`')
    expect(text).toMatch(/revision/)
    expect(text).toContain('plus 1')
    expect(text).toMatch(/stale revision/i)
    expect(text).toMatch(/do not create a second task list/i)
    expect(text).not.toMatch(/kanban CLI/i)
    expect(text.endsWith('\n')).toBe(true)
    expect(text).not.toContain(EM_DASH)
  })

  it('an external source points to the tracker and forbids copies and the kanban CLI', () => {
    const text = buildAgentSkill('plane')
    expect(frontmatter(text)).toEqual({
      name: 'nekode-tasks',
      description: expect.stringContaining('tracker configured'),
    })
    expect(text).toContain('tracker configured for this project in NeKode')
    expect(text).toMatch(/do not copy tasks into the repository/i)
    expect(text).toMatch(/do not create a second task list/i)
    expect(text).toMatch(/do not call .*kanban CLI/i)
    expect(text).not.toContain('"revision"')
    expect(text).not.toContain('plane')
    expect(text).not.toContain(EM_DASH)
  })

  it('the external description does not promise repository writes', () => {
    const { description } = frontmatter(buildAgentSkill('plane'))
    expect(description).not.toMatch(/add, or update this project's tasks/)
    expect(description).toMatch(/added and updated in NeKode/)
  })

  it('local-file states the encoding and the parser rules an agent could violate', () => {
    const text = buildAgentSkill('local-file')
    expect(text).toContain('UTF-8 without a byte order mark')
    expect(text).toMatch(/`title` is a string that is not blank/)
    expect(text).toMatch(/`order` is a number/)
    expect(text).toMatch(/no two items share a `ref` or an `id`/)
    expect(text).toMatch(/no two states share an `id`/)
    expect(text).toMatch(/below `nextRef`/)
    expect(text).toMatch(/every field is required/i)
  })
})

describe('skill text matches the local-file parser', () => {
  it('a document edited exactly as the skill describes parses and NeKode writes after it', async () => {
    const { service } = makeService(LOCAL)
    await service.bindLocalFile('p1')
    const taskFile = join(root, '.nekode', 'tasks.json')
    // Steps from the skill: read, note revision, add `T-<nextRef>` with a new
    // UUID, grow nextRef and revision by 1, keep the key order, two-space
    // indent, one final newline, UTF-8 without a byte order mark.
    const read = JSON.parse(readFileSync(taskFile, 'utf8'))
    const edited = {
      schemaVersion: read.schemaVersion,
      revision: read.revision + 1,
      nextRef: read.nextRef + 1,
      states: read.states,
      items: [
        ...read.items,
        {
          ref: `T-${read.nextRef}`,
          id: '7d3f0a52-4c1e-4a8b-9f0e-2b6c1d5e8a90',
          title: 'Added by an agent',
          description: null,
          stateId: 'todo',
          priority: 'high',
          updatedAt: new Date().toISOString(),
        },
      ],
    }
    writeFileSync(taskFile, `${JSON.stringify(edited, null, 2)}\n`, 'utf8')

    const parsed = parseLocalTaskDocument(readFileSync(taskFile, 'utf8'), 'test')
    expect(parsed.revision).toBe(2)
    expect(parsed.nextRef).toBe(2)
    expect(parsed.items.map((item) => item.ref)).toEqual(['T-1'])

    const written = await service.createItem('p1', { title: 'Next from NeKode' }, 2)
    expect(written.ref).toBe('T-2')
    expect(written.revision).toBe(3)
  })

  it('a file with a byte order mark is rejected, which is why the skill forbids it', () => {
    const text = `﻿${JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      nextRef: 1,
      states: [],
      items: [],
    })}\n`
    let caught: unknown
    try {
      parseLocalTaskDocument(text, 'test')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(AppError)
    expect((caught as AppError).code).toBe('validation_error')
    expect((caught as AppError).message).toContain('not valid JSON')
  })
})

describe('Teach agents write (Behaviour 11-12, AC8)', () => {
  it('writes exactly the one skill file for local-file, with no task items', async () => {
    const { service, invoke, discover, state } = makeService(LOCAL)
    await service.bindLocalFile('p1')
    await service.createItem('p1', { title: 'Secret plan item' }, 1)
    state.set.mockClear()

    expect(await service.skillStatus('p1')).toEqual({ exists: false })
    await service.writeSkill('p1')

    expect(readFileSync(skillFile(), 'utf8')).toBe(buildAgentSkill('local-file'))
    expect(readFileSync(skillFile(), 'utf8')).not.toContain('Secret plan item')
    expect(readdirSync(root).sort()).toEqual(['.agents', '.nekode'])
    expect(readdirSync(join(root, '.agents'))).toEqual(['skills'])
    expect(readdirSync(join(root, '.agents', 'skills'))).toEqual(['nekode-tasks'])
    expect(readdirSync(join(root, '.agents', 'skills', 'nekode-tasks'))).toEqual(['SKILL.md'])
    expect(await service.skillStatus('p1')).toEqual({ exists: true })
    expect(AGENT_SKILL_FILE_PATH).toBe('.agents/skills/nekode-tasks/SKILL.md')
    expect(state.set).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
    expect(discover).not.toHaveBeenCalled()
  })

  it('writes the external-source text for a process adapter without running it', async () => {
    const { service, invoke } = makeService(PLANE)
    await service.writeSkill('p1')
    expect(readFileSync(skillFile(), 'utf8')).toBe(buildAgentSkill('plane'))
    expect(readdirSync(root)).toEqual(['.agents'])
    expect(invoke).not.toHaveBeenCalled()
  })

  it('replaces an existing skill file and keeps sibling files', async () => {
    mkdirSync(join(root, '.agents', 'skills', 'nekode-tasks'), { recursive: true })
    writeFileSync(skillFile(), 'old text', 'utf8')
    writeFileSync(join(root, '.agents', 'skills', 'nekode-tasks', 'notes.md'), 'keep', 'utf8')
    const { service } = makeService(PLANE)
    expect(await service.skillStatus('p1')).toEqual({ exists: true })
    await service.writeSkill('p1')
    expect(readFileSync(skillFile(), 'utf8')).toBe(buildAgentSkill('plane'))
    expect(readdirSync(join(root, '.agents', 'skills', 'nekode-tasks')).sort()).toEqual([
      'SKILL.md',
      'notes.md',
    ])
  })

  it('a failed rename leaves the previous skill file unchanged and no temp file', async () => {
    mkdirSync(join(root, '.agents', 'skills', 'nekode-tasks'), { recursive: true })
    writeFileSync(skillFile(), 'previous', 'utf8')
    vi.spyOn(nodeFs, 'rename').mockRejectedValueOnce(
      Object.assign(new Error('EBUSY'), { code: 'EBUSY' }),
    )
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { service } = makeService(PLANE)
    const error = await rejection(service.writeSkill('p1'))
    expect(error.code).toBe('unknown')
    expect(error.message).toContain(AGENT_SKILL_FILE_PATH)
    expect(error.message).not.toContain(root.replace(/\\/g, '/'))
    expect(readFileSync(skillFile(), 'utf8')).toBe('previous')
    expect(readdirSync(join(root, '.agents', 'skills', 'nekode-tasks'))).toEqual(['SKILL.md'])
  })

  it('a failed temp write leaves the previous skill file unchanged', async () => {
    mkdirSync(join(root, '.agents', 'skills', 'nekode-tasks'), { recursive: true })
    writeFileSync(skillFile(), 'previous', 'utf8')
    vi.spyOn(nodeFs, 'writeFile').mockRejectedValueOnce(
      Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }),
    )
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { service } = makeService(LOCAL)
    const error = await rejection(service.writeSkill('p1'))
    expect(error.code).toBe('unknown')
    expect(readFileSync(skillFile(), 'utf8')).toBe('previous')
    expect(readdirSync(join(root, '.agents', 'skills', 'nekode-tasks'))).toEqual(['SKILL.md'])
  })

  it('a temp name that already exists is not ours: it is left alone and the write fails', async () => {
    const dir = join(root, '.agents', 'skills', 'nekode-tasks')
    mkdirSync(dir, { recursive: true })
    writeFileSync(skillFile(), 'previous', 'utf8')
    // The first id the service draws is `tmp-1`.
    const foreign = join(dir, 'SKILL.md.tmp-1.tmp')
    writeFileSync(foreign, 'someone else', 'utf8')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { service } = makeService(PLANE)
    const error = await rejection(service.writeSkill('p1'))
    expect(error.code).toBe('unknown')
    expect(readFileSync(foreign, 'utf8')).toBe('someone else')
    expect(readFileSync(skillFile(), 'utf8')).toBe('previous')
  })

  it('a project removed during the write drops it: no temp file and SKILL.md unchanged', async () => {
    const dir = join(root, '.agents', 'skills', 'nekode-tasks')
    mkdirSync(dir, { recursive: true })
    writeFileSync(skillFile(), 'previous', 'utf8')
    const original = nodeFs.writeFile.bind(nodeFs)
    vi.spyOn(nodeFs, 'writeFile').mockImplementation((async (
      ...args: Parameters<typeof nodeFs.writeFile>
    ) => {
      await original(...args)
      // The project is removed while the temp file is on disk.
      projectExists = false
    }) as typeof nodeFs.writeFile)
    const rename = vi.spyOn(nodeFs, 'rename')
    const { service } = makeService(LOCAL)
    const error = await rejection(service.writeSkill('p1'))
    expect(error.code).toBe('not_found')
    expect(rename).not.toHaveBeenCalled()
    expect(readdirSync(dir)).toEqual(['SKILL.md'])
    expect(readFileSync(skillFile(), 'utf8')).toBe('previous')
  })

  it('an unbound project is rejected and writes nothing', async () => {
    const stores: Record<string, string>[] = [{}, { 'project.kanbanAdapter:p1': '' }]
    for (const store of stores) {
      const { service } = makeService(store)
      const error = await rejection(service.writeSkill('p1'))
      expect(error.code).toBe('validation_error')
      expect(readdirSync(root)).toEqual([])
    }
  })

  it('an unknown project is not_found for the write and the status', async () => {
    const { service } = makeService(LOCAL)
    expect((await rejection(service.writeSkill('nope'))).code).toBe('not_found')
    expect((await rejection(service.skillStatus('nope'))).code).toBe('not_found')
    expect(readdirSync(root)).toEqual([])
  })

  it('a missing project folder is not_found and the root is never created', async () => {
    rmSync(root, { recursive: true, force: true })
    const { service } = makeService(LOCAL)
    const error = await rejection(service.writeSkill('p1'))
    expect(error.code).toBe('not_found')
    expect(error.message).toBe('The project folder was not found.')
    expect((await rejection(service.skillStatus('p1'))).code).toBe('not_found')
    expect(() => readdirSync(root)).toThrow()
  })
})

describe('Teach agents containment (Behaviour 12)', () => {
  let outside: string

  beforeEach(() => {
    outside = mkdtempSync(join(tmpdir(), 'nekode-skill-outside-'))
  })

  afterEach(() => {
    rmSync(outside, { recursive: true, force: true })
  })

  it('an .agents junction leaving the root is rejected and writes nothing outside', async () => {
    symlinkSync(outside, join(root, '.agents'), 'junction')
    const { service } = makeService(LOCAL)
    const error = await rejection(service.writeSkill('p1'))
    expect(error.code).toBe('validation_error')
    expect(error.message).toBe('.agents resolves outside the project folder.')
    expect((await rejection(service.skillStatus('p1'))).code).toBe('validation_error')
    expect(readdirSync(outside)).toEqual([])
  })

  it('an .agents/skills junction leaving the root is rejected and writes nothing outside', async () => {
    mkdirSync(join(root, '.agents'))
    symlinkSync(outside, join(root, '.agents', 'skills'), 'junction')
    const { service } = makeService(PLANE)
    const error = await rejection(service.writeSkill('p1'))
    expect(error.code).toBe('validation_error')
    expect(error.message).toBe('.agents/skills resolves outside the project folder.')
    expect((await rejection(service.skillStatus('p1'))).code).toBe('validation_error')
    expect(readdirSync(outside)).toEqual([])
  })

  it('an .agents/skills/nekode-tasks junction leaving the root is rejected and writes nothing outside', async (context) => {
    mkdirSync(join(root, '.agents', 'skills'), { recursive: true })
    try {
      symlinkSync(outside, join(root, '.agents', 'skills', 'nekode-tasks'), 'junction')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') context.skip()
      throw error
    }
    const { service } = makeService(LOCAL)
    const error = await rejection(service.writeSkill('p1'))
    expect(error.code).toBe('validation_error')
    expect(error.message).toBe('.agents/skills/nekode-tasks resolves outside the project folder.')
    expect((await rejection(service.skillStatus('p1'))).code).toBe('validation_error')
    expect(readdirSync(outside)).toEqual([])
  })

  it('a SKILL.md symlink leaving the root is rejected and the outside file is unchanged', async (context) => {
    mkdirSync(join(root, '.agents', 'skills', 'nekode-tasks'), { recursive: true })
    const outsideFile = join(outside, 'SKILL.md')
    writeFileSync(outsideFile, 'outside', 'utf8')
    try {
      symlinkSync(outsideFile, skillFile(), 'file')
    } catch (error) {
      // Windows without Developer Mode cannot create a file symlink.
      if ((error as NodeJS.ErrnoException).code === 'EPERM') context.skip()
      throw error
    }
    const { service } = makeService(LOCAL)
    const error = await rejection(service.writeSkill('p1'))
    expect(error.code).toBe('validation_error')
    expect(error.message).toBe(`${AGENT_SKILL_FILE_PATH} resolves outside the project folder.`)
    expect((await rejection(service.skillStatus('p1'))).code).toBe('validation_error')
    expect(readFileSync(outsideFile, 'utf8')).toBe('outside')
    expect(readdirSync(outside)).toEqual(['SKILL.md'])
    expect(readdirSync(join(root, '.agents', 'skills', 'nekode-tasks'))).toEqual(['SKILL.md'])
  })

  it('an existing segment realpath cannot follow is unknown naming that segment', async () => {
    mkdirSync(join(root, '.agents', 'skills'), { recursive: true })
    const original = nodeFs.realpath.bind(nodeFs)
    vi.spyOn(nodeFs, 'realpath').mockImplementation((async (path: string) => {
      if (String(path).replace(/\\/g, '/').endsWith('/.agents/skills')) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }
      return await original(path)
    }) as typeof nodeFs.realpath)
    const { service } = makeService(LOCAL)
    const error = await rejection(service.writeSkill('p1'))
    expect(error.code).toBe('unknown')
    expect(error.message).toContain('.agents/skills')
    expect((await rejection(service.skillStatus('p1'))).code).toBe('unknown')
    expect(readdirSync(join(root, '.agents', 'skills'))).toEqual([])
  })
})
