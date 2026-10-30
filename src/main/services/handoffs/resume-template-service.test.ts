import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResumeTemplateService } from './resume-template-service'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: vi.fn(actual.open) }
})

describe('ResumeTemplateService', () => {
  let directory: string
  let settings: string
  let service: ResumeTemplateService
  const projectPath = join(tmpdir(), 'resume-project')

  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), 'nekode-resume-template-'))
    settings = join(directory, 'settings.json')
    service = new ResumeTemplateService({
      userDataPath: directory,
      projects: { get: (id) => (id === 'p1' ? { path: projectPath } : null) },
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(directory, { recursive: true, force: true })
  })

  async function configure(value: unknown): Promise<void> {
    await fs.writeFile(settings, JSON.stringify(value))
  }

  it('preserves each caller default and does not create the optional file', async () => {
    await expect(service.format('handoffs/a.md', 'Resume from handoffs/a.md')).resolves.toBe(
      'Resume from handoffs/a.md',
    )
    await expect(service.resumePrompt('p1', join(projectPath, 'handoffs/a.md'))).resolves.toBe(
      'Resume from handoff handoffs/a.md',
    )
    await expect(service.readLegacyTemplate()).resolves.toBeNull()
    await expect(fs.stat(settings)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reads legacy template directly for explicit import', async () => {
    await configure({ resume: { template: 'Imported {handoffPath}' } })
    await expect(service.readLegacyTemplate()).resolves.toBe('Imported {handoffPath}')
  })

  it.each([{}, { unrelated: true }, { resume: {} }, { resume: { other: 'value' } }])(
    'uses the caller default for absent fields: %j',
    async (value) => {
      await configure(value)
      await expect(service.format('a.md', 'legacy text')).resolves.toBe('legacy text')
    },
  )

  it('replaces every placeholder literally without interpreting replacement data', async () => {
    const template = '  Wznów: {handoffPath}\nAgain {handoffPath}\n{other} $&  '
    const path = 'D:\\Shared handoffs\\$& {handoffPath} {prompt}.md'
    await configure({ resume: { template }, ignored: ['anything'] })
    await expect(service.format(path, 'default')).resolves.toBe(
      `  Wznów: ${path}\nAgain ${path}\n{other} $&  `,
    )
  })

  it('reads edits and removal on the next call, including after a failed read', async () => {
    await fs.writeFile(settings, '{invalid')
    await expect(service.format('a.md', 'default')).rejects.toMatchObject({ code: 'config' })
    await configure({ resume: { template: 'First {handoffPath}' } })
    await expect(service.format('a.md', 'default')).resolves.toBe('First a.md')
    await configure({ resume: { template: 'Second {handoffPath}' } })
    await expect(service.format('b.md', 'default')).resolves.toBe('Second b.md')
    await fs.unlink(settings)
    await expect(service.format('c.md', 'default')).resolves.toBe('default')
  })

  it('formats the picker path relative to its registered project, or absolute outside it', async () => {
    await configure({ resume: { template: 'Read {handoffPath}' } })
    await expect(service.resumePrompt('p1', join(projectPath, 'handoffs/a.md'))).resolves.toBe(
      'Read handoffs/a.md',
    )
    const external = join(directory, 'external a.md')
    await expect(service.resumePrompt('p1', external)).resolves.toBe(`Read ${external}`)
    await expect(service.resumePrompt('missing', external)).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('accepts a UTF-8 BOM', async () => {
    await fs.writeFile(settings, '\ufeff{"resume":{"template":"Read {handoffPath}"}}')
    await expect(service.format('a.md', 'default')).resolves.toBe('Read a.md')
  })

  it.each([
    null,
    [],
    'text',
    { resume: null },
    { resume: [] },
    { resume: 42 },
    { resume: { template: null } },
    { resume: { template: [] } },
    { resume: { template: 42 } },
    { resume: { template: '' } },
    { resume: { template: ' \n ' } },
    { resume: { template: 'No placeholder' } },
    { resume: { template: '{handoffPath}\u0000' } },
  ])(
    'rejects invalid configuration with the file path and no configuration contents: %j',
    async (value) => {
      await configure(value)
      await expect(service.format('SECRET_HANDOFF_PATH', 'default')).rejects.toMatchObject({
        code: 'config',
        message: expect.stringContaining(settings),
      })
      await expect(service.format('SECRET_HANDOFF_PATH', 'default')).rejects.not.toThrow(
        'SECRET_HANDOFF_PATH',
      )
    },
  )

  it.each([
    Buffer.from('{invalid SECRET_CONFIG_TEXT'),
    Buffer.from([0xc3, 0x28]),
    Buffer.alloc(64 * 1024 + 1, 32),
  ])('rejects malformed, invalid UTF-8, and oversized files', async (content) => {
    await fs.writeFile(settings, content)
    await expect(service.format('a.md', 'default')).rejects.toMatchObject({ code: 'config' })
    await expect(service.format('a.md', 'default')).rejects.not.toThrow('SECRET_CONFIG_TEXT')
  })

  it('accepts a file exactly 64 KiB long', async () => {
    const text = JSON.stringify({ resume: { template: 'Read {handoffPath}' } })
    await fs.writeFile(settings, text.padEnd(64 * 1024, ' '))
    await expect(service.format('a.md', 'default')).resolves.toBe('Read a.md')
  })

  it('reports non-ENOENT read errors instead of choosing the default', async () => {
    vi.mocked(fs.open).mockRejectedValueOnce(Object.assign(new Error('SECRET'), { code: 'EACCES' }))
    await expect(service.format('a.md', 'default')).rejects.toMatchObject({
      code: 'config',
      message: expect.stringContaining(settings),
    })
  })
})
