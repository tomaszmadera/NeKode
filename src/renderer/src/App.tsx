import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ActionBar } from './components/actions/ActionBar'
import { ActionSettings } from './components/actions/ActionSettings'
import { HandoffPicker } from './components/actions/HandoffPicker'
import {
  DEFAULT_MARKDOWN_VIEW,
  isMarkdownPath,
  markdownViewKey,
} from './components/files/markdown-path'
import { ProjectFilesPanel } from './components/files/ProjectFilesPanel'
import { KanbanSessions } from './components/kanban/KanbanSessions'
import { TaskResumeModal } from './components/kanban/TaskResumeModal'
import { TaskStartModal } from './components/kanban/TaskStartModal'
import { AddProject } from './components/layout/AddProject'
import { AppBrand } from './components/layout/AppBrand'
import { ConfirmDialog } from './components/layout/ConfirmDialog'
import { LeftNavigation } from './components/layout/LeftNavigation'
import { LeftPanelTrack } from './components/layout/LeftPanelTrack'
import { PanelFooter } from './components/layout/PanelFooter'
import { StatusBar } from './components/layout/StatusBar'
import { AppSettings } from './components/settings/AppSettings'
import { CenterTabs, homeTabStateFor } from './components/tabs/CenterTabs'
import {
  activateTab,
  closeFileTab,
  emptyTabsSession,
  type TabId,
} from './components/tabs/tabs-session'
import { BottomPanel } from './components/terminal/BottomPanel'
import { allBottomTabs } from './components/terminal/bottom-tabs'
import { UsageToolbar } from './components/usage/UsageToolbar'
import { ChatWorkspace } from './components/workspace/ChatWorkspace'
import { useBottomTerminals } from './hooks/app/useBottomTerminals'
import { useChatChords } from './hooks/app/useChatChords'
import { useChatClose } from './hooks/app/useChatClose'
import { useChatSelection } from './hooks/app/useChatSelection'
import { useChatTerminals } from './hooks/app/useChatTerminals'
import { useKanbanHome } from './hooks/app/useKanbanHome'
import { useLayoutRegions } from './hooks/app/useLayoutRegions'
import { useProjectFiles } from './hooks/app/useProjectFiles'
import { useProjectLifecycle } from './hooks/app/useProjectLifecycle'
import {
  useActionsList,
  useProjectColors,
  useTaskProgressObservation,
  useUsageQuota,
} from './hooks/app/useProjectMetadata'
import { useAppSettingsDialog, useProjectSettingsDialog } from './hooks/app/useSettingsDialogs'
import { useTaskLaunches } from './hooks/app/useTaskLaunches'
import { useWorkspaceHydration } from './hooks/app/useWorkspaceHydration'
import { type SetNotice, useWorkspaceRuntime } from './hooks/app/useWorkspaceRuntime'
import { useDesktopDictation } from './hooks/useDesktopDictation'
import { getProjectColor } from './lib/project-avatar'
import { sessionTaskProgress } from './lib/task-progress'
import { TEST_ID } from './lib/test-ids'
import { THEMES } from './lib/theme'
import { AppStoresProvider } from './stores/AppStoresProvider'
import { useChatStore } from './stores/useChatStore'
import { useProjectStore } from './stores/useProjectStore'
import { useSettingsStore, useSettingsStoreApi } from './stores/useSettingsStore'
import { useTabsStore } from './stores/useTabsStore'

// Re-exported so existing imports keep working; the definitions live in
// lib/test-ids.ts to break the App ↔ component import cycle.
export { TEST_ID, testIdFor } from './lib/test-ids'

export function App({ app = window.app }: { app?: typeof window.app }): React.JSX.Element {
  // The shell notice belongs to the App mount; stores report into it too.
  const [notice, setNotice] = useState<string | null>(null)
  return (
    <AppStoresProvider app={app} reportError={setNotice}>
      <AppContent app={app} notice={notice} setNotice={setNotice} />
    </AppStoresProvider>
  )
}

function AppContent({
  app,
  notice,
  setNotice,
}: {
  app: typeof window.app
  notice: string | null
  setNotice: SetNotice
}): React.JSX.Element {
  const desktopDictation = useDesktopDictation(app)
  const usage = useUsageQuota(app)
  const appSettings = useAppSettingsDialog()
  const settingsStore = useSettingsStoreApi()
  const settings = useSettingsStore(
    useShallow((state) => ({
      theme: state.theme,
      setTheme: state.setTheme,
      quickThemeSwitch: state.quickThemeSwitch,
      mascotVisible: state.mascotVisible,
      mascotError: state.mascotError,
      toggleMascot: state.toggleMascot,
      projectNamesUppercase: state.projectNamesUppercase,
      showProjectIcons: state.showProjectIcons,
      attentionSettings: state.attentionSettings,
      terminalFontSize: state.terminalFontSize,
      terminalFontFamilies: state.terminalFontFamilies,
      terminalCtrlVPaste: state.terminalCtrlVPaste,
      promptChrome: state.promptChrome,
      autoSendHandoff: state.autoSendHandoff,
      setAutoSendHandoff: state.setAutoSendHandoff,
    })),
  )

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])

  // Domain state is read per field: chat activity ticks and task snapshots
  // of other projects must not re-render the whole shell.
  const {
    projects,
    selectedProjectId,
    projectColors,
    kanbanProjectIds,
    localFileProjectIds,
    settledKanbanProjects,
    kanbanBindingsError,
  } = useProjectStore(
    useShallow((state) => ({
      projects: state.projects,
      selectedProjectId: state.selectedProjectId,
      projectColors: state.projectColors,
      kanbanProjectIds: state.kanbanProjectIds,
      localFileProjectIds: state.localFileProjectIds,
      settledKanbanProjects: state.settledKanbanProjects,
      kanbanBindingsError: state.kanbanBindingsError,
    })),
  )
  const chat = useChatStore(
    useShallow((state) => ({
      chatsByProject: state.chatsByProject,
      loadedChatProjectIds: state.loadedChatProjectIds,
      selectedChatId: state.selectedChatId,
      selectionNonce: state.selectionNonce,
      liveChatIds: state.liveChatIds,
      chatAttention: state.chatAttention,
      setChatAttention: state.setChatAttention,
      setChatActivity: state.setChatActivity,
    })),
  )
  const { tabsByProject, markdownViewByKey, updateTabsSession, setMarkdownView } = useTabsStore(
    useShallow((state) => ({
      tabsByProject: state.tabsByProject,
      markdownViewByKey: state.markdownViewByKey,
      updateTabsSession: state.updateTabsSession,
      setMarkdownView: state.setMarkdownView,
    })),
  )

  const runtime = useWorkspaceRuntime(app, setNotice)
  const { actions, refreshActions } = useActionsList(app, setNotice)
  const kanban = useKanbanHome(runtime)
  useTaskProgressObservation(app, setNotice)
  useEffect(() => settingsStore.getState().hydrate(), [settingsStore])
  const handleProjectColorChange = useProjectColors(app)
  const projectSettings = useProjectSettingsDialog(setNotice, kanban.refreshKanbanBindings)
  const terminals = useChatTerminals(runtime)
  const selection = useChatSelection(runtime, terminals.setTerminalCwds)
  const launches = useTaskLaunches(runtime, {
    adoptLaunchedChat: selection.adoptLaunchedChat,
    fillDraftPrompt: terminals.fillDraftPrompt,
    openAgentsSettings: projectSettings.openAgentsSettings,
    openProjectSettings: projectSettings.openProjectSettings,
  })
  const closing = useChatClose(runtime, {
    dropHeldLaunch: launches.dropHeldLaunch,
    setTerminalCwds: terminals.setTerminalCwds,
  })
  const layout = useLayoutRegions(app, setNotice)
  const bottom = useBottomTerminals(runtime)
  useWorkspaceHydration(runtime, {
    restoreRegionSizes: layout.restoreRegionSizes,
    restoreBottomOpen: bottom.restoreBottomOpen,
  })
  const files = useProjectFiles(runtime)
  const lifecycle = useProjectLifecycle(runtime, {
    refreshActions,
    dropProjectLaunches: launches.dropProjectLaunches,
    setTerminalCwds: terminals.setTerminalCwds,
    dropFilesProject: files.dropFilesProject,
    bottomTabIdsOf: bottom.bottomTabIdsOf,
    dropProjectBottomTabs: bottom.dropProjectBottomTabs,
  })
  useChatChords(runtime, {
    handleSwitchChat: selection.handleSwitchChat,
    handleCreateChat: selection.handleCreateChat,
  })

  // The tab strip and the main surface belong to the selected project.
  // Entering Project Files in the left panel is an independent sidebar
  // navigation that does not steal or diverge the center surface from the
  // active project. Opening a file from the tree activates that project.
  const tabProjectId = selectedProjectId
  const handleSelectTab = useCallback(
    (tab: TabId): void => {
      if (tabProjectId !== null) {
        updateTabsSession(tabProjectId, (session) => activateTab(session, tab))
      }
    },
    [tabProjectId, updateTabsSession],
  )
  const handleCloseFileTab = useCallback(
    (relativePath: string): void => {
      if (tabProjectId !== null) {
        updateTabsSession(tabProjectId, (session) => closeFileTab(session, relativePath))
      }
    },
    [tabProjectId, updateTabsSession],
  )
  const { openProjectSettings } = projectSettings
  // Board not-configured state: Configure opens Project Settings on its Kanban
  // tab (mirrors the Resume picker's Configure affordance, spec Behaviour 14).
  const handleOpenKanbanSettings = useCallback((): void => {
    if (tabProjectId !== null) {
      setNotice(null)
      openProjectSettings(tabProjectId, 'kanban')
    }
  }, [openProjectSettings, setNotice, tabProjectId])
  // The board's not-configured handoff notice opens Project Settings on the
  // tab that owns the per-project handoff directory.
  const handleConfigureProjectHandoffs = useCallback(
    (projectId: string): void => {
      setNotice(null)
      openProjectSettings(projectId, 'actions')
    },
    [openProjectSettings, setNotice],
  )
  const [handoffPickerOpen, setHandoffPickerOpen] = useState(false)

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null
  const tabProject = selectedProject
  const tabsSession =
    tabProjectId === null ? emptyTabsSession() : (tabsByProject[tabProjectId] ?? emptyTabsSession())
  const activeTab = tabsSession.active
  const activeMarkdownFile =
    tabProject !== null && activeTab.kind === 'file' && isMarkdownPath(activeTab.path)
      ? markdownViewKey(tabProject.id, activeTab.path)
      : null
  // Home tab contents (project-home spec Behaviour 2, Edge cases): see
  // homeTabStateFor.
  const homeTabState = homeTabStateFor({
    project: tabProject,
    active: activeTab,
    bound: tabProject !== null && kanbanProjectIds.has(tabProject.id),
    bindingsError: kanbanBindingsError,
    settled: tabProject !== null && settledKanbanProjects.has(tabProject.id),
  })
  // The terminal-chat tab shows the active chat's name when the active project
  // has a chat selected.
  const activeChat =
    selectedProject !== null
      ? (chat.chatsByProject[selectedProject.id]?.find((item) => item.id === chat.selectedChatId) ??
        null)
      : null
  // Only the active chat's task progress reaches the action row.
  const activeTaskSnapshot = useChatStore((state) =>
    activeChat === null ? undefined : state.taskSnapshots[activeChat.projectId],
  )
  const activeTask = useMemo(
    () => (activeChat === null ? undefined : sessionTaskProgress(activeChat, activeTaskSnapshot)),
    [activeChat, activeTaskSnapshot],
  )
  const { taskStart, taskResume } = launches
  const actionSettingsProject =
    projects.find((project) => project.id === projectSettings.projectId) ?? null

  // Floating shell theme (NeKode Float): the title bar strip stays (without
  // its hairline), the left panel floats detached with rounded corners and
  // the center content below the tab strip sits in a rounded frame with the
  // tabs attached to its top. Attached themes keep the window-edge shell.
  const floatingTheme = THEMES[settings.theme].layout === 'floating'
  const panelFooter = (
    <PanelFooter
      onOpenAppSettings={appSettings.openAppSettings}
      mascotVisible={settings.mascotVisible}
      mascotError={settings.mascotError}
      onToggleMascot={settings.toggleMascot}
    />
  )

  return (
    <div
      className="nk-app-shell flex h-screen w-screen flex-col overflow-hidden bg-app text-ink antialiased"
      data-testid={TEST_ID.appShell}
    >
      {/* Window title bar (user decision 2026-10-01): one continuous
          full-width drag strip; the brand on the left, Windows caption
          buttons overlay the top-right corner. Tab strip and panel headers
          sit one level below. Every theme keeps the strip (user decision
          2026-10-04: the app name stays top-left beside the caption
          buttons); the floating theme only drops the hairline under it. */}
      <div
        className="nk-title-bar drag-region flex h-10 shrink-0 items-center bg-app px-4"
        data-testid={TEST_ID.titleBar}
      >
        <AppBrand />
        {usage.usageEnabled ? (
          <UsageToolbar
            api={app.usage}
            version={usage.usageVersion}
            onConfigure={appSettings.openUsageSettings}
          />
        ) : null}
      </div>
      {/* The hairline under the title bar is owned by the content row
          (border-t, design doc 26.2 convention), not by the strip itself;
          the floating theme drops only the hairline. */}
      <div
        className={
          floatingTheme ? 'flex min-h-0 flex-1' : 'flex min-h-0 flex-1 border-t border-edge'
        }
      >
        <LeftPanelTrack
          view={files.filesProject !== null ? 'files' : 'projects'}
          width={layout.leftWidth}
          floating={floatingTheme}
          onResizeStart={layout.leftRegion.startResize}
          onResizeNudge={layout.leftRegion.nudge}
          projects={
            <LeftNavigation
              projectNamesUppercase={settings.projectNamesUppercase}
              showProjectIcons={settings.showProjectIcons}
              attentionBadgeEnabled={settings.attentionSettings.badge}
              attentionActiveIndicatorEnabled={settings.attentionSettings.activeIndicator}
              onSelectProject={selection.handleOpenProjectKanban}
              onToggleProject={selection.handleToggleProject}
              onSelectChat={selection.handleSelectChat}
              onAddProject={lifecycle.handleAddProject}
              onRemoveProject={lifecycle.handleRemoveProject}
              onOpenProjectFiles={files.handleOpenProjectFiles}
              onOpenProjectKanban={selection.handleOpenProjectKanban}
              onOpenInFileExplorer={lifecycle.handleOpenInFileExplorer}
              onOpenProjectSettings={(projectId) =>
                projectSettings.openProjectSettings(projectId, 'shell')
              }
              onCreateChat={selection.handleCreateChat}
              onCreateAgentChat={selection.handleCreateAgentChat}
              loadAgentProfiles={selection.loadAgentProfiles}
              onConfigureAgents={projectSettings.openAgentsSettings}
              onRequestCloseChat={closing.handleRequestCloseChat}
              notice={files.filesProject !== null ? null : notice}
            >
              {panelFooter}
            </LeftNavigation>
          }
          files={
            files.filesProject !== null ? (
              <ProjectFilesPanel
                project={files.filesProject}
                projectNamesUppercase={settings.projectNamesUppercase}
                showProjectIcons={settings.showProjectIcons}
                projectColor={projectColors?.[files.filesProject.id]}
                homeDir={app.homeDir}
                platform={app.platform}
                session={files.filesSession}
                onBack={files.handleCloseProjectFiles}
                onRefresh={files.handleRefreshProjectFiles}
                onToggleDirectory={files.handleFilesToggleDirectory}
                onSelectFile={files.handleFilesSelectFile}
                onShowInFolder={files.handleFilesShowInFolder}
                onCopyPath={files.handleFilesCopyPath}
                onCopyRelativePath={files.handleFilesCopyRelativePath}
                onTrash={files.handleFilesTrash}
                notice={notice}
              >
                {panelFooter}
              </ProjectFilesPanel>
            ) : null
          }
        />
        <CenterTabs
          app={app}
          floating={floatingTheme}
          project={tabProject}
          projectNamesUppercase={settings.projectNamesUppercase}
          chatName={activeChat?.name ?? null}
          session={tabsSession}
          homeTabState={homeTabState}
          bindingsError={kanbanBindingsError}
          markdownViewByKey={markdownViewByKey}
          surfaceRef={bottom.centerSurfaceRef}
          onSelectTab={handleSelectTab}
          onCloseFile={handleCloseFileTab}
          onOpenSettings={() => projectSettings.openProjectSettings(tabProjectId, 'shell')}
          onUseLocalTaskList={kanban.handleUseLocalTaskList}
          onConnectTracker={handleOpenKanbanSettings}
          onOpenExternalError={setNotice}
          actionRow={
            <ActionBar
              app={app}
              actions={actions}
              projectId={tabProjectId}
              activeChatId={activeChat?.id ?? null}
              chatIsLive={activeChat !== null && chat.liveChatIds.has(activeChat.id)}
              task={activeTask}
              isKanban={homeTabState === 'list'}
              kanbanControls={
                tabProjectId !== null && homeTabState === 'list'
                  ? (kanban.kanbanToolbarByProject[tabProjectId] ?? null)
                  : null
              }
              onNewTerminal={selection.handleNewTerminalAction}
              onBottomTerminal={bottom.handleBottomTerminalAction}
              onPromptCommand={terminals.handlePromptCommand}
              onResume={() => {
                if (tabProjectId !== null) {
                  setHandoffPickerOpen(true)
                }
              }}
              onError={setNotice}
              markdownView={
                activeMarkdownFile === null
                  ? null
                  : {
                      mode: markdownViewByKey[activeMarkdownFile] ?? DEFAULT_MARKDOWN_VIEW,
                      onChange: (mode) => setMarkdownView(activeMarkdownFile, mode),
                    }
              }
            />
          }
          chatSurface={
            <ChatWorkspace
              dictation={desktopDictation.control}
              app={app}
              projects={projects}
              chatsByProject={chat.chatsByProject}
              chatsLoaded={
                selectedProjectId !== null && chat.loadedChatProjectIds.has(selectedProjectId)
              }
              selectedProjectId={selectedProjectId}
              selectedChatId={chat.selectedChatId}
              selectionNonce={chat.selectionNonce}
              attention={chat.chatAttention}
              onActivityChange={chat.setChatActivity}
              onAttentionChange={chat.setChatAttention}
              attentionSettings={settings.attentionSettings}
              terminalCwds={terminals.terminalCwds}
              terminalFontSize={settings.terminalFontSize}
              terminalFontFamilies={settings.terminalFontFamilies}
              terminalCtrlVPaste={settings.terminalCtrlVPaste}
              promptChrome={settings.promptChrome}
              onSessionStatus={terminals.handleSessionStatus}
              onSessionReady={terminals.handleSessionReady}
              onChatClosed={closing.handleChatClosed}
              onStartNewChat={selection.handleStartNewChat}
              onAddProject={lifecycle.handleAddProject}
              promptInjection={terminals.promptInjection}
              onPromptInjected={terminals.handlePromptInjected}
              heldLaunches={launches.heldLaunches}
              onRetryHeldLaunch={launches.handleRetryHeldLaunch}
              retryingLaunchChatId={launches.retryingLaunchChatId}
            />
          }
          renderKanban={(activeKanbanProjectId) => (
            <KanbanSessions
              app={app}
              projectIds={
                new Set(
                  projects
                    .filter((project) => kanbanProjectIds.has(project.id))
                    .map((project) => project.id),
                )
              }
              activeProjectId={activeKanbanProjectId}
              versions={kanban.kanbanVersions}
              localFileProjectIds={localFileProjectIds}
              onUseLocalTaskList={kanban.handleUseLocalTaskList}
              onConfigure={handleOpenKanbanSettings}
              onConfigureHandoffs={handleConfigureProjectHandoffs}
              onStart={launches.handleStartTask}
              onStartDraft={launches.handleStartTaskDraft}
              onResume={launches.handleResumeTask}
              onToolbarControls={kanban.handleKanbanToolbarControls}
            />
          )}
        />
        {/* Right region is a real five-region sibling (SDD §7), hidden by default. */}
        <div data-testid={TEST_ID.rightRegion} style={{ display: 'none' }}>
          Right Panel
        </div>
      </div>
      {taskStart !== null ? (
        <TaskStartModal
          key={`${taskStart.projectId}:${taskStart.item.id}`}
          app={app}
          projectId={taskStart.projectId}
          item={taskStart.item}
          draft={taskStart.draft}
          onCancel={() => launches.setTaskStart(null)}
          onConfigureAgents={launches.handleConfigureTaskAgents}
          onLaunched={(result) => launches.handleTaskLaunched(taskStart.projectId, result)}
        />
      ) : null}
      {taskResume !== null ? (
        <TaskResumeModal
          key={`resume:${taskResume.projectId}:${taskResume.item.id}`}
          app={app}
          projectId={taskResume.projectId}
          item={taskResume.item}
          onCancel={() => launches.setTaskResume(null)}
          onConfigureHandoffs={launches.handleConfigureTaskHandoffs}
          onConfigureAgents={launches.handleConfigureResumeAgents}
          onLaunched={(result) => launches.handleTaskLaunched(taskResume.projectId, result)}
        />
      ) : null}
      {closing.chatToClose !== null ? (
        /* Close-chat confirmation (user request 2026-10-04): the row's X only
            requests the close; this dialog owns the destructive action.
            Cancel / backdrop / Escape keep everything untouched. */
        <ConfirmDialog
          title="Close chat"
          body={`Close "${closing.chatToClose.name}"? Its terminal session ends and the chat is removed.`}
          confirmLabel="Close chat"
          destructive
          onConfirm={closing.handleCloseChatConfirmed}
          onCancel={closing.cancelCloseChat}
        />
      ) : null}
      {appSettings.open ? (
        <AppSettings
          app={app}
          initialTab={appSettings.initialTab}
          scrollToUpdate={appSettings.scrollToUpdate}
          onUsageSaved={usage.handleUsageSaved}
          dictationApi={app.dictation}
          desktopDictation={desktopDictation}
          onClose={appSettings.closeAppSettings}
        />
      ) : null}
      {projectSettings.open ? (
        <ActionSettings
          suspended={appSettings.open}
          libraryRefreshKey={appSettings.agentLibraryRefreshKey}
          onManageAgents={appSettings.openAgentSettings}
          app={app}
          actions={actions}
          projectId={projectSettings.projectId}
          projectPath={actionSettingsProject?.path ?? null}
          projectName={actionSettingsProject?.name ?? null}
          projectColor={
            projectSettings.projectId === null
              ? null
              : getProjectColor(
                  { id: projectSettings.projectId },
                  projectColors[projectSettings.projectId],
                )
          }
          autoSend={settings.autoSendHandoff}
          onAutoSendChange={settings.setAutoSendHandoff}
          onRefresh={refreshActions}
          initialTab={projectSettings.tab}
          onClose={projectSettings.closeProjectSettings}
          onKanbanInvalidate={kanban.invalidateKanban}
          onProjectColorChange={handleProjectColorChange}
        />
      ) : null}
      {handoffPickerOpen && tabProjectId !== null ? (
        <HandoffPicker
          key={`${tabProjectId}:${chat.selectedChatId}`}
          app={app}
          projectId={tabProjectId}
          projectPath={tabProject?.path ?? null}
          onPick={terminals.handlePromptCommand}
          onConfigure={() => {
            setHandoffPickerOpen(false)
            projectSettings.openProjectSettings(tabProjectId, 'actions')
          }}
          onClose={() => setHandoffPickerOpen(false)}
        />
      ) : null}
      {lifecycle.addProjectOpen ? (
        <AddProject
          app={app}
          onAdded={lifecycle.handleProjectAdded}
          onClose={lifecycle.closeAddProject}
        />
      ) : null}
      <BottomPanel
        app={app}
        open={bottom.bottomOpen}
        height={layout.bottomHeight}
        activeProjectId={tabProjectId}
        tabs={allBottomTabs(bottom.bottomTabs)}
        terminalFontSize={settings.terminalFontSize}
        terminalFontFamilies={settings.terminalFontFamilies}
        terminalCtrlVPaste={settings.terminalCtrlVPaste}
        activeTabId={
          tabProjectId === null
            ? null
            : (bottom.bottomTabs.byProject[tabProjectId]?.activeId ?? null)
        }
        onNewTerminal={bottom.handleNewBottomTerminal}
        onSelectTab={(tabId) => {
          if (tabProjectId !== null) {
            bottom.selectTab(tabProjectId, tabId)
          }
        }}
        onCloseTab={bottom.handleCloseBottomTab}
        onExit={bottom.handleBottomExit}
        onSessionReady={bottom.handleBottomSessionReady}
        onSpawnError={bottom.markSpawnError}
        onRetry={bottom.retryTab}
        onResizeStart={layout.bottomRegion.startResize}
        onResizeNudge={layout.bottomRegion.nudge}
      />
      {/* Status bar: the very bottom of the window, full width (spec
          Behaviour 18). */}
      <StatusBar
        app={app}
        project={tabProject}
        theme={settings.theme}
        quickThemeSwitch={settings.quickThemeSwitch}
        onThemeChange={settings.setTheme}
        onError={setNotice}
        bottomOpen={bottom.bottomOpen}
        onToggleBottom={bottom.handleToggleBottom}
      />
    </div>
  )
}

export default App
