import type React from 'react'
import { useCallback, useRef, useState } from 'react'
import { useChatStore } from '../../stores/useChatStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import type { WorkspaceRuntime } from './useWorkspaceRuntime'

export interface PromptInjection {
  chatId: string
  text: string
  nonce: number
}

/** Chat terminal plumbing: launch directories, prompt fills, liveness and ready commands. */
export function useChatTerminals(runtime: WorkspaceRuntime): {
  terminalCwds: Record<string, string>
  setTerminalCwds: React.Dispatch<React.SetStateAction<Record<string, string>>>
  promptInjection: PromptInjection | null
  handlePromptCommand: (text: string) => void
  fillDraftPrompt: (chatId: string, text: string) => void
  handlePromptInjected: (nonce: number) => void
  handleSessionStatus: (chatId: string, live: boolean) => void
  handleSessionReady: (chatId: string) => void
} {
  const { selectionRef, pendingTerminalCommandsRef, cancelPendingSubmit, submitLine } = runtime
  const liveChatIds = useChatStore((state) => state.liveChatIds)
  const setLiveChatIds = useChatStore((state) => state.setLiveChatIds)
  const autoSendHandoff = useSettingsStore((state) => state.autoSendHandoff)
  const [terminalCwds, setTerminalCwds] = useState<Record<string, string>>({})
  // Pending console paste addressed to one chat (without submitting).
  const [promptInjection, setPromptInjection] = useState<PromptInjection | null>(null)
  const promptInjectionNonceRef = useRef(0)

  // Handoff/Resume delivery (spec handoff-resume-flow Behaviour 3): auto-send
  // writes the English command plus CR straight to the PTY through the
  // split-write helper; the default pastes into the addressed console and
  // waits for the user to submit.
  const handlePromptCommand = useCallback(
    (text: string): void => {
      const chatId = selectionRef.current.chatId
      if (chatId === null || !liveChatIds.has(chatId)) return
      if (autoSendHandoff) {
        submitLine(chatId, text, 'Failed to send the command.')
        return
      }
      promptInjectionNonceRef.current += 1
      setPromptInjection({ chatId, text, nonce: promptInjectionNonceRef.current })
    },
    [autoSendHandoff, liveChatIds, selectionRef, submitLine],
  )

  // Start without sending (NEKODE-99): the prompt main returned for a delivered
  // draft launch is pasted into the new chat's console without submitting.
  const fillDraftPrompt = useCallback((chatId: string, text: string): void => {
    promptInjectionNonceRef.current += 1
    setPromptInjection({ chatId, text, nonce: promptInjectionNonceRef.current })
  }, [])

  const handlePromptInjected = useCallback((nonce: number): void => {
    setPromptInjection((previous) =>
      previous !== null && previous.nonce === nonce ? null : previous,
    )
  }, [])

  const handleSessionStatus = useCallback(
    (chatId: string, live: boolean): void => {
      if (!live) {
        cancelPendingSubmit(chatId)
      }
      setLiveChatIds((previous) => {
        const next = new Set(previous)
        if (live) next.add(chatId)
        else next.delete(chatId)
        return next
      })
    },
    [cancelPendingSubmit, setLiveChatIds],
  )

  const handleSessionReady = useCallback(
    (chatId: string): void => {
      const command = pendingTerminalCommandsRef.current[chatId]
      if (command === undefined) return
      delete pendingTerminalCommandsRef.current[chatId]
      submitLine(chatId, command, 'Failed to write the action command.')
    },
    [pendingTerminalCommandsRef, submitLine],
  )

  return {
    terminalCwds,
    setTerminalCwds,
    promptInjection,
    handlePromptCommand,
    fillDraftPrompt,
    handlePromptInjected,
    handleSessionStatus,
    handleSessionReady,
  }
}
