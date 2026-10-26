import { act, cleanup, renderHook } from '@testing-library/react'
import type React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { THEME_STORAGE_KEY } from '../lib/theme'
import { AppStoresProvider } from './AppStoresProvider'
import { useChatStore } from './useChatStore'
import { useProjectStore } from './useProjectStore'
import { useSettingsStore } from './useSettingsStore'
import { useTabsStore } from './useTabsStore'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function wrapperFor(reportError: (message: string) => void) {
  const app = { state: { get: vi.fn(async () => null), set: vi.fn(async () => undefined) } }
  return ({ children }: { children: React.ReactNode }) => (
    <AppStoresProvider app={app} reportError={reportError}>
      {children}
    </AppStoresProvider>
  )
}

it('gives each App mount fresh project, chat, tabs and settings stores', () => {
  localStorage.setItem(THEME_STORAGE_KEY, 'nekode-flat')
  const useDomains = () => ({
    project: useProjectStore((state) => state),
    chat: useChatStore((state) => state),
    tabs: useTabsStore((state) => state),
    settings: useSettingsStore((state) => state),
  })
  const first = renderHook(useDomains, { wrapper: wrapperFor(vi.fn()) })
  expect(first.result.current.settings.theme).toBe('nekode-flat')
  const oldActions = first.result.current
  act(() => {
    oldActions.tabs.updateTabsSession('p1', (session) => ({ ...session, openFiles: ['a.md'] }))
    oldActions.settings.setChatSwitchEnabled(false)
    oldActions.project.setSelectedProjectId('p1')
  })
  first.unmount()

  const second = renderHook(useDomains, { wrapper: wrapperFor(vi.fn()) })
  act(() => {
    // Like an IPC response completing after the first App unmounted.
    oldActions.tabs.updateTabsSession('late', (session) => session)
    oldActions.settings.setAutoSendHandoff(true)
  })
  expect(second.result.current.tabs.tabsByProject).toEqual({})
  expect(second.result.current.settings.chatSwitchEnabled).toBe(true)
  expect(second.result.current.settings.autoSendHandoff).toBe(false)
  expect(second.result.current.project.selectedProjectId).toBeNull()
  expect(second.result.current.chat.chatsByProject).toEqual({})
})

it('requires the provider for the tabs and settings stores', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  expect(() => renderHook(() => useTabsStore((state) => state))).toThrow(
    'useTabsStore requires AppStoresProvider.',
  )
  expect(() => renderHook(() => useSettingsStore((state) => state))).toThrow(
    'useSettingsStore requires AppStoresProvider.',
  )
  vi.restoreAllMocks()
})
