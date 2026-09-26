// Per-project tab-strip session state (center-layout-tabs-actions spec
// Behaviour 3–5): the terminal-chat tab plus the open file tabs in open order,
// the active tab and the previously active tab (close fallback). The session
// lives for the app session only — never persisted across restarts. Held by
// App; components stay presentational. The reducers here are pure so the tab
// contract (order, focus-without-reorder, close fallback) is testable in
// isolation.

export type TabId = { kind: 'terminal' } | { kind: 'file'; path: string }

export const TERMINAL_TAB: TabId = { kind: 'terminal' }

export function fileTab(path: string): TabId {
  return { kind: 'file', path }
}

export interface ProjectTabsSession {
  /** Open file tabs in open order (relative paths, '/'-separated). */
  openFiles: string[]
  active: TabId
  /** The tab that was active before `active` (close fallback; null when none). */
  previous: TabId | null
}

export function emptyTabsSession(): ProjectTabsSession {
  return { openFiles: [], active: TERMINAL_TAB, previous: null }
}

export function tabKey(tab: TabId): string {
  return tab.kind === 'terminal' ? 'terminal' : `file:${tab.path}`
}

function sameTab(a: TabId | null, b: TabId | null): boolean {
  return a !== null && b !== null && tabKey(a) === tabKey(b)
}

function tabIsOpen(tab: TabId, openFiles: readonly string[]): boolean {
  return tab.kind === 'terminal' || openFiles.includes(tab.path)
}

/** Activate a tab, remembering the previously active tab (Behaviour 4). */
export function activateTab(session: ProjectTabsSession, tab: TabId): ProjectTabsSession {
  if (sameTab(session.active, tab)) {
    return session
  }
  return { ...session, active: tab, previous: session.active }
}

/**
 * Open a file tab (appended in open order) or focus the already open one —
 * a file never has two tabs and focusing never reorders the strip
 * (Behaviour 3).
 */
export function openFileTab(session: ProjectTabsSession, path: string): ProjectTabsSession {
  const openFiles = session.openFiles.includes(path)
    ? session.openFiles
    : [...session.openFiles, path]
  return activateTab({ ...session, openFiles }, fileTab(path))
}

/**
 * Close a file tab without confirmation (Behaviour 4). Closing the active tab
 * selects the previously active tab when it is still open, otherwise the
 * terminal-chat tab. Closing a non-active tab keeps the selection (and drops a
 * stale `previous` pointing at the closed tab).
 */
export function closeFileTab(session: ProjectTabsSession, path: string): ProjectTabsSession {
  if (!session.openFiles.includes(path)) {
    return session
  }
  const openFiles = session.openFiles.filter((item) => item !== path)
  const closed = fileTab(path)
  if (sameTab(session.active, closed)) {
    const fallback =
      session.previous !== null && tabIsOpen(session.previous, openFiles)
        ? session.previous
        : TERMINAL_TAB
    return { openFiles, active: fallback, previous: null }
  }
  return {
    openFiles,
    active: session.active,
    previous: sameTab(session.previous, closed) ? null : session.previous,
  }
}
