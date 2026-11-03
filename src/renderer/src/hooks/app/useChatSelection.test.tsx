import { act, cleanup, renderHook } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppStoresProvider } from '../../stores/AppStoresProvider'
import { useProjectStore } from '../../stores/useProjectStore'
import { useChatSelection } from './useChatSelection'
import type { WorkspaceRuntime } from './useWorkspaceRuntime'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function wrapper() {
  const app = { state: { get: vi.fn(async () => null), set: vi.fn(async () => undefined) } }
  return ({ children }: { children: React.ReactNode }) => (
    <AppStoresProvider app={app} reportError={vi.fn()}>
      {children}
    </AppStoresProvider>
  )
}

function createMockRuntime(loadChats = vi.fn().mockResolvedValue([])): WorkspaceRuntime {
  return {
    app: {
      state: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(undefined) },
      chats: { list: vi.fn().mockResolvedValue([]), create: vi.fn(), close: vi.fn() },
    } as unknown as WorkspaceRuntime['app'],
    setNotice: vi.fn(),
    removedProjectIdsRef: { current: new Set() },
    removedChatIdsRef: { current: new Set() },
    projectRemovalsRef: { current: new Map() },
    chatsByProjectRef: { current: {} },
    selectionRef: { current: { projectId: null, chatId: null } },
    projectsRef: { current: [] },
    tabProjectIdRef: { current: null },
    pendingTerminalCommandsRef: { current: {} },
    pendingBottomCommandsRef: { current: {} },
    applyChatsUpdate: vi.fn(),
    persistSelection: vi.fn().mockResolvedValue(undefined),
    loadChats,
  } as unknown as WorkspaceRuntime
}

describe('useChatSelection - handleToggleProject', () => {
  it('toggles expansion state and only triggers loadChats when expanding', async () => {
    const loadChats = vi.fn().mockResolvedValue([])
    const runtime = createMockRuntime(loadChats)
    const setTerminalCwds = vi.fn()

    const { result } = renderHook(
      () => ({
        selection: useChatSelection(runtime, setTerminalCwds),
        project: useProjectStore((state) => state),
      }),
      { wrapper: wrapper() },
    )

    expect(result.current.project.expandedProjectIds.has('p1')).toBe(false)

    // Expand p1
    act(() => {
      result.current.selection.handleToggleProject('p1')
    })

    expect(result.current.project.expandedProjectIds.has('p1')).toBe(true)
    expect(loadChats).toHaveBeenCalledTimes(1)
    expect(loadChats).toHaveBeenCalledWith('p1')

    // Collapse p1
    act(() => {
      result.current.selection.handleToggleProject('p1')
    })

    expect(result.current.project.expandedProjectIds.has('p1')).toBe(false)
    // loadChats is not called on collapse
    expect(loadChats).toHaveBeenCalledTimes(1)
  })

  it('correctly calculates next state inside updater on rapid consecutive calls', () => {
    const loadChats = vi.fn().mockResolvedValue([])
    const runtime = createMockRuntime(loadChats)
    const setTerminalCwds = vi.fn()

    const { result } = renderHook(
      () => ({
        selection: useChatSelection(runtime, setTerminalCwds),
        project: useProjectStore((state) => state),
      }),
      { wrapper: wrapper() },
    )

    // Rapid double toggle in the same act/tick
    act(() => {
      result.current.selection.handleToggleProject('p1')
      result.current.selection.handleToggleProject('p1')
    })

    // Expanded then collapsed -> should not be expanded
    expect(result.current.project.expandedProjectIds.has('p1')).toBe(false)
    // loadChats was triggered by the expanding invocation
    expect(loadChats).toHaveBeenCalledTimes(1)
  })
})
