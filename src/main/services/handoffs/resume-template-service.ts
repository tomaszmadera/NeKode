import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { relativeToProject } from '../../../shared/ipc-contract'
import { AppError } from '../../../shared/ipc-error'

const MAX_SETTINGS_BYTES = 64 * 1024
const PLACEHOLDER = '{handoffPath}'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class ResumeTemplateService {
  readonly #settingsPath: string
  readonly #projects: { get(projectId: string): { path: string } | null }

  constructor(deps: {
    userDataPath: string
    projects: { get(projectId: string): { path: string } | null }
  }) {
    this.#settingsPath = join(deps.userDataPath, 'settings.json')
    this.#projects = deps.projects
  }

  /** Picker paths are formatting data; this does not read the selected handoff. */
  async resumePrompt(projectId: string, handoffPath: string): Promise<string> {
    const project = this.#projects.get(projectId)
    if (project === null) throw new AppError('not_found', 'Project not found.')
    const path = relativeToProject(project.path, handoffPath) ?? handoffPath
    return this.format(path, `Resume from handoff ${path}`)
  }

  /** Read for each composition, keeping each entry point's existing default. */
  async format(handoffPath: string, defaultPrompt: string): Promise<string> {
    const template = await this.#readTemplate()
    return template === null ? defaultPrompt : template.replaceAll(PLACEHOLDER, () => handoffPath)
  }

  #error(reason: string): AppError {
    return new AppError('config', `Resume settings ${this.#settingsPath}: ${reason}`)
  }

  async #readTemplate(): Promise<string | null> {
    // Bound the read itself, including when a file grows after opening it.
    let content: Buffer
    try {
      const file = await open(this.#settingsPath, 'r')
      try {
        if (!(await file.stat()).isFile()) throw this.#error('expected a regular JSON file.')
        const buffer = Buffer.alloc(MAX_SETTINGS_BYTES + 1)
        let length = 0
        while (length < buffer.length) {
          const { bytesRead } = await file.read(buffer, length, buffer.length - length)
          if (bytesRead === 0) break
          length += bytesRead
        }
        if (length > MAX_SETTINGS_BYTES) throw this.#error('file exceeds the 64 KiB limit.')
        content = buffer.subarray(0, length)
      } finally {
        await file.close()
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      if (isObject(error) && error.code === 'ENOENT') return null
      throw this.#error('cannot read the file. Check that it is a readable JSON file.')
    }

    let document: unknown
    try {
      // TextDecoder strips an optional BOM and rejects invalid UTF-8.
      document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content))
    } catch {
      throw this.#error('expected valid UTF-8 JSON. Fix the file and retry Resume.')
    }
    if (!isObject(document)) throw this.#error('the JSON root must be an object.')
    if (!Object.hasOwn(document, 'resume')) return null
    if (!isObject(document.resume)) throw this.#error('resume must be an object.')
    if (!Object.hasOwn(document.resume, 'template')) return null
    const template = document.resume.template
    if (
      typeof template !== 'string' ||
      template.trim().length === 0 ||
      !template.includes(PLACEHOLDER) ||
      template.includes('\u0000')
    ) {
      throw this.#error(
        'resume.template must be a nonblank string containing {handoffPath}, without NUL characters.',
      )
    }
    return template
  }
}
