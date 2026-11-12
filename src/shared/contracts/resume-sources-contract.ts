export interface ResumeFileSource {
  kind: 'files'
  directory: string
  pattern: string
  recursive: boolean
  identity: 'stem' | 'parent'
}

export interface ResumeCommandSource {
  kind: 'command'
  protocol: 'generic' | 'agent-harness'
  executable: string
  args: string[]
}

export type ResumeSource = ResumeFileSource | ResumeCommandSource

export interface ResumeSourceTemplate {
  id: string
  revision: number
  name: string
  prompt: string
  source: ResumeSource
}

export interface ResumeSourceLibrary {
  revision: number
  templates: ResumeSourceTemplate[]
}

export interface ResumeSourcePut {
  id: string | null
  revision: number | null
  name: string
  prompt: string
  source: ResumeSource
}

export interface ResumeSourceCandidate {
  id: string
  title: string
  path: string
  displayPath: string
  modifiedAt: string
  status?: string
  current_phase?: string
  current_step?: string
  next_action?: string
  awaiting_resumption?: boolean
}

export interface ResumeSourcePreview {
  projectId: string
  templateId: string
  revision: number
  candidates: ResumeSourceCandidate[]
  rejections: Array<{ path: string; reason: string }>
}

export interface ResumeSourcesChanged {
  revision: number
  templateId: string
}

export function isResumeSourcesChanged(value: unknown): value is ResumeSourcesChanged {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const event = value as Record<string, unknown>
  return (
    typeof event.revision === 'number' &&
    Number.isSafeInteger(event.revision) &&
    event.revision > 0 &&
    typeof event.templateId === 'string' &&
    /^[a-zA-Z0-9_-]{1,128}$/.test(event.templateId)
  )
}

export const RESUME_SOURCES_STATE_KEY = 'resume.sources'

export function isResumeSourcesStateKey(key: string): boolean {
  return key === RESUME_SOURCES_STATE_KEY || key.startsWith('project.resumeTemplate:')
}

export interface ResumeSourceBinding {
  projectId: string
  templateId: string | null
}

export interface ResumeDiscoveryCandidate {
  token: string
  id: string
  title: string
  displayPath: string
  modifiedAt: string
  status?: string
  current_phase?: string
  current_step?: string
  next_action?: string
  awaiting_resumption?: boolean
}

export interface ResumeSourceDiscovery {
  projectId: string
  templateId: string
  revision: number
  candidates: ResumeDiscoveryCandidate[]
  rejections: Array<{ path: string; reason: string }>
}

export function formatResumePrompt(prompt: string, displayPath: string): string {
  return prompt.replaceAll(/\{(?:taskPath|handoffPath)\}/g, () => displayPath)
}

export const projectResumeTemplateKey = (projectId: string): string =>
  `project.resumeTemplate:${projectId}`

export const HARNESS_RESUME_SOURCE: ResumeCommandSource = {
  kind: 'command',
  protocol: 'agent-harness',
  executable: 'python',
  args: ['.agents/scripts/taskctl', 'list', '--json'],
}

/**
 * Ready Resume template for the no-Harness local task workflow
 * (local-task-workflow spec Behaviour 3-4): one progress file per card under
 * `work/<ref>/progress.md`, identified by its immediate parent directory.
 * It is a starting point only: selecting it creates and binds nothing.
 */
export const LOCAL_PROGRESS_RESUME_SOURCE: ResumeFileSource = {
  kind: 'files',
  directory: 'work',
  pattern: 'progress.md',
  recursive: true,
  identity: 'parent',
}

export const LOCAL_PROGRESS_RESUME_PROMPT =
  'Resume task {taskPath}.\nRead that progress file before continuing. It records the work so far, decisions, checks, and the next action.'

export function isLocalProgressResumeSource(source: ResumeSource): boolean {
  return (
    source.kind === 'files' &&
    source.directory === LOCAL_PROGRESS_RESUME_SOURCE.directory &&
    source.pattern === LOCAL_PROGRESS_RESUME_SOURCE.pattern &&
    source.recursive === LOCAL_PROGRESS_RESUME_SOURCE.recursive &&
    source.identity === LOCAL_PROGRESS_RESUME_SOURCE.identity
  )
}

/**
 * Full-ref match (local-task-workflow spec Behaviour 12): exact equality or
 * the ref followed by `-`. `T-1` matches `T-1` and `T-1-follow-up`, not
 * `T-10` or `old-T-1`.
 */
export function matchesResumeCandidateRef(ref: string, candidateId: string): boolean {
  const candidate = candidateId.trim().toLowerCase()
  const expected = ref.trim().toLowerCase()
  return candidate === expected || candidate.startsWith(`${expected}-`)
}
