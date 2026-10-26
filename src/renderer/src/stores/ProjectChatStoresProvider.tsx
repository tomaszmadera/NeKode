import type React from 'react'
import { useState } from 'react'
import { type ChatStoreApi, ChatStoreContext, createChatStore } from './useChatStore'
import { createProjectStore, type ProjectStoreApi, ProjectStoreContext } from './useProjectStore'

export function ProjectChatStoresProvider({
  children,
  projectStore: suppliedProjectStore,
  chatStore: suppliedChatStore,
}: {
  children: React.ReactNode
  projectStore?: ProjectStoreApi
  chatStore?: ChatStoreApi
}): React.JSX.Element {
  // A remounted App gets fresh state. Async callbacks from an old mount keep
  // their original stores and cannot publish into a later App or another test.
  const [projectStore] = useState(() => suppliedProjectStore ?? createProjectStore())
  const [chatStore] = useState(() => suppliedChatStore ?? createChatStore())
  return (
    <ProjectStoreContext.Provider value={projectStore}>
      <ChatStoreContext.Provider value={chatStore}>{children}</ChatStoreContext.Provider>
    </ProjectStoreContext.Provider>
  )
}
