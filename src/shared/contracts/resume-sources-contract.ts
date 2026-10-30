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
