import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { EditorRecoveryService, WorkspaceBackupService } from '../src/main/backupService'

describe('workspace recovery', () => {
  it('backs up ordinary files, excludes secrets, and restores safely', async () => {
    const root = mkdtempSync(join(tmpdir(), 'woo-backup-'))
    try {
      writeFileSync(join(root, 'app.ts'), 'before\n')
      writeFileSync(join(root, '.env'), 'TOKEN=never-copy-this\n')
      const service = new WorkspaceBackupService(root)
      const backup = await service.create('before test change')
      expect(backup.files).toEqual(['app.ts'])
      expect(existsSync(join(root, '.woo/backups', backup.id, 'files/.env'))).toBe(false)

      writeFileSync(join(root, 'app.ts'), 'after\n')
      await service.restore(backup.id)
      expect(readFileSync(join(root, 'app.ts'), 'utf8')).toBe('before\n')
      expect((await service.list()).length).toBeGreaterThanOrEqual(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('persists bounded unsaved buffers but never secret-named files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'woo-recovery-'))
    try {
      const service = new EditorRecoveryService(root)
      await service.save([
        { path: 'src/app.ts', content: 'unsaved' },
        { path: '.env', content: 'TOKEN=secret' }
      ])
      await expect(service.load()).resolves.toEqual([{ path: 'src/app.ts', content: 'unsaved' }])
      await service.clear()
      await expect(service.load()).resolves.toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('can keep recovery data outside the repository with private permissions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'woo-private-workspace-'))
    const storage = mkdtempSync(join(tmpdir(), 'woo-private-data-'))
    try {
      writeFileSync(join(root, 'app.ts'), 'private source\n')
      const backups = new WorkspaceBackupService(root, storage)
      const recovery = new EditorRecoveryService(root, storage)
      const backup = await backups.create('privacy test')
      await recovery.save([{ path: 'app.ts', content: 'private unsaved source' }])

      expect(existsSync(join(root, '.woo/backups'))).toBe(false)
      // NTFS has no POSIX permission bits — mode asserts only hold on Unix.
      if (process.platform !== 'win32') {
        expect(statSync(join(storage, 'backups', backup.id)).mode & 0o777).toBe(0o700)
        expect(
          statSync(join(storage, 'backups', backup.id, 'files', 'app.ts')).mode & 0o777
        ).toBe(0o600)
        expect(statSync(join(storage, 'recovery', 'unsaved.json')).mode & 0o777).toBe(0o600)
      }

      await backups.clear()
      await recovery.clear()
      expect(existsSync(join(storage, 'backups'))).toBe(false)
      expect(existsSync(join(storage, 'recovery', 'unsaved.json'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(storage, { recursive: true, force: true })
    }
  })
})
