import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import nekodeIcon from '../../resources/icon.ico?asset'
import { isSafeExternalUrl } from '../shared/safe-url'
import { registerAppIpcHandlers } from './ipc/ipc-handlers'
import { isTrustedRendererUrl } from './security/sender-guard'
import { createServices } from './services/create-services'

// Isolated smoke/e2e runs (docs/development/setup.md §3): redirect userData
// before the app is ready so the SQLite db and local settings stay out of the
// developer's real profile. Windows ignores the APPDATA override (Known
// Folder), so app.setPath is the only reliable isolation path.
const smokeUserData = process.env.NEKODE_USER_DATA
if (smokeUserData !== undefined && smokeUserData.length > 0) {
  app.setPath('userData', smokeUserData)
}

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
    // Window and taskbar icon (2026-10-01): the branded cat tile, so dev
    // runs carry the app identity like the packaged exe (electron-builder
    // win.icon below). ?asset resolves to a real file path in dev and build.
    icon: nekodeIcon,
    // Custom title bar (design doc 26.2): the renderer's full-width title
    // bar strip (brand on the left) is the drag surface (.drag-region in
    // index.css) and paints the base app background; Windows draws the
    // caption buttons in the top-right corner over that strip with the
    // overlay colors below. backgroundColor prevents a white flash before
    // the first renderer paint.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0b0d1f',
      symbolColor: '#cacbd1',
      height: 36,
    },
    backgroundColor: '#0b0d1f',
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
    // Native directory picker behind dialogs:pickDirectory (spec
    // handoff-resume-flow Data/API). Null = user cancel.
    pickDirectory: async (defaultPath) => {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Choose Directory',
        defaultPath: defaultPath ?? undefined,
      })
      if (result.canceled || result.filePaths.length === 0) {
        return null
      }
      return result.filePaths[0]
    },
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
