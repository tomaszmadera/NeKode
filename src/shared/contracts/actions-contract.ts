import type { ChatInfo } from './chats-contract'

export interface ActionInput {
  scope: 'global' | 'project'
  projectId: string | null
  title: string
  icon: string | null
  command: string
  cwd: string | null
  runMode: 'background' | 'new-terminal' | 'bottom-terminal'
  confirm: boolean
  sortOrder: number
}

export interface ActionControl extends ActionInput {
  id: string
}

export interface ActionExecution {
  status: 'idle' | 'running' | 'success' | 'failed'
  exitCode: number | null
  completedAt: string | null
  error: string | null
  chat?: ChatInfo
  /**
   * New-terminal delivery waits until its terminal view is subscribed and ready.
   */
  terminalCommand?: string
  terminalCwd?: string
  /**
   * Bottom-terminal delivery addresses the new bottom tab (never a chat): the
   * renderer opens the panel, adds the tab, and writes terminalCommand plus CR
   * once that tab's terminal is subscribed. Success means delivery, so the
   * exit code is null and the shell command's later exit is not tracked.
   */
  bottomTabId?: string
}
