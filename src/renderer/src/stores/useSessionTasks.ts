import type { SessionTaskProgress } from '@shared/ipc-contract'
import { useMemo } from 'react'
import { sessionTaskProgress } from '../lib/task-progress'
import { useChatStore } from './useChatStore'

export function useSessionTasks(): Record<string, SessionTaskProgress> {
  const chatsByProject = useChatStore((state) => state.chatsByProject)
  const taskSnapshots = useChatStore((state) => state.taskSnapshots)
  return useMemo(() => {
    const progress: Record<string, SessionTaskProgress> = {}
    for (const chats of Object.values(chatsByProject)) {
      for (const chat of chats) {
        const task = sessionTaskProgress(chat, taskSnapshots[chat.projectId])
        if (task !== undefined) progress[chat.id] = task
      }
    }
    return progress
  }, [chatsByProject, taskSnapshots])
}
