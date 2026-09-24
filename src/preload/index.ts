import { contextBridge, ipcRenderer } from 'electron'
import { createAppApi } from './app-api'

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('app', createAppApi(ipcRenderer))
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-expect-error (fallback when context isolation is disabled)
  window.app = createAppApi(ipcRenderer)
}
