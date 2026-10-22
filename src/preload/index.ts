import { contextBridge, ipcRenderer } from 'electron'
import { homeDirFromEnv } from '../shared/home-path'
import { createAppApi } from './app-api'

// The sandboxed preload has process.env; the home directory is only used to
// show paths under it as `~`.
const homeDir = homeDirFromEnv(process.platform, process.env)

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('app', createAppApi(ipcRenderer, process.platform, homeDir))
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-expect-error (fallback when context isolation is disabled)
  window.app = createAppApi(ipcRenderer, process.platform, homeDir)
}
