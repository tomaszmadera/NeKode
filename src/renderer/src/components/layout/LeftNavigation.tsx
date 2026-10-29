import type {
  AgentProfile,
  AgentProfilesDocument,
  AppApi,
  ChatInfo,
  SessionStatus,
  SessionTaskProgress,
} from '@shared/ipc-contract'
import { parseWslPath } from '@shared/wsl-path'
import type React from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { Icon } from '../../lib/icons'
import { clampMenuPosition } from '../../lib/menu-position'
import { getProjectColor, getProjectInitials } from '../../lib/project-avatar'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { useChatStore } from '../../stores/useChatStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { useSessionTasks } from '../../stores/useSessionTasks'
import { NoticeBanner } from './NoticeBanner'

export type SidebarView = 'projects' | 'sessions'

export interface LeftNavigationProps {
  projectNamesUppercase?: boolean
  showProjectIcons?: boolean
  sessionStatuses?: Record<string, SessionStatus>
  floating?: boolean
  attentionBadgeEnabled?: boolean
  attentionActiveIndicatorEnabled?: boolean
  onSelectProject: (projectId: string) => void
  onToggleProject: (projectId: string) => void
  onSelectChat: (projectId: string, chatId: string) => void
  onAddProject: () => void
  onRemoveProject: (projectId: string) => void
  onOpenProjectFiles: (projectId: string) => void
  onOpenProjectKanban?: (projectId: string) => void
  onOpenProjectSettings: (projectId: string) => void
  onCreateChat: (projectId: string) => Promise<boolean>
  onCreateAgentChat: (projectId: string, profileId: string) => Promise<boolean>
  loadAgentProfiles: (projectId: string) => Promise<AgentProfilesDocument>
  onConfigureAgents: (projectId: string) => void
  onOpenInFileExplorer: (projectId: string) => void
  onRequestCloseChat?: (chatId: string) => void
  onOpenAppSettings?: (options?: { scrollToUpdate?: boolean }) => void
  notice: string | null
  children?: React.ReactNode
  app?: AppApi
}

export const SESSION_CAPTION_CLASS = 'text-xs text-ink-muted'

type ContextMenuState = {
  x: number
  y: number
} & ({ projectId: string } | { projectId: null })

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

export function getAgentOrShell(chat: ChatInfo): string {
  if (chat.agentName) {
    return chat.agentName.toLowerCase()
  }
  const match = chat.name.match(/^\[([^\]]+)\]/)
  if (match) {
    return match[1].toLowerCase()
  }
  return 'pwsh'
}

export function getChatLabel(chat: ChatInfo): string {
  return chat.taskRef?.trim() || chat.name.replace(/^\[[^\]]+\](?:\s+|$)/, '').trim() || 'Terminal'
}

function resolveChatStatus(
  chat: ChatInfo,
  sessionStatuses: Record<string, SessionStatus> | undefined,
  _attention: Record<string, { message: string | null }>,
  _activity: ReadonlySet<string> | undefined,
  badgeVisible: boolean,
  task?: SessionTaskProgress,
): SessionStatus {
  if (badgeVisible) {
    return 'waiting'
  }
  if (sessionStatuses?.[chat.id]) {
    return sessionStatuses[chat.id]
  }
  if (chat.status) {
    return chat.status
  }
  if (task !== undefined && !task.stale) {
    return 'running'
  }
  return 'idle'
}

export function LeftNavigation({
  projectNamesUppercase = true,
  showProjectIcons = true,
  sessionStatuses,
  floating = true,
  attentionBadgeEnabled = true,
  attentionActiveIndicatorEnabled = true,
  onSelectProject,
  onToggleProject,
  onSelectChat,
  onAddProject,
  onRemoveProject,
  onOpenProjectFiles,
  onOpenProjectSettings,
  onCreateChat,
  onCreateAgentChat,
  loadAgentProfiles,
  onConfigureAgents,
  onOpenInFileExplorer,
  onRequestCloseChat,
  onOpenAppSettings,
  notice,
  children,
  app: _app,
}: LeftNavigationProps): React.JSX.Element {
  const { projects, projectColors, expandedProjectIds, selectedProjectId } = useProjectStore(
    useShallow((state) => ({
      projects: state.projects,
      projectColors: state.projectColors,
      expandedProjectIds: state.expandedProjectIds,
      selectedProjectId: state.selectedProjectId,
    })),
  )
  const { chatsByProject, selectedChatId, attention, activity } = useChatStore(
    useShallow((state) => ({
      chatsByProject: state.chatsByProject,
      selectedChatId: state.selectedChatId,
      attention: state.chatAttention,
      activity: state.chatActivity,
    })),
  )
  const sessionTasks = useSessionTasks()
  const [sidebarView, setSidebarView] = useState<SidebarView>('projects')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [newChatMenu, setNewChatMenu] = useState<NewChatMenuState | null>(null)
  const [revealedChatId, setRevealedChatId] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const statusTimestampsRef = useRef<Record<string, { status: SessionStatus; timestamp: number }>>(
    {},
  )

  function getSessionTime(chatId: string, status: SessionStatus): string {
    const record = statusTimestampsRef.current[chatId]
    if (!record || record.status !== status) {
      statusTimestampsRef.current[chatId] = { status, timestamp: now }
      return 'now'
    }
    const elapsedSeconds = Math.max(0, Math.floor((now - record.timestamp) / 1000))
    return formatTimeSince(elapsedSeconds)
  }

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 10_000)
    return () => clearInterval(timer)
  }, [])

  // Escape closes any open menu
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
    setNewChatMenu(null)
    setContextMenu({ projectId, x, y })
  }

  function openNewChatMenu(projectId: string, x: number, y: number): void {
    setContextMenu(null)
    setNewChatMenu({ projectId, x, y })
  }

  const totalSessionCount = useMemo(() => {
    let count = 0
    for (const project of projects) {
      count += (chatsByProject[project.id] ?? []).length
    }
    return count
  }, [projects, chatsByProject])

  // Flat list of sessions from all projects for the Sessions view
  const allSessions = useMemo(() => {
    const list: Array<{
      project: (typeof projects)[number]
      chat: ChatInfo
      status: SessionStatus
      task?: SessionTaskProgress
      label: string
      agentOrShell: string
      projectColor: string
      initials: string
      folderName: string
      isChatSelected: boolean
    }> = []

    for (const project of projects) {
      const chats = chatsByProject[project.id] ?? []
      const projectColor = getProjectColor(project, projectColors?.[project.id])
      const initials = getProjectInitials(project.name)
      const folderName =
        project.path.replace(/\\/g, '/').split('/').filter(Boolean).pop() || project.name

      for (const chat of chats) {
        const isChatSelected = chat.id === selectedChatId && project.id === selectedProjectId
        const attentionState = attention[chat.id]
        const badgeVisible =
          attentionState !== undefined &&
          (isChatSelected ? attentionActiveIndicatorEnabled : attentionBadgeEnabled)

        const task = sessionTasks?.[chat.id]
        const status = resolveChatStatus(
          chat,
          sessionStatuses,
          attention,
          activity,
          badgeVisible,
          task,
        )
        const label = getChatLabel(chat)
        const agentOrShell = getAgentOrShell(chat)

        list.push({
          project,
          chat,
          status,
          task,
          label,
          agentOrShell,
          projectColor,
          initials,
          folderName,
          isChatSelected,
        })
      }
    }

    return list
  }, [
    projects,
    chatsByProject,
    projectColors,
    selectedChatId,
    selectedProjectId,
    attention,
    activity,
    attentionActiveIndicatorEnabled,
    attentionBadgeEnabled,
    sessionStatuses,
    sessionTasks,
  ])

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-panel">
      <NoticeBanner notice={notice} />

      {/* Header (spec §3): Segmented control on left, Add project on right */}
      <div
        className="flex shrink-0 items-center justify-between"
        style={{ padding: '16px 14px 8px 20px' }}
      >
        {/* biome-ignore lint/a11y/useSemanticElements: spec §3.1 requires role="group" and aria-label="Sidebar view" */}
        <div
          role="group"
          aria-label="Sidebar view"
          style={{
            display: 'flex',
            gap: 2,
            padding: 2,
            borderRadius: floating ? 8 : 0,
            border: '1px solid var(--color-edge)',
            backgroundColor: 'var(--color-dialog)',
          }}
        >
          <button
            type="button"
            aria-pressed={sidebarView === 'projects'}
            onClick={() => setSidebarView('projects')}
            data-testid={TEST_ID.projectsHeader}
            style={{
              height: 26,
              padding: '0 10px',
              gap: 6,
              border: 0,
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              backgroundColor: sidebarView === 'projects' ? 'var(--color-selected)' : 'transparent',
              color: sidebarView === 'projects' ? '#ffffff' : 'var(--color-ink-muted)',
              cursor: 'pointer',
            }}
          >
            Projects
          </button>
          <button
            type="button"
            aria-pressed={sidebarView === 'sessions'}
            onClick={() => setSidebarView('sessions')}
            style={{
              height: 26,
              padding: '0 10px',
              gap: 6,
              border: 0,
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              backgroundColor: sidebarView === 'sessions' ? 'var(--color-selected)' : 'transparent',
              color: sidebarView === 'sessions' ? '#ffffff' : 'var(--color-ink-muted)',
              cursor: 'pointer',
            }}
          >
            <span>Sessions</span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                fontWeight: 500,
                color: 'var(--color-ink-disabled)',
              }}
            >
              {totalSessionCount}
            </span>
          </button>
        </div>

        {sidebarView === 'projects' ? (
          <button
            type="button"
            className="nk-add-project nk-icon-btn flex size-8 shrink-0 items-center justify-center bg-transparent transition-colors duration-fast ease-standard"
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: '1px solid var(--color-edge)',
              color: 'var(--color-ink-secondary)',
            }}
            data-testid={TEST_ID.addProjectButton}
            aria-label="Add Project"
            title="Add Project"
            onClick={onAddProject}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        ) : null}
      </div>

      {/* Scrollable list (spec §4 & §5) */}
      <section
        aria-label="Projects"
        tabIndex={-1}
        data-testid={TEST_ID.projectListArea}
        className="min-h-0 flex-1 overflow-y-auto"
        onContextMenu={(event) => {
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
        {sidebarView === 'projects' ? (
          /* Projects view (spec §4) */
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: '4px 10px 12px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: 0,
            }}
            data-testid={TEST_ID.projectList}
          >
            {projects.length === 0 ? (
              <p
                style={{ padding: '4px 12px', fontSize: 12, color: 'var(--color-ink-disabled)' }}
                data-testid={TEST_ID.emptyProjectList}
              >
                No projects yet. Add a project to start working.
              </p>
            ) : (
              projects.map((project) => {
                const isExpanded = expandedProjectIds.has(project.id)
                const isSelected = project.id === selectedProjectId
                const chats = chatsByProject[project.id] ?? []
                const projectColor = getProjectColor(project, projectColors?.[project.id])
                const initials = getProjectInitials(project.name)
                const wslLocation = parseWslPath(project.path)

                let runningCount = 0
                let waitingCount = 0
                for (const chat of chats) {
                  const attentionState = attention[chat.id]
                  const isChatSelected = chat.id === selectedChatId && isSelected
                  const badgeVisible =
                    attentionState !== undefined &&
                    (isChatSelected ? attentionActiveIndicatorEnabled : attentionBadgeEnabled)
                  const task = sessionTasks?.[chat.id]
                  const st = resolveChatStatus(
                    chat,
                    sessionStatuses,
                    attention,
                    activity,
                    badgeVisible,
                    task,
                  )
                  if (st === 'running') runningCount++
                  if (st === 'waiting') waitingCount++
                }

                return (
                  <li key={project.id} style={{ listStyle: 'none' }}>
                    <section style={{ padding: isExpanded ? '0 0 10px 0' : 0 }}>
                      {/* Project row: 34px, rounded (8px) inset tint when active */}
                      {/* biome-ignore lint/a11y/noStaticElementInteractions: project row wrapper handles context menu and shortcut gestures */}
                      <div
                        className={`nk-project-row ${isSelected ? 'bg-selected' : ''}`}
                        data-testid={testIdFor.projectRow(project.id)}
                        data-selected={isSelected ? 'true' : 'false'}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          openContextMenu(project.id, event.clientX, event.clientY)
                        }}
                        onKeyDown={(event) => {
                          if (
                            event.key === 'ContextMenu' ||
                            (event.key === 'F10' && event.shiftKey)
                          ) {
                            event.preventDefault()
                            event.stopPropagation()
                            const rect = event.currentTarget.getBoundingClientRect()
                            openContextMenu(project.id, rect.left, rect.bottom)
                          }
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          minHeight: 34,
                          height: 34,
                          borderRadius: floating ? 8 : 0,
                          backgroundColor: isSelected
                            ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)'
                            : 'transparent',
                        }}
                      >
                        {/* Toggle button fills the row */}
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          aria-label={
                            isExpanded ? `Collapse ${project.name}` : `Expand ${project.name}`
                          }
                          onClick={() => onToggleProject(project.id)}
                          data-testid={testIdFor.projectToggle(project.id)}
                          style={{
                            flex: '1 1 0%',
                            minWidth: 0,
                            minHeight: 34,
                            height: 34,
                            padding: '0 4px 0 6px',
                            gap: 8,
                            border: 0,
                            borderRadius: 8,
                            background: 'transparent',
                            display: 'flex',
                            alignItems: 'center',
                            textAlign: 'left',
                            color: 'var(--color-ink-secondary)',
                            cursor: 'pointer',
                          }}
                        >
                          {/* 1. Chevron */}
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="var(--color-ink-muted)"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{
                              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                              transition: 'transform .15s',
                              flexShrink: 0,
                            }}
                            aria-hidden="true"
                          >
                            <path d="M9 6l6 6-6 6" />
                          </svg>

                          {/* 2. Avatar */}
                          {showProjectIcons ? (
                            <span
                              aria-hidden="true"
                              data-testid={testIdFor.projectAvatar(project.id)}
                              style={{
                                width: 22,
                                height: 22,
                                minWidth: 22,
                                borderRadius: floating ? 6 : 0,
                                fontFamily: 'var(--font-mono)',
                                fontSize: 10,
                                fontWeight: 700,
                                color: projectColor,
                                backgroundColor: `color-mix(in srgb, ${projectColor} 18%, transparent)`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                                userSelect: 'none',
                              }}
                            >
                              {initials}
                            </span>
                          ) : null}

                          {/* 3. Name */}
                          {/* biome-ignore lint/a11y/noStaticElementInteractions: inner name element handles project selection click */}
                          {/* biome-ignore lint/a11y/useKeyWithClickEvents: outer toggle button handles keyboard events */}
                          <span
                            data-testid={testIdFor.projectSelect(project.id)}
                            onClick={(e) => {
                              e.stopPropagation()
                              onSelectProject(project.id)
                            }}
                            className={
                              isExpanded || isSelected
                                ? 'text-project-title'
                                : 'text-project-title-collapsed hover:text-project-title transition-colors'
                            }
                            style={{
                              flex: '1 1 0%',
                              minWidth: 0,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              fontFamily: 'var(--font-mono)',
                              fontSize: 13,
                              fontWeight: isExpanded || isSelected ? 700 : 500,
                              color:
                                isExpanded || isSelected
                                  ? 'var(--color-ink)'
                                  : 'var(--color-ink-secondary)',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                            }}
                          >
                            <span
                              className={`truncate ${isExpanded || isSelected ? 'font-semibold' : 'font-normal'}`}
                            >
                              {projectNamesUppercase ? project.name.toUpperCase() : project.name}
                            </span>
                            {wslLocation !== null ? (
                              <span
                                style={{
                                  borderRadius: 4,
                                  border: '1px solid var(--color-edge)',
                                  backgroundColor: 'var(--color-highlight)',
                                  padding: '2px 4px',
                                  marginLeft: 6,
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: 10,
                                  lineHeight: 1,
                                  color: 'var(--color-ink-muted)',
                                  flexShrink: 0,
                                }}
                                title={`WSL: ${wslLocation.distribution}`}
                              >
                                WSL
                              </span>
                            ) : null}
                          </span>

                          {/* 5. Status badges (collapsed only) */}
                          {!isExpanded && (runningCount > 0 || waitingCount > 0) ? (
                            <span
                              style={{
                                display: 'flex',
                                gap: 8,
                                fontFamily: 'var(--font-mono)',
                                fontSize: 11,
                                flexShrink: 0,
                              }}
                            >
                              {runningCount > 0 ? (
                                <span style={{ color: 'var(--color-success)' }}>
                                  ● {runningCount}
                                </span>
                              ) : null}
                              {waitingCount > 0 ? (
                                <span style={{ color: 'var(--color-warning)' }}>
                                  ● {waitingCount}
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                        </button>

                        {/* Row action 1: New session */}
                        <button
                          type="button"
                          aria-label={`New session in ${project.name}`}
                          title="New session"
                          onClick={() => void onCreateChat(project.id)}
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
                          data-testid={TEST_ID.newChatButton}
                          className="nk-project-row-action nk-icon-btn flex size-8 shrink-0 items-center justify-center rounded-lg bg-transparent text-ink-muted transition-colors duration-fast ease-standard"
                          style={{
                            width: 32,
                            height: 32,
                            minWidth: 32,
                            flex: 'none',
                            border: 0,
                            borderRadius: 8,
                          }}
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                            <path d="M12 7v6M9 10h6" />
                          </svg>
                        </button>

                        {/* Row action 2: File tree */}
                        <button
                          type="button"
                          aria-label={`Open file tree of ${project.name}`}
                          title="File tree"
                          onClick={(event) => {
                            event.stopPropagation()
                            onOpenProjectFiles(project.id)
                          }}
                          data-testid={testIdFor.projectFiles(project.id)}
                          className="nk-project-row-action nk-icon-btn flex size-8 shrink-0 items-center justify-center rounded-lg bg-transparent text-ink-muted transition-colors duration-fast ease-standard"
                          style={{
                            width: 32,
                            height: 32,
                            minWidth: 32,
                            flex: 'none',
                            border: 0,
                            borderRadius: 8,
                          }}
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M5 12h14M13 6l6 6-6 6" />
                          </svg>
                        </button>
                      </div>

                      {/* Expanded content */}
                      {isExpanded ? (
                        <div>
                          {/* Recent sessions label */}
                          {chats.length > 0 ? (
                            <div
                              style={{
                                margin: '8px 0 2px 0',
                                paddingLeft: 28,
                                fontSize: 11,
                                fontWeight: 600,
                                letterSpacing: '0.08em',
                                textTransform: 'uppercase',
                                color: 'var(--color-ink-muted)',
                              }}
                            >
                              Recent sessions
                            </div>
                          ) : null}

                          {/* Session cards container */}
                          <div
                            data-testid={testIdFor.projectChats(project.id)}
                            style={{
                              padding: '2px 0 0 28px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                            }}
                          >
                            {chats.length === 0 ? (
                              <div
                                className={SESSION_CAPTION_CLASS}
                                style={{
                                  fontSize: 12,
                                  color: 'var(--color-ink-disabled)',
                                  padding: '4px 12px',
                                }}
                              >
                                No active sessions
                              </div>
                            ) : (
                              <>
                                <ul
                                  style={{
                                    listStyle: 'none',
                                    margin: 0,
                                    padding: 0,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 6,
                                  }}
                                >
                                  {chats.map((chat) => {
                                    const isChatSelected = chat.id === selectedChatId && isSelected
                                    const attentionState = attention[chat.id]
                                    const badgeVisible =
                                      attentionState !== undefined &&
                                      (isChatSelected
                                        ? attentionActiveIndicatorEnabled
                                        : attentionBadgeEnabled)

                                    const task = sessionTasks?.[chat.id]
                                    const status = resolveChatStatus(
                                      chat,
                                      sessionStatuses,
                                      attention,
                                      activity,
                                      badgeVisible,
                                      task,
                                    )
                                    const label = getChatLabel(chat)
                                    const agentOrShell = getAgentOrShell(chat)
                                    const config = SESSION_STATUS_CONFIG[status]
                                    const timeFormatted = getSessionTime(chat.id, status)
                                    const accessibleName = chat.agentName
                                      ? `${label}, ${chat.agentName}`
                                      : label
                                    const isRevealed = revealedChatId === chat.id

                                    return (
                                      <li
                                        key={chat.id}
                                        className="relative"
                                        style={{ listStyle: 'none' }}
                                        onMouseEnter={() => setRevealedChatId(chat.id)}
                                        onMouseLeave={() => {
                                          if (revealedChatId === chat.id) {
                                            setRevealedChatId(null)
                                          }
                                        }}
                                        onFocus={(event) => {
                                          if (event.currentTarget.contains(event.target)) {
                                            setRevealedChatId(chat.id)
                                          }
                                        }}
                                        onBlur={(event) => {
                                          if (
                                            !event.currentTarget.contains(
                                              event.relatedTarget as Node | null,
                                            )
                                          ) {
                                            if (revealedChatId === chat.id) {
                                              setRevealedChatId(null)
                                            }
                                          }
                                        }}
                                      >
                                        <button
                                          type="button"
                                          aria-current={isChatSelected ? 'true' : 'false'}
                                          onClick={() => onSelectChat(project.id, chat.id)}
                                          data-testid={testIdFor.chatRow(chat.id)}
                                          data-selected={isChatSelected ? 'true' : 'false'}
                                          title={`${accessibleName}: ${config.label}`}
                                          aria-label={`${accessibleName}, ${config.label}, ${timeFormatted}`}
                                          className="nk-session-card"
                                          style={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: 4,
                                            width: '100%',
                                            boxSizing: 'border-box',
                                            padding: '8px 10px 8px 12px',
                                            borderRadius: 8,
                                            textAlign: 'left',
                                            border: isChatSelected
                                              ? '1px solid var(--color-accent)'
                                              : '1px solid var(--color-edge)',
                                            backgroundColor: isChatSelected
                                              ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)'
                                              : 'var(--color-group)',
                                            cursor: 'pointer',
                                          }}
                                        >
                                          {/* Line 1 */}
                                          <div
                                            style={{
                                              display: 'flex',
                                              alignItems: 'center',
                                              gap: 8,
                                              width: '100%',
                                            }}
                                          >
                                            <span
                                              aria-hidden="true"
                                              data-testid={testIdFor.chatStatusDot(chat.id)}
                                              data-status={status}
                                              style={{
                                                width: 8,
                                                height: 8,
                                                minWidth: 8,
                                                borderRadius: '50%',
                                                backgroundColor: config.color,
                                                boxShadow: `0 0 6px ${config.color}99`,
                                                flexShrink: 0,
                                              }}
                                            />
                                            <span
                                              className="truncate"
                                              style={{
                                                minWidth: 0,
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                                fontSize: 13,
                                                fontWeight: isChatSelected ? 600 : 500,
                                                color: isChatSelected
                                                  ? '#ffffff'
                                                  : 'var(--color-ink)',
                                              }}
                                            >
                                              {label}
                                            </span>
                                            <span style={{ flex: 1 }} />
                                            <span
                                              data-testid={testIdFor.chatTime(chat.id)}
                                              className={isRevealed ? 'invisible' : ''}
                                              style={{
                                                fontSize: 11,
                                                color: 'var(--color-ink-muted)',
                                                flexShrink: 0,
                                                whiteSpace: 'nowrap',
                                              }}
                                            >
                                              {timeFormatted}
                                            </span>
                                          </div>

                                          {/* Line 2 */}
                                          <div
                                            style={{
                                              display: 'flex',
                                              alignItems: 'center',
                                              gap: 8,
                                              paddingLeft: 16,
                                              fontFamily: 'var(--font-mono)',
                                              fontSize: 11,
                                              color: 'var(--color-ink-muted)',
                                            }}
                                          >
                                            <span className="lowercase">
                                              {chat.agentName ?? agentOrShell}
                                            </span>
                                            {task !== undefined ? (
                                              <span
                                                role="img"
                                                data-testid={testIdFor.chatTaskProgress(chat.id)}
                                                title={`${task.stale ? `Out of date: ${task.staleReason}. ` : ''}Task ${task.taskId}: step ${task.step} of ${task.totalSteps}`}
                                                aria-label={task.ariaLabel}
                                                className="font-mono rounded-[3px] px-1.5 py-0.5 leading-none"
                                                style={{
                                                  color: '#5AA9FF',
                                                  backgroundColor: 'rgba(90, 169, 255, 0.12)',
                                                  opacity: task.stale ? 0.5 : undefined,
                                                }}
                                              >
                                                {task.step}/{task.totalSteps}
                                              </span>
                                            ) : null}
                                          </div>

                                          {/* Screen reader indicators */}
                                          {badgeVisible && !isRevealed ? (
                                            <span
                                              role="img"
                                              className="sr-only"
                                              data-testid={testIdFor.chatAttentionBadge(chat.id)}
                                              title={attentionState?.message ?? 'Needs attention'}
                                              aria-label={`${accessibleName} needs attention`}
                                            />
                                          ) : null}
                                          {activity?.has(chat.id) &&
                                          !badgeVisible &&
                                          !isRevealed ? (
                                            <span
                                              className="sr-only"
                                              data-testid={testIdFor.chatActivity(chat.id)}
                                              role="img"
                                              aria-label={`${accessibleName}: recent terminal output`}
                                              title="Recent terminal output. This is not agent status; silence does not mean completion."
                                            />
                                          ) : null}
                                        </button>

                                        {/* Close chat button */}
                                        {onRequestCloseChat ? (
                                          <button
                                            type="button"
                                            className={`nk-chat-close absolute right-2.5 top-2.5 z-10 size-5 items-center justify-center rounded bg-transparent text-ink-muted transition-colors hover:text-ink ${
                                              isRevealed ? 'flex' : 'hidden'
                                            }`}
                                            data-testid={testIdFor.chatClose(chat.id)}
                                            aria-label={`Close chat ${accessibleName}`}
                                            onClick={(event) => {
                                              event.stopPropagation()
                                              onRequestCloseChat(chat.id)
                                            }}
                                          >
                                            <Icon.close size={12} aria-hidden strokeWidth={1.8} />
                                          </button>
                                        ) : null}
                                      </li>
                                    )
                                  })}
                                </ul>

                                {/* "New session" action button */}
                                <button
                                  type="button"
                                  aria-label={`New session in ${project.name}`}
                                  onClick={() => void onCreateChat(project.id)}
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
                                  className="nk-new-session-action nk-icon-btn"
                                  style={{
                                    alignSelf: 'flex-start',
                                    height: 32,
                                    padding: '0 12px',
                                    gap: 8,
                                    border: 0,
                                    borderRadius: 8,
                                    background: 'transparent',
                                    fontSize: 13,
                                    fontWeight: 500,
                                    color: 'var(--color-accent)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    cursor: 'pointer',
                                  }}
                                >
                                  <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.2"
                                    strokeLinecap="round"
                                    aria-hidden="true"
                                  >
                                    <path d="M12 5v14M5 12h14" />
                                  </svg>
                                  <span>New session</span>
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </section>
                  </li>
                )
              })
            )}
          </ul>
        ) : (
          /* Sessions view (spec §5): flat list sorted by status */
          <div
            style={{
              padding: '4px 10px 12px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            {allSessions.length === 0 ? (
              <p style={{ padding: '4px 12px', fontSize: 12, color: 'var(--color-ink-disabled)' }}>
                No active sessions
              </p>
            ) : (
              allSessions.map((item) => {
                const timeFormatted = getSessionTime(item.chat.id, item.status)
                const statusConfig = SESSION_STATUS_CONFIG[item.status]

                return (
                  <button
                    key={`${item.project.id}:${item.chat.id}`}
                    type="button"
                    aria-current={item.isChatSelected ? 'true' : 'false'}
                    onClick={() => onSelectChat(item.project.id, item.chat.id)}
                    data-testid={testIdFor.chatRow(item.chat.id)}
                    className="nk-flat-session-row"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 3,
                      padding: '7px 12px 6px 12px',
                      border: item.isChatSelected
                        ? '1px solid var(--color-accent)'
                        : '1px solid transparent',
                      borderRadius: floating ? 8 : 0,
                      textAlign: 'left',
                      backgroundColor: item.isChatSelected
                        ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)'
                        : 'transparent',
                      width: '100%',
                      boxSizing: 'border-box',
                      cursor: 'pointer',
                    }}
                  >
                    {/* Line 1 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                      <span
                        style={{
                          position: 'relative',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            width: 18,
                            height: 18,
                            minWidth: 18,
                            borderRadius: floating ? 5 : 0,
                            fontFamily: 'var(--font-mono)',
                            fontSize: 9,
                            fontWeight: 700,
                            color: item.projectColor,
                            backgroundColor: `color-mix(in srgb, ${item.projectColor} 18%, transparent)`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {item.initials}
                        </span>
                        <span
                          aria-hidden="true"
                          data-testid={testIdFor.chatStatusDot(item.chat.id)}
                          data-status={item.status}
                          style={{
                            position: 'absolute',
                            bottom: -2,
                            right: -2,
                            width: 7,
                            height: 7,
                            minWidth: 7,
                            borderRadius: '50%',
                            backgroundColor: statusConfig.color,
                            boxShadow: `0 0 0 1.5px var(--color-panel), 0 0 4px ${statusConfig.color}99`,
                          }}
                        />
                      </span>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 12,
                          color: item.isChatSelected ? '#ffffff' : 'var(--color-ink-secondary)',
                          fontWeight: item.isChatSelected ? 600 : 400,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.label}
                      </span>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11,
                          color: 'var(--color-ink-disabled)',
                          flexShrink: 0,
                        }}
                      >
                        {item.agentOrShell}
                      </span>
                      <span style={{ flex: 1 }} />
                      {item.task ? (
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 11,
                            color: 'var(--color-info)',
                            flexShrink: 0,
                          }}
                        >
                          {item.task.step}/{item.task.totalSteps}
                        </span>
                      ) : null}
                      <span
                        style={{
                          fontSize: 11,
                          color: 'var(--color-ink-muted)',
                          flexShrink: 0,
                        }}
                      >
                        {timeFormatted}
                      </span>
                    </div>

                    {/* Line 2 */}
                    <div
                      style={{
                        paddingLeft: 26,
                        display: 'flex',
                        alignItems: 'center',
                        width: '100%',
                      }}
                    >
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11,
                          color: item.projectColor,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.folderName}
                      </span>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        )}
      </section>

      {/* Footer (spec §6) */}
      {children ? (
        children
      ) : (
        <div style={{ padding: '8px 10px', borderTop: '1px solid var(--color-edge)' }}>
          <button
            type="button"
            className="nk-app-settings nk-icon-btn"
            aria-label="App Settings"
            title="App Settings"
            data-testid={TEST_ID.appSettingsButton}
            onClick={() => onOpenAppSettings?.()}
            style={{
              height: 44,
              width: '100%',
              padding: '0 12px',
              gap: 10,
              border: 0,
              borderRadius: 8,
              background: 'transparent',
              fontSize: 13,
              color: 'var(--color-ink-muted)',
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
            }}
          >
            <Icon.settings size={16} aria-hidden strokeWidth={1.8} />
            <span>App settings</span>
          </button>
        </div>
      )}

      {/* Context Menus */}
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

  return createPortal(
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
          className="block w-full px-3 py-1.5 text-left text-xs text-ink-secondary hover:bg-highlight hover:text-ink whitespace-nowrap"
          onClick={onAddProject}
        >
          Add Project
        </button>
      </div>
    </div>,
    document.body,
  )
}

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
  const menuRef = useRef<HTMLDivElement>(null)
  const position = clampMenuPosition(state.x, state.y, { menuWidth: 160, menuHeight: 120 })

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      const refined = clampMenuPosition(state.x, state.y, {
        menuWidth: rect.width,
        menuHeight: rect.height,
      })
      menu.style.left = `${refined.left}px`
      menu.style.top = `${refined.top}px`
    }
  }, [state.x, state.y])

  return createPortal(
    <div
      role="menu"
      aria-label={`Project ${projectName}`}
      className="fixed inset-0 z-40"
      onClick={(event) => {
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
        ref={menuRef}
        className="absolute min-w-40 rounded-md border border-edge bg-panel py-1 shadow-lg"
        style={position}
        data-testid={TEST_ID.projectContextMenu}
      >
        <button
          type="button"
          role="menuitem"
          className="block w-full px-3 py-1.5 text-left text-xs text-ink-secondary hover:bg-highlight hover:text-ink whitespace-nowrap"
          onClick={() => onOpenProjectSettings(state.projectId)}
        >
          Project Settings
        </button>
        <button
          type="button"
          role="menuitem"
          className="block w-full px-3 py-1.5 text-left text-xs text-ink-secondary hover:bg-highlight hover:text-ink whitespace-nowrap"
          onClick={() => onOpenInFileExplorer(state.projectId)}
        >
          Open in file explorer
        </button>
        <button
          type="button"
          role="menuitem"
          className="block w-full px-3 py-1.5 text-left text-xs text-error hover:bg-error/10 whitespace-nowrap"
          data-testid={testIdFor.removeProject(state.projectId)}
          aria-label={`Remove Project ${projectName}`}
          onClick={() => onRemoveProject(state.projectId)}
        >
          Remove Project
        </button>
      </div>
    </div>,
    document.body,
  )
}

export function NewChatAgentMenu({
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
  const menuRef = useRef<HTMLDivElement>(null)
  const position = clampMenuPosition(state.x, state.y, { menuWidth: 180, menuHeight: 160 })

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

  useLayoutEffect(() => {
    void phase
    void profiles.length
    const menu = menuRef.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      const refined = clampMenuPosition(state.x, state.y, {
        menuWidth: rect.width,
        menuHeight: rect.height,
      })
      menu.style.left = `${refined.left}px`
      menu.style.top = `${refined.top}px`
    }
  }, [state.x, state.y, phase, profiles.length])

  const itemClass =
    'block w-full px-3 py-1.5 text-left text-xs text-ink-secondary hover:bg-highlight hover:text-ink whitespace-nowrap'

  return createPortal(
    <div
      role="menu"
      aria-label="New chat with agent"
      className="no-drag fixed inset-0 z-40"
      onClick={(event) => {
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
        ref={menuRef}
        className="absolute min-w-40 rounded-md border border-edge bg-panel py-1 shadow-lg"
        style={position}
        data-testid={TEST_ID.newChatAgentMenu}
      >
        {phase === 'loading' ? (
          <p
            className="px-3 py-1.5 text-xs text-ink-muted whitespace-nowrap"
            data-testid={TEST_ID.newChatAgentMenuLoading}
          >
            Loading…
          </p>
        ) : null}
        {phase === 'error' ? (
          <p
            className="px-3 py-1.5 text-xs text-ink-muted whitespace-nowrap"
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
    </div>,
    document.body,
  )
}
