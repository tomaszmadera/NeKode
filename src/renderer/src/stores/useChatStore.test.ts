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
    // A second close in the same tick reads the first removal synchronously.
    update((previous) => ({ ...previous, p1: previous.p1.filter((entry) => entry.id !== 'c1') }))
    update((previous) => ({
      ...previous,
      p1: previous.p1.filter((entry) => entry.id !== 'created'),
    }))
    expect(store.getState().chatsByProject.p1).toEqual([])
  })

  it('distinguishes an unloaded chat list from a loaded empty one and counts explicit re-selection', () => {
    const store = createChatStore()
    const actions = store.getState()
    expect(actions.loadedChatProjectIds.has('p1')).toBe(false)
    actions.setChatsByProject({ p1: [] })
    actions.setLoadedChatProjectIds((previous) => new Set(previous).add('p1'))
    actions.setSelectedChatId('c1')
    actions.setSelectionNonce((previous) => previous + 1)
    actions.setSelectedChatId('c1')
    actions.setSelectionNonce((previous) => previous + 1)
    expect(store.getState().loadedChatProjectIds.has('p1')).toBe(true)
    expect(store.getState().selectedChatId).toBe('c1')
    expect(store.getState().selectionNonce).toBe(2)
  })

  it('resets ephemeral chat, live-session and progress state without affecting a separate instance', () => {
    const store = createChatStore()
    const other = createChatStore()
    const actions = store.getState()
    actions.setChatsByProject({ p1: [chat] })
    actions.setLoadedChatProjectIds(new Set(['p1']))
    actions.setSelectedChatId('c1')
    actions.setSelectionNonce(1)
    actions.setLiveChatIds(new Set(['c1']))
    actions.setChatAttention({ c1: { message: 'Confirm?' } })
    actions.setChatActivity(new Set(['c1']))
    actions.setTaskSnapshots({
      p1: { projectId: 'p1', adapterId: 'example', status: 'ok', tasks: [], receivedAt: null },
    })
    expect(other.getState().chatsByProject).toEqual({})
    actions.reset()
    for (const key of [
      'chatsByProject',
      'loadedChatProjectIds',
      'selectedChatId',
      'selectionNonce',
      'liveChatIds',
      'chatAttention',
      'chatActivity',
      'taskSnapshots',
    ] as const) {
      expect(store.getState()[key]).toEqual(other.getState()[key])
    }
    expect(store.getState().setChatsByProject).toBe(actions.setChatsByProject)
  })
})
