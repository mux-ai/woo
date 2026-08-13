import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readFileSync } from 'fs'
import { workspaceDataRoot } from '../src/main/localData'

describe('production data-protection boundaries', () => {
  it('keeps the Electron renderer sandboxed and closed to ambient capabilities', () => {
    const main = readFileSync('src/main/index.ts', 'utf8')
    const html = readFileSync('src/renderer/index.html', 'utf8')
    expect(main).toContain('sandbox: true')
    expect(main).toContain("nodeIntegration: false")
    expect(main).toContain('contextIsolation: true')
    expect(main).toContain("on('will-navigate'")
    expect(main).toContain("setWindowOpenHandler(() => ({ action: 'deny' }))")
    expect(main).toContain('setPermissionRequestHandler')
    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain("script-src 'self'")
    expect(html).toContain("object-src 'none'")
    expect(readFileSync('electron.vite.config.mts', 'utf8')).toContain(': "\'none\'"')
  })

  it('routes every workspace IPC handler through sender validation', () => {
    const ipc = readFileSync('src/main/ipc.ts', 'utf8')
    expect(ipc.match(/ipcMain\.handle\(/g)).toHaveLength(1)
    expect(ipc).toContain('event.sender !== win.webContents')
    expect(ipc).toContain('event.senderFrame !== win.webContents.mainFrame')
    expect((ipc.match(/^  handle\(/gm) ?? []).length).toBeGreaterThan(70)
  })

  it('creates non-identifying private per-workspace storage roots', () => {
    const userData = mkdtempSync(join(tmpdir(), 'woo-user-data-'))
    try {
      const first = workspaceDataRoot(userData, '/projects/private-name')
      const second = workspaceDataRoot(userData, '/projects/private-name')
      expect(first).toBe(second)
      expect(first).not.toContain('private-name')
      // NTFS has no POSIX permission bits — mode asserts only hold on Unix.
      if (process.platform !== 'win32') {
        expect(statSync(first).mode & 0o777).toBe(0o700)
      }
    } finally {
      rmSync(userData, { recursive: true, force: true })
    }
  })

  it('prevents local recovery and vault artifacts from being committed', () => {
    const ignored = readFileSync('.gitignore', 'utf8')
    expect(ignored).toContain('.woo/backups/')
    expect(ignored).toContain('.woo/recovery/')
    expect(ignored).toContain('.woo/vault.enc')
  })
})
