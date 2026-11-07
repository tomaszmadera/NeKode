import { PREVIEW_WINDOW_ARGUMENT } from '@shared/contracts/preview-contract'
import { homeDirFromEnv } from '@shared/home-path'
import { contextBridge, ipcRenderer } from 'electron'
import { createAppApi } from './app-api'
import { selectBridge } from './bridge-selection'
import { createPreviewApi } from './preview-api'

// The sandboxed preload has process.env; the home directory is only used to
// show paths under it as `~`.
const homeDir = homeDirFromEnv(process.platform, process.env)

// One preload serves both window kinds. Main marks file preview windows with
// a webPreferences additionalArguments flag, which the renderer cannot set;
// those windows get only window.preview and no window.app
// (docs/features/file-preview-window/spec.md Authorization).
const bridge = selectBridge(process.argv.includes(PREVIEW_WINDOW_ARGUMENT), {
  app: () => createAppApi(ipcRenderer, process.platform, homeDir),
  preview: () => createPreviewApi(ipcRenderer),
})

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld(bridge.key, bridge.api)
  } catch (error) {
    console.error(error)
  }
} else {
  // Fallback when context isolation is disabled. `globalThis` is the renderer
  // window here; naming it avoids depending on the DOM lib in the node project.
  ;(globalThis as unknown as Record<string, unknown>)[bridge.key] = bridge.api
}
