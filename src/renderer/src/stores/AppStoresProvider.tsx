import type React from 'react'
import { useState } from 'react'
import { ProjectChatStoresProvider } from './ProjectChatStoresProvider'
import {
  createSettingsStore,
  type SettingsPersistence,
  type SettingsStoreApi,
  SettingsStoreContext,
} from './useSettingsStore'
import { createTabsStore, type TabsStoreApi, TabsStoreContext } from './useTabsStore'

/**
 * All domain stores of one App mount (projects, chats, tabs, settings). Like
 * ProjectChatStoresProvider, a remounted App gets fresh stores, so late
 * callbacks from an old mount cannot publish into a later one. The settings
 * store reads localStorage when it is created, during the first App render.
 */
export function AppStoresProvider({
  children,
  app,
  reportError,
  settingsStore: suppliedSettingsStore,
  tabsStore: suppliedTabsStore,
}: SettingsPersistence & {
  children: React.ReactNode
  settingsStore?: SettingsStoreApi
  tabsStore?: TabsStoreApi
}): React.JSX.Element {
  // `app` is fixed for one App mount; a different bridge needs a remount.
  const [settingsStore] = useState(
    () => suppliedSettingsStore ?? createSettingsStore({ app, reportError }),
  )
  const [tabsStore] = useState(() => suppliedTabsStore ?? createTabsStore())
  return (
    <ProjectChatStoresProvider>
      <SettingsStoreContext.Provider value={settingsStore}>
        <TabsStoreContext.Provider value={tabsStore}>{children}</TabsStoreContext.Provider>
      </SettingsStoreContext.Provider>
    </ProjectChatStoresProvider>
  )
}
