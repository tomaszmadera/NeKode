import { createBottomTabId } from '@shared/bottom-tab-id'
import type { ActionExecution } from '@shared/ipc-contract'
import { APP_STATE_KEY } from '@shared/ipc-contract'
import { useCallback, useEffect, useRef, useState } from 'react'
import { isBottomPanelChord } from '../../components/terminal/bottom-panel-chord'
import {
  addBottomTab,
  type BottomTab,
  type BottomTabsState,
  closeBottomTab,
  dropBottomProject,
  emptyBottomTabs,
  markBottomTabError,
  retryBottomTab,
  selectBottomTab,
} from '../../components/terminal/bottom-tabs'
import { errorMessage } from '../../lib/app-error-message'
import type { WorkspaceRuntime } from './useWorkspaceRuntime'

// True when the element can take focus. `display: none` on an ancestor (a
// chat switch, or the chat surface under a file tab) leaves the node
// connected, but focus() does not make it document.activeElement.
function isRenderedElement(element: HTMLElement): boolean {
  if (!element.isConnected) {
    return false
  }
  let current: HTMLElement | null = element
  while (current !== null) {
    if (current.hidden) {
      return false
    }
    const style = window.getComputedStyle(current)
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    ) {
      return false
    }
    current = current.parentElement
  }
  return true
}

/** Bottom auxiliary terminal panel: visibility, per-project tabs and action delivery. */
export function useBottomTerminals(runtime: WorkspaceRuntime) {
  const {
    app,
    setNotice,
    removedProjectIdsRef,
    projectsRef,
    tabProjectIdRef,
    pendingBottomCommandsRef,
    cancelPendingSubmit,
    submitLine,
  } = runtime
  const [bottomOpen, setBottomOpen] = useState(false)
  const [bottomTabs, setBottomTabs] = useState<BottomTabsState>(emptyBottomTabs)
  const bottomOpenRef = useRef(bottomOpen)
  bottomOpenRef.current = bottomOpen
  const bottomOpenTouchedRef = useRef(false)
  const bottomTabsRef = useRef(bottomTabs)
  bottomTabsRef.current = bottomTabs
  const focusBeforeOpenRef = useRef<HTMLElement | null>(null)
  const centerSurfaceRef = useRef<HTMLElement | null>(null)

  const persistBottomOpen = useCallback(
    (open: boolean): void => {
      void app.state
        .set(APP_STATE_KEY.bottomRegionOpen, open ? '1' : '0')
        .catch((error: unknown) => {
          setNotice(errorMessage(error, 'Failed to save the bottom panel.'))
        })
    },
    [app, setNotice],
  )

  // Startup hydration: a toggle that landed before hydration wins. Missing or
  // invalid open flag stays hidden (spec Behaviour 2). Tabs are not restored.
  const restoreBottomOpen = useCallback((savedBottomOpen: string | null): void => {
    if (!bottomOpenTouchedRef.current) {
      const open = savedBottomOpen === '1'
      bottomOpenRef.current = open
      setBottomOpen(open)
    }
  }, [])

  // Ready callback for bottom-tab terminals: same delivery contract as chat
  // sessions — the command, then one CR (0x0D) after the submit gap.
  const handleBottomSessionReady = useCallback(
    (tabId: string): void => {
      const command = pendingBottomCommandsRef.current[tabId]
      if (command === undefined) return
      delete pendingBottomCommandsRef.current[tabId]
      submitLine(tabId, command, 'Failed to write the action command.')
    },
    [pendingBottomCommandsRef, submitLine],
  )

  const createBottomTab = useCallback(
    async (projectId: string, options?: { tabId?: string; cwd?: string }): Promise<void> => {
      const tabId = options?.tabId
      const dropStagedCommand = (): void => {
        // An aborted creation leaves a staged bottom-terminal command that can
        // never be delivered (review:4 follow-up); a completed creation keeps
        // it — the tab's ready event consumes it.
        if (tabId !== undefined) {
          delete pendingBottomCommandsRef.current[tabId]
          cancelPendingSubmit(tabId)
        }
      }
      if (removedProjectIdsRef.current.has(projectId)) {
        dropStagedCommand()
        return
      }
      const project = projectsRef.current.find((item) => item.id === projectId)
      if (project === undefined) {
        dropStagedCommand()
        setNotice('Select or add a project before starting a terminal.')
        return
      }
      let label: string
      try {
        // The label resolves the project's stored shell choice (spec
        // project-shell-selection): e.g. "WSL: Ubuntu-24.04" for a WSL-bound
        // project, the platform default name otherwise.
        label = (await app.terminals.shellName(projectId)).trim()
      } catch (error) {
        if (removedProjectIdsRef.current.has(projectId)) {
          dropStagedCommand()
          return
        }
        dropStagedCommand()
        setNotice(errorMessage(error, 'Failed to start the terminal.'))
        return
      }
      if (removedProjectIdsRef.current.has(projectId)) {
        dropStagedCommand()
        return
      }
      if (label.length === 0) {
        dropStagedCommand()
        setNotice('Failed to start the terminal.')
        return
      }
      const tab: BottomTab = {
        id: options?.tabId ?? createBottomTabId(projectId),
        projectId,
        label,
        cwd: options?.cwd ?? project.path,
        generation: 0,
        status: 'running',
        errorMessage: null,
      }
      setBottomTabs((previous) => {
        if (removedProjectIdsRef.current.has(projectId)) {
          // The tombstone check drops the tab here; its staged command (if a
          // bottom-terminal action staged one) must not survive either.
          if (tabId !== undefined) {
            delete pendingBottomCommandsRef.current[tabId]
            cancelPendingSubmit(tabId)
          }
          return previous
        }
        return addBottomTab(previous, tab)
      })
    },
    [
      app,
      cancelPendingSubmit,
      pendingBottomCommandsRef,
      projectsRef,
      removedProjectIdsRef,
      setNotice,
    ],
  )

  const handleNewBottomTerminal = useCallback((): void => {
    const projectId = tabProjectIdRef.current
    if (projectId === null) {
      setNotice('Select or add a project before starting a terminal.')
      return
    }
    setNotice(null)
    void createBottomTab(projectId)
  }, [createBottomTab, setNotice, tabProjectIdRef])

  const hideBottomPanel = useCallback((): void => {
    bottomOpenTouchedRef.current = true
    bottomOpenRef.current = false
    setBottomOpen(false)
    persistBottomOpen(false)
    const previous = focusBeforeOpenRef.current
    focusBeforeOpenRef.current = null
    queueMicrotask(() => {
      if (previous?.isConnected) {
        previous.focus()
      }
      if (
        previous === null ||
        !previous.isConnected ||
        !isRenderedElement(previous) ||
        document.activeElement !== previous
      ) {
        centerSurfaceRef.current?.focus()
      }
    })
  }, [persistBottomOpen])

  // Opening remembers what held focus, so a later hide restores focus there
  // instead of falling back to the center surface (Behaviour 4).
  const openBottomPanel = useCallback((): void => {
    const active = document.activeElement
    focusBeforeOpenRef.current =
      active instanceof HTMLElement && active !== document.body ? active : null
    bottomOpenTouchedRef.current = true
    bottomOpenRef.current = true
    setBottomOpen(true)
    persistBottomOpen(true)
  }, [persistBottomOpen])

  const showBottomPanel = useCallback((): void => {
    openBottomPanel()
    const projectId = tabProjectIdRef.current
    if (projectId === null) {
      return
    }
    const session = bottomTabsRef.current.byProject[projectId]
    if (session !== undefined && session.tabs.length > 0) {
      return
    }
    void createBottomTab(projectId)
  }, [createBottomTab, openBottomPanel, tabProjectIdRef])

  const showBottomRef = useRef(showBottomPanel)
  const hideBottomRef = useRef(hideBottomPanel)
  showBottomRef.current = showBottomPanel
  hideBottomRef.current = hideBottomPanel

  const handleCloseBottomTab = useCallback(
    (tabId: string, options?: { viaShortcut?: boolean }): void => {
      void (async () => {
        try {
          await app.terminals.terminate(tabId)
        } catch (error) {
          setNotice(errorMessage(error, 'Failed to close the terminal.'))
          return
        }
        // A Ctrl+D close hides the panel when its project has no tabs left to
        // show (spec Behaviour 9, NEKODE-19). The visibleTabs rule of
        // BottomPanel (null project -> no tabs) applies too, so a shortcut
        // close without an active project also hides instead of emptying.
        // Hide runs after the removal below: it closes over the pre-removal
        // tabs, mirrors of the same tick. X-button and shell exits keep
        // Behaviour 9: the panel stays open and empty.
        const viaShortcut = options?.viaShortcut === true
        const projectOfRemoved = Object.entries(bottomTabsRef.current.byProject).find(([, s]) =>
          s.tabs.some((tab) => tab.id === tabId),
        )
        delete pendingBottomCommandsRef.current[tabId]
        cancelPendingSubmit(tabId)
        setBottomTabs((previous) => closeBottomTab(previous, tabId))
        if (viaShortcut) {
          const activeProjectId = tabProjectIdRef.current
          const remainingVisible =
            activeProjectId === null
              ? []
              : (projectOfRemoved?.[1].tabs ?? []).filter(
                  (tab) => tab.projectId === activeProjectId,
                )
          if (remainingVisible.length <= 1) {
            hideBottomRef.current()
          }
        }
      })()
    },
    [app, cancelPendingSubmit, pendingBottomCommandsRef, setNotice, tabProjectIdRef],
  )

  const handleBottomExit = useCallback(
    (tabId: string): void => {
      // The tab is gone: its staged bottom-terminal command must not linger
      // (review:4 follow-up). A spawn failure keeps the entry — the retry
      // remount fires a fresh ready event that must still deliver it.
      delete pendingBottomCommandsRef.current[tabId]
      cancelPendingSubmit(tabId)
      setBottomTabs((previous) => closeBottomTab(previous, tabId))
      void app.terminals.terminate(tabId).catch(() => undefined)
    },
    [app, cancelPendingSubmit, pendingBottomCommandsRef],
  )

  const handleToggleBottom = useCallback((): void => {
    if (bottomOpenRef.current) {
      hideBottomPanel()
    } else {
      showBottomPanel()
    }
  }, [hideBottomPanel, showBottomPanel])

  // Ctrl+` shows or hides the panel, capture phase so it wins over a focused
  // terminal; an open modal dialog swallows the chord.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat || !isBottomPanelChord(event)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (document.querySelector('[aria-modal="true"]') !== null) {
        return
      }
      if (bottomOpenRef.current) {
        hideBottomRef.current()
      } else {
        showBottomRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])

  // Bottom-terminal delivery (bottom-auxiliary-terminal spec Behaviour 16–18):
  // the execution addresses a brand-new bottom tab id. The panel opens if
  // hidden (plain open: no chord auto-tab, so exactly one new tab lands per
  // execution), the tab is added to the tab-strip project (never a chat,
  // never a selection change), and the command plus CR (0x0D) is written once
  // that tab's terminal view is subscribed and ready (handleBottomSessionReady).
  const handleBottomTerminalAction = useCallback(
    (execution: ActionExecution, projectId: string): void => {
      const tabId = execution.bottomTabId
      const command = execution.terminalCommand
      const cwd = execution.terminalCwd
      if (tabId === undefined || command === undefined || cwd === undefined) return
      pendingBottomCommandsRef.current[tabId] = command
      if (!bottomOpenRef.current) {
        openBottomPanel()
      }
      void createBottomTab(projectId, { tabId, cwd })
    },
    [createBottomTab, openBottomPanel, pendingBottomCommandsRef],
  )

  const selectTab = useCallback((projectId: string, tabId: string): void => {
    setBottomTabs((previous) => selectBottomTab(previous, projectId, tabId))
  }, [])
  const markSpawnError = useCallback((tabId: string, message: string): void => {
    setBottomTabs((previous) => markBottomTabError(previous, tabId, message))
  }, [])
  const retryTab = useCallback((tabId: string): void => {
    setBottomTabs((previous) => retryBottomTab(previous, tabId))
  }, [])

  /** Bottom tab ids of a project, read before its removal awaits. */
  const bottomTabIdsOf = useCallback(
    (projectId: string): string[] =>
      bottomTabsRef.current.byProject[projectId]?.tabs.map((tab) => tab.id) ?? [],
    [],
  )

  // The project removal succeeded: those tabs are gone and their staged
  // bottom-terminal commands can never be delivered (review follow-up: same
  // leak class as the close/exit paths).
  const dropProjectBottomTabs = useCallback(
    (projectId: string, tabIds: readonly string[]): void => {
      for (const tabId of tabIds) {
        delete pendingBottomCommandsRef.current[tabId]
        cancelPendingSubmit(tabId)
      }
      setBottomTabs((previous) => dropBottomProject(previous, projectId))
    },
    [cancelPendingSubmit, pendingBottomCommandsRef],
  )

  return {
    bottomOpen,
    bottomTabs,
    centerSurfaceRef,
    restoreBottomOpen,
    handleBottomSessionReady,
    handleNewBottomTerminal,
    handleCloseBottomTab,
    handleBottomExit,
    handleToggleBottom,
    handleBottomTerminalAction,
    selectTab,
    markSpawnError,
    retryTab,
    bottomTabIdsOf,
    dropProjectBottomTabs,
  }
}
