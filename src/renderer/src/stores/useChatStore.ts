import type { ChatInfo, TaskProgressSnapshot } from '@shared/ipc-contract'
import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { ChatAttention } from '../lib/chat-attention'
import { resolveUpdate, type StoreUpdate } from './store-update'

interface ChatState {
  chatsByProject: Record<string, ChatInfo[]>
  // A missing entry is not loaded yet, so it must not show the empty-chat state.
  loadedChatProjectIds: ReadonlySet<string>
  selectedChatId: string | null
  selectionNonce: number
  liveChatIds: ReadonlySet<string>
  // Attention and activity last for this renderer run and are never persisted.
  chatAttention: Record<string, ChatAttention>
  chatActivity: ReadonlySet<string>
  taskSnapshots: Record<string, TaskProgressSnapshot>
}

interface ChatActions {
  setChatsByProject: (update: StoreUpdate<ChatState['chatsByProject']>) => void
  setLoadedChatProjectIds: (update: StoreUpdate<ChatState['loadedChatProjectIds']>) => void
  setSelectedChatId: (update: StoreUpdate<ChatState['selectedChatId']>) => void
  setSelectionNonce: (update: StoreUpdate<ChatState['selectionNonce']>) => void
  setLiveChatIds: (update: StoreUpdate<ChatState['liveChatIds']>) => void
  setChatAttention: (update: StoreUpdate<ChatState['chatAttention']>) => void
  setChatActivity: (update: StoreUpdate<ChatState['chatActivity']>) => void
  setTaskSnapshots: (update: StoreUpdate<ChatState['taskSnapshots']>) => void
  reset: () => void
}

function initialState(): ChatState {
  return {
    chatsByProject: {},
    loadedChatProjectIds: new Set(),
    selectedChatId: null,
    selectionNonce: 0,
    liveChatIds: new Set(),
    chatAttention: {},
    chatActivity: new Set(),
    taskSnapshots: {},
  }
}

export type ChatStore = ChatState & ChatActions

// A chats:list response is a snapshot that can predate mutations the renderer
// already applied: a concurrent create lands after the snapshot was taken, a
// close lands before a response that still carries the chat. Replacing the
// known list with such a snapshot transiently drops a chat whose session view
// is alive (the ChatWorkspace eviction effect then disposes its xterm and
// scrollback) or resurrects a closed chat. Merge instead: fetched entries
// update their id in place (preserving tree order), known entries the
// snapshot predates are kept, and tombstoned ids (closed by this renderer in
// this session) never come back.
export function mergeFetchedChats(
  known: ChatInfo[],
  fetched: ChatInfo[],
  removedChatIds: ReadonlySet<string>,
): ChatInfo[] {
  const byId = new Map(known.map((chat) => [chat.id, chat] as const))
  for (const chat of fetched) byId.set(chat.id, chat)
  for (const chatId of removedChatIds) byId.delete(chatId)
  return [...byId.values()]
}

export function createChatStore() {
  return createStore<ChatStore>()((set) => ({
    ...initialState(),
    setChatsByProject: (update) =>
      set((state) => ({ chatsByProject: resolveUpdate(update, state.chatsByProject) })),
    setLoadedChatProjectIds: (update) =>
      set((state) => ({ loadedChatProjectIds: resolveUpdate(update, state.loadedChatProjectIds) })),
    setSelectedChatId: (update) =>
      set((state) => ({ selectedChatId: resolveUpdate(update, state.selectedChatId) })),
    setSelectionNonce: (update) =>
      set((state) => ({ selectionNonce: resolveUpdate(update, state.selectionNonce) })),
    setLiveChatIds: (update) =>
      set((state) => ({ liveChatIds: resolveUpdate(update, state.liveChatIds) })),
    setChatAttention: (update) =>
      set((state) => ({ chatAttention: resolveUpdate(update, state.chatAttention) })),
    setChatActivity: (update) =>
      set((state) => ({ chatActivity: resolveUpdate(update, state.chatActivity) })),
    setTaskSnapshots: (update) =>
      set((state) => ({ taskSnapshots: resolveUpdate(update, state.taskSnapshots) })),
    reset: () => set(initialState()),
  }))
}

export type ChatStoreApi = ReturnType<typeof createChatStore>
export const ChatStoreContext = createContext<ChatStoreApi | null>(null)

export function useChatStore<T>(selector: (state: ChatStore) => T): T {
  const store = useContext(ChatStoreContext)
  if (store === null) throw new Error('useChatStore requires ProjectChatStoresProvider.')
  return useStore(store, selector)
}
