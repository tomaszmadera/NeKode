import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionTaskProgress } from '../../../shared/ipc-contract'

export const CANONICAL_TASK_PHASES = [
  'Intake',
  'Specification and plan',
  'Implementation',
  'Verification and closure',
] as const

export interface TaskRecordFs {
  existsSync(path: string): boolean
  readdirSync(path: string): string[]
  readFileSync(path: string, encoding: 'utf-8'): string
}

const defaultFs: TaskRecordFs = {
  existsSync: (p) => existsSync(p),
  readdirSync: (p) => readdirSync(p),
  readFileSync: (p, enc) => readFileSync(p, enc),
}

export interface TaskRecordServiceDeps {
  fs?: TaskRecordFs
}

interface ParsedStep {
  id: string
  phase: number
  stepNumber: number
  checked: boolean
  rawLabel: string
  phaseName: string
  displayLabel: string
}

export function formatStepName(rawLabel: string, phaseName: string): string {
  const lower = rawLabel.toLowerCase()
  if (lower.includes('specification')) return 'Specification'
  if (lower.includes('approval')) return 'Plan approval'
  if (lower.includes('plan')) return 'Plan'
  if (lower.includes('provisional classification') || lower.includes('inspect')) return 'Intake'
  const stageMatch = rawLabel.match(/^Stage\s+(\d+)/i)
  if (stageMatch) return `Stage ${stageMatch[1]}`
  if (lower.includes('implement')) return 'Implementation'
  if (lower.includes('verification') || lower.includes('closure')) return 'Verification'
  if (rawLabel.length > 0 && rawLabel.length <= 25) return rawLabel
  if (phaseName && phaseName.length <= 25) return phaseName
  return rawLabel.length > 0 ? `${rawLabel.slice(0, 22)}...` : phaseName
}

export function parseTaskMarkdown(
  content: string,
  fallbackRef?: string,
): SessionTaskProgress | null {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
  const frontmatter = frontmatterMatch ? frontmatterMatch[1] : ''

  const idMatch = frontmatter.match(/^id:\s*(.+)$/m)
  const id = idMatch ? idMatch[1].trim() : (fallbackRef ?? '')
  if (!id && !fallbackRef) {
    return null
  }

  const statusMatch = frontmatter.match(/^status:\s*(.+)$/m)
  const status = statusMatch ? statusMatch[1].trim().toLowerCase() : 'active'

  const currentStepMatch = frontmatter.match(/^current_step:\s*(.+)$/m)
  const currentStep = currentStepMatch ? currentStepMatch[1].trim() : undefined

  const titleMatch = content.match(/^#\s+(.+)$/m)
  const title = titleMatch ? titleMatch[1].trim() : undefined

  // Check for explicit progress override in frontmatter
  const progressBlockMatch = frontmatter.match(
    /progress:\s*\r?\n([\s\S]*?)(?=\r?\n[a-zA-Z0-9_-]+:|$)/,
  )
  if (progressBlockMatch) {
    const block = progressBlockMatch[1]
    const stepM = block.match(/step:\s*(\d+)/)
    const totalM = block.match(/total_steps:\s*(\d+)/)
    const nameM = block.match(/step_name:\s*(.+)/)
    const fixM = block.match(/fix:\s*(\d+)/)
    const reviewM = block.match(/review:\s*(\d+)/)

    if (stepM) {
      const step = Number.parseInt(stepM[1], 10)
      const totalSteps = totalM ? Number.parseInt(totalM[1], 10) : 8
      const stepName = nameM ? nameM[1].trim() : `Step ${step}`
      const fix = fixM ? Number.parseInt(fixM[1], 10) : undefined
      const review = reviewM ? Number.parseInt(reviewM[1], 10) : undefined
      const ariaLabel = `Task progress: step ${step} of ${totalSteps}, ${stepName}${fix ? `, fix ${fix}` : ''}`
      const label = `${stepName}${fix ? ` · fix:${fix}` : ''}`
      const refMatch = id.match(/^([a-zA-Z]+-\d+)/)
      const displayId = refMatch ? refMatch[1].toUpperCase() : (fallbackRef ?? id)

      return {
        taskId: displayId,
        taskTitle: title,
        step,
        totalSteps,
        stepName,
        fix,
        review,
        ariaLabel,
        label,
      }
    }
  }

  // Parse phase headings
  const phaseMap = new Map<number, string>()
  const phaseHeadingRegex = /^## Phase (\d+)(?:\s*-\s*(.+))?$/gm
  let pMatch: RegExpExecArray | null = phaseHeadingRegex.exec(content)
  while (pMatch !== null) {
    const num = Number.parseInt(pMatch[1], 10)
    const name = pMatch[2]?.trim() ?? `Phase ${num}`
    phaseMap.set(num, name)
    pMatch = phaseHeadingRegex.exec(content)
  }

  // Parse checklist steps from the task body
  const checklistSteps: ParsedStep[] = []
  const lines = content.split(/\r?\n/)
  const stepRegex = /^- \[( |x|X)\]\s*(Phase (\d+)\.(\d+))(?:\s*-\s*(.+))?$/
  for (const line of lines) {
    const match = line.match(stepRegex)
    if (match) {
      const checked = match[1].toLowerCase() === 'x'
      const stepId = match[2].trim()
      const phaseNum = Number.parseInt(match[3], 10)
      const stepNum = Number.parseInt(match[4], 10)
      const rawLabel = match[5]?.trim() ?? ''
      const phaseName = phaseMap.get(phaseNum) ?? `Phase ${phaseNum}`
      const displayLabel = formatStepName(rawLabel, phaseName)
      checklistSteps.push({
        id: stepId,
        phase: phaseNum,
        stepNumber: stepNum,
        checked,
        rawLabel,
        phaseName,
        displayLabel,
      })
    }
  }

  // Fallback: if no checklist steps found, use phase headings or canonical phases
  if (checklistSteps.length === 0 && phaseMap.size > 0) {
    for (const [num, name] of phaseMap.entries()) {
      checklistSteps.push({
        id: `Phase ${num}`,
        phase: num,
        stepNumber: 1,
        checked: false,
        rawLabel: name,
        phaseName: name,
        displayLabel: name,
      })
    }
  }
  if (checklistSteps.length === 0) {
    for (let i = 0; i < CANONICAL_TASK_PHASES.length; i++) {
      const name = CANONICAL_TASK_PHASES[i]
      checklistSteps.push({
        id: `Phase ${i}`,
        phase: i,
        stepNumber: 1,
        checked: false,
        rawLabel: name,
        phaseName: name,
        displayLabel: name,
      })
    }
  }

  // Parse Timing table
  let fixCount = 0
  let reviewCount = 0
  let lastTimingElement = ''

  const timingMatch = content.match(/## Timing\s*\r?\n[\s\S]*?(?=\r?\n## |$)/)
  if (timingMatch) {
    const timingLines = timingMatch[0].split(/\r?\n/)
    for (const line of timingLines) {
      if (!line.startsWith('|')) continue
      const parts = line.split('|').map((p) => p.trim())
      if (parts.length >= 2 && parts[1] && parts[1] !== 'Element' && !parts[1].startsWith('---')) {
        const el = parts[1].toLowerCase()
        lastTimingElement = el
        if (el.startsWith('correction') || el.startsWith('fix')) {
          fixCount += 1
        } else if (el.startsWith('review')) {
          reviewCount += 1
        }
      }
    }
  }

  const totalSteps = checklistSteps.length
  let currentStepIndex = 0

  if (status === 'completed') {
    currentStepIndex = totalSteps - 1
  } else if (currentStep && currentStep !== 'none') {
    const foundIdx = checklistSteps.findIndex((s) => s.id === currentStep)
    if (foundIdx >= 0) {
      currentStepIndex = foundIdx
    } else {
      const unchIdx = checklistSteps.findIndex((s) => !s.checked)
      currentStepIndex = unchIdx >= 0 ? unchIdx : totalSteps - 1
    }
  } else {
    const unchIdx = checklistSteps.findIndex((s) => !s.checked)
    currentStepIndex = unchIdx >= 0 ? unchIdx : totalSteps - 1
  }

  const step = currentStepIndex + 1
  const activeStep = checklistSteps[currentStepIndex]
  let stepName = activeStep?.displayLabel ?? `Step ${step}`

  const fix = fixCount > 0 ? fixCount : undefined
  const review = reviewCount > 0 ? reviewCount : undefined

  if (lastTimingElement.startsWith('correction') || lastTimingElement.startsWith('fix')) {
    stepName = 'Fixes'
  } else if (lastTimingElement.startsWith('review')) {
    stepName = 'Code review'
  }

  const stepNames = checklistSteps.map((s) => s.displayLabel)

  // Clean task ref for display: if id is like nekode-74-spec-content-verification, simplify to NEKODE-74
  const refMatch = id.match(/^([a-zA-Z]+-\d+)/)
  const displayId = refMatch ? refMatch[1].toUpperCase() : (fallbackRef ?? id)

  const ariaLabel = `Task progress: step ${step} of ${totalSteps}, ${stepName}${fix ? `, fix ${fix}` : ''}`
  const label = `${stepName}${fix ? ` · fix:${fix}` : ''}`

  return {
    taskId: displayId,
    taskTitle: title,
    step,
    totalSteps,
    stepName,
    fix,
    review,
    stepNames,
    ariaLabel,
    label,
  }
}

export class TaskRecordService {
  readonly #fs: TaskRecordFs

  constructor(deps: TaskRecordServiceDeps = {}) {
    this.#fs = deps.fs ?? defaultFs
  }

  /**
   * Discovers and parses a matching task record for a given chat.
   */
  getTaskForChat(
    projectPath: string,
    chatName: string,
    explicitTaskRef?: string,
  ): SessionTaskProgress | null {
    if (!projectPath) return null

    const candidateRefs: string[] = []
    if (explicitTaskRef?.trim()) {
      candidateRefs.push(explicitTaskRef.trim())
    }

    // Extract refs from chatName (e.g. NEKODE-74, nekode-74, n74)
    const matchFullRef = chatName.match(/(?:^|[^a-zA-Z0-9])([A-Za-z]+-\d+)(?:[^a-zA-Z0-9]|$)/)
    if (matchFullRef) {
      candidateRefs.push(matchFullRef[1])
    }

    const matchShortN = chatName.match(/\b[nN](\d+)\b/)
    if (matchShortN) {
      candidateRefs.push(`NEKODE-${matchShortN[1]}`)
      candidateRefs.push(`nekode-${matchShortN[1]}`)
    }

    const trimmed = chatName.trim()
    if (trimmed && !candidateRefs.includes(trimmed)) {
      candidateRefs.push(trimmed)
    }

    const taskDirs = [
      join(projectPath, '.agents', 'tasks'),
      join(projectPath, '.agents', 'tasks', 'archive'),
    ]

    for (const baseDir of taskDirs) {
      if (!this.#fs.existsSync(baseDir)) continue

      let entries: string[] = []
      try {
        entries = this.#fs.readdirSync(baseDir)
      } catch {
        continue
      }

      for (const entry of entries) {
        if (entry === 'archive' || entry === 'templates') continue

        const dirPath = join(baseDir, entry)
        const taskFilePath = join(dirPath, 'task.md')
        if (!this.#fs.existsSync(taskFilePath)) continue

        for (const candidate of candidateRefs) {
          const lowerCandidate = candidate.toLowerCase()
          const lowerEntry = entry.toLowerCase()

          const matches =
            lowerEntry === lowerCandidate ||
            lowerEntry.startsWith(`${lowerCandidate}-`) ||
            lowerEntry.startsWith(`${lowerCandidate}_`)

          if (matches) {
            try {
              const content = this.#fs.readFileSync(taskFilePath, 'utf-8')
              const parsed = parseTaskMarkdown(content, candidate.toUpperCase())
              if (parsed) return parsed
            } catch {
              // Ignore file read error and continue
            }
          }
        }
      }
    }

    return null
  }
}
