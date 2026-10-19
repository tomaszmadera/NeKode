import type React from 'react'
import { useState } from 'react'
import type { SessionTaskProgress } from '../../../../shared/ipc-contract'
import { TEST_ID } from '../../lib/test-ids'

interface TaskProgressButtonProps {
  task: SessionTaskProgress
  onToggle?: () => void
  open?: boolean
}

export function TaskProgressButton({
  task,
  onToggle,
  open: controlledOpen,
}: TaskProgressButtonProps): React.JSX.Element {
  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = controlledOpen ?? internalOpen

  const stepNames = task.stepNames ?? []
  const total = task.totalSteps || (stepNames.length > 0 ? stepNames.length : 1)
  const current = Math.max(0, Math.min(task.step - 1, total - 1))
  const stepName = task.stepName ?? stepNames[current] ?? `Step ${task.step}`
  const fix = task.fix

  const ariaLabel =
    task.ariaLabel ??
    `Task progress: step ${task.step} of ${total}, ${stepName}${fix ? `, fix ${fix}` : ''}`
  const progressLabel = task.label ?? `${stepName}${fix ? ` · fix:${fix}` : ''}`

  const handleClick = (): void => {
    setInternalOpen((previous) => !previous)
    onToggle?.()
  }

  const steps = Array.from({ length: total }, (_, i) => ({
    label: `${i + 1}. ${stepNames[i] ?? `Step ${i + 1}`}`,
    isDone: i < current,
    isCurrent: i === current,
  }))

  return (
    <button
      type="button"
      className="nk-tb inline-flex h-8 items-center gap-3 rounded-lg border border-[#2e364d] bg-[#151823] px-2.5 text-[#c3c7d4] transition-colors hover:bg-[#2d3852] focus:outline-none"
      onClick={handleClick}
      aria-expanded={isOpen}
      aria-label={ariaLabel}
      title={ariaLabel}
      data-testid={TEST_ID.taskProgressButton}
    >
      <span aria-hidden="true" className="flex items-center gap-1">
        {steps.map((st) => (
          <span
            key={st.label}
            title={st.label}
            style={{
              width: '14px',
              height: '6px',
              borderRadius: '3px',
              backgroundColor: st.isDone ? '#8b7cf6' : st.isCurrent ? '#7dd3fc' : '#2e364d',
              boxShadow: st.isCurrent ? '0 0 6px rgba(125,211,252,0.55)' : undefined,
            }}
          />
        ))}
      </span>
      <span className="font-mono text-[13px] whitespace-nowrap text-[#c3c7d4] leading-none">
        {progressLabel}
      </span>
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#8a90a6"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          transition: 'transform .15s',
          transform: `rotate(${isOpen ? 180 : 0}deg)`,
        }}
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
  )
}
