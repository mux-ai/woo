import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { CrashService } from '../src/main/crashService'

describe('CrashService', () => {
  it('redacts sensitive values and paths and writes private reports', () => {
    const userData = mkdtempSync(join(tmpdir(), 'woo-crashes-'))
    const workspace = join(userData, 'private-project')
    try {
      const service = new CrashService(userData)
      const error = new Error(
        `TOKEN=super_secret_value at ${workspace}/src/app.ts postgres://user:hunter2hunter2@db/prod`
      )
      const path = service.record('test', error, workspace)
      expect(path).not.toBeNull()
      const raw = readFileSync(path!, 'utf8')
      expect(raw).not.toContain('super_secret_value')
      expect(raw).not.toContain('hunter2hunter2')
      expect(raw).not.toContain(workspace)
      expect(raw).toContain('<workspace>')
      expect(statSync(path!).mode & 0o777).toBe(0o600)
      expect(statSync(service.directory()).mode & 0o777).toBe(0o700)
    } finally {
      rmSync(userData, { recursive: true, force: true })
    }
  })

  it('retains at most five acknowledged reports and supports deletion', () => {
    const userData = mkdtempSync(join(tmpdir(), 'woo-crashes-'))
    try {
      const service = new CrashService(userData)
      for (let i = 0; i < 8; i++) {
        service.record('test', new Error(`failure ${i}`))
        expect(service.acknowledgeLatest()).not.toBeNull()
      }
      expect(readdirSync(service.directory()).filter((name) => name.endsWith('.json'))).toHaveLength(5)
      service.clear()
      expect(() => readdirSync(service.directory())).toThrow()
    } finally {
      rmSync(userData, { recursive: true, force: true })
    }
  })
})
