import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { registerIpc } from './ipc'
import { CrashService } from './crashService'
import { redactDiagnostic } from './redaction'

let mainWindow: BrowserWindow | null = null
let handlingFatalError = false
let activeWorkspaceRoot: string | undefined
const crashes = new CrashService(app.getPath('userData'))

process.on('uncaughtException', (error) => {
  if (handlingFatalError) return
  handlingFatalError = true
  const report = crashes.record('uncaughtException', error, activeWorkspaceRoot)
  console.error('[woo] fatal main-process error:', redactDiagnostic(error, activeWorkspaceRoot))
  dialog.showErrorBox(
    'Woo Studio stopped unexpectedly',
    `A local crash report was saved${report ? ` to ${report}` : ''}. Unsaved editor buffers can be restored on the next launch.`
  )
  app.exit(1)
})

process.on('unhandledRejection', (error) => {
  crashes.record('unhandledRejection', error, activeWorkspaceRoot)
  console.error('[woo] unhandled rejection:', redactDiagnostic(error, activeWorkspaceRoot))
})

// Woo does not render video. Disabling VA-API avoids Chromium probing old
// system VA drivers and emitting a misleading startup error on Linux.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('disable-features', 'VaapiVideoDecoder,VaapiVideoEncoder')
}

function createWindow(workspaceRoot: string): void {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    backgroundColor: '#0d1117',
    title: 'Woo Studio',
    // Custom in-app window controls — native decorations are unreliable
    // across Linux DEs (GNOME/COSMIC hide or no-op min/max).
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, // UI-001
      nodeIntegration: false,
      sandbox: true
    }
  })

  // The workbench is a single local document. Never let renderer content
  // navigate this privileged WebContents, create another window, or acquire
  // browser permissions. External URLs must be opened by an explicit,
  // allowlisted main-process action if that capability is added later.
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false)
  )

  registerIpc(workspaceRoot, mainWindow, crashes, (root) => {
    activeWorkspaceRoot = root
  })

  // Renderer blocks unload while unsaved changes exist; without this
  // handler the close button would silently do nothing.
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    if (!mainWindow) return
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: ['Discard Changes', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Unsaved changes',
      message: 'There are unsaved changes. Discard them and close?'
    })
    if (choice === 0) event.preventDefault() // preventDefault = proceed with unload
  })

  // Frameless window has no native close fallback: if the renderer hangs or
  // dies, destroy the window outright rather than trapping the user.
  mainWindow.webContents.on('render-process-gone', () => {
    mainWindow?.destroy()
  })
  ipcMain.handle('window:forceClose', (event) => {
    if (
      !mainWindow ||
      event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame
    ) {
      throw new Error('Rejected IPC from an untrusted renderer.')
    }
    mainWindow.destroy()
  })

  const rendererFile = join(__dirname, '../renderer/index.html')
  let rendererFallbackAttempted = false
  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3 || rendererFallbackAttempted || !mainWindow) return
      rendererFallbackAttempted = true
      console.error(redactDiagnostic(
        `[woo] renderer failed to load ${validatedURL}: ${errorDescription} (${errorCode})`,
        workspaceRoot
      ))
      // A development server can disappear while Electron is relaunching.
      // Prefer the last production bundle when one exists; otherwise show a
      // visible diagnostic instead of leaving only the dark window background.
      if (existsSync(rendererFile)) {
        void mainWindow.loadFile(rendererFile)
        return
      }
      const html = `<!doctype html><meta charset="utf-8"><style>
        body{margin:0;background:#0d1117;color:#d4d4d4;font:14px system-ui;display:grid;place-items:center;height:100vh}
        main{max-width:620px;padding:32px}h1{font-size:20px;color:#f08c8c}code{color:#9cdcfe}
      </style><main><h1>Woo could not load its workbench</h1>
      <p>The renderer stopped during the workspace switch.</p>
      <p>Close this window and restart Woo with <code>npm run dev</code>.</p>
      <p>${errorDescription} (${errorCode})</p></main>`
      void mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    }
  )

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(rendererFile)
  }

  // CLI `woo some/file.ts` — open the file in the editor once loaded.
  const openFileArg = process.env['WOO_OPEN_FILE']
  if (openFileArg) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('open-file', openFileArg)
        }
      }, 400)
    })
  }

  // Debug utility: WOO_CAPTURE=/path/out.png screenshots the window after
  // load and exits. Lets layout bugs be reproduced without a display.
  const capturePath = process.env['WOO_CAPTURE']
  if (capturePath) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const view = process.env['WOO_CAPTURE_VIEW']
          if (view) {
            await mainWindow!.webContents.executeJavaScript(
              `document.querySelector('.activity-item[title=${JSON.stringify(view)}]')?.click()`
            )
            await new Promise((r) => setTimeout(r, 600))
          }
          if (process.env['WOO_PROBE']) {
            const layout = await mainWindow!.webContents.executeJavaScript(`
              (() => {
                const pick = (sel) => {
                  const el = document.querySelector(sel)
                  if (!el) return null
                  const r = el.getBoundingClientRect()
                  const cs = getComputedStyle(el)
                  return { top: r.top, height: r.height, display: cs.display, flexDir: cs.flexDirection, position: cs.position }
                }
                return JSON.stringify({
                  center: pick('.center'),
                  ctx: pick('.context-view'),
                  problems: pick('.problems-panel'),
                  centerChildren: [...(document.querySelector('.center')?.children ?? [])].map((c) => c.className)
                })
              })()
            `)
            console.log('[woo] layout:', layout)
          }
          const image = await mainWindow!.webContents.capturePage()
          const { writeFileSync } = await import('fs')
          writeFileSync(capturePath, image.toPNG())
          console.log(`[woo] captured ${capturePath}`)
        } catch (err) {
          console.error('[woo] capture failed:', redactDiagnostic(err, workspaceRoot))
        } finally {
          mainWindow?.destroy()
          app.quit()
        }
      }, 3500)
    })
  }
}

app.whenReady().then(async () => {
  const previousCrash = crashes.acknowledgeLatest()
  if (previousCrash) {
    await dialog.showMessageBox({
      type: 'warning',
      title: 'Woo recovered from a previous crash',
      message: previousCrash.report.message ?? 'The previous session stopped unexpectedly.',
      detail: `Occurred: ${previousCrash.report.occurredAt ?? 'unknown'}\nReport: ${previousCrash.path}\nAny recoverable unsaved buffers will be offered after the workspace opens.`
    })
  }
  // Workspace: CLI arg, WOO_WORKSPACE env, or picker.
  let workspaceRoot = process.argv.find((a) => a.startsWith('--workspace='))?.slice(12)
    ?? process.env.WOO_WORKSPACE
  if (!workspaceRoot) {
    const result = await dialog.showOpenDialog({
      title: 'Open Workspace',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      app.quit()
      return
    }
    workspaceRoot = result.filePaths[0]
  }
  activeWorkspaceRoot = workspaceRoot
  createWindow(workspaceRoot)
})

app.on('window-all-closed', () => {
  app.quit()
})
