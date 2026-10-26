import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { kanbanWorkItem } from '../../test/kanban-fixtures'
import { ItemLaunchButtons, StartMenu } from './KanbanItemActions'

afterEach(() => {
  cleanup()
})

const ITEM = kanbanWorkItem('NK-1', 'First task', 's1')

describe('ItemLaunchButtons', () => {
  it('starts the item and opens the Start menu from the keyboard menu key', () => {
    const onStart = vi.fn()
    const onOpenStartMenu = vi.fn()
    render(
      <ItemLaunchButtons
        item={ITEM}
        resumeEnabled={false}
        onStart={onStart}
        onOpenStartMenu={onOpenStartMenu}
      />,
    )
    const start = screen.getByTestId(testIdFor.kanbanItemStart('NK-1'))
    fireEvent.click(start)
    expect(onStart).toHaveBeenCalledWith(ITEM)
    fireEvent.keyDown(start, { key: 'F10', shiftKey: true })
    expect(onOpenStartMenu).toHaveBeenCalledWith(ITEM, 0, 0)
    expect(screen.queryByTestId(testIdFor.kanbanItemResume('NK-1'))).toBeNull()
  })

  it('disables Start, opens no Start menu, and shows Resume when resumable', () => {
    const onResume = vi.fn()
    const onOpenStartMenu = vi.fn()
    render(
      <ItemLaunchButtons
        item={ITEM}
        resumeEnabled
        onResume={onResume}
        onOpenStartMenu={onOpenStartMenu}
      />,
    )
    const start = screen.getByTestId(testIdFor.kanbanItemStart('NK-1')) as HTMLButtonElement
    expect(start.disabled).toBe(true)
    fireEvent.contextMenu(start)
    expect(onOpenStartMenu).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId(testIdFor.kanbanItemResume('NK-1')))
    expect(onResume).toHaveBeenCalledWith(ITEM)
  })
})

describe('StartMenu', () => {
  it('closes before Start or Start without sending, and closes on Escape', () => {
    const calls: string[] = []
    const onClose = vi.fn(() => calls.push('close'))
    const onStart = vi.fn(() => calls.push('start'))
    const onStartDraft = vi.fn(() => calls.push('draft'))
    render(
      <StartMenu
        item={ITEM}
        x={1}
        y={2}
        onStart={onStart}
        onStartDraft={onStartDraft}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanStartMenuStart))
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanStartMenuDraft))
    expect(calls).toEqual(['close', 'start', 'close', 'draft'])
    expect(onStartDraft).toHaveBeenCalledWith(ITEM)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
