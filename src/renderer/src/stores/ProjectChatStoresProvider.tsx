import type React from 'react'
import { useState } from 'react'
import { ChatStoreContext, createChatStore } from './useChatStore'
import { createProjectStore, ProjectStoreContext } from './useProjectStore'

export function ProjectChatStoresProvider({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  // A remounted App gets fresh state. Async callbacks from an old mount keep
  // their original stores and cannot publish into a later App or another test.
  const [projectStore] = useState(() => createProjectStore())
  const [chatStore] = useState(() => createChatStore())
  return (
    <ProjectStoreContext.Provider value={projectStore}>
      <ChatStoreContext.Provider value={chatStore}>{children}</ChatStoreContext.Provider>
    </ProjectStoreContext.Provider>
  )
}
