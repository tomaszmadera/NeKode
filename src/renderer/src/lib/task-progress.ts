import type {
  ChatInfo,
  SessionTaskProgress,
  TaskProgressItem,
  TaskProgressSnapshot,
} from '../../../shared/ipc-contract'

function matchTask(tasks: TaskProgressItem[], candidate: string): TaskProgressItem | undefined {
  const token = candidate.toLowerCase()
  return tasks
    .filter((task) => {
      const id = task.id.toLowerCase()
      return task.ref?.toLowerCase() === token || id === token || id.startsWith(`${token}-`)
    })
    .sort((a, b) => {
      const stateOrder = Number(a.state === 'completed') - Number(b.state === 'completed')
      return (
        stateOrder ||
        (b.updatedAt === null ? 0 : Date.parse(b.updatedAt)) -
          (a.updatedAt === null ? 0 : Date.parse(a.updatedAt))
      )
    })[0]
}

/** Project-scoped matching and display only; the renderer never reads task records. */
export function sessionTaskProgress(
  chat: ChatInfo,
  snapshot: TaskProgressSnapshot | null | undefined,
): SessionTaskProgress | undefined {
  if (snapshot == null || snapshot.projectId !== chat.projectId) return undefined
  const name = chat.name.replace(/^\[[^\]]+\](?:\s+|$)/, '')
  const token = name.match(/(?:^|[^a-zA-Z0-9])([A-Za-z]+-\d+)(?=[^a-zA-Z0-9]|$)/)?.[1]
  const task =
    (chat.taskRef?.trim() ? matchTask(snapshot.tasks, chat.taskRef.trim()) : undefined) ??
    (token ? matchTask(snapshot.tasks, token) : undefined)
  if (task === undefined || task.recordState !== 'valid') return undefined

  const steps = task.phases.flatMap((phase) => phase.steps)
  if (steps.length === 0) return undefined
  const current =
    task.currentStepId === null
      ? steps.findIndex((step) => !step.done)
      : steps.findIndex((step) => step.id === task.currentStepId)
  const index = task.state === 'completed' || current < 0 ? steps.length - 1 : current
  const step = index + 1
  const stepName = task.currentLabel ?? steps[index].label
  const fix = task.corrections || undefined
  const description = `Task progress: step ${step} of ${steps.length}, ${stepName}${fix ? `, fix ${fix}` : ''}`
  const stale = snapshot.status === 'stale'
  const staleReason = stale ? (snapshot.error?.message ?? 'Snapshot unavailable') : undefined
  return {
    taskId: task.ref ?? task.id,
    taskTitle: task.title ?? undefined,
    step,
    totalSteps: steps.length,
    stepName,
    stepNames: steps.map((step) => step.label),
    fix,
    review: task.reviews || undefined,
    label: `${stepName}${fix ? ` · fix:${fix}` : ''}`,
    ariaLabel: stale ? `Out of date: ${staleReason}. ${description}` : description,
    stale,
    staleReason,
  }
}
