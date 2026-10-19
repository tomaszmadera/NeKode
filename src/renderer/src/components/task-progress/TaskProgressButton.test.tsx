import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionTaskProgress } from '../../../../shared/ipc-contract'
import { TEST_ID } from '../../lib/test-ids'
import { TaskProgressButton } from './TaskProgressButton'

afterEach(cleanup)

describe('TaskProgressButton', () => {
  it('renders with exact aria-label "Task progress: step 5 of 8, Fixes, fix 3"', () => {
    const task: SessionTaskProgress = {
      taskId: 'NEKODE-74',
      step: 5,
      totalSteps: 8,
      stepName: 'Fixes',
      fix: 3,
    }

    render(<TaskProgressButton task={task} />)

    const button = screen.getByRole('button', {
      name: 'Task progress: step 5 of 8, Fixes, fix 3',
    })
    expect(button).toBeTruthy()
    expect(button.getAttribute('aria-label')).toBe('Task progress: step 5 of 8, Fixes, fix 3')
    expect(button.getAttribute('title')).toBe('Task progress: step 5 of 8, Fixes, fix 3')
    expect(screen.getByText('Fixes · fix:3')).toBeTruthy()
  })

  it('renders dynamic step pill indicators with correct done, current and pending counts', () => {
    const task: SessionTaskProgress = {
      taskId: 'NEKODE-74',
      step: 5,
      totalSteps: 6,
      stepName: 'Fixes',
      fix: 3,
      stepNames: ['Intake', 'Specification', 'Plan', 'Plan approval', 'Fixes', 'Verification'],
    }

    render(<TaskProgressButton task={task} />)

    // Check titles on steps
    expect(screen.getByTitle('1. Intake')).toBeTruthy()
    expect(screen.getByTitle('5. Fixes')).toBeTruthy()
    expect(screen.getByTitle('6. Verification')).toBeTruthy()

    const step1 = screen.getByTitle('1. Intake')
    expect(step1.style.backgroundColor).toBe('rgb(139, 124, 246)') // #8b7cf6 (done)

    const step5 = screen.getByTitle('5. Fixes')
    expect(step5.style.backgroundColor).toBe('rgb(125, 211, 252)') // #7dd3fc (current)
    expect(step5.style.boxShadow).toBe('0 0 6px rgba(125,211,252,0.55)')

    const step6 = screen.getByTitle('6. Verification')
    expect(step6.style.backgroundColor).toBe('rgb(46, 54, 77)') // #2e364d (pending)
  })

  it('toggles aria-expanded on click', () => {
    const task: SessionTaskProgress = {
      taskId: 'NEKODE-74',
      step: 2,
      totalSteps: 8,
      stepName: 'Plan',
    }

    render(<TaskProgressButton task={task} />)

    const button = screen.getByTestId(TEST_ID.taskProgressButton)
    expect(button.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })
})
