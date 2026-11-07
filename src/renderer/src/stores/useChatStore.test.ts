import type { ChatInfo } from '@shared/ipc-contract'
import { describe, expect, it } from 'vitest'
import { createChatStore, mergeFetchedChats } from './useChatStore'

const chat: ChatInfo = { id: 'c1', projectId: 'p1', name: 'First' }

describe('chat store', () => {
  it('merges stale snapshots without losing a new chat, reviving a closed chat, or changing tree order', () => {
    const store = createChatStore()
    const update = store.getState().setChatsByProject
    const created = { ...chat, id: 'created' }
    const closed = { ...chat, id: 'closed' }
    const fetched = { ...chat, name: 'Updated' }
    const removed = new Set(['closed'])
    update({ p1: [chat, created], p2: [{ ...chat, id: 'other', projectId: 'p2' }] })
    update((previous) => ({
      ...previous,
      p1: mergeFetchedChats(previous.p1, [fetched, closed], removed),
    }))
    expect(store.getState().chatsByProject.p1).toEqual([fetched, created])
    expect(store.getState().chatsByProject.p2[0].id).toBe('other')
  })
})
