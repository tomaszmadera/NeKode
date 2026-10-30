import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import {
  formatResumePrompt,
  HARNESS_RESUME_SOURCE,
  projectResumeTemplateKey,
  RESUME_SOURCES_STATE_KEY,
  type ResumeDiscoveryCandidate,
  type ResumeSourceBinding,
  type ResumeSourceCandidate,
  type ResumeSourceDiscovery,
  type ResumeSourceLibrary,
  type ResumeSourcePreview,
  type ResumeSourcePut,
  type ResumeSourcesChanged,
} from '@shared/contracts/resume-sources-contract'
import { resumeSourcePutSchema } from '@shared/contracts/resume-sources-schema'
import { AppError } from '@shared/ipc-error'
import { discoverResumeCommand, type runResumeCommand } from './resume-source-command'
import { checkResumeCancelled, discoverResumeFiles } from './resume-source-files'

export const RESUME_DISCOVERY_TIMEOUT_MS = 30000

interface ResumeSourcesDeps {
  state: { get(key: string): string | null; set(key: string, value: string): void }
  projects: {
    get(id: string): { path: string } | null
    list?(): Array<{ id: string; name: string }>
  }
  timeoutMs?: number
  runCommand?: typeof runResumeCommand
  readLegacyTemplate?: () => Promise<string | null>
}

async function computeFileHash(path: string, signal: AbortSignal): Promise<string> {
  checkResumeCancelled(signal)
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    checkResumeCancelled(signal)
    const stat = await file.stat()
    if (!stat.isFile()) throw new AppError('config', 'Expected a regular readable file.')
    if (stat.size > 1024 * 1024) throw new AppError('config', 'File exceeds the 1 MiB limit.')
    const bytes = Buffer.alloc(1024 * 1024 + 1)
    let size = 0
    while (size < bytes.length) {
      checkResumeCancelled(signal)
      const result = await file.read(bytes, size, bytes.length - size)
      if (result.bytesRead === 0) break
      size += result.bytesRead
    }
    if (size > 1024 * 1024) throw new AppError('config', 'File exceeds the 1 MiB limit.')
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size))
    } catch {
      throw new AppError('config', 'File is not valid UTF-8.')
    }
    return createHash('sha256').update(bytes.subarray(0, size)).digest('hex')
  } finally {
    await file.close()
  }
}

async function abortableFiles(
  projectPath: string,
  source: import('@shared/contracts/resume-sources-contract').ResumeFileSource,
  signal: AbortSignal,
) {
  let abort!: () => void
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
  try {
    return await Promise.race([discoverResumeFiles(projectPath, source, signal), cancelled])
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

export class ResumeSourcesService {
  readonly #deps: ResumeSourcesDeps
  readonly #listeners = new Set<(event: ResumeSourcesChanged) => void>()
  #stopping = false
  readonly #requests = new Map<
    string,
    { controller: AbortController; templateId: string; projectId: string; completed: Promise<void> }
  >()
  readonly #bindingRevisions = new Map<string, number>()
  readonly #projectInventories = new Map<
    string,
    {
      projectId: string
      templateId: string
      templateRevision: number
      bindingRevision: number
      generation: number
      records: Map<
        string,
        {
          token: string
          candidate: ResumeSourceCandidate
          contentHash: string
          consumed: boolean
        }
      >
    }
  >()

  constructor(deps: ResumeSourcesDeps) {
    this.#deps = deps
  }

  bind(projectId: string, templateId: string | null): ResumeSourceBinding {
    const project = this.#deps.projects.get(projectId)
    if (project === null) throw new AppError('not_found', 'Project not found.')
    if (templateId !== null) {
      const template = this.list().templates.find((row) => row.id === templateId)
      if (template === undefined) throw new AppError('not_found', 'Resume template not found.')
    }
    const currentRev = this.#bindingRevisions.get(projectId) ?? 0
    this.#bindingRevisions.set(projectId, currentRev + 1)
    this.#projectInventories.delete(projectId)
    this.#deps.state.set(projectResumeTemplateKey(projectId), templateId ?? '')
    return { projectId, templateId }
  }

  binding(projectId: string): ResumeSourceBinding {
    const project = this.#deps.projects.get(projectId)
    if (project === null) throw new AppError('not_found', 'Project not found.')
    const raw = this.#deps.state.get(projectResumeTemplateKey(projectId))
    const templateId = raw === null || raw.trim().length === 0 ? null : raw.trim()
    return { projectId, templateId }
  }

  list(): ResumeSourceLibrary {
    const raw = this.#deps.state.get(RESUME_SOURCES_STATE_KEY)
    if (raw === null)
      return {
        revision: 1,
        templates: [
          {
            id: 'agent-harness',
            revision: 1,
            name: 'Agent Harness',
            prompt: 'Resume task {taskPath}',
            source: structuredClone(HARNESS_RESUME_SOURCE),
          },
        ],
      }
    try {
      const document = JSON.parse(raw) as ResumeSourceLibrary
      if (
        !Number.isSafeInteger(document.revision) ||
        document.revision < 1 ||
        !Array.isArray(document.templates)
      )
        throw new Error()
      const ids = new Set<string>()
      for (const row of document.templates) {
        const valid = resumeSourcePutSchema.safeParse(row)
        if (
          !valid.success ||
          row.id === null ||
          row.revision === null ||
          row.revision > document.revision ||
          ids.has(row.id)
        )
          throw new Error()
        ids.add(row.id)
      }
      return document
    } catch {
      throw new AppError(
        'config',
        'Saved Resume templates are invalid. Repair the Resume template library before saving changes.',
      )
    }
  }

  put(input: ResumeSourcePut): ResumeSourceLibrary {
    const parsed = resumeSourcePutSchema.safeParse(input)
    if (!parsed.success) throw new AppError('validation', parsed.error.issues[0].message)
    const library = this.list()
    if (input.id !== null && input.revision !== null)
      this.#template(library, input.id, input.revision)
    const id = input.id ?? randomUUID()
    const next = { ...input, id, revision: library.revision + 1 }
    return this.#save(
      {
        revision: next.revision,
        templates: [...library.templates.filter((row) => row.id !== id), next],
      },
      id,
    )
  }

  duplicate(id: string, revision: number): ResumeSourceLibrary {
    const template = this.#template(this.list(), id, revision)
    return this.put({
      ...template,
      id: null,
      revision: null,
      name: `${template.name.slice(0, 190)} copy`,
    })
  }

  delete(id: string, revision: number): ResumeSourceLibrary {
    const library = this.list()
    this.#template(library, id, revision)
    const projects = this.#deps.projects.list?.() ?? []
    const usingProjects = projects
      .filter((p) => this.#deps.state.get(projectResumeTemplateKey(p.id)) === id)
      .map((p) => p.name)
    if (usingProjects.length > 0) {
      throw new AppError(
        'conflict',
        `Resume template is used by projects: ${usingProjects.join(', ')}. Remove or change their Resume template selection first.`,
      )
    }
    return this.#save(
      {
        revision: library.revision + 1,
        templates: library.templates.filter((row) => row.id !== id),
      },
      id,
    )
  }

  #save(library: ResumeSourceLibrary, templateId: string): ResumeSourceLibrary {
    this.#deps.state.set(RESUME_SOURCES_STATE_KEY, JSON.stringify(library))
    for (const request of this.#requests.values())
      if (request.templateId === templateId)
        request.controller.abort(
          new AppError('conflict', 'The Resume template changed. Test the saved version again.'),
        )
    for (const listener of this.#listeners) listener({ revision: library.revision, templateId })
    return library
  }

  #template(library: ResumeSourceLibrary, id: string, revision: number) {
    const template = library.templates.find((row) => row.id === id)
    if (template === undefined) throw new AppError('not_found', 'Resume template not found.')
    if (template.revision !== revision)
      throw new AppError('conflict', 'The Resume template changed. Reload it and retry.')
    return template
  }

  async test(
    templateId: string,
    projectId: string,
    revision: number,
    requestId: string,
  ): Promise<ResumeSourcePreview> {
    if (this.#stopping) throw new AppError('conflict', 'Resume discovery is shutting down.')
    const template = this.#template(this.list(), templateId, revision)
    const project = this.#deps.projects.get(projectId)
    if (project === null) throw new AppError('not_found', 'Project not found.')
    if (this.#requests.has(requestId))
      throw new AppError('conflict', 'This Resume Test request is already running.')
    const controller = new AbortController()
    let finish!: () => void
    const completed = new Promise<void>((resolve) => {
      finish = resolve
    })
    this.#requests.set(requestId, { controller, templateId, projectId, completed })
    const timeout = setTimeout(
      () =>
        controller.abort(
          new AppError(
            'timeout',
            'Resume discovery exceeded 30 seconds. Narrow the source or fix its command.',
          ),
        ),
      this.#deps.timeoutMs ?? RESUME_DISCOVERY_TIMEOUT_MS,
    )
    try {
      const inventory =
        template.source.kind === 'files'
          ? await abortableFiles(project.path, template.source, controller.signal)
          : {
              candidates: await discoverResumeCommand(
                project.path,
                template.source,
                controller.signal,
                this.#deps.runCommand,
              ),
              rejections: [],
            }
      checkResumeCancelled(controller.signal)
      if (this.#deps.projects.get(projectId)?.path !== project.path)
        throw new AppError('conflict', 'Project changed. Test again.')
      this.#template(this.list(), templateId, revision)
      return { projectId, templateId, revision, ...inventory }
    } finally {
      clearTimeout(timeout)
      this.#requests.delete(requestId)
      finish()
    }
  }

  async discover(projectId: string, requestId: string): Promise<ResumeSourceDiscovery> {
    if (this.#stopping) throw new AppError('conflict', 'Resume discovery is shutting down.')
    const project = this.#deps.projects.get(projectId)
    if (project === null) throw new AppError('not_found', 'Project not found.')
    const { templateId } = this.binding(projectId)
    if (templateId === null)
      throw new AppError('not_found', 'No Resume template is configured for this project.')
    const template = this.list().templates.find((row) => row.id === templateId)
    if (template === undefined) throw new AppError('not_found', 'Resume template not found.')
    if (this.#requests.has(requestId))
      throw new AppError('conflict', 'This Resume discovery request is already running.')
    const controller = new AbortController()
    let finish!: () => void
    const completed = new Promise<void>((resolve) => {
      finish = resolve
    })
    this.#requests.set(requestId, { controller, templateId: template.id, projectId, completed })
    const timeout = setTimeout(
      () =>
        controller.abort(
          new AppError(
            'timeout',
            'Resume discovery exceeded 30 seconds. Narrow the source or fix its command.',
          ),
        ),
      this.#deps.timeoutMs ?? RESUME_DISCOVERY_TIMEOUT_MS,
    )
    try {
      const inventory =
        template.source.kind === 'files'
          ? await abortableFiles(project.path, template.source, controller.signal)
          : {
              candidates: await discoverResumeCommand(
                project.path,
                template.source,
                controller.signal,
                this.#deps.runCommand,
              ),
              rejections: [],
            }
      checkResumeCancelled(controller.signal)
      if (this.#deps.projects.get(projectId)?.path !== project.path)
        throw new AppError('conflict', 'Project changed. Test again.')
      const currentTemplate = this.#template(this.list(), template.id, template.revision)
      const records = new Map<
        string,
        {
          token: string
          candidate: ResumeSourceCandidate
          contentHash: string
          consumed: boolean
        }
      >()
      const candidates: ResumeDiscoveryCandidate[] = []
      for (const candidate of inventory.candidates) {
        checkResumeCancelled(controller.signal)
        const token = randomUUID()
        const contentHash = await computeFileHash(candidate.path, controller.signal)
        records.set(token, {
          token,
          candidate,
          contentHash,
          consumed: false,
        })
        candidates.push({
          token,
          id: candidate.id,
          title: candidate.title,
          displayPath: candidate.displayPath,
          modifiedAt: candidate.modifiedAt,
          status: candidate.status,
          current_phase: candidate.current_phase,
          current_step: candidate.current_step,
          next_action: candidate.next_action,
          awaiting_resumption: candidate.awaiting_resumption,
        })
      }
      const bindingRevision = this.#bindingRevisions.get(projectId) ?? 0
      this.#projectInventories.set(projectId, {
        projectId,
        templateId: currentTemplate.id,
        templateRevision: currentTemplate.revision,
        bindingRevision,
        generation: (this.#projectInventories.get(projectId)?.generation ?? 0) + 1,
        records,
      })
      return {
        projectId,
        templateId: currentTemplate.id,
        revision: currentTemplate.revision,
        candidates,
        rejections: inventory.rejections,
      }
    } finally {
      clearTimeout(timeout)
      this.#requests.delete(requestId)
      finish()
    }
  }

  async prepare(projectId: string, token: string, _requestId: string): Promise<string> {
    if (this.#stopping) throw new AppError('conflict', 'Resume discovery is shutting down.')
    const project = this.#deps.projects.get(projectId)
    if (project === null) throw new AppError('not_found', 'Project not found.')
    const { templateId } = this.binding(projectId)
    if (templateId === null)
      throw new AppError(
        'conflict',
        'No Resume template is bound to this project. Refresh the Resume list.',
      )
    const inventory = this.#projectInventories.get(projectId)
    if (!inventory)
      throw new AppError(
        'conflict',
        'Resume inventory expired or unavailable. Refresh the Resume list.',
      )
    const currentBindingRev = this.#bindingRevisions.get(projectId) ?? 0
    if (inventory.bindingRevision !== currentBindingRev || inventory.templateId !== templateId) {
      throw new AppError(
        'conflict',
        'Project Resume configuration has changed. Refresh the Resume list.',
      )
    }
    const record = inventory.records.get(token)
    if (!record) {
      throw new AppError(
        'conflict',
        'Invalid or expired Resume selection. Refresh the Resume list.',
      )
    }
    if (record.consumed) {
      throw new AppError(
        'conflict',
        'This Resume selection has already been used. Refresh the Resume list.',
      )
    }
    const template = this.#template(this.list(), inventory.templateId, inventory.templateRevision)

    const controller = new AbortController()
    let hash: string
    try {
      hash = await computeFileHash(record.candidate.path, controller.signal)
    } catch {
      throw new AppError(
        'conflict',
        'The selected candidate has changed or is no longer available. Refresh the Resume list.',
      )
    }
    if (hash !== record.contentHash) {
      throw new AppError('conflict', 'The selected candidate has changed. Refresh the Resume list.')
    }
    record.consumed = true
    return formatResumePrompt(template.prompt, record.candidate.displayPath)
  }

  async importLegacy(): Promise<string | null> {
    if (this.#deps.readLegacyTemplate) {
      return this.#deps.readLegacyTemplate()
    }
    return null
  }

  cancel(requestId: string): void {
    this.#requests
      .get(requestId)
      ?.controller.abort(new AppError('conflict', 'Resume discovery was cancelled.'))
  }
  dropProject(projectId: string): void {
    for (const [id, request] of this.#requests) if (request.projectId === projectId) this.cancel(id)
    this.#projectInventories.delete(projectId)
    this.#bindingRevisions.delete(projectId)
  }
  async shutdown(): Promise<void> {
    this.#stopping = true
    const requests = [...this.#requests.values()]
    for (const id of this.#requests.keys()) this.cancel(id)
    await Promise.all(requests.map((request) => request.completed))
  }
  onChanged(callback: (event: ResumeSourcesChanged) => void): () => void {
    this.#listeners.add(callback)
    return () => this.#listeners.delete(callback)
  }
}
