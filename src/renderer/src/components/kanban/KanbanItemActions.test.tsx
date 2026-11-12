import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { kanbanWorkItem } from '../../test/kanban-fixtures'
import { ItemLaunchButtons, ResumeMenu, StartMenu } from './KanbanItemActions'

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
    expect(screen.queryByTestId(testIdFor.kanbanResumeOptions('NK-1'))).toBeNull()
  })

  it('opens the Resume menu from its chevron and keeps the main action separate', () => {
    const onResume = vi.fn()
    const onOpenResumeMenu = vi.fn()
    render(
      <ItemLaunchButtons
        item={ITEM}
        resumeEnabled
        onResume={onResume}
        onOpenResumeMenu={onOpenResumeMenu}
      />,
    )
    const group = screen.getByRole('group', { name: 'Resume NK-1' })
    const options = screen.getByTestId(testIdFor.kanbanResumeOptions('NK-1'))
    expect(options.getAttribute('aria-haspopup')).toBe('menu')
    expect(options.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(options)
    expect(onOpenResumeMenu).toHaveBeenCalledTimes(1)
    expect(onOpenResumeMenu.mock.calls[0]?.[0]).toBe(ITEM)
    expect(onOpenResumeMenu.mock.calls[0]?.[3]).toBe(options)
    expect(onResume).not.toHaveBeenCalled()

    fireEvent.keyDown(options, { key: 'ArrowDown' })
    expect(onOpenResumeMenu).toHaveBeenCalledTimes(2)
    fireEvent.click(within(group).getByTestId(testIdFor.kanbanItemResume('NK-1')))
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

describe('ResumeMenu', () => {
  it('closes before Resume or Resume without sending, and Escape returns focus', () => {
    const calls: string[] = []
    const onClose = vi.fn(() => calls.push('close'))
    const onResume = vi.fn(() => calls.push('resume'))
    const onResumeDraft = vi.fn(() => calls.push('draft'))
    const view = render(
      <button type="button" data-testid="anchor">
        anchor
      </button>,
    )
    const anchor = screen.getByTestId('anchor')
    anchor.focus()
    view.rerender(
      <>
        <button type="button" data-testid="anchor">
          anchor
        </button>
        <ResumeMenu
          item={ITEM}
          x={1}
          y={2}
          anchor={anchor}
          onResume={onResume}
          onResumeDraft={onResumeDraft}
          onClose={onClose}
        />
      </>,
    )
    expect(document.activeElement).toBe(screen.getByTestId(TEST_ID.kanbanResumeMenuResume))
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanResumeMenuResume))
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanResumeMenuDraft))
    expect(calls).toEqual(['close', 'resume', 'close', 'draft'])
    expect(onResumeDraft).toHaveBeenCalledWith(ITEM)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
    expect(document.activeElement).toBe(anchor)
  })

  it('moves focus between items with the arrow keys', () => {
    const anchor = document.createElement('button')
    document.body.append(anchor)
    render(
      <ResumeMenu
        item={ITEM}
        x={1}
        y={2}
        anchor={anchor}
        onResumeDraft={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const resume = screen.getByTestId(TEST_ID.kanbanResumeMenuResume)
    const draft = screen.getByTestId(TEST_ID.kanbanResumeMenuDraft)
    expect(document.activeElement).toBe(resume)
    fireEvent.keyDown(resume, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(draft)
    fireEvent.keyDown(draft, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(resume)
    fireEvent.keyDown(resume, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(draft)
    anchor.remove()
  })
})
