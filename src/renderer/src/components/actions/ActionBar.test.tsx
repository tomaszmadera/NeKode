import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActionControl, AppApi } from '../../../../shared/ipc-contract'
import { ActionBar } from './ActionBar'

afterEach(cleanup)

function makeAppMock(): AppApi {
  return {
    actions: {
      status: vi.fn().mockResolvedValue({ status: 'idle', exitCode: null }),
      execute: vi.fn().mockResolvedValue({ status: 'success', exitCode: 0 }),
    },
    terminals: {
      write: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as AppApi
}

const customAction: ActionControl = {
  id: 'action-1',
  scope: 'global',
  projectId: null,
  title: 'Start',
  icon: null,
  command: 'npm start',
  cwd: null,
  runMode: 'background',
  confirm: false,
  sortOrder: 0,
}

describe('ActionBar', () => {
  it('renders fixed buttons and custom actions on the left by default (non-kanban)', async () => {
    const app = makeAppMock()
    const onSettings = vi.fn()
    render(
      <ActionBar
        app={app}
        actions={[customAction]}
        projectId="p1"
        activeChatId="c1"
        chatIsLive={true}
        onNewTerminal={vi.fn()}
        onBottomTerminal={vi.fn()}
        onPromptCommand={vi.fn()}
        onResume={vi.fn()}
        onError={vi.fn()}
        onSettings={onSettings}
        markdownView={null}
        isKanban={false}
      />,
    )

    expect(screen.getByRole('button', { name: 'Handoff' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
    const customBtn = screen.getByRole('button', { name: 'Start' })
    expect(customBtn).toBeTruthy()
    const settingsBtn = screen.getByRole('button', { name: 'Actions' })
    expect(settingsBtn).toBeTruthy()

    // In default layout, custom button is NOT inside the right ml-auto container
    const rightContainer = settingsBtn.closest('div.ml-auto')
    expect(rightContainer).not.toBeNull()
    expect(rightContainer?.contains(customBtn)).toBe(false)
  })

  it('in kanban mode, hides fixed buttons and places custom actions on the right before settings', async () => {
    const app = makeAppMock()
    const onSettings = vi.fn()
    render(
      <ActionBar
        app={app}
        actions={[customAction]}
        projectId="p1"
        activeChatId="c1"
        chatIsLive={true}
        onNewTerminal={vi.fn()}
        onBottomTerminal={vi.fn()}
        onPromptCommand={vi.fn()}
        onResume={vi.fn()}
        onError={vi.fn()}
        onSettings={onSettings}
        markdownView={null}
        isKanban={true}
      />,
    )

    // Fixed buttons should not exist on kanban view
    expect(screen.queryByRole('button', { name: 'Handoff' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()

    const customBtn = screen.getByRole('button', { name: 'Start' })
    expect(customBtn).toBeTruthy()
    const settingsBtn = screen.getByRole('button', { name: 'Actions' })
    expect(settingsBtn).toBeTruthy()

    // In kanban layout, custom button IS inside the right ml-auto container before settings
    const rightContainer = settingsBtn.closest('div.ml-auto')
    expect(rightContainer).not.toBeNull()
    expect(rightContainer?.contains(customBtn)).toBe(true)

    // Clicking custom button triggers execution
    fireEvent.click(customBtn)
    await waitFor(() => {
      expect(app.actions.execute).toHaveBeenCalledWith('action-1', 'p1', false)
    })
  })

  it('in kanban mode with no custom actions, hides fixed buttons and renders only settings on the right', () => {
    const app = makeAppMock()
    render(
      <ActionBar
        app={app}
        actions={[]}
        projectId="p1"
        activeChatId={null}
        chatIsLive={false}
        onNewTerminal={vi.fn()}
        onBottomTerminal={vi.fn()}
        onPromptCommand={vi.fn()}
        onResume={vi.fn()}
        onError={vi.fn()}
        onSettings={vi.fn()}
        markdownView={null}
        isKanban={true}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Handoff' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Actions' })).toBeTruthy()
  })
})
