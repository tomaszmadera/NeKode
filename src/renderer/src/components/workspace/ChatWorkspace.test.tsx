import type { RenderResult } from '@testing-library/react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import type { AppApi, ChatInfo, ProjectInfo } from '../../../../shared/ipc-contract'
import { emptyGitWorktree } from '../../../../shared/ipc-contract'
import { DEFAULT_ATTENTION_SETTINGS } from '../../lib/attention-settings'
import { playAttentionChime } from '../../lib/chime'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { resetMockFitAddons } from '../../test/fit-addon-mock'
import { mockTerminalInstances, resetMockTerminals } from '../../test/xterm-mock'
import { ChatWorkspace } from './ChatWorkspace'

// Session-host tests with the app bridge and xterm.js mocked: chat selection
// opens the workspace, switching chats preserves sessions and scrollback
// (same chatId keeps its session handle), terminal exit closes the chat
// (dispose + chat-close hand-off, spec Behaviour 11) and failed spawns surface
// the spawn-error state with Retry (the only terminal overlay in this slice).

vi.mock('@xterm/xterm', () => import('../../test/xterm-mock'))
vi.mock('@xterm/addon-fit', () => import('../../test/fit-addon-mock'))
// The chime is stubbed at its module boundary: component tests assert call
// gating only; the real Web Audio path has no jsdom AudioContext (its guard
// behavior is covered in chime.test.ts).
vi.mock('../../lib/chime', () => ({ playAttentionChime: vi.fn() }))

const projectA: ProjectInfo = {
  id: 'p1',
  name: 'Demo',
  path: 'D:/code/demo',
  runtimeLabel: 'Node 24',
}
const chatOne: ChatInfo = { id: 't1', projectId: 'p1', name: 'First chat' }
const chatTwo: ChatInfo = { id: 't2', projectId: 'p1', name: 'Second chat' }

interface AppMockBundle {
  app: AppApi
  exitListenersByChat: Map<string, Set<(exitCode: number) => void>>
  emitExit: (chatId: string, exitCode: number) => void
  emitData: (chatId: string, data: string) => void
  countExitListeners: () => number
}

function createAppMock(): AppMockBundle {
  const exitListenersByChat = new Map<string, Set<(exitCode: number) => void>>()
  const dataListenersByChat = new Map<string, Set<(data: string) => void>>()
  const app: AppApi = {
    actions: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      execute: vi.fn(),
      status: vi.fn(),
    },
    projects: {
      list: vi.fn().mockResolvedValue([projectA]),
      add: vi.fn().mockResolvedValue(null),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    chats: {
      list: vi.fn().mockResolvedValue([chatOne, chatTwo]),
      create: vi.fn().mockResolvedValue(chatTwo),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    state: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    },
    terminals: {
      create: vi.fn().mockImplementation((chatId: string) => Promise.resolve(chatId)),
      write: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      shellName: vi.fn().mockResolvedValue('PowerShell'),
      shellList: vi.fn().mockResolvedValue([]),
      shellDetect: vi.fn().mockResolvedValue([{ id: 'default', label: 'PowerShell' }]),
      shellAddCustom: vi.fn().mockResolvedValue({ id: 'default', label: 'PowerShell' }),
      terminate: vi.fn().mockResolvedValue(undefined),
      onData: vi.fn((chatId: string, cb: (data: string) => void) => {
        const listeners = dataListenersByChat.get(chatId) ?? new Set()
        listeners.add(cb)
        dataListenersByChat.set(chatId, listeners)
        return () => {
          listeners.delete(cb)
        }
      }),
      onExit: vi.fn((chatId: string, cb: (exitCode: number) => void) => {
        const listeners = exitListenersByChat.get(chatId) ?? new Set()
        listeners.add(cb)
        exitListenersByChat.set(chatId, listeners)
        return () => {
          listeners.delete(cb)
        }
      }),
    },
    git: {
      getStatus: vi
        .fn()
        .mockResolvedValue({ branch: 'main', dirty: false, worktree: emptyGitWorktree() }),
    },
    files: {
      list: vi.fn().mockResolvedValue([]),
      read: vi.fn().mockResolvedValue({ kind: 'text', content: '', language: null }),
      openExternal: vi.fn().mockResolvedValue(undefined),
      openRoot: vi.fn().mockResolvedValue(undefined),
    },
    handoffs: {
      list: vi.fn().mockResolvedValue([]),
    },
    kanban: {
      adaptersList: vi.fn().mockResolvedValue([]),
      getConfig: vi.fn().mockResolvedValue({ adapterId: null, values: {}, secretKeys: [] }),
      setConfig: vi.fn().mockResolvedValue(undefined),
      test: vi.fn().mockResolvedValue(undefined),
      listBoard: vi.fn().mockResolvedValue({ states: [], items: [] }),
      createItem: vi.fn(),
      updateItem: vi.fn(),
    },
    dialogs: {
      pickDirectory: vi.fn().mockResolvedValue(null),
    },
  }
  return {
    app,
    exitListenersByChat,
    emitExit: (chatId, exitCode) => {
      for (const listener of [...(exitListenersByChat.get(chatId) ?? [])]) {
        listener(exitCode)
      }
    },
    emitData: (chatId, data) => {
      for (const listener of [...(dataListenersByChat.get(chatId) ?? [])]) {
        listener(data)
      }
    },
    countExitListeners: () => {
      let total = 0
      for (const listeners of exitListenersByChat.values()) {
        total += listeners.size
      }
      return total
    },
  }
}

function workspaceProps(
  bundle: AppMockBundle,
  options: {
    chatId: string | null
    selectionNonce: number
    chatsByProject?: Record<string, ChatInfo[]>
    chatsLoaded?: boolean
  },
) {
  return {
    app: bundle.app,
    projects: [projectA],
    chatsByProject: options.chatsByProject ?? { p1: [chatOne, chatTwo] },
    chatsLoaded: options.chatsLoaded ?? true,
    selectedProjectId: 'p1',
    selectedChatId: options.chatId,
    selectionNonce: options.selectionNonce,
    attention: {},
    onAttentionChange: vi.fn(),
    attentionSettings: DEFAULT_ATTENTION_SETTINGS,
    onChatClosed: vi.fn(),
    onStartNewChat: vi.fn(),
    onAddProject: vi.fn(),
  }
}

describe('ChatWorkspace session host', () => {
  beforeEach(() => {
    resetMockTerminals()
    resetMockFitAddons()
  })

  afterEach(() => {
    cleanup()
    vi.mocked(playAttentionChime).mockClear()
  })

  it('shows the welcome surface until a chat is selected, then opens the workspace', async () => {
    const bundle = createAppMock()
    const props = workspaceProps(bundle, { chatId: null, selectionNonce: 0 })
    const { rerender } = render(<ChatWorkspace {...props} />)
    expect(screen.getByTestId(TEST_ID.welcomeSurface)).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.chatWorkspace)).toBeNull()
    expect(bundle.app.terminals.create).not.toHaveBeenCalled()
    expect(screen.getByRole('heading').textContent).toBe('Welcome to NeKode')
    fireEvent.click(screen.getByRole('button', { name: 'New Chat' }))
    expect(props.onStartNewChat).toHaveBeenCalledTimes(1)
    expect(props.onAddProject).not.toHaveBeenCalled()

    rerender(<ChatWorkspace {...workspaceProps(bundle, { chatId: 't1', selectionNonce: 1 })} />)
    expect(screen.queryByTestId(TEST_ID.welcomeSurface)).toBeNull()
    const workspace = screen.getByTestId(TEST_ID.chatWorkspace)
    // The chat name lives in the terminal-chat tab label (tab model); the
    // workspace itself hosts the terminal view.
    expect(workspace).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId(testIdFor.terminalView('t1'))).toBeTruthy())
    await waitFor(() =>
      expect(bundle.app.terminals.create).toHaveBeenCalledWith('t1', 'D:/code/demo'),
    )
  })

  it('shows the Start new chat empty state when the project has no chats left', () => {
    const bundle = createAppMock()
    const props = workspaceProps(bundle, {
      chatId: null,
      selectionNonce: 0,
      chatsByProject: { p1: [] },
    })
    render(<ChatWorkspace {...props} />)
    expect(screen.getByTestId(TEST_ID.startNewChatState)).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.welcomeSurface)).toBeNull()

    fireEvent.click(screen.getByTestId(TEST_ID.startNewChatButton))
    expect(props.onStartNewChat).toHaveBeenCalledTimes(1)
  })

  it('preserves sessions across chat switches (same chatId keeps its session handle)', async () => {
    const bundle = createAppMock()
    const view = render(
      <ChatWorkspace {...workspaceProps(bundle, { chatId: 't1', selectionNonce: 1 })} />,
    )
    await waitFor(() => expect(bundle.app.terminals.create).toHaveBeenCalledTimes(1))
    const firstTerminal = mockTerminalInstances[0]

    // Switch to chat two: its own lazy spawn; chat one stays alive and hidden.
    view.rerender(
      <ChatWorkspace {...workspaceProps(bundle, { chatId: 't2', selectionNonce: 2 })} />,
    )
    await waitFor(() => expect(bundle.app.terminals.create).toHaveBeenCalledTimes(2))
    expect(bundle.app.terminals.create).toHaveBeenLastCalledWith('t2', 'D:/code/demo')
    expect(firstTerminal.dispose).not.toHaveBeenCalled()
    expect(screen.getByTestId(testIdFor.terminalView('t1')).style.display).toBe('none')
    expect(screen.getByTestId(testIdFor.terminalView('t2')).style.display).toBe('block')

    // Back to chat one: re-attach to the same session — no respawn, no
    // scrollback reset (the same xterm instance keeps its buffer).
    view.rerender(
      <ChatWorkspace {...workspaceProps(bundle, { chatId: 't1', selectionNonce: 3 })} />,
    )
    expect(bundle.app.terminals.create).toHaveBeenCalledTimes(2)
    expect(mockTerminalInstances).toHaveLength(2)
    expect(firstTerminal.dispose).not.toHaveBeenCalled()
    expect(screen.getByTestId(testIdFor.terminalView('t1')).style.display).toBe('block')

    // Background data keeps flowing into the hidden terminal's scrollback.
    act(() => {
      bundle.emitData('t1', 'background output')
    })
    expect(firstTerminal.written).toContain('background output')
  })

  it('terminal exit disposes the view and hands the chat-close flow to the host', async () => {
    const bundle = createAppMock()
    const props = workspaceProps(bundle, { chatId: 't1', selectionNonce: 1 })
    render(<ChatWorkspace {...props} />)
    await waitFor(() => expect(bundle.app.terminals.create).toHaveBeenCalledTimes(1))
    const firstTerminal = mockTerminalInstances[0]

    act(() => {
      bundle.emitExit('t1', 3)
    })

    // Spec Behaviour 11: the terminal view is disposed (unsubscribed xterm)
    // and the host removes the chat from the tree and the database.
    await waitFor(() => expect(firstTerminal.dispose).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId(testIdFor.terminalView('t1'))).toBeNull()
    expect(props.onChatClosed).toHaveBeenCalledTimes(1)
    expect(props.onChatClosed).toHaveBeenCalledWith('t1')
    // Bridge subscriptions die with the view; no "session ended" state exists.
    expect(bundle.countExitListeners()).toBe(0)
    expect(screen.queryByTestId(TEST_ID.terminalSpawnError)).toBeNull()
  })

  it('a duplicate exit event closes the chat exactly once', async () => {
    const bundle = createAppMock()
    const props = workspaceProps(bundle, { chatId: 't1', selectionNonce: 1 })
    render(<ChatWorkspace {...props} />)
    await waitFor(() => expect(bundle.app.terminals.create).toHaveBeenCalledTimes(1))

    act(() => {
      bundle.emitExit('t1', 0)
      bundle.emitExit('t1', 0)
    })
    expect(props.onChatClosed).toHaveBeenCalledTimes(1)
  })

  it('a background chat exit closes that chat without touching the viewed one', async () => {
    const bundle = createAppMock()
    const view = render(
      <ChatWorkspace {...workspaceProps(bundle, { chatId: 't1', selectionNonce: 1 })} />,
    )
    await waitFor(() => expect(bundle.app.terminals.create).toHaveBeenCalledTimes(1))
    view.rerender(
      <ChatWorkspace {...workspaceProps(bundle, { chatId: 't2', selectionNonce: 2 })} />,
    )
    await waitFor(() => expect(bundle.app.terminals.create).toHaveBeenCalledTimes(2))
    const viewedTerminal = mockTerminalInstances[1]

    act(() => {
      bundle.emitExit('t1', 3)
    })

    await waitFor(() => expect(screen.queryByTestId(testIdFor.terminalView('t1'))).toBeNull())
    expect(mockTerminalInstances[0].dispose).toHaveBeenCalledTimes(1)
    expect(viewedTerminal.dispose).not.toHaveBeenCalled()
    expect(screen.getByTestId(testIdFor.terminalView('t2'))).toBeTruthy()
  })

  it('a projects/chats reload never retries a failed spawn (explicit re-selection only)', async () => {
    const bundle = createAppMock()
    vi.mocked(bundle.app.terminals.create).mockRejectedValueOnce({
      nekodeAppError: true,
      code: 'not_found',
      message: 'The project directory does not exist.',
    })
    const view = render(
      <ChatWorkspace {...workspaceProps(bundle, { chatId: 't1', selectionNonce: 1 })} />,
    )
    await screen.findByTestId(TEST_ID.terminalSpawnError)

    // The spawn-error state survives the same refresh unaltered.
    view.rerender(
      <ChatWorkspace
        {...workspaceProps(bundle, { chatId: 't1', selectionNonce: 1 })}
        projects={[{ ...projectA }]}
        chatsByProject={{ p1: [{ ...chatOne }, { ...chatTwo }] }}
      />,
    )
    expect(bundle.app.terminals.create).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId(TEST_ID.terminalSpawnError)).toBeTruthy()

    // Explicit re-selection retries the spawn.
    view.rerender(
      <ChatWorkspace {...workspaceProps(bundle, { chatId: 't1', selectionNonce: 2 })} />,
    )
    await waitFor(() => expect(bundle.app.terminals.create).toHaveBeenCalledTimes(2))
  })

  it('evicts session views for removed chats and disposes their xterm instances', async () => {
    const bundle = createAppMock()
    const view = render(
      <ChatWorkspace {...workspaceProps(bundle, { chatId: 't1', selectionNonce: 1 })} />,
    )
    await waitFor(() => expect(bundle.app.terminals.create).toHaveBeenCalledTimes(1))
    const firstTerminal = mockTerminalInstances[0]

    // The chat disappears from every project's chat list (project deletion
    // cascade): its view must unmount and tear down the xterm + subscriptions.
    view.rerender(
      <ChatWorkspace
        {...workspaceProps(bundle, { chatId: null, selectionNonce: 1 })}
        projects={[]}
        chatsByProject={{}}
        selectedProjectId={null}
      />,
    )
    expect(screen.queryByTestId(testIdFor.terminalView('t1'))).toBeNull()
    await waitFor(() => expect(firstTerminal.dispose).toHaveBeenCalledTimes(1))
    // Bridge subscriptions are torn down with the view (exit listeners gone).
    expect(bundle.countExitListeners()).toBe(0)
    act(() => {
      bundle.emitData('t1', 'after eviction')
    })
    expect(firstTerminal.written).not.toContain('after eviction')
  })

  it('surfaces the spawn-error state with a retry affordance', async () => {
    const bundle = createAppMock()
    vi.mocked(bundle.app.terminals.create)
      .mockRejectedValueOnce({
        nekodeAppError: true,
        code: 'not_found',
        message: 'The project directory does not exist.',
      })
      .mockImplementation((chatId: string) => Promise.resolve(chatId))

    render(<ChatWorkspace {...workspaceProps(bundle, { chatId: 't1', selectionNonce: 1 })} />)
    const errorState = await screen.findByTestId(TEST_ID.terminalSpawnError)
    expect(errorState.textContent).toContain('The project directory does not exist.')

    fireEvent.click(screen.getByTestId(TEST_ID.terminalRetry))
    await waitFor(() => expect(bundle.app.terminals.create).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.terminalSpawnError)).toBeNull())
  })

  it('a failed spawn never closes the chat (only terminal exit does)', async () => {
    const bundle = createAppMock()
    const props = workspaceProps(bundle, { chatId: 't1', selectionNonce: 1 })
    vi.mocked(bundle.app.terminals.create).mockRejectedValue({
      nekodeAppError: true,
      code: 'not_found',
      message: 'The project directory does not exist.',
    })
    render(<ChatWorkspace {...props} />)
    await screen.findByTestId(TEST_ID.terminalSpawnError)
    expect(props.onChatClosed).not.toHaveBeenCalled()
  })

  it('a failed close leaves the chat closable: a fresh session closes it again', async () => {
    const bundle = createAppMock()
    const props = workspaceProps(bundle, { chatId: 't1', selectionNonce: 1 })
    const view = render(<ChatWorkspace {...props} />)
    await waitFor(() => expect(bundle.app.terminals.create).toHaveBeenCalledTimes(1))

    // The host fails to remove the chat (chats.remove rejected), so the chat
    // stays in the tree — with this exit already handed to the host once.
    act(() => {
      bundle.emitExit('t1', 0)
    })
    expect(props.onChatClosed).toHaveBeenCalledTimes(1)

    // Re-selecting the chat opens a fresh session for it…
    view.rerender(<ChatWorkspace {...props} selectionNonce={2} />)
    await waitFor(() => expect(bundle.app.terminals.create).toHaveBeenCalledTimes(2))

    // …whose exit must close the chat: the stale close guard from the failed
    // attempt must not swallow it (the chat would be permanently un-closable).
    act(() => {
      bundle.emitExit('t1', 0)
    })
    expect(props.onChatClosed).toHaveBeenCalledTimes(2)
    expect(props.onChatClosed).toHaveBeenLastCalledWith('t1')
  })

  it('holds the Start new chat state back until the chat list is loaded', () => {
    const bundle = createAppMock()
    const view = render(
      <ChatWorkspace
        {...workspaceProps(bundle, {
          chatId: null,
          selectionNonce: 0,
          chatsByProject: { p1: [] },
          chatsLoaded: false,
        })}
      />,
    )
    // "Not loaded yet" is not "no chats": the neutral welcome surface shows
    // until the load settles (no flash of the empty-state affordance).
    expect(screen.getByTestId(TEST_ID.welcomeSurface)).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.startNewChatState)).toBeNull()

    view.rerender(
      <ChatWorkspace
        {...workspaceProps(bundle, {
          chatId: null,
          selectionNonce: 0,
          chatsByProject: { p1: [] },
          chatsLoaded: true,
        })}
      />,
    )
    expect(screen.getByTestId(TEST_ID.startNewChatState)).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.welcomeSurface)).toBeNull()
  })

  // --- Attention state (chat attention badge spec) --------------------------
  // The workspace owns signal/clear wiring for every mounted (hidden included)
  // chat view; the host renders the state. A fresh workspaceProps() carries
  // empty attention, so each test drives the state through a controlled
  // onAttentionChange spy and feeds it back on rerender.
  describe('chat attention', () => {
    async function renderTwoChatWorkspace(
      bundle: AppMockBundle,
      attentionSettings = DEFAULT_ATTENTION_SETTINGS,
    ): Promise<{
      view: RenderResult
      onAttentionChange: Mock<(attention: Record<string, { message: string | null }>) => void>
    }> {
      const onAttentionChange = vi.fn()
      const view = render(
        <ChatWorkspace
          {...workspaceProps(bundle, { chatId: 't1', selectionNonce: 1 })}
          attentionSettings={attentionSettings}
          onAttentionChange={onAttentionChange}
        />,
      )
      await waitFor(() => expect(bundle.app.terminals.create).toHaveBeenCalledTimes(1))
      // Select the second chat: the first stays mounted (hidden) and keeps
      // detecting — the retention contract this feature leans on.
      view.rerender(
        <ChatWorkspace
          {...workspaceProps(bundle, { chatId: 't2', selectionNonce: 2 })}
          attentionSettings={attentionSettings}
          onAttentionChange={onAttentionChange}
        />,
      )
      await waitFor(() => expect(bundle.app.terminals.create).toHaveBeenCalledTimes(2))
      return { view, onAttentionChange }
    }

    function rerenderWith(
      view: RenderResult,
      bundle: AppMockBundle,
      options: { chatId: string; selectionNonce: number; attention: Record<string, unknown> },
      onAttentionChange: Mock<(attention: Record<string, { message: string | null }>) => void>,
    ): void {
      view.rerender(
        <ChatWorkspace
          {...workspaceProps(bundle, {
            chatId: options.chatId,
            selectionNonce: options.selectionNonce,
          })}
          attention={options.attention as Record<string, { message: string | null }>}
          onAttentionChange={onAttentionChange}
        />,
      )
    }

    it('AC10 + AC9: a signal on a hidden chat marks exactly that chat', async () => {
      const bundle = createAppMock()
      const { onAttentionChange } = await renderTwoChatWorkspace(bundle)

      act(() => {
        bundle.emitData('t1', '\x07')
      })
      expect(onAttentionChange).toHaveBeenLastCalledWith({ t1: { message: null } })

      act(() => {
        bundle.emitData('t1', '\x1b]9;needs permission\x07')
      })
      // A newer OSC 9 message replaces the tooltip text (Edge cases).
      expect(onAttentionChange).toHaveBeenLastCalledWith({
        t1: { message: 'needs permission' },
      })
      // Never a second chat's entry: the key is the chat id only.
      expect(onAttentionChange).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ t2: expect.anything() }),
      )
    })

    it('AC4 (attention-alert-settings): a signal on the selected chat marks it and chimes by default', async () => {
      const bundle = createAppMock()
      const { onAttentionChange } = await renderTwoChatWorkspace(bundle)

      act(() => {
        bundle.emitData('t2', '\x1b]9;while watched\x07')
      })
      // The active-indicator default is ON: the selected chat's signal sets
      // state so its row can show the indicator dot (spec Behaviour 3).
      expect(onAttentionChange).toHaveBeenLastCalledWith({
        t2: { message: 'while watched' },
      })
      expect(playAttentionChime).toHaveBeenCalledTimes(1)
    })

    it('AC3 (attention-alert-settings): active-indicator off suppresses the selected chat state, chime still fires', async () => {
      const bundle = createAppMock()
      const { onAttentionChange } = await renderTwoChatWorkspace(bundle, {
        ...DEFAULT_ATTENTION_SETTINGS,
        activeIndicator: false,
      })

      act(() => {
        bundle.emitData('t2', '\x07')
      })
      expect(onAttentionChange).toHaveBeenCalledTimes(0)
      expect(playAttentionChime).toHaveBeenCalledTimes(1)
    })

    it('AC4 (attention-alert-settings): active chime off silences the selected chat, indicator still marks', async () => {
      const bundle = createAppMock()
      const { onAttentionChange } = await renderTwoChatWorkspace(bundle, {
        ...DEFAULT_ATTENTION_SETTINGS,
        activeChime: false,
      })

      act(() => {
        bundle.emitData('t2', '\x07')
      })
      expect(onAttentionChange).toHaveBeenLastCalledWith({ t2: { message: null } })
      expect(playAttentionChime).not.toHaveBeenCalled()
    })

    it('AC5 (attention-alert-settings): background chime off silences hidden-chat signals, state still marks', async () => {
      const bundle = createAppMock()
      const { onAttentionChange } = await renderTwoChatWorkspace(bundle, {
        ...DEFAULT_ATTENTION_SETTINGS,
        chime: false,
      })

      act(() => {
        bundle.emitData('t1', '\x07')
      })
      expect(onAttentionChange).toHaveBeenLastCalledWith({ t1: { message: null } })
      expect(playAttentionChime).not.toHaveBeenCalled()
    })

    it('AC6 (attention-alert-settings): clearing a badge never chimes', async () => {
      const bundle = createAppMock()
      const { view } = await renderTwoChatWorkspace(bundle)
      act(() => {
        bundle.emitData('t1', '\x07')
      })
      const chimesAfterSignal = vi.mocked(playAttentionChime).mock.calls.length
      expect(chimesAfterSignal).toBe(1)

      // Delivered input clears t1's state — and must not sound.
      rerenderWith(
        view,
        bundle,
        { chatId: 't2', selectionNonce: 2, attention: { t1: { message: null } } },
        vi.fn(),
      )
      const hiddenInput = within(screen.getByTestId(testIdFor.terminalView('t1'))).getByTestId(
        TEST_ID.terminalPromptInput,
      )
      fireEvent.change(hiddenInput, { target: { value: 'go on' } })
      fireEvent.submit(hiddenInput.closest('form') as HTMLFormElement)
      await waitFor(() => expect(bundle.app.terminals.write).toHaveBeenCalledWith('t1', 'go on'))
      expect(vi.mocked(playAttentionChime).mock.calls.length).toBe(chimesAfterSignal)
    })

    it('AC5: selecting a badged chat clears its badge', async () => {
      const bundle = createAppMock()
      const { view } = await renderTwoChatWorkspace(bundle)
      act(() => {
        bundle.emitData('t1', '\x07')
      })

      const selectSpy = vi.fn()
      rerenderWith(
        view,
        bundle,
        { chatId: 't1', selectionNonce: 3, attention: { t1: { message: null } } },
        selectSpy,
      )
      await waitFor(() => expect(selectSpy).toHaveBeenLastCalledWith({}))
    })

    it('AC6: submitting input to a badged chat clears its badge and writes the PTY', async () => {
      const bundle = createAppMock()
      const { view } = await renderTwoChatWorkspace(bundle)
      act(() => {
        bundle.emitData('t1', '\x07')
      })
      const writeSpy = vi.fn()
      rerenderWith(
        view,
        bundle,
        { chatId: 't2', selectionNonce: 2, attention: { t1: { message: null } } },
        writeSpy,
      )

      // The hidden chat's prompt input is mounted and addressable: submitting
      // there is delivered input for exactly that chat.
      const hiddenInput = within(screen.getByTestId(testIdFor.terminalView('t1'))).getByTestId(
        TEST_ID.terminalPromptInput,
      )
      fireEvent.change(hiddenInput, { target: { value: 'go on' } })
      fireEvent.submit(hiddenInput.closest('form') as HTMLFormElement)
      await waitFor(() => expect(bundle.app.terminals.write).toHaveBeenCalledWith('t1', 'go on'))
      expect(writeSpy).toHaveBeenLastCalledWith({})
    })

    it('Behaviour 7: removing the chat removes its attention state with it', async () => {
      const bundle = createAppMock()
      const { view } = await renderTwoChatWorkspace(bundle)
      const state = { t1: { message: null } }

      const removeSpy = vi.fn()
      view.rerender(
        <ChatWorkspace
          {...workspaceProps(bundle, { chatId: 't2', selectionNonce: 2 })}
          chatsByProject={{ p1: [chatTwo] }}
          attention={state as Record<string, { message: string | null }>}
          onAttentionChange={removeSpy}
        />,
      )
      await waitFor(() => expect(removeSpy).toHaveBeenLastCalledWith({}))
    })
  })
})
