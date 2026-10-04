import type React from 'react'
import { useEffect, useState } from 'react'
import type { ChatInfo, ProjectInfo } from '../../../../shared/ipc-contract'
import { LEFT_REGION_SIZE } from '../../hooks/useResizableRegion'
import { cn } from '../../lib/cn'
import { Icon } from '../../lib/icons'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { NoticeBanner } from './NoticeBanner'
import { ResizeHandle } from './ResizeHandle'

// Left navigation (UX-UI §9-10): a "Projects" section header carries the
// icon-only Add Project button (user decision 2026-10-01); project rows
// expand to their chat lists with a New Chat button under each expanded
// project. New Chat creates the chat immediately (no naming form: the name
// is the shell's display label, spec Behaviour 3).
//
// Project Files entry (spec Behaviour 1): the row shows a "Files" action on
// hover/focus (tooltip "Show project files"); clicking the row itself only
// selects the project and expands/collapses its chat list — it never opens
// Project Files. Project removal lives in the row's context menu only (right
// click / ContextMenu key / Shift+F10, spec Behaviour 3): the row has no
// remove button.

interface LeftNavigationProps {
  width: number
  /** Floating theme variant (lib/theme.ts): detached rounded panel with
      margins around it and a gap to the center column, instead of the
      window-edge column with a right hairline. */
  floating?: boolean
  /** Mirrors the files panel's slide (left-to-right; only right after
      leaving Project Files). */
  slideIn?: boolean
  onResizeStart: (event: React.PointerEvent<HTMLElement>) => void
  onResizeNudge: (delta: number) => void
  projects: ProjectInfo[]
  projectNamesUppercase?: boolean
  chatsByProject: Record<string, ChatInfo[]>
  expandedProjectIds: ReadonlySet<string>
  selectedProjectId: string | null
  selectedChatId: string | null
  /** Chats currently showing the attention badge (chat id → tooltip data). */
  attention: Record<string, { message: string | null }>
  /**
   * Attention surfacing gates (attention-alert-settings spec): the badge
   * toggle hides unselected chats' dots while the state itself survives
   * (re-enabling re-renders without a new signal); the active-indicator
   * toggle shows the selected chat's dot. Gating here keeps LeftNavigation
   * presentation-only.
   */
  attentionBadgeEnabled: boolean
  attentionActiveIndicatorEnabled: boolean
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
  /** Opens the project root in the OS file explorer. */
  onOpenInFileExplorer: (projectId: string) => void
  /**
   * Requests closing a chat from its row's close control (user request
   * 2026-10-04): the host opens the confirmation dialog and, on confirm,
   * runs the same close flow as a terminal exit (spec Behaviour 11).
   */
  onRequestCloseChat: (chatId: string) => void
  notice: string | null
  /** Bottom-of-panel strip (App Settings opener), rendered after the
      scrollable list and above the resize handle. */
  children?: React.ReactNode
}

interface ContextMenuState {
  projectId: string
  x: number
  y: number
}

export function LeftNavigation({
  width,
  floating = false,
  slideIn = false,
  onResizeStart,
  onResizeNudge,
  projects,
  projectNamesUppercase = true,
  chatsByProject,
  expandedProjectIds,
  selectedProjectId,
  selectedChatId,
  attention,
  attentionBadgeEnabled,
  attentionActiveIndicatorEnabled,
  onSelectProject,
  onToggleProject,
  onSelectChat,
  onAddProject,
  onRemoveProject,
  onOpenProjectFiles,
  onOpenProjectSettings,
  onCreateChat,
  onOpenInFileExplorer,
  onRequestCloseChat,
  notice,
  children,
}: LeftNavigationProps): React.JSX.Element {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  // Chat row whose close control is revealed (row hover or keyboard focus).
  // JS state instead of CSS :hover so the attention badge can yield the same
  // corner while the X is visible.
  const [revealedChatId, setRevealedChatId] = useState<string | null>(null)

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
        'relative flex shrink-0 flex-col bg-panel',
        // Floating theme: the panel floats detached from the window edges
        // (user request 2026-10-04); overflow-hidden clips the right-edge
        // resize strip and the notice banner to the rounded corners.
        floating ? 'm-2 overflow-hidden rounded-lg border border-edge' : 'border-r border-edge',
        slideIn && 'slide-in-from-left',
      )}
      style={{ width }}
      data-testid={TEST_ID.leftNav}
    >
      {/* The brand strip left with the window title bar (user decision
          2026-10-01); the panel starts with the notices and Projects header. */}
      <NoticeBanner notice={notice} />
      {/* Section header (user decision 2026-10-01): "Projects" title with an
          icon-only Add Project button on the right. Title sized like the
          project rows (text-sm). Its height aligns the first project tile
          with the action buttons: header + 8px margin + 4px list inset =
          tab strip + 1px action-row border + 8px action-row padding. */}
      <div className="mt-2 flex h-[calc(var(--spacing-control)+0.3125rem)] shrink-0 items-center justify-between px-4">
        <span className="text-sm text-projects-header" data-testid={TEST_ID.projectsHeader}>
          Projects
        </span>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded text-ink-muted hover:bg-highlight hover:text-ink"
          data-testid={TEST_ID.addProjectButton}
          aria-label="Add Project"
          title="Add Project"
          onClick={onAddProject}
        >
          <Icon.plus size={14} aria-hidden />
        </button>
      </div>
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
                <li key={project.id} className="py-1">
                  {/* Selection container (NEKODE-3, brief r3.2): the whole
                      row is the container — rounded, highlighted, with a
                      narrow left accent stripe when selected; overflow-hidden
                      clips the stripe to the radius. Stripe is decorative;
                      selection stays announced by data-selected. */}
                  {/* Hover-at-rest (user decision 2026-10-02): an unselected
                      project row already shows a slightly dimmer highlight in
                      the same footprint as selection, so hover cannot resize
                      the tile. Selection keeps the brighter --color-highlight. */}
                  {/* Right axis (user request 2026-10-04): the row's content
                      edge sits 8px from the panel edge (pr-2 after the 4px
                      list inset), level with the header's Add Project button
                      and the chat rows' right padding. */}
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: the row hosts the context-menu gesture (right click / ContextMenu key / Shift+F10 — spec Behaviour 3); the menu items are real buttons and the menu closes on Escape. */}
                  <div
                    className={cn(
                      'relative flex h-control items-center overflow-hidden rounded-md pl-1 pr-2 py-1.5 transition-colors',
                      isSelected ? 'bg-highlight' : 'hover:bg-row-hover',
                    )}
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
                    {isSelected ? (
                      /* Narrow left accent stripe (NEKODE-3): lavender in
                         default-beta-1, blue in default, from --color-accent. */
                      <span
                        aria-hidden
                        className="absolute inset-y-0 left-0 w-[3px] rounded-full bg-accent"
                      />
                    ) : null}
                    {/* One toggle surface (user request 2026-10-02): the
                        title itself expands/collapses the chat list. An
                        unselected project is selected on first click (its
                        select path also expands); a selected one folds and
                        unfolds in place, keeping the active chat intact. */}
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center self-stretch rounded px-1 py-1 text-left text-sm text-project-title"
                      data-testid={testIdFor.projectSelect(project.id)}
                      title={project.path}
                      aria-expanded={isExpanded}
                      onClick={() => {
                        if (isSelected) {
                          onToggleProject(project.id)
                        } else {
                          onSelectProject(project.id)
                        }
                      }}
                    >
                      {isExpanded ? (
                        <Icon.chevronDown size={12} aria-hidden className="mr-1 shrink-0" />
                      ) : (
                        <Icon.chevronRight size={12} aria-hidden className="mr-1 shrink-0" />
                      )}
                      <span className="min-w-0 truncate">
                        {projectNamesUppercase ? project.name.toUpperCase() : project.name}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-highlight hover:text-ink"
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
                    /* Constant hairline gap under the project tile (user
                       request 2026-10-01): ~3px (nearest scale step, 4px)
                       between the tile's highlight and any highlight below,
                       selected first chat included — always, not only when
                       the first chat is selected. */
                    <div className="mt-1" data-testid={testIdFor.projectChats(project.id)}>
                      {chats.length > 0 && (
                        <ul className="flex flex-col gap-1">
                          {chats.map((chat) => {
                            const isChatSelected = chat.id === selectedChatId && isSelected
                            // Attention badge (chat attention badge spec
                            // Behaviour 5, gated by attention-alert-settings):
                            // an amber dot next to the chat name, with the
                            // OSC 9 message as its tooltip. Unselected chats
                            // show it when the badge toggle is on; the
                            // SELECTED chat shows it only when the
                            // active-indicator toggle is on. A collapsed
                            // project hides the badge with the whole list
                            // (no promotion to the project row).
                            const attentionState = attention[chat.id]
                            const badgeVisible =
                              attentionState !== undefined &&
                              (isChatSelected
                                ? attentionActiveIndicatorEnabled
                                : attentionBadgeEnabled)
                            const badgeTitle =
                              attentionState === undefined
                                ? undefined
                                : (attentionState.message ?? 'Needs attention')
                            // While the close X occupies the row's right edge,
                            // the badge yields the same corner (they overlap).
                            return (
                              /* The tile is the hover boundary: its leave hides
                                 the X. The X is a sibling overlay of the row
                                 button, so a row-level leave would fire the
                                 moment the pointer reaches the control and
                                 flicker hide/show (fixed 2026-10-04). */
                              <li
                                key={chat.id}
                                className="relative pl-6"
                                onMouseLeave={() => {
                                  if (revealedChatId === chat.id) {
                                    setRevealedChatId(null)
                                  }
                                }}
                              >
                                {/* Close control (user request 2026-10-04): an
                                    X on the shared 24px right-edge axis with
                                    Add Project and Show project files, centered
                                    in the row and shown on hover or focus.
                                    Absolute positioning keeps the tile size
                                    stable. Clicking stages a confirmation
                                    dialog — closing removes the chat with its
                                    terminal (spec Behaviour 11). The badge
                                    yields while the X is shown (same corner). */}
                                <button
                                  type="button"
                                  className={cn(
                                    'absolute right-2 top-1/2 z-10 h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-ink-muted hover:bg-highlight hover:text-ink',
                                    revealedChatId === chat.id ? 'flex' : 'hidden',
                                  )}
                                  data-testid={testIdFor.chatClose(chat.id)}
                                  aria-label={`Close chat ${chat.name}`}
                                  title="Close chat"
                                  onClick={(event) => {
                                    // The row's own activation must not fire
                                    // behind this control.
                                    event.stopPropagation()
                                    onRequestCloseChat(chat.id)
                                  }}
                                >
                                  <Icon.close size={12} aria-hidden />
                                </button>
                                <button
                                  type="button"
                                  className={cn(
                                    'flex h-control w-full items-center gap-1.5 rounded-md pl-3 pr-2 text-left text-sm text-chat-title',
                                    isChatSelected ? 'bg-highlight text-ink' : 'hover:bg-row-hover',
                                  )}
                                  data-testid={testIdFor.chatRow(chat.id)}
                                  data-selected={isChatSelected ? 'true' : 'false'}
                                  onMouseEnter={() => setRevealedChatId(chat.id)}
                                  onFocus={() => setRevealedChatId(chat.id)}
                                  onBlur={() => {
                                    if (revealedChatId === chat.id) {
                                      setRevealedChatId(null)
                                    }
                                  }}
                                  onClick={() => onSelectChat(project.id, chat.id)}
                                >
                                  <Icon.chat size={12} aria-hidden className="shrink-0" />
                                  <span className="min-w-0 truncate">{chat.name}</span>
                                  {badgeVisible && revealedChatId !== chat.id ? (
                                    <span
                                      role="img"
                                      className="ml-auto h-2 w-2 shrink-0 rounded-full bg-warning"
                                      data-testid={testIdFor.chatAttentionBadge(chat.id)}
                                      title={badgeTitle}
                                      aria-label={`${chat.name} needs attention`}
                                    />
                                  ) : null}
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                      {/* Same indent axis and shared control height as the chat tiles. */}
                      <div className="mt-1 pl-6">
                        <button
                          type="button"
                          className="flex h-control w-full items-center gap-1.5 rounded-md pl-3 pr-2 text-left text-sm text-ink-secondary hover:bg-row-hover"
                          data-testid={TEST_ID.newChatButton}
                          onClick={() => {
                            void onCreateChat(project.id)
                          }}
                        >
                          <Icon.plus size={12} aria-hidden className="shrink-0" />
                          New Chat
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {/* Bottom-of-panel strip (user decision 2026-10-02, after Zed): the
          App Settings opener lives at the very bottom of the left panel,
          not in the window title bar. */}
      {children}
      {contextMenu !== null ? (
        <ContextMenuOverlay
          state={contextMenu}
          projectName={projects.find((project) => project.id === contextMenu.projectId)?.name ?? ''}
          onClose={() => setContextMenu(null)}
          onRemoveProject={(projectId) => {
            setContextMenu(null)
            onRemoveProject(projectId)
          }}
          onOpenInFileExplorer={(projectId) => {
            setContextMenu(null)
            onOpenInFileExplorer(projectId)
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
  onOpenInFileExplorer,
  onOpenProjectSettings,
}: {
  state: ContextMenuState
  projectName: string
  onClose: () => void
  onRemoveProject: (projectId: string) => void
  onOpenInFileExplorer: (projectId: string) => void
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
          className="w-full px-3 py-1.5 text-left text-xs text-ink-secondary hover:bg-highlight hover:text-ink"
          onClick={() => onOpenInFileExplorer(state.projectId)}
        >
          Open in file explorer
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
