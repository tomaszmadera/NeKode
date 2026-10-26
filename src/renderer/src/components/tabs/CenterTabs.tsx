import type { AppApi, ProjectInfo } from '@shared/ipc-contract'
import type React from 'react'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { FilePreview } from '../files/FilePreview'
import {
  DEFAULT_MARKDOWN_VIEW,
  type MarkdownViewMode,
  markdownViewKey,
} from '../files/markdown-path'
import {
  ProjectHomeError,
  ProjectHomeLoading,
  ProjectHomeWelcome,
} from '../kanban/ProjectHomeWelcome'
import { TabStrip } from './TabStrip'
import type { ProjectTabsSession, TabId } from './tabs-session'

// Center column (center-layout-tabs-actions spec Behaviour 1): the tab strip,
// the reserved action-row slot and the main surface with one view per tab.
// The tab session state stays with the caller (App); this component renders
// the strip and decides which tab view is visible. Views of inactive tabs stay
// mounted and hidden, so file previews and chat sessions survive tab switches.

/** What the project home tab shows (project-home spec Behaviour 2, Edge cases). */
export type HomeTabState = 'none' | 'list' | 'error' | 'loading' | 'welcome'

/**
 * Home tab contents: a bound project shows its task list; an unbound one keeps
 * the home tab selected and shows the setup welcome once the binding read
 * settles (a loading line until then). A failed binding read shows its error
 * instead of the loading line or a possibly stale welcome. No adapter never
 * redirects to the chat tab.
 */
export function homeTabStateFor(input: {
  project: ProjectInfo | null
  active: TabId
  bound: boolean
  bindingsError: string | null
  settled: boolean
}): HomeTabState {
  if (input.project === null || input.active.kind !== 'kanban') {
    return 'none'
  }
  if (input.bound) {
    return 'list'
  }
  if (input.bindingsError !== null) {
    return 'error'
  }
  return input.settled ? 'welcome' : 'loading'
}

export interface CenterTabsProps {
  /** Renderer API handed to the file previews. */
  app: AppApi
  /** Floating shell theme: the content below the strip sits in a rounded frame. */
  floating: boolean
  /** The tab-strip project; null renders no home tab and no file views. */
  project: ProjectInfo | null
  projectNamesUppercase: boolean
  /** Active chat's display name for the terminal-chat tab; null shows "Chat". */
  chatName: string | null
  /** The tab-strip project's tab session (open files in order, active tab). */
  session: ProjectTabsSession
  homeTabState: HomeTabState
  /** Binding read error shown on the home tab in the `error` state. */
  bindingsError: string | null
  markdownViewByKey: Readonly<Record<string, MarkdownViewMode>>
  /** The focusable main surface (focus fallback when the bottom panel hides). */
  surfaceRef: React.Ref<HTMLElement>
  /** The action row rendered between the strip and the main surface. */
  actionRow: React.ReactNode
  /** The chat workspace; stays mounted while another tab is active. */
  chatSurface: React.ReactNode
  /** Kanban sessions; the argument is the project whose home tab shows, or null. */
  renderKanban: (activeProjectId: string | null) => React.ReactNode
  onSelectTab: (tab: TabId) => void
  onCloseFile: (relativePath: string) => void
  onOpenSettings: () => void
  onUseLocalTaskList: (projectId: string) => Promise<void>
  onConnectTracker: () => void
  onOpenExternalError: (message: string) => void
}

export function CenterTabs({
  app,
  floating,
  project,
  projectNamesUppercase,
  chatName,
  session,
  homeTabState,
  bindingsError,
  markdownViewByKey,
  surfaceRef,
  actionRow,
  chatSurface,
  renderKanban,
  onSelectTab,
  onCloseFile,
  onOpenSettings,
  onUseLocalTaskList,
  onConnectTracker,
  onOpenExternalError,
}: CenterTabsProps): React.JSX.Element {
  const activeTab = session.active
  return (
    <div className="nk-center-column relative z-10 flex min-w-0 flex-1 flex-col bg-app">
      {/* Center column (spec Behaviour 1): tab strip, reserved action-row
          slot, main surface. No window-top band and no context header.
          Raised above the left-panel slot. The sliding track's transform
          would otherwise paint that track over this column, so the panel
          emerges from under the middle panel. */}
      <TabStrip
        floating={floating}
        chatName={chatName}
        projectName={
          project === null
            ? null
            : projectNamesUppercase
              ? project.name.toUpperCase()
              : project.name
        }
        openFiles={session.openFiles}
        projectRoot={project?.path ?? null}
        active={activeTab}
        onSelectTab={onSelectTab}
        onCloseFile={onCloseFile}
        onSettings={onOpenSettings}
      />
      {/* Floating theme: the content below the tab strip sits in a
          rounded frame (user decision 2026-10-04) that keeps the tabs
          outside but attached: no top margin, so the tabs sit directly
          on the frame's top edge; attached themes render this block
          flush. The top-left corner stays square: the first tab (the
          terminal-chat tab) sits on it, and a rounded corner would open
          a gap under the tab's left edge (user decision 2026-10-04). */}
      <div
        className={
          floating
            ? 'nk-content-frame mx-2 mb-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg rounded-tl-none border border-edge'
            : 'flex min-h-0 flex-1 flex-col'
        }
      >
        {actionRow}
        <main
          ref={surfaceRef}
          tabIndex={-1}
          className="flex min-h-0 flex-1 flex-col outline-none"
          data-testid={TEST_ID.centerSurface}
        >
          {/* Every open file tab owns its preview view (hidden while another
              tab is active): per-tab loading/fallback/error state survives
              tab switches and never touches the other tabs (Behaviour 6-7). */}
          {project !== null
            ? session.openFiles.map((path) => (
                <div
                  key={path}
                  className="flex min-h-0 flex-1 flex-col"
                  style={{
                    display: activeTab.kind === 'file' && activeTab.path === path ? 'flex' : 'none',
                  }}
                  data-testid={testIdFor.filePreviewPane(path)}
                >
                  <FilePreview
                    app={app}
                    projectId={project.id}
                    relativePath={path}
                    markdownView={
                      markdownViewByKey[markdownViewKey(project.id, path)] ?? DEFAULT_MARKDOWN_VIEW
                    }
                    onOpenExternalError={onOpenExternalError}
                  />
                </div>
              ))
            : null}
          {/* Chat sessions stay mounted (hidden) while a file tab is active:
              PTY processes and xterm scrollback survive tab switches and
              mode round-trips (spec Behaviour 6 / AC2, AC11). In the
              Files-mode divergence no active chat belongs to the tab-strip
              project: the surface shows the Behaviour 2 empty state, never
              another project's terminal. */}
          <div
            className="flex min-h-0 flex-1 flex-col"
            style={{
              display: activeTab.kind === 'terminal' ? 'flex' : 'none',
            }}
            data-testid={TEST_ID.chatSurfaceHost}
          >
            {chatSurface}
          </div>
          {renderKanban(project !== null && activeTab.kind === 'kanban' ? project.id : null)}
          {homeTabState === 'welcome' && project !== null ? (
            <ProjectHomeWelcome
              onUseLocalTaskList={() => onUseLocalTaskList(project.id)}
              onConnectTracker={onConnectTracker}
            />
          ) : homeTabState === 'error' && bindingsError !== null ? (
            <ProjectHomeError message={bindingsError} />
          ) : homeTabState === 'loading' ? (
            <ProjectHomeLoading />
          ) : null}
        </main>
      </div>
    </div>
  )
}
