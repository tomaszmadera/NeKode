import { useEffect, useRef } from 'react'
import { chatSwitchDirection } from '../../components/terminal/chat-switch-chord'
import { isNewChatChord } from '../../lib/new-chat-chord'
import { useSettingsStore } from '../../stores/useSettingsStore'
import type { WorkspaceRuntime } from './useWorkspaceRuntime'

/**
 * Window-level chat chords, in the capture phase so they win over focus
 * traversal even inside a focused terminal and never reach a PTY
 * (ChatTerminal swallows them in its custom key handler). An open modal
 * dialog swallows both.
 */
export function useChatChords(
  runtime: WorkspaceRuntime,
  handlers: {
    handleSwitchChat: (direction: 1 | -1) => void
    handleCreateChat: (projectId: string) => Promise<boolean>
  },
): void {
  const { setNotice, tabProjectIdRef } = runtime
  const chatSwitchEnabled = useSettingsStore((state) => state.chatSwitchEnabled)
  const switchChatRef = useRef(handlers.handleSwitchChat)
  switchChatRef.current = handlers.handleSwitchChat
  const chatSwitchEnabledRef = useRef(chatSwitchEnabled)
  chatSwitchEnabledRef.current = chatSwitchEnabled
  const createChatRef = useRef(handlers.handleCreateChat)
  createChatRef.current = handlers.handleCreateChat

  // Ctrl+Tab / Ctrl+Shift+Tab chat switching across all projects (NEKODE-18).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) {
        return
      }
      const direction = chatSwitchDirection(event)
      if (direction === null) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (document.querySelector('[aria-modal="true"]') !== null) {
        return
      }
      if (!chatSwitchEnabledRef.current) {
        return
      }
      switchChatRef.current(direction)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])

  // Ctrl+N starts a new chat in the active project (spec Behaviour 3 path).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat || !isNewChatChord(event)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (document.querySelector('[aria-modal="true"]') !== null) {
        return
      }
      const projectId = tabProjectIdRef.current
      if (projectId === null) {
        // Same contract as the "+ New chat" control (Behaviour 8): the flow
        // cannot run without an active project, so the dead press is noticed.
        setNotice('Select or add a project before starting a new chat.')
        return
      }
      void createChatRef.current(projectId)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [setNotice, tabProjectIdRef])
}
