import { promises as fs } from 'fs'
import { basename, dirname, join, relative, resolve, sep } from 'path'
import { isSecretFileName } from './secretBroker'
import type { RecoveryBuffer, WorkspaceBackup } from '../shared/types'

const EXCLUDED = new Set(['.git', '.woo', 'node_modules', 'out', 'release', 'coverage'])
const MAX_FILES = 5_000
const MAX_BYTES = 100 * 1024 * 1024
const MAX_BACKUPS = 5

function relativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
}

export class WorkspaceBackupService {
  constructor(
    private workspaceRoot: string,
    private storageRoot = join(workspaceRoot, '.woo')
  ) {}

  private root(): string {
    return join(this.storageRoot, 'backups')
  }

  private async privateDirectory(path: string): Promise<void> {
    await fs.mkdir(path, { recursive: true, mode: 0o700 })
    await fs.chmod(path, 0o700)
  }

  async create(reason: string, protectedBackupId?: string): Promise<WorkspaceBackup> {
    const createdAt = new Date().toISOString()
    const id = `agent-${createdAt.replace(/[:.]/g, '-')}`
    const destination = join(this.root(), id)
    const files: string[] = []
    let totalBytes = 0
    let truncated = false

    const walk = async (directory: string): Promise<void> => {
      if (truncated) return
      let entries = await fs.readdir(directory, { withFileTypes: true })
      entries = entries.sort((a, b) => a.name.localeCompare(b.name))
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue
        const source = join(directory, entry.name)
        if (entry.isDirectory()) {
          if (!EXCLUDED.has(entry.name)) await walk(source)
          continue
        }
        if (!entry.isFile() || isSecretFileName(entry.name)) continue
        const stat = await fs.stat(source)
        if (files.length >= MAX_FILES || totalBytes + stat.size > MAX_BYTES) {
          truncated = true
          break
        }
        const path = relativePath(this.workspaceRoot, source)
        const target = join(destination, 'files', path)
        await this.privateDirectory(dirname(target))
        await fs.copyFile(source, target)
        await fs.chmod(target, 0o600)
        files.push(path)
        totalBytes += stat.size
      }
    }

    await this.privateDirectory(destination)
    await walk(this.workspaceRoot)
    const manifest = { id, createdAt, reason, files, totalBytes, truncated }
    const manifestPath = join(destination, 'manifest.json')
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    })
    await fs.chmod(manifestPath, 0o600)
    await this.prune(protectedBackupId)
    return manifest
  }

  async list(): Promise<WorkspaceBackup[]> {
    let entries
    try {
      entries = await fs.readdir(this.root(), { withFileTypes: true })
    } catch {
      return []
    }
    const backups: WorkspaceBackup[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('agent-')) continue
      try {
        backups.push(
          JSON.parse(await fs.readFile(join(this.root(), entry.name, 'manifest.json'), 'utf8'))
        )
      } catch {
        // Ignore incomplete backup directories left by an interrupted copy.
      }
    }
    return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async restore(id: string): Promise<string[]> {
    if (!/^agent-[A-Za-z0-9-]+$/.test(id)) throw new Error('Invalid backup id.')
    const backupRoot = resolve(this.root(), id)
    if (!backupRoot.startsWith(`${resolve(this.root())}${sep}`)) throw new Error('Invalid backup path.')
    const manifest = JSON.parse(
      await fs.readFile(join(backupRoot, 'manifest.json'), 'utf8')
    ) as WorkspaceBackup
    await this.create(`Before restoring backup ${id}`, id)
    for (const path of manifest.files) {
      const destination = resolve(this.workspaceRoot, path)
      if (!destination.startsWith(`${resolve(this.workspaceRoot)}${sep}`)) {
        throw new Error('Backup contains a path outside the workspace.')
      }
      await fs.mkdir(dirname(destination), { recursive: true })
      await fs.copyFile(join(backupRoot, 'files', path), destination)
    }
    return manifest.files
  }

  private async prune(protectedBackupId?: string): Promise<void> {
    const backups = await this.list()
    const removable = backups.filter((backup) => backup.id !== protectedBackupId)
    const keepSlots = protectedBackupId ? MAX_BACKUPS - 1 : MAX_BACKUPS
    for (const backup of removable.slice(keepSlots)) {
      await fs.rm(join(this.root(), backup.id), { recursive: true, force: true })
    }
  }

  clear(): Promise<void> {
    return fs.rm(this.root(), { recursive: true, force: true })
  }
}

export class EditorRecoveryService {
  constructor(
    private workspaceRoot: string,
    private storageRoot = join(workspaceRoot, '.woo')
  ) {}

  private path(): string {
    return join(this.storageRoot, 'recovery', 'unsaved.json')
  }

  async save(buffers: RecoveryBuffer[]): Promise<void> {
    const safe = buffers
      .filter((buffer) => !isSecretFileName(basename(buffer.path)))
      .filter((buffer) => buffer.content.length <= 2 * 1024 * 1024)
      .slice(0, 25)
    if (safe.length === 0) {
      await fs.rm(this.path(), { force: true })
      return
    }
    await fs.mkdir(dirname(this.path()), { recursive: true, mode: 0o700 })
    await fs.chmod(dirname(this.path()), 0o700)
    const temporary = `${this.path()}.tmp`
    await fs.writeFile(temporary, JSON.stringify({ savedAt: Date.now(), buffers: safe }), {
      encoding: 'utf8',
      mode: 0o600
    })
    await fs.chmod(temporary, 0o600)
    await fs.rename(temporary, this.path())
  }

  async load(): Promise<RecoveryBuffer[]> {
    try {
      const value = JSON.parse(await fs.readFile(this.path(), 'utf8')) as { buffers?: unknown }
      if (!Array.isArray(value.buffers)) return []
      return value.buffers.filter(
        (buffer): buffer is RecoveryBuffer =>
          typeof buffer?.path === 'string' && typeof buffer?.content === 'string'
      )
    } catch {
      return []
    }
  }

  clear(): Promise<void> {
    return fs.rm(this.path(), { force: true })
  }
}
