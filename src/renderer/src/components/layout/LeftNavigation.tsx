import type React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  AgentProfile,
  AgentProfilesDocument,
  ChatInfo,
  ProjectInfo,
  SessionStatus,
  SessionTaskProgress,
} from '../../../../shared/ipc-contract'
import { parseWslPath } from '../../../../shared/wsl-path'
import { cn } from '../../lib/cn'
import { Icon } from '../../lib/icons'
import { clampMenuPosition } from '../../lib/menu-position'
import { getProjectColor, getProjectInitials } from '../../lib/project-avatar'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { NoticeBanner } from './NoticeBanner'

// Left navigation (UX-UI §9-10): a "Projects" section header carries the
// icon-only Add Project button (user decision 2026-10-01); project rows
// carry Files and New Chat actions and expand to show Kanban and their chat lists.
// New Chat creates the chat immediately (no naming form: the name
// is the shell's display label, spec Behaviour 3).
//
// Project Files entry (spec Behaviour 1): the row shows a "Files" action on
// hover/focus (tooltip "Show project files"); clicking the row itself only
// selects the project and expands/collapses its chat list — it never opens
// Project Files. Project removal lives in the row's context menu only (right
// click / ContextMenu key / Shift+F10, spec Behaviour 3): the row has no
// remove button.

interface LeftNavigationProps {
  projects: ProjectInfo[]
  projectNamesUppercase?: boolean
  showProjectIcons?: boolean
  projectColors?: Record<string, string>
  chatsByProject: Record<string, ChatInfo[]>
  expandedProjectIds: ReadonlySet<string>
  selectedProjectId: string | null
  selectedChatId: string | null
  /** Chats currently showing the attention badge (chat id → tooltip data). */
  attention: Record<string, { message: string | null }>
  activity?: ReadonlySet<string>
  sessionStatuses?: Record<string, SessionStatus>
  sessionTasks?: Record<string, SessionTaskProgress>
  /**
   * Attention surfacing gates (attention-alert-settings spec): the badge
   * toggle hides unselected chats' dots while the state itself survives
   * (re-enabling re-renders without a new signal); the active-indicator
   * toggle shows the selected chat's dot. Gating here keeps LeftNavigation
   * presentation-only.
   */
  attentionBadgeEnabled: boolean
  attentionActiveIndicatorEnabled: boolean
  /**
   * Project name or icon click: opens the project's home tab. Called for the
   * already selected project too (project-home spec Behaviour 4).
   */
  onSelectProject: (projectId: string) => void
  onToggleProject: (projectId: string) => void
  onSelectChat: (projectId: string, chatId: string) => void
  onAddProject: () => void
  onRemoveProject: (projectId: string) => void
  /** Enters Project Files mode for the project (spec Behaviour 1). */
  onOpenProjectFiles: (projectId: string) => void
  /**
   * Projects with a stored Kanban binding (spec kanban-adapter-interface
   * Behaviour 14): each shows a `Kanban` tile as the first element of its
   * expanded content, directly under its name. Unbound projects show none.
   */
  kanbanProjectIds: ReadonlySet<string>
  /** Opens the project's Kanban board (selects the project, activates its tab). */
  onOpenProjectKanban: (projectId: string) => void
  onOpenProjectSettings: (projectId: string) => void
  /** Creates a chat immediately with the shell-derived name (no form). */
  onCreateChat: (projectId: string) => Promise<boolean>
  /**
   * Starts one chat with the chosen agent profile (spec new-chat-agent-menu):
   * main names the chat and runs the profile in its terminal. Resolves true
   * when the chat was adopted; the host owns the notice on failure.
   */
  onCreateAgentChat: (projectId: string, profileId: string) => Promise<boolean>
  /** Reads a project's agent profiles for the New Chat menu (agentProfiles:get). */
  loadAgentProfiles: (projectId: string) => Promise<AgentProfilesDocument>
  /** Opens Project Settings on the Agents tab without creating a chat. */
  onConfigureAgents: (projectId: string) => void
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
      scrollable list. The slot owns the resize handle. */
  children?: React.ReactNode
}

type ContextMenuState = {
  x: number
  y: number
} & ({ projectId: string } | { projectId: null })

/** Open position of the New Chat button's agent profile menu. */
interface NewChatMenuState {
  projectId: string
  x: number
  y: number
}

export const SESSION_STATUS_CONFIG: Record<SessionStatus, { label: string; color: string }> = {
  running: { label: 'running', color: '#4ADE80' },
  waiting: { label: 'waiting for input', color: '#F59E0B' },
  idle: { label: 'idle', color: '#8A90A6' },
}

export function formatTimeSince(seconds: number): string {
  if (seconds < 60) return 'now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h`
  const days = Math.floor(hours / 24)
  return `${days} d`
}

interface SessionRowItemProps {
  chat: ChatInfo
  projectId: string
  isChatSelected: boolean
  status: SessionStatus
  task?: SessionTaskProgress
  revealedChatId: string | null
  setRevealedChatId: (chatId: string | null) => void
  onSelectChat: (projectId: string, chatId: string) => void
  onRequestCloseChat: (chatId: string) => void
  legacyAttention?: {
    badgeVisible: boolean
    badgeTitle?: string
  }
  legacyActivity?: boolean
}

export function SessionRowItem({
  chat,
  projectId,
  isChatSelected,
  status,
  task,
  revealedChatId,
  setRevealedChatId,
  onSelectChat,
  onRequestCloseChat,
  legacyAttention,
  legacyActivity,
}: SessionRowItemProps): React.JSX.Element {
  const [prevStatus, setPrevStatus] = useState(status)
  const [statusTimestamp, setStatusTimestamp] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())

  if (prevStatus !== status) {
    setPrevStatus(status)
    setStatusTimestamp(Date.now())
  }

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 10_000)
    return () => clearInterval(timer)
  }, [])

  const elapsedSeconds = Math.max(0, Math.floor((now - statusTimestamp) / 1000))
  const timeFormatted = formatTimeSince(elapsedSeconds)
  const config = SESSION_STATUS_CONFIG[status]
  const isRevealed = revealedChatId === chat.id
  const label =
    chat.taskRef?.trim() || chat.name.replace(/^\[[^\]]+\](?:\s+|$)/, '').trim() || 'Terminal'
  const accessibleName = chat.agentName ? `${label}, ${chat.agentName}` : label

  return (
    <li
      className="group relative"
      onFocus={() => setRevealedChatId(chat.id)}
      onMouseEnter={() => setRevealedChatId(chat.id)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          if (revealedChatId === chat.id) {
            setRevealedChatId(null)
          }
        }
      }}
      onMouseLeave={(event) => {
        if (event.currentTarget.contains(document.activeElement)) {
          return
        }
        if (revealedChatId === chat.id) {
          setRevealedChatId(null)
        }
      }}
    >
      <button
        type="button"
        className={cn(
          'nk-chat-row flex h-control w-full items-center gap-2 rounded-md pl-5 pr-5 text-left text-sm transition-colors duration-fast ease-standard border-0',
          isChatSelected
            ? 'bg-[#262B3F] text-white'
            : cn(
                'bg-transparent text-chat-title hover:bg-row-hover group-hover:bg-row-hover',
                isRevealed && 'bg-row-hover',
              ),
        )}
        data-testid={testIdFor.chatRow(chat.id)}
        data-selected={isChatSelected ? 'true' : 'false'}
        title={`${accessibleName}: ${config.label}`}
        aria-label={`${accessibleName}, ${config.label}, ${timeFormatted}`}
        onMouseEnter={() => setRevealedChatId(chat.id)}
        onClick={() => onSelectChat(projectId, chat.id)}
      >
        <Icon.terminal size={16} aria-hidden className="session-icon neon-term shrink-0" />
        <span
          aria-hidden="true"
          className="nk-chat-dot h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: config.color }}
          data-testid={testIdFor.chatStatusDot(chat.id)}
          data-status={status}
        />
        <span className="min-w-0 truncate font-mono">{label}</span>
        {chat.agentName ? (
          <span
            className="max-w-24 shrink-0 truncate rounded border border-edge bg-highlight px-1.5 py-0.5 font-mono text-[10px] leading-none text-ink-muted"
            title={`Agent: ${chat.agentName}`}
          >
            {chat.agentName}
          </span>
        ) : null}
        {task !== undefined ? (
          <span
            role="img"
            className="rounded-[3px] px-1.5 py-0.5 text-[11px] font-mono shrink-0 leading-none"
            style={{
              color: '#5AA9FF',
              backgroundColor: 'rgba(90, 169, 255, 0.12)',
              opacity: task.stale ? 0.5 : undefined,
            }}
            title={`${task.stale ? `Out of date: ${task.staleReason}. ` : ''}Task ${task.taskId}: step ${task.step} of ${task.totalSteps}`}
            aria-label={task.ariaLabel}
            data-testid={testIdFor.chatTaskProgress(chat.id)}
          >
            {task.step}/{task.totalSteps}
          </span>
        ) : null}
        <span
          className={cn(
            'ml-auto shrink-0 text-xs font-mono text-[#6c7288]',
            isRevealed && 'invisible',
          )}
          data-testid={testIdFor.chatTime(chat.id)}
        >
          {timeFormatted}
        </span>
        {legacyAttention?.badgeVisible && !isRevealed ? (
          <span
            role="img"
            className="sr-only"
            data-testid={testIdFor.chatAttentionBadge(chat.id)}
            title={legacyAttention.badgeTitle}
            aria-label={`${accessibleName} needs attention`}
          />
        ) : legacyActivity && !isRevealed ? (
          <span
            className="sr-only"
            data-testid={testIdFor.chatActivity(chat.id)}
            role="img"
            aria-label={`${accessibleName}: recent terminal output`}
            title="Recent terminal output. This is not agent status; silence does not mean completion."
          />
        ) : null}
      </button>
      <button
        type="button"
        className={cn(
          'absolute right-5 top-1/2 z-10 h-6 w-6 -translate-y-1/2 items-center justify-center rounded bg-transparent text-[#8A90A6] transition-colors duration-fast ease-standard hover:text-white',
          isRevealed ? 'flex' : 'hidden',
        )}
        data-testid={testIdFor.chatClose(chat.id)}
        aria-label={`Close chat ${accessibleName}`}
        title="Close chat"
        onClick={(event) => {
          event.stopPropagation()
          onRequestCloseChat(chat.id)
        }}
      >
        <Icon.close size={14} aria-hidden />
      </button>
    </li>
  )
}

export function LeftNavigation({
  projects,
  projectNamesUppercase = true,
  showProjectIcons = true,
  projectColors,
  chatsByProject,
  expandedProjectIds,
  selectedProjectId,
  selectedChatId,
  attention,
  activity,
  sessionStatuses,
  sessionTasks,
  attentionBadgeEnabled,
  attentionActiveIndicatorEnabled,
  onSelectProject,
  onToggleProject,
  onSelectChat,
  onAddProject,
  onRemoveProject,
  onOpenProjectFiles,
  kanbanProjectIds,
  onOpenProjectKanban,
  onOpenProjectSettings,
  onCreateChat,
  onCreateAgentChat,
  loadAgentProfiles,
  onConfigureAgents,
  onOpenInFileExplorer,
  onRequestCloseChat,
  notice,
  children,
}: LeftNavigationProps): React.JSX.Element {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  // Agent profile menu of one project's New Chat button (spec
  // new-chat-agent-menu): presentation-only state; the profiles themselves
  // come from agentProfiles:get through the host.
  const [newChatMenu, setNewChatMenu] = useState<NewChatMenuState | null>(null)
  // Chat row whose close control is revealed (row hover or keyboard focus).
  // JS state instead of CSS :hover so the attention badge can yield the same
  // corner while the X is visible.
  const [revealedChatId, setRevealedChatId] = useState<string | null>(null)

  // Escape closes the open menu (the overlay handles pointer dismissal).
  useEffect(() => {
    if (contextMenu === null && newChatMenu === null) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setContextMenu(null)
        setNewChatMenu(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [contextMenu, newChatMenu])

  function openContextMenu(projectId: string | null, x: number, y: number): void {
    // One menu at a time (spec Behaviour 7: a gesture while a menu is open
    // closes the old menu first). Only pointer gestures are swallowed by the
    // open overlay; a keyboard gesture reaches the other opener directly.
    setNewChatMenu(null)
    setContextMenu({ projectId, x, y })
  }

  function openNewChatMenu(projectId: string, x: number, y: number): void {
    setContextMenu(null)
    setNewChatMenu({ projectId, x, y })
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-panel">
      {/* The brand strip left with the window title bar (user decision
          2026-10-01); the panel starts with the notices and Projects header. */}
      <NoticeBanner notice={notice} />
      {/* Section header (user decision 2026-10-01): "Projects" title with an
          icon-only Add Project button on the right. Title sized like the
          project rows (text-sm). Its height aligns the first project tile
          with the action buttons: header + 8px margin + 4px list inset =
          tab strip + 1px action-row border + 8px action-row padding. */}
      <div className="mt-2 flex h-[calc(var(--spacing-control)+0.3125rem)] shrink-0 items-center justify-between px-5">
        <span
          className="text-sm uppercase text-projects-header"
          data-testid={TEST_ID.projectsHeader}
        >
          Projects
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="nk-add-project flex h-6 w-6 items-center justify-center rounded text-ink-muted hover:bg-highlight hover:text-ink"
            data-testid={TEST_ID.addProjectButton}
            aria-label="Add Project"
            title="Add Project"
            onClick={onAddProject}
          >
            <Icon.plus size={14} aria-hidden />
          </button>
        </div>
      </div>
      <section
        aria-label="Projects"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: focus enables keyboard scrolling and ContextMenu / Shift+F10 in this region.
        tabIndex={0}
        data-testid={TEST_ID.projectListArea}
        className="min-h-0 flex-1 overflow-y-auto px-5 pb-2"
        onContextMenu={(event) => {
          // Project subtrees keep their own gestures, including chat controls.
          if (event.target instanceof Element && event.target.closest('li')) return
          event.preventDefault()
          event.currentTarget.focus()
          openContextMenu(null, event.clientX, event.clientY)
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
            event.preventDefault()
            const rect = event.currentTarget.getBoundingClientRect()
            openContextMenu(null, rect.left, rect.top)
          }
        }}
      >
        {projects.length === 0 ? (
          <p
            className="px-2 py-3 text-xs leading-relaxed text-ink-muted"
            data-testid={TEST_ID.emptyProjectList}
          >
            No projects yet. Add a project to start working.
          </p>
        ) : (
          <ul data-testid={TEST_ID.projectList}>
            {projects.map((project) => {
              const isExpanded = expandedProjectIds.has(project.id)
              const isSelected = project.id === selectedProjectId
              const chats = chatsByProject[project.id] ?? []
              const projectColor = getProjectColor(project, projectColors?.[project.id])
              const initials = getProjectInitials(project.name)
              const wslLocation = parseWslPath(project.path)
              return (
                <li key={project.id} className="py-1">
                  {/* Selection container (NEKODE-3, brief r3.2): the whole
                      row is the container — rounded, highlighted, with a
                      narrow left accent stripe when selected; overflow-hidden
                      clips the stripe to the radius. Stripe is decorative;
                      selection stays announced by data-selected. */}
                  {/* Active project row has no resting background fill (user decision 2026-10-17);
                      selection is marked by the accent stripe and data-selected. */}
                  {/* Flush left alignment and isolated icon hover (user decision 2026-10-18):
                      the project row has no hover background fill, allowing row content
                      to start flush at the left boundary (pl-0), aligning with the Projects
                      header. Action buttons on the right are enlarged to 28x28 (h-7 w-7, 14px icons)
                      with their own prominent hover highlight. */}
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: the row hosts the context-menu gesture (right click / ContextMenu key / Shift+F10 — spec Behaviour 3); the menu items are real buttons and the menu closes on Escape. */}
                  <div
                    className={cn(
                      'relative flex h-control items-center py-1.5 pl-0 pr-0 transition-colors duration-fast ease-standard',
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
                    {/* Split surfaces (NEKODE-96): the chevron only folds and
                        unfolds the chat list and never changes the selection;
                        the icon and name open the project's home tab
                        (project-home spec Behaviour 4). The host keeps the
                        selected chat when the project is already selected. */}
                    <button
                      type="button"
                      className={cn(
                        'flex shrink-0 items-center self-stretch rounded pl-0 pr-2 transition-colors duration-fast ease-standard',
                        isExpanded || isSelected
                          ? 'text-project-title'
                          : 'text-project-title-collapsed hover:text-project-title',
                      )}
                      data-testid={testIdFor.projectToggle(project.id)}
                      aria-label={
                        isExpanded ? `Collapse ${project.name}` : `Expand ${project.name}`
                      }
                      aria-expanded={isExpanded}
                      onClick={() => {
                        onToggleProject(project.id)
                      }}
                    >
                      {isExpanded ? (
                        <Icon.chevronDown
                          size={14}
                          aria-hidden
                          className="project-chevron shrink-0"
                        />
                      ) : (
                        <Icon.chevronRight
                          size={14}
                          aria-hidden
                          className="project-chevron shrink-0"
                        />
                      )}
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'flex min-w-0 flex-1 items-center self-stretch rounded pl-0 pr-1 py-1 text-left text-sm transition-colors duration-fast ease-standard',
                        isExpanded || isSelected
                          ? 'text-project-title'
                          : 'text-project-title-collapsed hover:text-project-title',
                      )}
                      data-testid={testIdFor.projectSelect(project.id)}
                      title={project.path}
                      onClick={() => {
                        onSelectProject(project.id)
                      }}
                    >
                      {showProjectIcons ? (
                        <span
                          aria-hidden="true"
                          data-testid={testIdFor.projectAvatar(project.id)}
                          className="mr-2 flex h-5 w-5 shrink-0 select-none items-center justify-center rounded font-mono text-[10px] font-bold leading-none"
                          style={{
                            color: projectColor,
                            backgroundColor: `${projectColor}2e`,
                          }}
                        >
                          {initials}
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          'min-w-0 truncate',
                          isExpanded || isSelected ? 'font-semibold' : 'font-normal',
                        )}
                      >
                        {projectNamesUppercase ? project.name.toUpperCase() : project.name}
                      </span>
                      {wslLocation !== null ? (
                        <span
                          className="ml-2 shrink-0 rounded border border-edge bg-highlight px-1.5 py-0.5 font-mono text-[10px] leading-none text-ink-muted"
                          title={`WSL: ${wslLocation.distribution}`}
                        >
                          WSL
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="nk-project-row-action ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors duration-fast ease-standard hover:bg-highlight hover:text-ink"
                      data-testid={TEST_ID.newChatButton}
                      title="New chat"
                      aria-label="New chat"
                      onClick={() => {
                        void onCreateChat(project.id)
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        openNewChatMenu(project.id, event.clientX, event.clientY)
                      }}
                      onKeyDown={(event) => {
                        if (
                          event.key === 'ContextMenu' ||
                          (event.key === 'F10' && event.shiftKey)
                        ) {
                          event.preventDefault()
                          event.stopPropagation()
                          const rect = event.currentTarget.getBoundingClientRect()
                          openNewChatMenu(project.id, rect.left, rect.bottom)
                        }
                      }}
                    >
                      <Icon.newChat size={14} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="nk-project-row-action ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-transparent text-ink-muted transition-colors duration-fast ease-standard hover:bg-highlight hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      data-testid={testIdFor.projectFiles(project.id)}
                      title="File tree"
                      aria-label={`Open file tree of ${project.name}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        onOpenProjectFiles(project.id)
                      }}
                    >
                      <Icon.arrowRight size={14} aria-hidden />
                    </button>
                  </div>
                  {isExpanded ? (
                    <>
                      {/* Full-width rows, no vertical guide line: the chat
                         highlight reads across the whole list width. */}
                      {/* Constant hairline gap under the project tile (user
                         request 2026-10-01): ~3px (nearest scale step, 4px)
                         between the tile's highlight and any highlight below,
                         selected first chat included — always, not only when
                         the first chat is selected. */}
                      <div className="mt-1" data-testid={testIdFor.projectChats(project.id)}>
                        {chats.length > 0 ? (
                          <ul className="flex flex-col gap-1">
                            {chats.map((chat) => {
                              const isChatSelected = chat.id === selectedChatId && isSelected
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

                              let resolvedStatus: SessionStatus = 'idle'
                              if (sessionStatuses?.[chat.id]) {
                                resolvedStatus = sessionStatuses[chat.id]
                              } else if (chat.status) {
                                resolvedStatus = chat.status
                              } else if (badgeVisible) {
                                resolvedStatus = 'waiting'
                              } else if (activity?.has(chat.id)) {
                                resolvedStatus = 'running'
                              }

                              const resolvedTask = sessionTasks?.[chat.id]

                              return (
                                <SessionRowItem
                                  key={chat.id}
                                  chat={chat}
                                  projectId={project.id}
                                  isChatSelected={isChatSelected}
                                  status={resolvedStatus}
                                  task={resolvedTask}
                                  revealedChatId={revealedChatId}
                                  setRevealedChatId={setRevealedChatId}
                                  onSelectChat={onSelectChat}
                                  onRequestCloseChat={onRequestCloseChat}
                                  legacyAttention={
                                    attentionState !== undefined
                                      ? { badgeVisible, badgeTitle }
                                      : undefined
                                  }
                                  legacyActivity={activity?.has(chat.id)}
                                />
                              )
                            })}
                          </ul>
                        ) : (
                          <p className="py-1.5 pl-9 pr-5 text-xs text-ink-muted">No chats</p>
                        )}
                      </div>
                    </>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>
      {/* Bottom-of-panel strip (user decision 2026-10-02, after Zed): the
          App Settings opener lives at the very bottom of the left panel,
          not in the window title bar. */}
      {children}
      {contextMenu?.projectId === null ? (
        <ProjectsContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onAddProject={() => {
            setContextMenu(null)
            onAddProject()
          }}
        />
      ) : contextMenu !== null ? (
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
      {newChatMenu !== null ? (
        <NewChatAgentMenu
          state={newChatMenu}
          loadProfiles={loadAgentProfiles}
          onCreateChat={onCreateAgentChat}
          onConfigureAgents={onConfigureAgents}
          onClose={() => setNewChatMenu(null)}
        />
      ) : null}
    </div>
  )
}

function ProjectsContextMenu({
  x,
  y,
  onClose,
  onAddProject,
}: {
  x: number
  y: number
  onClose: () => void
  onAddProject: () => void
}): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const actionRef = useRef<HTMLButtonElement>(null)
  const position = clampMenuPosition(x, y, { menuWidth: 160, menuHeight: 40 })

  useLayoutEffect(() => {
    const opener = document.activeElement
    actionRef.current?.focus()
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      const refined = clampMenuPosition(x, y, { menuWidth: rect.width, menuHeight: rect.height })
      menu.style.left = `${refined.left}px`
      menu.style.top = `${refined.top}px`
    }
  }, [x, y])

  return (
    <div
      role="menu"
      aria-label="Projects"
      className="fixed inset-0 z-40"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Tab') onClose()
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) event.preventDefault()
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div
        ref={menuRef}
        className="absolute min-w-40 rounded-md border border-edge bg-panel py-1 shadow-lg"
        style={position}
      >
        <button
          ref={actionRef}
          type="button"
          role="menuitem"
          className="w-full px-3 py-1.5 text-left text-xs text-ink-secondary hover:bg-highlight hover:text-ink"
          onClick={onAddProject}
        >
          Add Project
        </button>
      </div>
    </div>
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
  state: ContextMenuState & { projectId: string }
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

/**
 * Agent profile menu of one project's New Chat button (spec
 * new-chat-agent-menu). Rendered as a fixed overlay like the project-row menu:
 * an outside click, Escape, a further context-menu gesture, or activating an
 * item closes it. The profiles are read through the host's `loadProfiles`
 * (`agentProfiles:get`), so this component owns no domain data: while the list
 * loads it shows a non-actionable row, and a failed load shows the failure row
 * — neither creates a chat.
 */
function NewChatAgentMenu({
  state,
  loadProfiles,
  onCreateChat,
  onConfigureAgents,
  onClose,
}: {
  state: NewChatMenuState
  loadProfiles: (projectId: string) => Promise<AgentProfilesDocument>
  onCreateChat: (projectId: string, profileId: string) => Promise<boolean>
  onConfigureAgents: (projectId: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [profiles, setProfiles] = useState<AgentProfile[]>([])

  // The menu opens immediately; the list arrives through the host.
  useEffect(() => {
    let active = true
    void loadProfiles(state.projectId)
      .then((document) => {
        if (!active) {
          return
        }
        setProfiles(document.profiles)
        setPhase('ready')
      })
      .catch(() => {
        if (!active) {
          return
        }
        setPhase('error')
      })
    return () => {
      active = false
    }
  }, [loadProfiles, state.projectId])

  const itemClass =
    'w-full px-3 py-1.5 text-left text-xs text-ink-secondary hover:bg-highlight hover:text-ink'

  return (
    <div
      role="menu"
      aria-label="New chat with agent"
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
        data-testid={TEST_ID.newChatAgentMenu}
      >
        {phase === 'loading' ? (
          <p
            className="px-3 py-1.5 text-xs text-ink-muted"
            data-testid={TEST_ID.newChatAgentMenuLoading}
          >
            Loading…
          </p>
        ) : null}
        {phase === 'error' ? (
          <p
            className="px-3 py-1.5 text-xs text-ink-muted"
            data-testid={TEST_ID.newChatAgentMenuError}
          >
            Failed to load agent profiles.
          </p>
        ) : null}
        {phase === 'ready' && profiles.length === 0 ? (
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            data-testid={TEST_ID.newChatAgentConfigure}
            onClick={() => {
              // Closing first keeps one gesture to one outcome.
              onClose()
              onConfigureAgents(state.projectId)
            }}
          >
            Configure agents
          </button>
        ) : null}
        {phase === 'ready' && profiles.length > 0 ? (
          <>
            {profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                role="menuitem"
                className={itemClass}
                data-testid={testIdFor.newChatAgentProfile(profile.id)}
                onClick={() => {
                  // One gesture creates at most one chat: the menu is gone
                  // before the launch resolves, so it cannot fire twice.
                  onClose()
                  void onCreateChat(state.projectId, profile.id)
                }}
              >
                {profile.name}
              </button>
            ))}
            <div className="my-1 border-t border-edge" />
            <button
              type="button"
              role="menuitem"
              className={itemClass}
              data-testid={TEST_ID.newChatAgentConfigure}
              onClick={() => {
                onClose()
                onConfigureAgents(state.projectId)
              }}
            >
              Add profile…
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
