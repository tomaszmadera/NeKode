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

// A list snapshot can predate a create or close. Updating existing ids in place
// preserves tree order and keeps mounted terminal views alive across that race.
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
