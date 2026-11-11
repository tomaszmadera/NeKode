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
import { AgentSkillFile, agentSkillToken, buildAgentSkill } from './agent-skill-file'
import { KanbanService } from './kanban-service'
import { LocalTaskFile, parseLocalTaskDocument } from './local-task-file'

// `Teach agents` (project-home spec Behaviour 11-13, AC8, AC10-12, Business
// rules, Errors). Real temp directories stand in for a project root and the
// adapters directory; the adapter host is a spy that must never run.

let root: string
let adaptersRoot: string
let projectExists: boolean

const LOCAL = { 'project.kanbanAdapter:p1': 'local-file' }
const PLANE = { 'project.kanbanAdapter:p1': 'plane' }
/** U+2014, kept out of the source text (repository prose rules). */
const EM_DASH = String.fromCharCode(0x2014)

function skillFile(): string {
  return join(root, '.agents', 'skills', 'nekode-tasks', 'SKILL.md')
}

const LOCAL_TEXT = buildAgentSkill({ kind: 'local-file' })
const PLANE_TEXT = buildAgentSkill({ kind: 'default', adapterName: 'Plane' })
const TOKEN = 'a'.repeat(64)

interface TestAdapter {
  id: string
  name: string
  agentSkill?: string
}

function discovered(adapter: TestAdapter) {
  const dir = join(adaptersRoot, adapter.id)
  mkdirSync(dir, { recursive: true })
  return {
    info: { id: adapter.id, name: adapter.name, configSchema: [] },
    id: adapter.id,
    dir,
    invocation: { command: 'node', args: ['adapter.cjs'] },
    ...(adapter.agentSkill === undefined ? {} : { agentSkill: adapter.agentSkill }),
  }
}

function makeService(
  store: Record<string, string> = {},
  adapters: TestAdapter[] = [{ id: 'plane', name: 'Plane' }],
) {
  const values = new Map(Object.entries(store))
  const state = {
    get: vi.fn((key: string) => values.get(key) ?? null),
    set: vi.fn((key: string, value: string) => void values.set(key, value)),
    delete: vi.fn((key: string) => void values.delete(key)),
  }
  const invoke = vi.fn(async (_adapter: AdapterInvocation, _request: AdapterRequest) => {
    throw new Error('the adapter host must not run for Teach agents')
  })
  const list = adapters.map(discovered)
  const discover = vi.fn(() => ({ adapters: list, warnings: [] }))
  const projects = {
    get: (projectId: string) => (projectId === 'p1' && projectExists ? { path: root } : null),
  }
  let counter = 0
  const service = new KanbanService({
    projects,
    state,
    adaptersDir: () => adaptersRoot,
    host: { invoke } as unknown as ConstructorParameters<typeof KanbanService>[0]['host'],
    discoverAdapters: discover,
    localFile: new LocalTaskFile({ projects }),
    skillFile: new AgentSkillFile({ projects, newId: () => `tmp-${++counter}` }),
  })
  return { service, state, invoke, discover }
}

/** Preview, then confirm with the preview token. */
async function teach(service: KanbanService) {
  const preview = await service.skillPreview('p1')
  await service.writeSkill('p1', preview.token)
  return preview
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
  adaptersRoot = mkdtempSync(join(tmpdir(), 'nekode-skill-adapters-'))
  projectExists = true
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
  rmSync(adaptersRoot, { recursive: true, force: true })
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
    const text = LOCAL_TEXT
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

  it('the default text names the adapter, forbids copies and a second list, and forbids no tool', () => {
    const text = PLANE_TEXT
    expect(frontmatter(text)).toEqual({
      name: 'nekode-tasks',
      description: expect.stringContaining('tracker configured'),
    })
    expect(text).toContain('tracker configured for this project in NeKode')
    expect(text).toContain('through the Plane adapter')
    expect(text).toMatch(/do not copy tasks into the repository/i)
    expect(text).toMatch(/do not create a second task list/i)
    expect(text).toMatch(/ask the user instead of choosing/)
    // No tool and no repository tooling is named or forbidden (AC10).
    expect(text).not.toMatch(/kanban/i)
    expect(text).not.toContain('.agents')
    expect(text).not.toMatch(/do not (call|use|run)/i)
    expect(text).not.toContain('"revision"')
    expect(text).not.toContain(EM_DASH)
  })

  it('the default description does not promise repository writes', () => {
    const { description } = frontmatter(PLANE_TEXT)
    expect(description).not.toMatch(/add, or update this project's tasks/)
    expect(description).toMatch(/not in the repository/)
  })

  it('an adapter name is kept on one line', () => {
    const text = buildAgentSkill({ kind: 'default', adapterName: '  My\n\nTracker ' })
    expect(text).toContain('through the My Tracker adapter')
  })

  it('an adapter body is copied unchanged under the fixed front matter', () => {
    const body = '# Tracker\n\nUse `tracker-cli` for tasks.\n'
    const text = buildAgentSkill({ kind: 'adapter', body })
    expect(frontmatter(text)).toEqual({
      name: 'nekode-tasks',
      description: expect.stringContaining('tracker configured'),
    })
    expect(text.endsWith(`---\n\n${body}`)).toBe(true)
  })

  it('local-file states the encoding and the parser rules an agent could violate', () => {
    const text = LOCAL_TEXT
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

    const preview = await teach(service)
    expect(preview).toEqual({
      path: AGENT_SKILL_FILE_PATH,
      origin: 'local-file',
      sourceName: 'Local file',
      exists: false,
      current: null,
      text: LOCAL_TEXT,
      token: agentSkillToken(LOCAL_TEXT, null),
    })

    expect(readFileSync(skillFile(), 'utf8')).toBe(LOCAL_TEXT)
    expect(readFileSync(skillFile(), 'utf8')).not.toContain('Secret plan item')
    expect(readdirSync(root).sort()).toEqual(['.agents', '.nekode'])
    expect(readdirSync(join(root, '.agents'))).toEqual(['skills'])
    expect(readdirSync(join(root, '.agents', 'skills'))).toEqual(['nekode-tasks'])
    expect(readdirSync(join(root, '.agents', 'skills', 'nekode-tasks'))).toEqual(['SKILL.md'])
    expect(await service.skillPreview('p1')).toMatchObject({ exists: true, current: LOCAL_TEXT })
    expect(AGENT_SKILL_FILE_PATH).toBe('.agents/skills/nekode-tasks/SKILL.md')
    expect(state.set).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
    expect(discover).not.toHaveBeenCalled()
  })

  it('writes the default text for a process adapter without running it', async () => {
    const { service, invoke } = makeService(PLANE)
    const preview = await teach(service)
    expect(preview).toMatchObject({ origin: 'default', sourceName: 'Plane', text: PLANE_TEXT })
    expect(readFileSync(skillFile(), 'utf8')).toBe(PLANE_TEXT)
    expect(readdirSync(root)).toEqual(['.agents'])
    expect(invoke).not.toHaveBeenCalled()
  })

  it('replaces an existing skill file and keeps sibling files', async () => {
    mkdirSync(join(root, '.agents', 'skills', 'nekode-tasks'), { recursive: true })
    writeFileSync(skillFile(), 'old text', 'utf8')
    writeFileSync(join(root, '.agents', 'skills', 'nekode-tasks', 'notes.md'), 'keep', 'utf8')
    const { service } = makeService(PLANE)
    const preview = await teach(service)
    expect(preview).toMatchObject({ exists: true, current: 'old text' })
    expect(preview.token).toBe(agentSkillToken(PLANE_TEXT, Buffer.from('old text')))
    expect(readFileSync(skillFile(), 'utf8')).toBe(PLANE_TEXT)
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
    const { token } = await service.skillPreview('p1')
    const error = await rejection(service.writeSkill('p1', token))
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
    const { token } = await service.skillPreview('p1')
    const error = await rejection(service.writeSkill('p1', token))
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
    const { token } = await service.skillPreview('p1')
    const error = await rejection(service.writeSkill('p1', token))
    expect(error.code).toBe('unknown')
    expect(readFileSync(foreign, 'utf8')).toBe('someone else')
    expect(readFileSync(skillFile(), 'utf8')).toBe('previous')
  })

  it('a project removed during the write drops it: no temp file and SKILL.md unchanged', async () => {
    const dir = join(root, '.agents', 'skills', 'nekode-tasks')
    mkdirSync(dir, { recursive: true })
    writeFileSync(skillFile(), 'previous', 'utf8')
    const original = nodeFs.writeFile.bind(nodeFs)
    const { service } = makeService(LOCAL)
    const { token } = await service.skillPreview('p1')
    vi.spyOn(nodeFs, 'writeFile').mockImplementation((async (
      ...args: Parameters<typeof nodeFs.writeFile>
    ) => {
      await original(...args)
      // The project is removed while the temp file is on disk.
      projectExists = false
    }) as typeof nodeFs.writeFile)
    const rename = vi.spyOn(nodeFs, 'rename')
    const error = await rejection(service.writeSkill('p1', token))
    expect(error.code).toBe('not_found')
    expect(rename).not.toHaveBeenCalled()
    expect(readdirSync(dir)).toEqual(['SKILL.md'])
    expect(readFileSync(skillFile(), 'utf8')).toBe('previous')
  })

  it('an unbound project is rejected and writes nothing', async () => {
    const stores: Record<string, string>[] = [{}, { 'project.kanbanAdapter:p1': '' }]
    for (const store of stores) {
      const { service } = makeService(store)
      const error = await rejection(service.writeSkill('p1', TOKEN))
      expect(error.code).toBe('validation_error')
      expect(readdirSync(root)).toEqual([])
    }
  })

  it('an unknown project is not_found for the write and the status', async () => {
    const { service } = makeService(LOCAL)
    expect((await rejection(service.writeSkill('nope', TOKEN))).code).toBe('not_found')
    expect((await rejection(service.skillPreview('nope'))).code).toBe('not_found')
    expect(readdirSync(root)).toEqual([])
  })

  it('a missing project folder is not_found and the root is never created', async () => {
    rmSync(root, { recursive: true, force: true })
    const { service } = makeService(LOCAL)
    const error = await rejection(service.writeSkill('p1', TOKEN))
    expect(error.code).toBe('not_found')
    expect(error.message).toBe('The project folder was not found.')
    expect((await rejection(service.skillPreview('p1'))).code).toBe('not_found')
    expect(() => readdirSync(root)).toThrow()
  })
})

describe('Teach agents preview (Behaviour 11, 13, AC10-12)', () => {
  const NEKODE = { 'project.kanbanAdapter:p1': 'tracker' }
  const BODY = '# Tracker tasks\n\nUse the tracker tool to read tasks.\n'

  function declare(relative: string, content: string | Buffer | null): TestAdapter {
    const dir = join(adaptersRoot, 'tracker')
    if (content !== null) {
      const target = join(dir, ...relative.split('/'))
      mkdirSync(join(target, '..'), { recursive: true })
      writeFileSync(target, content)
    }
    return { id: 'tracker', name: 'Tracker', agentSkill: relative }
  }

  it('an adapter that declares agentSkill gets its body under the fixed front matter', async () => {
    const { service, invoke } = makeService(NEKODE, [declare('skill/SKILL.md', BODY)])
    const preview = await teach(service)
    const text = buildAgentSkill({ kind: 'adapter', body: BODY })
    expect(preview).toMatchObject({ origin: 'adapter', sourceName: 'Tracker', text })
    expect(readFileSync(skillFile(), 'utf8')).toBe(text)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('an adapter without agentSkill gets the default text naming it', async () => {
    const { service } = makeService(NEKODE, [{ id: 'tracker', name: 'Tracker' }])
    const preview = await service.skillPreview('p1')
    expect(preview.origin).toBe('default')
    expect(preview.text).toBe(buildAgentSkill({ kind: 'default', adapterName: 'Tracker' }))
  })

  it('a bound adapter that is not installed is not_found and gets no guessed text', async () => {
    const { service } = makeService(NEKODE, [])
    const error = await rejection(service.skillPreview('p1'))
    expect(error.code).toBe('not_found')
    expect(error.message).toContain('tracker')
    expect(readdirSync(root)).toEqual([])
  })

  const invalidBodies: Array<[string, string | Buffer | null, string]> = [
    ['missing', null, 'does not exist'],
    ['blank', ' \n\t\n', 'is empty'],
    ['front matter', '---\nname: x\n---\nbody\n', 'front-matter'],
    ['too large', 'x'.repeat(32 * 1024 + 1), '32 KiB'],
    ['not UTF-8', Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]), 'not valid UTF-8'],
  ]
  for (const [label, content, reason] of invalidBodies) {
    it(`an invalid declared agentSkill (${label}) is validation_error with no fallback`, async () => {
      const { service } = makeService(NEKODE, [declare('SKILL.md', content)])
      const error = await rejection(service.skillPreview('p1'))
      expect(error.code).toBe('validation_error')
      expect(error.message).toContain('"tracker"')
      expect(error.message).toContain('"SKILL.md"')
      expect(error.message).toContain(reason)
      const write = await rejection(service.writeSkill('p1', TOKEN))
      expect(write.code).toBe('validation_error')
      expect(readdirSync(root)).toEqual([])
    })
  }

  it('a declared agentSkill link leaving the adapter folder is validation_error', async (context) => {
    const outsideFile = join(root, 'outside.md')
    writeFileSync(outsideFile, BODY, 'utf8')
    const adapter = declare('SKILL.md', null)
    mkdirSync(join(adaptersRoot, 'tracker'), { recursive: true })
    try {
      symlinkSync(outsideFile, join(adaptersRoot, 'tracker', 'SKILL.md'), 'file')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') context.skip()
      throw error
    }
    const { service } = makeService(NEKODE, [adapter])
    const error = await rejection(service.skillPreview('p1'))
    expect(error.code).toBe('validation_error')
    expect(error.message).toContain('outside the adapter folder')
  })

  it('a hand-edited existing file shows its content and Confirm replaces it with the shown text', async () => {
    mkdirSync(join(root, '.agents', 'skills', 'nekode-tasks'), { recursive: true })
    writeFileSync(skillFile(), 'edited by hand\n', 'utf8')
    const { service } = makeService(LOCAL)
    const preview = await teach(service)
    expect(preview).toMatchObject({ exists: true, current: 'edited by hand\n', text: LOCAL_TEXT })
    expect(readFileSync(skillFile(), 'utf8')).toBe(LOCAL_TEXT)
  })

  it('a current file that is not valid UTF-8 or over 256 KiB is not shown and still replaceable', async () => {
    mkdirSync(join(root, '.agents', 'skills', 'nekode-tasks'), { recursive: true })
    const { service } = makeService(PLANE)
    for (const content of [Buffer.from([0xc3, 0x28]), Buffer.alloc(256 * 1024 + 1, 0x61)]) {
      writeFileSync(skillFile(), content)
      const preview = await service.skillPreview('p1')
      expect(preview).toMatchObject({ exists: true, current: null })
      expect(preview.token).toBe(agentSkillToken(PLANE_TEXT, content))
    }
    await teach(service)
    expect(readFileSync(skillFile(), 'utf8')).toBe(PLANE_TEXT)
  })

  it('a binding change after the preview is conflict and writes nothing', async () => {
    const { service, state } = makeService(PLANE)
    const { token } = await service.skillPreview('p1')
    state.set('project.kanbanAdapter:p1', 'local-file')
    const error = await rejection(service.writeSkill('p1', token))
    expect(error.code).toBe('conflict')
    expect(error.message).toBe('The skill file or its source changed. Review the new preview.')
    expect(readdirSync(root)).toEqual([])
  })

  it('a skill file change after the preview is conflict and leaves the file unchanged', async () => {
    const { service } = makeService(LOCAL)
    const { token } = await service.skillPreview('p1')
    mkdirSync(join(root, '.agents', 'skills', 'nekode-tasks'), { recursive: true })
    writeFileSync(skillFile(), 'written meanwhile', 'utf8')
    const error = await rejection(service.writeSkill('p1', token))
    expect(error.code).toBe('conflict')
    expect(readFileSync(skillFile(), 'utf8')).toBe('written meanwhile')
    expect(readdirSync(join(root, '.agents', 'skills', 'nekode-tasks'))).toEqual(['SKILL.md'])
  })

  it('a changed adapter body after the preview is conflict', async () => {
    const adapter = declare('SKILL.md', BODY)
    const { service } = makeService(NEKODE, [adapter])
    const { token } = await service.skillPreview('p1')
    writeFileSync(join(adaptersRoot, 'tracker', 'SKILL.md'), '# Changed\n', 'utf8')
    expect((await rejection(service.writeSkill('p1', token))).code).toBe('conflict')
    expect(readdirSync(root)).toEqual([])
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
    const error = await rejection(service.writeSkill('p1', TOKEN))
    expect(error.code).toBe('validation_error')
    expect(error.message).toBe('.agents resolves outside the project folder.')
    expect((await rejection(service.skillPreview('p1'))).code).toBe('validation_error')
    expect(readdirSync(outside)).toEqual([])
  })

  it('an .agents/skills junction leaving the root is rejected and writes nothing outside', async () => {
    mkdirSync(join(root, '.agents'))
    symlinkSync(outside, join(root, '.agents', 'skills'), 'junction')
    const { service } = makeService(PLANE)
    const error = await rejection(service.writeSkill('p1', TOKEN))
    expect(error.code).toBe('validation_error')
    expect(error.message).toBe('.agents/skills resolves outside the project folder.')
    expect((await rejection(service.skillPreview('p1'))).code).toBe('validation_error')
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
    const error = await rejection(service.writeSkill('p1', TOKEN))
    expect(error.code).toBe('validation_error')
    expect(error.message).toBe('.agents/skills/nekode-tasks resolves outside the project folder.')
    expect((await rejection(service.skillPreview('p1'))).code).toBe('validation_error')
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
    const error = await rejection(service.writeSkill('p1', TOKEN))
    expect(error.code).toBe('validation_error')
    expect(error.message).toBe(`${AGENT_SKILL_FILE_PATH} resolves outside the project folder.`)
    expect((await rejection(service.skillPreview('p1'))).code).toBe('validation_error')
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
    const error = await rejection(service.writeSkill('p1', TOKEN))
    expect(error.code).toBe('unknown')
    expect(error.message).toContain('.agents/skills')
    expect((await rejection(service.skillPreview('p1'))).code).toBe('unknown')
    expect(readdirSync(join(root, '.agents', 'skills'))).toEqual([])
  })
})
