import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { isSafeExternalUrl } from '../shared/safe-url'
import { registerAppIpcHandlers } from './ipc/ipc-handlers'
import { isTrustedRendererUrl } from './security/sender-guard'
import { createServices } from './services/create-services'

// The single trusted renderer document: the dev server root in dev, the
// built index.html in production. Used for both navigation locking and the
// IPC sender guard.
function getTrustedRendererUrls(): string[] {
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    return [process.env.ELECTRON_RENDERER_URL]
  }
  return [pathToFileURL(join(__dirname, '../renderer/index.html')).href]
}

function createWindow(): void {
  const trustedRendererUrls = getTrustedRendererUrls()
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // New windows are always denied; external opens go through the protocol
  // allowlist (untrusted URLs never reach shell.openExternal).
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isSafeExternalUrl(details.url)) {
      void shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  // The renderer is one trusted document; block any other navigation.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url, trustedRendererUrls)) {
      event.preventDefault()
    }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.nekode.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const services = createServices({
    dbPath: join(app.getPath('userData'), 'nekode.db'),
    // The single OS-facing action of the project-files feature (spec
    // Behaviour 11): open with the OS default application. '' = success.
    openExternal: (absolutePath) => shell.openPath(absolutePath),
  })
  registerAppIpcHandlers(ipcMain, services, {
    trustedRendererUrls: getTrustedRendererUrls(),
    // Terminal data/exit events go to every window's webContents (single-window
    // app today; the fan-out keeps the contract window-agnostic).
    broadcast: (channel, chatId, payload) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(channel, chatId, payload)
      }
    },
  })

  // App-quit PTY teardown (spec Behaviour 8): terminate every chat terminal
  // so no orphaned pwsh/powershell processes outlive the app. Quit is NOT a
  // chat exit: chat rows are never deleted here, and terminateAll suppresses
  // exit events so the renderer's chat-close flow cannot run while quitting.
  app.on('before-quit', () => {
    services.terminals.terminateAll()
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
