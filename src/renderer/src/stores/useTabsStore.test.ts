import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  activateTab,
  emptyTabsSession,
  fileTab,
  KANBAN_TAB,
  openFileTab,
  TERMINAL_TAB,
} from '../components/tabs/tabs-session'
import { createTabsStore } from './useTabsStore'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('tabs store', () => {
  it('applies successive session updates per project without touching another project', () => {
    const store = createTabsStore()
    const { updateTabsSession } = store.getState()
    updateTabsSession('p1', (session) => openFileTab(session, 'a.md'))
    updateTabsSession('p1', (session) => openFileTab(session, 'b.ts'))
    updateTabsSession('p2', (session) => activateTab(session, KANBAN_TAB))

    expect(store.getState().tabsByProject.p1).toEqual({
      openFiles: ['a.md', 'b.ts'],
      active: fileTab('b.ts'),
      previous: fileTab('a.md'),
    })
    expect(store.getState().tabsByProject.p2).toEqual({
      ...emptyTabsSession(),
      active: KANBAN_TAB,
      previous: TERMINAL_TAB,
    })
  })

  it('drops a removed project and ignores a project without a session', () => {
    const store = createTabsStore()
    store.getState().updateTabsSession('p1', (session) => openFileTab(session, 'a.md'))
    const listener = vi.fn()
    store.subscribe(listener)
    store.getState().dropProject('missing')
    expect(listener).not.toHaveBeenCalled()
    store.getState().dropProject('p1')
    expect(store.getState().tabsByProject).toEqual({})
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps the markdown view per file and skips a same-mode write', () => {
    const store = createTabsStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.getState().setMarkdownView('p1:a.md', 'code')
    store.getState().setMarkdownView('p1:a.md', 'code')
    store.getState().setMarkdownView('p1:b.md', 'preview')
    expect(store.getState().markdownViewByKey).toEqual({ 'p1:a.md': 'code', 'p1:b.md': 'preview' })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('is session-only: no update writes localStorage, and reset restores a fresh state', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const store = createTabsStore()
    store.getState().updateTabsSession('p1', (session) => openFileTab(session, 'a.md'))
    store.getState().setMarkdownView('p1:a.md', 'code')
    store.getState().reset()
    expect(setItem).not.toHaveBeenCalled()
    expect(store.getState().tabsByProject).toEqual({})
    expect(store.getState().markdownViewByKey).toEqual({})
    expect(createTabsStore().getState().tabsByProject).not.toBe(store.getState().tabsByProject)
  })
})
