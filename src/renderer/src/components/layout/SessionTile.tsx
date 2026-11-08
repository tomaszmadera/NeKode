import type { ChatInfo, SessionStatus, SessionTaskProgress } from '@shared/ipc-contract'
import type React from 'react'
import { getAgentColor } from '../../lib/agent-colors'
import { Icon } from '../../lib/icons'
import { testIdFor } from '../../lib/test-ids'

export const SESSION_STATUS_CONFIG: Record<SessionStatus, { label: string; color: string }> = {
  running: { label: 'running', color: 'var(--color-success)' },
  waiting: { label: 'waiting for input', color: 'var(--color-warning)' },
  idle: { label: 'idle', color: 'var(--color-ink-muted)' },
}

interface SessionTileProps {
  chat: ChatInfo
  label: string
  projectName: string
  folderName: string
  projectColor: string
  initials: string
  status: SessionStatus
  active: boolean
  flat?: boolean
  task?: SessionTaskProgress
  attentionMessage?: string | null
  attentionVisible: boolean
  recentOutput: boolean
  onSelect: () => void
  onClose?: () => void
}

export function SessionTile({
  chat,
  label,
  projectName,
  folderName,
  projectColor,
  initials,
  status,
  active,
  flat = false,
  task,
  attentionMessage,
  attentionVisible,
  recentOutput,
  onSelect,
  onClose,
}: SessionTileProps): React.JSX.Element {
  const config = SESSION_STATUS_CONFIG[status]
  const identity = chat.agentName ? `${label}, ${chat.agentName}` : label
  const accessibleName = `${identity}, ${projectName}, ${config.label}`
  const style = {
    '--session-status-color': config.color,
    '--project-color': projectColor,
    ...(chat.agentName ? { '--agent-color': getAgentColor(chat.agentName) } : {}),
  } as React.CSSProperties

  // TODO(NEKODE-160): ChatInfo has no token usage or last-activity timestamp.
  // Hide context and time until the session API supplies real telemetry.
  return (
    <div className="nk-session-wrapper" style={style}>
      <button
        type="button"
        aria-current={active ? 'true' : 'false'}
        aria-label={accessibleName}
        title={accessibleName}
        data-testid={testIdFor.chatRow(chat.id)}
        data-selected={active ? 'true' : 'false'}
        className="nk-session-tile"
        onClick={onSelect}
      >
        <span className="nk-session-line">
          <span className="nk-session-leading" aria-hidden="true">
            {flat ? <span className="nk-session-avatar">{initials}</span> : null}
            <span
              className={flat ? 'nk-session-status nk-session-status-badge' : 'nk-session-status'}
              data-testid={testIdFor.chatStatusDot(chat.id)}
              data-status={status}
            />
          </span>
          <span className="nk-session-name">{label}</span>
          {chat.agentName ? (
            <span className="nk-agent-badge">{chat.agentName.toLowerCase()}</span>
          ) : (
            <span className="nk-session-shell">pwsh</span>
          )}
          <span className="nk-session-spacer" />
          {task !== undefined ? (
            <span
              role="img"
              data-testid={testIdFor.chatTaskProgress(chat.id)}
              title={`${task.stale ? `Out of date: ${task.staleReason}. ` : ''}Task ${task.taskId}: step ${task.step} of ${task.totalSteps}`}
              aria-label={task.ariaLabel}
              className="nk-session-progress"
              style={{ opacity: task.stale ? 0.5 : undefined }}
            >
              {task.step}/{task.totalSteps}
            </span>
          ) : null}
        </span>
        {flat ? (
          <span className="nk-session-line nk-session-meta">
            <span className="nk-session-folder">{folderName}</span>
          </span>
        ) : null}
        {attentionVisible ? (
          <span
            role="img"
            className="sr-only"
            data-testid={testIdFor.chatAttentionBadge(chat.id)}
            title={attentionMessage ?? 'Needs attention'}
            aria-label={`${identity} needs attention`}
          />
        ) : null}
        {recentOutput && !attentionVisible ? (
          <span
            role="img"
            className="sr-only"
            data-testid={testIdFor.chatActivity(chat.id)}
            aria-label={`${identity}: recent terminal output`}
            title="Recent terminal output. This is not agent status; silence does not mean completion."
          />
        ) : null}
      </button>
      {onClose ? (
        <button
          type="button"
          className="nk-chat-close nk-icon-btn"
          data-testid={testIdFor.chatClose(chat.id)}
          aria-label={`Close chat ${identity}`}
          onClick={onClose}
        >
          <Icon.close size={12} aria-hidden strokeWidth={1.8} />
        </button>
      ) : null}
    </div>
  )
}
