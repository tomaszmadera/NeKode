import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import nekodeIcon from '../../resources/icon.ico?asset'
import nekodePngIcon from '../../resources/icon.png?asset'
import { IPC_CHANNEL } from '../shared/ipc-contract'
import { isSafeExternalUrl } from '../shared/safe-url'
import { bootstrap } from './bootstrap'
import { broadcastToTrustedWindows } from './ipc/broadcast'
import { registerAppIpcHandlers } from './ipc/ipc-handlers'
import { allowsMicrophone, allowsRendererClipboard } from './security/media-permissions'
import { isTrustedRendererUrl } from './security/sender-guard'
import { createServices } from './services/create-services'
import { DesktopShortcutSender, desktopHelperPath } from './services/dictation/desktop-sender'
import { bundledUsageAdapterDirectories } from './services/usage/adapter-host'
import { registerShutdown } from './shutdown'
import { applyUserDataOverride } from './user-data-override'

// Isolated smoke/e2e runs (docs/development/setup.md §3): redirect userData
// before the app is ready so the SQLite db and local settings stay out of the
// developer's real profile. Windows ignores the APPDATA override (Known
// Folder), so app.setPath is the only reliable isolation path.
applyUserDataOverride(process.env.NEKODE_USER_DATA, (name, targetPath) => {
  app.setPath(name as 'userData', targetPath)
})

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
    // Windows uses the multi-size .ico; Linux window managers need a PNG.
    icon: process.platform === 'win32' ? nekodeIcon : nekodePngIcon,
    // Custom title bar (design doc 26.2): the renderer's full-width title
    // bar strip (brand on the left) is the drag surface (.drag-region in
    // index.css) and paints the base app background; Windows draws the
    // caption buttons in the top-right corner over that strip with the
    // overlay colors below. backgroundColor prevents a white flash before
    // the first renderer paint.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#cacbd1',
      height: 36,
    },
    backgroundColor: '#0d1222',
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

  const permissions = mainWindow.webContents.session
  permissions.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(
      contents === mainWindow.webContents &&
        (allowsMicrophone(
          permission,
          details.requestingUrl,
          details.isMainFrame,
          'mediaTypes' in details ? details.mediaTypes : undefined,
          trustedRendererUrls,
        ) ||
          allowsRendererClipboard(
            permission,
            details.requestingUrl,
            details.isMainFrame,
            trustedRendererUrls,
          )),
    )
  })
  permissions.setPermissionCheckHandler(
    (contents, permission, _origin, details) =>
      contents === mainWindow.webContents &&
      (allowsMicrophone(
        permission,
        details.requestingUrl,
        details.isMainFrame,
        details.mediaType ? [details.mediaType] : undefined,
        trustedRendererUrls,
      ) ||
        allowsRendererClipboard(
          permission,
          details.requestingUrl,
          details.isMainFrame,
          trustedRendererUrls,
        )),
  )

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

app
  .whenReady()
  .then(() =>
    bootstrap(
      async () => {
        electronApp.setAppUserModelId('com.nekode.app')

        app.on('browser-window-created', (_, window) => {
          optimizer.watchWindowShortcuts(window)
        })

        const desktopSender = new DesktopShortcutSender(
          desktopHelperPath(app.isPackaged, app.getAppPath(), process.resourcesPath),
        )
        const services = createServices({
          pickUsageFile: async (output) => {
            if (output) {
              const result = await dialog.showSaveDialog({
                title: 'Export usage JSON',
                filters: [{ name: 'JSON', extensions: ['json'] }],
              })
              return result.canceled ? null : (result.filePath ?? null)
            }
            const result = await dialog.showOpenDialog({
              title: 'Choose usage JSON input',
              properties: ['openFile'],
              filters: [{ name: 'JSON', extensions: ['json'] }],
            })
            return result.canceled ? null : (result.filePaths[0] ?? null)
          },
          desktopShortcut: (handle) => desktopSender.send(handle),
          dbPath: join(app.getPath('userData'), 'nekode.db'),
          userDataPath: app.getPath('userData'),
          safeStorage,
          packaged: app.isPackaged,
          appVersion: app.getVersion(),
          tempDir: app.getPath('temp'),
          quitApp: () => {
            app.quit()
          },
          subscribeAppQuit: (listener) => {
            app.on('before-quit', listener)
            return () => {
              app.removeListener('before-quit', listener)
            }
          },
          bundledUsageAdapterDirectories: bundledUsageAdapterDirectories(
            app.isPackaged,
            app.getAppPath(),
            process.resourcesPath,
          ),
          // The single OS-facing action of the project-files feature (spec
          // Behaviour 11): open with the OS default application. '' = success.
          openExternal: (absolutePath) => shell.openPath(absolutePath),
          showInFolder: (absolutePath) => {
            shell.showItemInFolder(absolutePath)
          },
          trashItem: (absolutePath) => shell.trashItem(absolutePath),
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
          desktopWindow: (event) => {
            const window = BrowserWindow.fromWebContents(event.sender)
            if (!window || window.isDestroyed() || !window.isFocused()) return null
            const handle = window.getNativeWindowHandle()
            return (
              handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())
            ).toString()
          },
          trustedRendererUrls: getTrustedRendererUrls(),
          // Terminal data/exit events go to every trusted window's webContents.
          broadcast: (channel, chatId, payload) => {
            broadcastToTrustedWindows(
              BrowserWindow.getAllWindows(),
              getTrustedRendererUrls(),
              channel,
              chatId,
              payload,
            )
          },
          broadcastDictation: (result) => {
            broadcastToTrustedWindows(
              BrowserWindow.getAllWindows(),
              getTrustedRendererUrls(),
              IPC_CHANNEL.dictationResult,
              result,
            )
          },
          broadcastTaskProgress: (event) => {
            broadcastToTrustedWindows(
              BrowserWindow.getAllWindows(),
              getTrustedRendererUrls(),
              IPC_CHANNEL.taskProgressChanged,
              event,
            )
          },
        })

        // Usage polling and task progress reads pause while no window is
        // visible and not minimized (usage-quota rule 12, task-progress-adapters
        // Behaviour 18).
        const updateUsageVisibility = () => {
          const visible = BrowserWindow.getAllWindows().some(
            (window) => !window.isDestroyed() && window.isVisible() && !window.isMinimized(),
          )
          services.usage.setVisible(visible)
          services.taskProgress.setVisible(visible)
        }
        app.on('browser-window-created', (_, window) => {
          window.on('show', updateUsageVisibility)
          window.on('hide', updateUsageVisibility)
          window.on('minimize', updateUsageVisibility)
          window.on('restore', updateUsageVisibility)
          window.on('closed', updateUsageVisibility)
        })
        app.on('before-quit', () => {
          services.usage.shutdown()
          services.taskProgress.shutdown()
        })

        // App-quit PTY teardown (spec Behaviour 8): terminate every chat terminal
        // so no orphaned pwsh/powershell processes outlive the app. Quit is NOT a
        // chat exit: chat rows are never deleted here, and terminateAll suppresses
        // exit events so the renderer's chat-close flow cannot run while quitting.
        registerShutdown(
          app,
          (reportTimeout) => services.terminals.shutdown(reportTimeout),
          () => services.dictation.shutdown(),
          () => {
            console.error('[terminal] application shutdown did not complete')
            dialog.showErrorBox(
              'NeKode could not close',
              'Terminal shutdown did not complete. NeKode is still running.',
            )
          },
          {
            stopActions: () => services.actions.stopAll(),
            closeDatabase: () => services.closeDatabase?.(),
          },
        )

        createWindow()

        app.on('activate', () => {
          if (BrowserWindow.getAllWindows().length === 0) {
            createWindow()
          }
        })
      },
      {
        showErrorBox: (title, content) => dialog.showErrorBox(title, content),
        quit: () => app.quit(),
      },
    ),
  )
  .catch((error) => {
    console.error('[bootstrap] unexpected startup error', error)
    dialog.showErrorBox(
      'NeKode failed to start',
      error instanceof Error ? error.message : String(error),
    )
    app.quit()
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
