import type { ActionControl, ActionExecution } from '@shared/ipc-contract'
import type React from 'react'
import { cn } from '../../lib/cn'
import { actionIconGlyph, Icon, type LucideIcon } from '../../lib/icons'

/**
 * Status glyph per action state (design doc 10: status icons 13-14px).
 * Completion intentionally reverts to the idle glyph: the persisted run
 * state survives app restarts, so a success checkmark would never go away;
 * the tooltip (exit code, completed at) carries the result.
 */
export const ACTION_STATUS_ICONS: Record<ActionExecution['status'], LucideIcon> = {
  idle: Icon.run,
  running: Icon.running,
  success: Icon.run,
  failed: Icon.fail,
}

/**
 * The action's own icon (preset glyph or emoji) IS its run-state glyph: it
 * carries the state color and the running spin. The generic status glyph
 * (idle/run, failed) renders only when no custom icon is set - never both
 * (double-icon fix).
 */
export function ActionGlyph({
  action,
  status,
  size = 15,
}: {
  action: ActionControl
  status: ActionExecution['status']
  size?: number
}): React.JSX.Element {
  const PresetIcon = actionIconGlyph(action.icon)
  const StatusIcon = ACTION_STATUS_ICONS[status]
  const isRunning = status === 'running'
  if (PresetIcon) {
    return (
      <PresetIcon
        size={size}
        aria-hidden
        className={cn(isRunning && 'animate-spin', status === 'idle' && 'text-ink-secondary')}
      />
    )
  }
  if (action.icon) {
    return (
      <span aria-hidden="true" className={cn(isRunning && 'animate-spin')}>
        {action.icon}
      </span>
    )
  }
  return (
    <StatusIcon
      size={size}
      aria-hidden
      className={cn(isRunning && 'animate-spin', status === 'idle' && 'text-ink-secondary')}
    />
  )
}
