import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ProjectChatStoresProvider } from './ProjectChatStoresProvider'
import { useChatStore } from './useChatStore'
import { useProjectStore } from './useProjectStore'

afterEach(cleanup)

it('binds late callbacks to their original App instance and gives a remount fresh stores', () => {
  const useDomains = () => ({
    project: useProjectStore((state) => state),
    chat: useChatStore((state) => state),
  })
  const first = renderHook(useDomains, { wrapper: ProjectChatStoresProvider })
  const oldActions = first.result.current
  act(() => {
    oldActions.project.setSelectedProjectId('p1')
    oldActions.chat.setSelectedChatId('c1')
  })
  first.unmount()
  const second = renderHook(useDomains, { wrapper: ProjectChatStoresProvider })
  act(() => {
    // Like an IPC response completing after the first App unmounted.
    oldActions.project.setSelectedProjectId('late-project')
    oldActions.chat.setChatsByProject({ p1: [{ id: 'late', projectId: 'p1', name: 'Late' }] })
  })
  expect(second.result.current.project.selectedProjectId).toBeNull()
  expect(second.result.current.chat.selectedChatId).toBeNull()
  expect(second.result.current.chat.chatsByProject).toEqual({})
})
