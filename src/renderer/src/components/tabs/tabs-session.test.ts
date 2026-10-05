import { describe, expect, it } from 'vitest'
import {
  activateTab,
  closeFileTab,
  emptyTabsSession,
  fileTab,
  KANBAN_TAB,
  openFileTab,
  TERMINAL_TAB,
  tabKey,
} from './tabs-session'

// Tab-strip session contract (center-layout-tabs-actions spec Behaviour 3–5):
// open order is append-only (focusing never reopens or reorders), a file never
// has two tabs, closing falls back to the previously active tab and then to
// the terminal-chat tab. These are the deciding reducers behind the renderer
// tests in CenterTabs.test.tsx.

describe('tabs session — opening and order (spec Behaviour 3)', () => {
  it('appends file tabs in open order and never opens a file twice', () => {
    let session = emptyTabsSession()
    session = openFileTab(session, 'README.md')
    session = openFileTab(session, 'notes.txt')
    session = openFileTab(session, 'src/app.ts')
    expect(session.openFiles).toEqual(['README.md', 'notes.txt', 'src/app.ts'])
    expect(session.active).toEqual(fileTab('src/app.ts'))

    // Opening an already open file focuses it — no duplicate tab…
    session = openFileTab(session, 'README.md')
    expect(session.openFiles).toEqual(['README.md', 'notes.txt', 'src/app.ts'])
    expect(session.openFiles.filter((path) => path === 'README.md')).toHaveLength(1)
    // …and focusing never reorders the strip (open order is retained).
    expect(session.openFiles).toEqual(['README.md', 'notes.txt', 'src/app.ts'])
    expect(session.active).toEqual(fileTab('README.md'))
  })
})

describe('tabs session — activation (spec Behaviour 4–5)', () => {
  it('remembers the previously active tab on every activation', () => {
    let session = emptyTabsSession()
    session = openFileTab(session, 'a.ts')
    expect(session.active).toEqual(fileTab('a.ts'))
    expect(session.previous).toEqual(TERMINAL_TAB)

    session = openFileTab(session, 'b.ts')
    expect(session.previous).toEqual(fileTab('a.ts'))

    session = activateTab(session, TERMINAL_TAB)
    expect(session.active).toEqual(TERMINAL_TAB)
    expect(session.previous).toEqual(fileTab('b.ts'))
  })

  it('re-activating the current tab is a no-op (the previous tab is kept)', () => {
    let session = openFileTab(openFileTab(emptyTabsSession(), 'a.ts'), 'b.ts')
    const before = session
    session = activateTab(session, fileTab('b.ts'))
    expect(session).toBe(before)
  })
})

describe('tabs session — closing (spec Behaviour 4)', () => {
  it('closing the active tab selects the previously active tab', () => {
    let session = openFileTab(openFileTab(emptyTabsSession(), 'a.ts'), 'b.ts')
    session = closeFileTab(session, 'b.ts')
    expect(session.active).toEqual(fileTab('a.ts'))
    expect(session.openFiles).toEqual(['a.ts'])
  })

  it('closing the active tab falls back to the terminal tab when the previous tab is gone', () => {
    let session = openFileTab(openFileTab(emptyTabsSession(), 'a.ts'), 'b.ts')
    // Closing the non-active previous tab drops it from the close fallback…
    session = closeFileTab(session, 'a.ts')
    expect(session.active).toEqual(fileTab('b.ts'))
    // …so closing the active tab now lands on the terminal-chat tab.
    session = closeFileTab(session, 'b.ts')
    expect(session.active).toEqual(TERMINAL_TAB)
    expect(session.openFiles).toEqual([])
  })

  it('closing the active tab whose previous tab is the terminal selects the terminal tab', () => {
    let session = openFileTab(emptyTabsSession(), 'a.ts')
    session = closeFileTab(session, 'a.ts')
    expect(session.active).toEqual(TERMINAL_TAB)
    expect(session.openFiles).toEqual([])
  })

  it('closing a non-active tab never changes the selection', () => {
    let session = openFileTab(openFileTab(emptyTabsSession(), 'a.ts'), 'b.ts')
    session = activateTab(session, fileTab('a.ts'))
    session = closeFileTab(session, 'b.ts')
    expect(session.active).toEqual(fileTab('a.ts'))
    expect(session.openFiles).toEqual(['a.ts'])
  })

  it('closing an unknown path is a no-op', () => {
    const session = openFileTab(emptyTabsSession(), 'a.ts')
    expect(closeFileTab(session, 'missing.ts')).toEqual(session)
  })
})

// Kanban project-view tab (spec kanban-adapter-interface Behaviour 14): a
// third TabId kind, addressable as 'kanban', that is always "open" (a project
// view, never a document) and never carries a close path.
describe('tabs session — kanban tab (spec kanban-adapter-interface Behaviour 14)', () => {
  it('has its own key and activates/remembers the previous tab like any tab', () => {
    expect(tabKey(KANBAN_TAB)).toBe('kanban')
    expect(tabKey(TERMINAL_TAB)).toBe('terminal')
    expect(tabKey(fileTab('a.ts'))).toBe('file:a.ts')

    let session = emptyTabsSession()
    session = activateTab(session, KANBAN_TAB)
    expect(session.active).toEqual(KANBAN_TAB)
    expect(session.previous).toEqual(TERMINAL_TAB)
  })

  it('is a valid close fallback while a file tab is closed (always open)', () => {
    let session = emptyTabsSession()
    session = openFileTab(session, 'a.ts')
    // Activate Kanban, then re-activate the file: closing it falls back to the
    // remembered Kanban project view (it is open even with no file tabs).
    session = activateTab(session, KANBAN_TAB)
    session = activateTab(session, fileTab('a.ts'))
    session = closeFileTab(session, 'a.ts')
    expect(session.active).toEqual(KANBAN_TAB)
    expect(session.openFiles).toEqual([])
  })

  it('re-activating the kanban tab is a no-op (the previous tab is kept)', () => {
    const session = activateTab(emptyTabsSession(), KANBAN_TAB)
    expect(activateTab(session, KANBAN_TAB)).toBe(session)
  })
})
