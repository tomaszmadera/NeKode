import type { AppApi, KanbanComment } from '@shared/ipc-contract'
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { restoreClipboard, stubClipboard } from '../../test/clipboard-stub'
import { kanbanBoardFixture, kanbanWorkItem } from '../../test/kanban-fixtures'
import {
  KanbanItemReview,
  type KanbanItemReviewProps,
  ReviewTextMenu,
  useReviewComments,
} from './KanbanItemReview'

afterEach(() => {
  cleanup()
  restoreClipboard()
})

const ITEM = { ...kanbanWorkItem('NK-1', 'First task', 's1'), stateName: 'Backlog' }

function renderReview(overrides: Partial<KanbanItemReviewProps> = {}): KanbanItemReviewProps {
  const props: KanbanItemReviewProps = {
    item: ITEM,
    states: kanbanBoardFixture.states,
    statusValue: 'Backlog',
    statusError: null,
    priorityValue: null,
    priorityError: null,
    fieldsDisabled: false,
    resumeEnabled: false,
    comments: [],
    commentsLoading: false,
    commentsError: null,
    onStart: vi.fn(),
    onResume: vi.fn(),
    onStatusChange: vi.fn(),
    onPriorityChange: vi.fn(),
    textDraft: null,
    textError: null,
    onEditText: vi.fn(),
    onTextDraftChange: vi.fn(),
    onSaveText: vi.fn(),
    onCancelText: vi.fn(),
    onCopyText: vi.fn(),
    ...overrides,
  }
  render(<KanbanItemReview {...props} />)
  return props
}

describe('KanbanItemReview text edit (NEKODE-196)', () => {
  it('shows Edit with read-only text and asks the board to start editing', () => {
    const props = renderReview()
    expect(screen.queryByTestId(TEST_ID.kanbanReviewEditForm)).toBeNull()
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanReviewEdit))
    expect(props.onEditText).toHaveBeenCalledTimes(1)
  })

  it('disables Edit while a review write is in flight', () => {
    renderReview({ fieldsDisabled: true })
    expect((screen.getByTestId(TEST_ID.kanbanReviewEdit) as HTMLButtonElement).disabled).toBe(true)
  })

  it('replaces the title and description with the form, the plain-text note, and the error', () => {
    const props = renderReview({
      textDraft: { title: 'Draft title', description: 'Draft body' },
      textError: 'Could not update the task.',
    })
    expect(screen.queryByTestId(TEST_ID.kanbanReviewEdit)).toBeNull()
    expect(screen.queryByTestId(TEST_ID.kanbanReviewTitle)).toBeNull()
    expect(screen.queryByTestId(TEST_ID.kanbanReviewDescription)).toBeNull()
    const title = screen.getByLabelText('Title') as HTMLInputElement
    const description = screen.getByLabelText('Description') as HTMLTextAreaElement
    expect(title.value).toBe('Draft title')
    expect(description.value).toBe('Draft body')
    expect(screen.getByTestId(TEST_ID.kanbanReviewEditNote).textContent).toBe(
      'The description is saved as plain text. Formatting from the tracker, such as headings, lists, and links, is not kept.',
    )
    expect(screen.getByTestId(TEST_ID.kanbanReviewEditError).textContent).toBe(
      'Could not update the task.',
    )

    fireEvent.change(title, { target: { value: 'New title' } })
    expect(props.onTextDraftChange).toHaveBeenLastCalledWith({
      title: 'New title',
      description: 'Draft body',
    })
    fireEvent.change(description, { target: { value: 'New body' } })
    expect(props.onTextDraftChange).toHaveBeenLastCalledWith({
      title: 'Draft title',
      description: 'New body',
    })
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanReviewEditSave))
    expect(props.onSaveText).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanReviewEditCancel))
    expect(props.onCancelText).toHaveBeenCalledTimes(1)
  })

  it('blocks Save for a blank title and cancels on Escape', () => {
    const props = renderReview({ textDraft: { title: '   ', description: '' } })
    const save = screen.getByTestId(TEST_ID.kanbanReviewEditSave) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.submit(screen.getByTestId(TEST_ID.kanbanReviewEditForm))
    expect(props.onSaveText).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByLabelText('Title'), { key: 'Escape' })
    expect(props.onCancelText).toHaveBeenCalledTimes(1)
  })

  it('locks the form while saving: no Save, Cancel, or Escape', () => {
    const props = renderReview({
      textDraft: { title: 'Draft title', description: '' },
      fieldsDisabled: true,
    })
    expect((screen.getByTestId(TEST_ID.kanbanReviewEditSave) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect((screen.getByTestId(TEST_ID.kanbanReviewEditCancel) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect((screen.getByLabelText('Title') as HTMLInputElement).disabled).toBe(true)
    fireEvent.keyDown(screen.getByTestId(TEST_ID.kanbanReviewEditForm), { key: 'Escape' })
    expect(props.onCancelText).not.toHaveBeenCalled()
  })

  it('does not open the copy menu from the edit fields', () => {
    const props = renderReview({ textDraft: { title: 'Draft title', description: '' } })
    fireEvent.contextMenu(screen.getByLabelText('Title'))
    fireEvent.contextMenu(screen.getByLabelText('Description'))
    expect(props.onCopyText).not.toHaveBeenCalled()
  })
})

describe('KanbanItemReview', () => {
  it('shows the ref, title, description fallback, and the empty comments state', () => {
    renderReview()
    expect(screen.getByTestId(TEST_ID.kanbanReviewTitle).textContent).toBe('First task')
    expect(screen.getByTestId(TEST_ID.kanbanReviewDescription).textContent).toBe('No description.')
    expect(screen.getByTestId(TEST_ID.kanbanReviewCommentsEmpty)).toBeTruthy()
  })

  it('renders comments, their loading state, and their typed error', () => {
    const comments: KanbanComment[] = [
      { id: 'c1', author: null, text: 'Hello', createdAt: 'not a date' },
    ]
    renderReview({ comments })
    const comment = screen.getByTestId(testIdFor.kanbanReviewComment('c1'))
    expect(comment.textContent).toContain('Unknown')
    expect(comment.textContent).toContain('Hello')
    expect(comment.textContent).toContain('not a date')
    cleanup()

    renderReview({ commentsLoading: true })
    expect(screen.getByText('Loading comments...')).toBeTruthy()
    cleanup()

    renderReview({ commentsError: 'Failed to load comments.' })
    expect(screen.getByTestId(TEST_ID.kanbanReviewCommentsError).textContent).toBe(
      'Failed to load comments.',
    )
  })

  it('saves Status and Priority through callbacks, None as null, and colors the priority', () => {
    const props = renderReview({ priorityValue: 'urgent' })
    const priority = screen.getByTestId(TEST_ID.kanbanReviewPriority) as HTMLSelectElement
    expect(priority.value).toBe('urgent')
    expect(priority.style.color).toBe('rgb(99, 40, 36)')

    fireEvent.change(priority, { target: { value: 'none' } })
    expect(props.onPriorityChange).toHaveBeenCalledWith(null)
    fireEvent.change(screen.getByTestId(TEST_ID.kanbanReviewStatus), {
      target: { value: 's3' },
    })
    expect(props.onStatusChange).toHaveBeenCalledWith('s3')
  })

  it('offers an unknown state name once and disables the selects during a write', () => {
    renderReview({ item: { ...ITEM, stateName: 'Archived' }, statusValue: 'Archived' })
    const status = screen.getByTestId(TEST_ID.kanbanReviewStatus) as HTMLSelectElement
    expect([...status.options].map((option) => option.value)).toEqual([
      's1',
      's2',
      's3',
      'Archived',
    ])
    expect([...status.options].map((option) => option.textContent)).toEqual([
      'Backlog',
      'In Progress',
      'Done',
      'Archived',
    ])
    cleanup()

    renderReview({ fieldsDisabled: true, statusError: 'Nope', priorityError: 'No' })
    expect((screen.getByTestId(TEST_ID.kanbanReviewStatus) as HTMLSelectElement).disabled).toBe(
      true,
    )
    expect((screen.getByTestId(TEST_ID.kanbanReviewPriority) as HTMLSelectElement).disabled).toBe(
      true,
    )
    expect(screen.getByTestId(TEST_ID.kanbanReviewError).textContent).toBe('Nope')
    expect(screen.getByTestId(TEST_ID.kanbanReviewPriorityError).textContent).toBe('No')
  })

  it('routes Start and Resume and opens the copy menu only off controls', () => {
    const props = renderReview({ resumeEnabled: true })
    expect(
      (screen.getByTestId(testIdFor.kanbanItemStart('NK-1')) as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent.click(screen.getByTestId(testIdFor.kanbanItemResume('NK-1')))
    expect(props.onResume).toHaveBeenCalledWith(ITEM)

    fireEvent.contextMenu(screen.getByTestId(TEST_ID.kanbanReviewStatus))
    expect(props.onCopyText).not.toHaveBeenCalled()
    fireEvent.contextMenu(screen.getByTestId(TEST_ID.kanbanReviewTitle), {
      clientX: 5,
      clientY: 6,
    })
    expect(props.onCopyText).toHaveBeenCalledWith('', 5, 6)
  })
})

describe('ReviewTextMenu', () => {
  it('copies the captured text and closes, and disables Copy for blank text', async () => {
    const clipboard = stubClipboard()
    const onClose = vi.fn()
    render(<ReviewTextMenu text="picked" x={1} y={2} onClose={onClose} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }))
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1)
    })
    expect(clipboard.writeText).toHaveBeenCalledWith('picked')
    cleanup()

    render(<ReviewTextMenu text="  " x={1} y={2} onClose={onClose} />)
    expect((screen.getByRole('menuitem', { name: 'Copy' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('shows the copy error when the clipboard rejects', async () => {
    stubClipboard({ writeText: vi.fn(() => Promise.reject(new Error('denied'))) })
    const onClose = vi.fn()
    render(<ReviewTextMenu text="picked" x={1} y={2} onClose={onClose} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Could not copy to the clipboard.')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps the menu inside the viewport when opened at the right edge', () => {
    const originalInnerWidth = window.innerWidth
    const originalInnerHeight = window.innerHeight
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })
    try {
      render(<ReviewTextMenu text="picked" x={790} y={40} onClose={vi.fn()} />)
      const menu = screen.getByRole('menu', { name: 'Copy selection' })
      const panel = menu.firstElementChild as HTMLElement
      const left = Number.parseFloat(panel.style.left)
      const top = Number.parseFloat(panel.style.top)
      // 800 - estimated width 200 - padding 8. The click at 790 would paint off-screen.
      expect(left).toBe(592)
      expect(top).toBe(40)
      expect(left).toBeGreaterThanOrEqual(8)
      expect(left).toBeLessThan(790)
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: originalInnerHeight,
      })
    }
  })
})

describe('useReviewComments', () => {
  it('loads comments for the open ref, reports a typed error, and clears on close', async () => {
    const comments: KanbanComment[] = [{ id: 'c1', author: 'A', text: 'T', createdAt: null }]
    const getComments = vi
      .fn()
      .mockResolvedValueOnce(comments)
      .mockRejectedValueOnce({ nekodeAppError: true, code: 'network', message: 'Offline' })
    const app = { kanban: { getComments } } as unknown as AppApi
    const { result, rerender } = renderHook(
      ({ ref }: { ref: string | null }) => useReviewComments(app, 'p1', ref),
      { initialProps: { ref: null as string | null } },
    )
    expect(result.current).toEqual({ comments: null, loading: false, error: null })
    expect(getComments).not.toHaveBeenCalled()

    rerender({ ref: 'NK-1' })
    expect(result.current.loading).toBe(true)
    await waitFor(() => {
      expect(result.current).toEqual({ comments, loading: false, error: null })
    })
    expect(getComments).toHaveBeenCalledWith('p1', 'NK-1')

    rerender({ ref: 'NK-2' })
    await waitFor(() => {
      expect(result.current).toEqual({ comments: null, loading: false, error: 'Offline' })
    })

    rerender({ ref: null })
    expect(result.current).toEqual({ comments: null, loading: false, error: null })
    expect(getComments).toHaveBeenCalledTimes(2)
  })
})
