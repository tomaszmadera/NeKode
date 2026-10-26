import { useCallback, useState } from 'react'
import type { SettingsTabId } from '../../components/actions/ActionSettings'
import type { SetNotice } from './useWorkspaceRuntime'

/** Project Settings dialog: open state, target project and the tab it opens on. */
export function useProjectSettingsDialog(
  setNotice: SetNotice,
  refreshKanbanBindings: () => Promise<void>,
) {
  const [open, setOpen] = useState(false)
  const [projectId, setProjectId] = useState<string | null>(null)
  // Tab the Project Settings dialog opens on. Only the board's Configure
  // button sets 'kanban'; every other opener names its own tab (the dialog
  // remounts per open, so the initial value is read fresh).
  const [tab, setTab] = useState<SettingsTabId>('shell')

  const openProjectSettings = useCallback(
    (targetProjectId: string | null, targetTab: SettingsTabId): void => {
      setProjectId(targetProjectId)
      setTab(targetTab)
      setOpen(true)
    },
    [],
  )

  // Project Settings on the Agents tab. Start and Resume share this opener.
  const openAgentsSettings = useCallback(
    (targetProjectId: string): void => {
      setNotice(null)
      openProjectSettings(targetProjectId, 'agents')
    },
    [openProjectSettings, setNotice],
  )

  // Closing Project Settings re-reads the task-source bindings (project-home
  // spec Behaviour 2): a bind/unbind saved in the dialog then switches the
  // home tab between the list and the welcome without a restart.
  const closeProjectSettings = useCallback((): void => {
    setOpen(false)
    void refreshKanbanBindings()
  }, [refreshKanbanBindings])

  return { open, projectId, tab, openProjectSettings, openAgentsSettings, closeProjectSettings }
}

type AppSettingsTab = 'general' | 'usage' | 'agents'

/** App Settings dialog: open state, the page it opens on and the agent-library refresh key. */
export function useAppSettingsDialog() {
  const [open, setOpen] = useState(false)
  const [scrollToUpdate, setScrollToUpdate] = useState(false)
  const [usage, setUsage] = useState(false)
  const [agents, setAgents] = useState(false)
  // Bumped on close so Project Settings re-reads the global agent library.
  const [agentLibraryRefreshKey, setAgentLibraryRefreshKey] = useState(0)

  function openAppSettings(options?: { scrollToUpdate?: boolean }): void {
    if (options?.scrollToUpdate === true) {
      setUsage(false)
      setAgents(false)
    }
    setScrollToUpdate(options?.scrollToUpdate === true)
    setOpen(true)
  }

  function openUsageSettings(): void {
    setUsage(true)
    setOpen(true)
  }

  function openAgentSettings(): void {
    setAgents(true)
    setOpen(true)
  }

  function closeAppSettings(): void {
    setOpen(false)
    setUsage(false)
    setAgents(false)
    setScrollToUpdate(false)
    setAgentLibraryRefreshKey((current) => current + 1)
  }

  const initialTab: AppSettingsTab = scrollToUpdate
    ? 'general'
    : usage
      ? 'usage'
      : agents
        ? 'agents'
        : 'general'

  return {
    open,
    scrollToUpdate,
    initialTab,
    agentLibraryRefreshKey,
    openAppSettings,
    openUsageSettings,
    openAgentSettings,
    closeAppSettings,
  }
}
