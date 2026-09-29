import type React from 'react'
import { useEffect, useState } from 'react'
import type { ChatInfo, ProjectInfo } from '../../../../shared/ipc-contract'
import { LEFT_REGION_SIZE } from '../../hooks/useResizableRegion'
import { cn } from '../../lib/cn'
import { Icon } from '../../lib/icons'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { NoticeBanner } from './NoticeBanner'
import { ResizeHandle } from './ResizeHandle'

// Left navigation (UX-UI §9–10): project rows expand to their chat lists,
// with Add Project and a New Chat button under the active project. New Chat
// creates the chat immediately (no naming form — the name is the shell's
// display label, spec Behaviour 3).
//
// Project Files entry (spec Behaviour 1): the row shows a "Files" action on
// hover/focus (tooltip "Show project files"); clicking the row itself only
// selects the project and expands/collapses its chat list — it never opens
// Project Files. Project removal lives in the row's context menu only (right
// click / ContextMenu key / Shift+F10, spec Behaviour 3): the row has no
// remove button.

interface LeftNavigationProps {
  width: number
  /** Mirrors the files panel's slide (left-to-right; only right after
      leaving Project Files). */
  slideIn?: boolean
  onResizeStart: (event: React.PointerEvent<HTMLElement>) => void
  onResizeNudge: (delta: number) => void
  projects: ProjectInfo[]
  chatsByProject: Record<string, ChatInfo[]>
  expandedProjectIds: ReadonlySet<string>
  selectedProjectId: string | null
  selectedChatId: string | null
  onSelectProject: (projectId: string) => void
  onToggleProject: (projectId: string) => void
  onSelectChat: (projectId: string, chatId: string) => void
  onAddProject: () => void
  onRemoveProject: (projectId: string) => void
  /** Enters Project Files mode for the project (spec Behaviour 1). */
  onOpenProjectFiles: (projectId: string) => void
  onOpenProjectSettings: (projectId: string) => void
  /** Creates a chat immediately with the shell-derived name (no form). */
  onCreateChat: (projectId: string) => Promise<boolean>
  notice: string | null
}

interface ContextMenuState {
  projectId: string
  x: number
  y: number
}

export function LeftNavigation({
  width,
  slideIn = false,
  onResizeStart,
  onResizeNudge,
  projects,
  chatsByProject,
  expandedProjectIds,
  selectedProjectId,
  selectedChatId,
  onSelectProject,
  onToggleProject,
  onSelectChat,
  onAddProject,
  onRemoveProject,
  onOpenProjectFiles,
  onOpenProjectSettings,
  onCreateChat,
  notice,
}: LeftNavigationProps): React.JSX.Element {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  // Escape closes the context menu (the overlay handles pointer dismissal).
  useEffect(() => {
    if (contextMenu === null) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setContextMenu(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [contextMenu])

  function openContextMenu(projectId: string, x: number, y: number): void {
    setContextMenu({ projectId, x, y })
  }

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col border-r border-edge bg-panel',
        slideIn && 'slide-in-from-left',
      )}
      style={{ width }}
      data-testid={TEST_ID.leftNav}
    >
      {/* Window drag surface (title bar): the top strip is the base app
          background; the button opts out of dragging. Fixed 40px height so the
          header matches the tab strip; the 32px control centers in it. */}
      <div className="drag-region flex h-10 items-center justify-between bg-app px-4">
        <h2 className="text-xs font-semibold tracking-wider text-ink-secondary uppercase">
          Projects
        </h2>
        <button
          type="button"
          className="no-drag flex h-control items-center gap-1.5 rounded-md bg-button px-3 text-xs text-ink hover:bg-button-hover"
          data-testid={TEST_ID.addProjectButton}
          onClick={onAddProject}
        >
          <Icon.projectAdd size={14} aria-hidden />
          Add Project
        </button>
      </div>
      <NoticeBanner notice={notice} />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {projects.length === 0 ? (
          <p
            className="px-2 py-3 text-xs leading-relaxed text-ink-muted"
            data-testid={TEST_ID.emptyProjectList}
          >
            No projects yet. Add a local project to start working.
          </p>
        ) : (
          <ul data-testid={TEST_ID.projectList}>
            {projects.map((project) => {
              const isExpanded = expandedProjectIds.has(project.id)
              const isSelected = project.id === selectedProjectId
              const chats = chatsByProject[project.id] ?? []
              return (
                <li key={project.id} className="py-0.5">
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: the row hosts the context-menu gesture (right click / ContextMenu key / Shift+F10 — spec Behaviour 3); the menu items are real buttons and the menu closes on Escape. */}
                  <div
                    className="flex items-center rounded px-1 py-1"
                    data-testid={testIdFor.projectRow(project.id)}
                    data-selected={isSelected ? 'true' : 'false'}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      openContextMenu(project.id, event.clientX, event.clientY)
                    }}
                    onKeyDown={(event) => {
                      // Keyboard context-menu invocation (spec Behaviour 3):
                      // the ContextMenu key or Shift+F10 opens the menu.
                      if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
                        event.preventDefault()
                        const rect = event.currentTarget.getBoundingClientRect()
                        openContextMenu(project.id, rect.left, rect.bottom)
                      }
                    }}
                  >
                    <button
                      type="button"
                      className="flex items-center rounded px-1 py-0.5 text-ink-secondary hover:bg-highlight hover:text-ink"
                      data-testid={testIdFor.projectToggle(project.id)}
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${project.name}`}
                      onClick={() => onToggleProject(project.id)}
                    >
                      {isExpanded ? (
                        <Icon.chevronDown size={12} aria-hidden />
                      ) : (
                        <Icon.chevronRight size={12} aria-hidden />
                      )}
                    </button>
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate rounded pr-1 py-0.5 text-left text-sm uppercase text-project-title"
                      data-testid={testIdFor.projectSelect(project.id)}
                      title={project.path}
                      onClick={() => onSelectProject(project.id)}
                    >
                      {project.name}
                    </button>
                    <button
                      type="button"
                      className="ml-1 flex items-center rounded px-1.5 py-0.5 text-ink-muted hover:bg-highlight hover:text-ink"
                      data-testid={testIdFor.projectFiles(project.id)}
                      title="Show project files"
                      aria-label={`Show project files for ${project.name}`}
                      onClick={() => onOpenProjectFiles(project.id)}
                    >
                      <Icon.directory size={12} aria-hidden />
                    </button>
                  </div>
                  {isExpanded ? (
                    /* Full-width rows, no vertical guide line: the chat
                       highlight reads across the whole list width. */
                    <div data-testid={testIdFor.projectChats(project.id)}>
                      {chats.length === 0 ? (
                        <p className="px-1 py-1 text-xs leading-relaxed text-ink-muted">
                          No chats yet.
                        </p>
                      ) : (
                        <ul>
                          {chats.map((chat) => {
                            const isChatSelected = chat.id === selectedChatId && isSelected
                            return (
                              <li key={chat.id}>
                                <button
                                  type="button"
                                  className={cn(
                                    'flex w-full items-center gap-1.5 rounded pb-1 pl-6 pr-2 pt-1 text-left text-xs text-ink-secondary hover:bg-highlight hover:text-ink',
                                    isChatSelected && 'bg-highlight text-ink',
                                  )}
                                  data-testid={testIdFor.chatRow(chat.id)}
                                  data-selected={isChatSelected ? 'true' : 'false'}
                                  onClick={() => onSelectChat(project.id, chat.id)}
                                >
                                  <Icon.chat size={12} aria-hidden className="shrink-0" />
                                  <span className="min-w-0 truncate">{chat.name}</span>
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                      {isSelected ? (
                        <button
                          type="button"
                          className="mt-1 flex w-full items-center gap-1.5 rounded pb-1 pl-6 pr-2 pt-1 text-left text-xs text-ink-secondary hover:bg-highlight hover:text-ink"
                          data-testid={TEST_ID.newChatButton}
                          onClick={() => {
                            void onCreateChat(project.id)
                          }}
                        >
                          <Icon.plus size={12} aria-hidden className="shrink-0" />
                          New Chat
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {contextMenu !== null ? (
        <ContextMenuOverlay
          state={contextMenu}
          projectName={projects.find((project) => project.id === contextMenu.projectId)?.name ?? ''}
          onClose={() => setContextMenu(null)}
          onRemoveProject={(projectId) => {
            setContextMenu(null)
            onRemoveProject(projectId)
          }}
          onOpenProjectSettings={(projectId) => {
            setContextMenu(null)
            onOpenProjectSettings(projectId)
          }}
        />
      ) : null}
      <ResizeHandle
        axis="x"
        size={width}
        minSize={LEFT_REGION_SIZE.min}
        maxSize={LEFT_REGION_SIZE.max}
        onResizeStart={onResizeStart}
        onResizeNudge={onResizeNudge}
        testId={TEST_ID.leftResizeHandle}
      />
    </aside>
  )
}

/**
 * Project row context menu (spec Behaviour 3): the only place the Remove
 * Project action lives now. Rendered as a fixed overlay so the menu closes on
 * any outside click or context-menu gesture.
 */
function ContextMenuOverlay({
  state,
  projectName,
  onClose,
  onRemoveProject,
  onOpenProjectSettings,
}: {
  state: ContextMenuState
  projectName: string
  onClose: () => void
  onRemoveProject: (projectId: string) => void
  onOpenProjectSettings: (projectId: string) => void
}): React.JSX.Element {
  return (
    <div
      role="menu"
      aria-label={`Project ${projectName}`}
      className="fixed inset-0 z-40"
      onClick={(event) => {
        // Only the backdrop dismisses: menu-item clicks run their own action.
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          onClose()
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div
        className="absolute min-w-40 rounded-md border border-edge bg-panel py-1 shadow-lg"
        style={{ left: state.x, top: state.y }}
        data-testid={TEST_ID.projectContextMenu}
      >
        <button
          type="button"
          role="menuitem"
          className="w-full px-3 py-1.5 text-left text-xs text-ink-secondary hover:bg-highlight hover:text-ink"
          onClick={() => onOpenProjectSettings(state.projectId)}
        >
          Project Settings
        </button>
        <button
          type="button"
          role="menuitem"
          className="w-full px-3 py-1.5 text-left text-xs text-error hover:bg-error/10"
          data-testid={testIdFor.removeProject(state.projectId)}
          aria-label={`Remove Project ${projectName}`}
          onClick={() => onRemoveProject(state.projectId)}
        >
          Remove Project
        </button>
      </div>
    </div>
  )
}
