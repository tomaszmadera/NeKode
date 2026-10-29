import type {
  ChatInfo,
  KanbanLaunchResult,
  KanbanLaunchTaskInput,
  WorkItem,
} from '@shared/ipc-contract'
import { useCallback, useRef, useState } from 'react'
import type { SettingsTabId } from '../../components/actions/ActionSettings'
import type { HeldLaunch } from '../../components/kanban/held-launch'
import { errorMessage } from '../../lib/app-error-message'
import type { WorkspaceRuntime } from './useWorkspaceRuntime'

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) {
    return record
  }
  const next = { ...record }
  delete next[key]
  return next
}

/** Kanban Start/Resume confirmations and launches whose terminal is held for a retry. */
export function useTaskLaunches(
  runtime: WorkspaceRuntime,
  options: {
    adoptLaunchedChat: (projectId: string, chat: ChatInfo) => void
    fillDraftPrompt: (chatId: string, text: string) => void
    openAgentsSettings: (projectId: string) => void
    openProjectSettings: (projectId: string | null, tab: SettingsTabId) => void
  },
) {
  const { app, setNotice, removedProjectIdsRef } = runtime
  const { adoptLaunchedChat, fillDraftPrompt, openAgentsSettings, openProjectSettings } = options
  const [taskStart, setTaskStart] = useState<{
    projectId: string
    item: WorkItem
    draft: boolean
  } | null>(null)
  const [taskResume, setTaskResume] = useState<{ projectId: string; item: WorkItem } | null>(null)
  const [heldLaunches, setHeldLaunches] = useState<Record<string, HeldLaunch>>({})
  const heldLaunchesRef = useRef(heldLaunches)
  heldLaunchesRef.current = heldLaunches
  const retryingLaunchRef = useRef<string | null>(null)
  const [retryingLaunchChatId, setRetryingLaunchChatId] = useState<string | null>(null)

  const handleStartTask = useCallback((projectId: string, item: WorkItem): void => {
    setTaskStart({ projectId, item, draft: false })
  }, [])

  // Start without sending (NEKODE-99): the same confirmation in its draft variant.
  const handleStartTaskDraft = useCallback((projectId: string, item: WorkItem): void => {
    setTaskStart({ projectId, item, draft: true })
  }, [])

  const handleResumeTask = useCallback((projectId: string, item: WorkItem): void => {
    setTaskResume({ projectId, item })
  }, [])

  const handleConfigureTaskAgents = useCallback((): void => {
    const projectId = taskStart?.projectId
    setTaskStart(null)
    if (projectId === undefined) {
      return
    }
    openAgentsSettings(projectId)
  }, [openAgentsSettings, taskStart])

  const handleConfigureResumeAgents = useCallback((): void => {
    const projectId = taskResume?.projectId
    setTaskResume(null)
    if (projectId === undefined) {
      return
    }
    openAgentsSettings(projectId)
  }, [openAgentsSettings, taskResume])

  // Resume with no configured directory: Configure handoffs opens Project
  // Settings on the tab that owns the handoff directory.
  const handleConfigureTaskHandoffs = useCallback((): void => {
    const projectId = taskResume?.projectId
    setTaskResume(null)
    if (projectId === undefined) {
      return
    }
    setNotice(null)
    openProjectSettings(projectId, 'kanban')
  }, [openProjectSettings, setNotice, taskResume])

  const handleTaskLaunched = useCallback(
    (projectId: string, result: KanbanLaunchResult & { input: KanbanLaunchTaskInput }): void => {
      if (removedProjectIdsRef.current.has(projectId)) {
        return
      }
      adoptLaunchedChat(projectId, result.chat)
      if (result.delivered) {
        if (result.draftPrompt !== undefined) {
          fillDraftPrompt(result.chat.id, result.draftPrompt)
        }
        setHeldLaunches((previous) => withoutKey(previous, result.chat.id))
      } else {
        setHeldLaunches((previous) => ({
          ...previous,
          [result.chat.id]: {
            message: 'Failed to start the terminal for this chat.',
            input: result.input,
          },
        }))
      }
      setTaskStart(null)
      setTaskResume(null)
    },
    [adoptLaunchedChat, fillDraftPrompt, removedProjectIdsRef],
  )

  const handleRetryHeldLaunch = useCallback(
    (chatId: string): void => {
      const held = heldLaunchesRef.current[chatId]
      if (held === undefined || retryingLaunchRef.current !== null) {
        return
      }
      retryingLaunchRef.current = chatId
      setRetryingLaunchChatId(chatId)
      void (async () => {
        try {
          const result = await app.kanban.launchTask(held.input)
          if (removedProjectIdsRef.current.has(held.input.projectId)) {
            return
          }
          if (result.delivered) {
            setHeldLaunches((previous) => withoutKey(previous, chatId))
            adoptLaunchedChat(held.input.projectId, result.chat)
            if (result.draftPrompt !== undefined) {
              fillDraftPrompt(result.chat.id, result.draftPrompt)
            }
          } else {
            setHeldLaunches((previous) => ({
              ...previous,
              [chatId]: {
                ...held,
                message: 'Failed to start the terminal for this chat.',
              },
            }))
          }
        } catch (error) {
          if (removedProjectIdsRef.current.has(held.input.projectId)) {
            return
          }
          setHeldLaunches((previous) => ({
            ...previous,
            [chatId]: {
              ...held,
              message: errorMessage(error, 'Failed to start the terminal for this chat.'),
            },
          }))
        } finally {
          if (retryingLaunchRef.current === chatId) {
            retryingLaunchRef.current = null
            setRetryingLaunchChatId(null)
          }
        }
      })()
    },
    [adoptLaunchedChat, app, fillDraftPrompt, removedProjectIdsRef],
  )

  // A closed chat's held launch can no longer be retried: the entry must not
  // outlive its chat in the renderer.
  const dropHeldLaunch = useCallback((chatId: string): void => {
    setHeldLaunches((previous) => withoutKey(previous, chatId))
  }, [])

  // A removed project's confirmations and held launches go with it: clearing
  // the state unmounts the Resume modal and invalidates its pending scan
  // (spec Bledy i wyscigi: removing a project before confirmation
  // invalidates pending responses).
  const dropProjectLaunches = useCallback((projectId: string): void => {
    setTaskStart((current) => (current?.projectId === projectId ? null : current))
    setTaskResume((current) => (current?.projectId === projectId ? null : current))
    setHeldLaunches((previous) => {
      let changed = false
      const next: Record<string, HeldLaunch> = {}
      for (const [chatId, held] of Object.entries(previous)) {
        if (held.input.projectId === projectId) {
          changed = true
          continue
        }
        next[chatId] = held
      }
      return changed ? next : previous
    })
  }, [])

  return {
    taskStart,
    setTaskStart,
    taskResume,
    setTaskResume,
    heldLaunches,
    retryingLaunchChatId,
    handleStartTask,
    handleStartTaskDraft,
    handleResumeTask,
    handleConfigureTaskAgents,
    handleConfigureResumeAgents,
    handleConfigureTaskHandoffs,
    handleTaskLaunched,
    handleRetryHeldLaunch,
    dropHeldLaunch,
    dropProjectLaunches,
  }
}
