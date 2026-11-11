import type { ChatInfo, SessionStatus, SessionTaskProgress } from '@shared/ipc-contract'
import type React from 'react'
import { getAgentColor } from '../../lib/agent-colors'
import { contextLevel, describeContextTokens, formatContextTokens } from '../../lib/context-meter'
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
  /**
   * Context tokens in use, read from this chat's own agent transcript. Absent
   * when the transcript is unavailable (shell chats, other agents), which
   * hides the meter instead of showing a guess.
   */
  contextTokens?: number
  attentionMessage?: string | null
  attentionVisible: boolean
  recentOutput: boolean
  onSelect: () => void
  onClose?: () => void
  /** Opens the session menu; the parent view decides whether a tile has one. */
  onOpenContextMenu?: (x: number, y: number) => void
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
  contextTokens,
  attentionMessage,
  attentionVisible,
  recentOutput,
  onSelect,
  onClose,
  onOpenContextMenu,
}: SessionTileProps): React.JSX.Element {
  const config = SESSION_STATUS_CONFIG[status]
  const identity = chat.agentName ? `${label}, ${chat.agentName}` : label
  const accessibleName = `${identity}, ${projectName}, ${config.label}`
  const style = {
    '--session-status-color': config.color,
    '--project-color': projectColor,
    ...(chat.agentName ? { '--agent-color': getAgentColor(chat.agentName) } : {}),
  } as React.CSSProperties

  // TODO(NEKODE-160): ChatInfo has no real last-activity timestamp.
  // The time stays hidden until the session API supplies real telemetry.
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
        onContextMenu={
          onOpenContextMenu === undefined
            ? undefined
            : (event) => {
                event.preventDefault()
                event.stopPropagation()
                onOpenContextMenu(event.clientX, event.clientY)
              }
        }
        onKeyDown={
          onOpenContextMenu === undefined
            ? undefined
            : (event) => {
                if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) {
                  return
                }
                event.preventDefault()
                event.stopPropagation()
                const rect = event.currentTarget.getBoundingClientRect()
                onOpenContextMenu(rect.left, rect.bottom)
              }
        }
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
          {contextTokens !== undefined ? (
            <span
              role="img"
              className="nk-session-context"
              data-level={contextLevel(contextTokens)}
              data-testid={testIdFor.chatContext(chat.id)}
              title={`Context in use: ${describeContextTokens(contextTokens)}. Warning from 160,000, critical from 180,000.`}
              aria-label={`${identity}, context ${describeContextTokens(contextTokens)} in use`}
            >
              {formatContextTokens(contextTokens)}
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
