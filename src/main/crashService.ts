import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { redactDiagnostic } from './redaction'

const MAX_REPORTS = 5
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export interface CrashReport {
  kind: string
  occurredAt: string
  name?: string
  message: string
  stack?: string
}

export class CrashService {
  constructor(private userDataRoot: string) {}

  directory(): string {
    return join(this.userDataRoot, 'crashes')
  }

  private ensureDirectory(): string {
    const directory = this.directory()
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    chmodSync(directory, 0o700)
    return directory
  }

  record(kind: string, error: unknown, workspaceRoot?: string): string | null {
    try {
      const directory = this.ensureDirectory()
      const path = join(directory, 'latest.json')
      const report: CrashReport = error instanceof Error
        ? {
            kind,
            occurredAt: new Date().toISOString(),
            name: redactDiagnostic(error.name, workspaceRoot),
            message: redactDiagnostic(error.message, workspaceRoot),
            stack: redactDiagnostic(error.stack ?? '', workspaceRoot)
          }
        : {
            kind,
            occurredAt: new Date().toISOString(),
            message: redactDiagnostic(error, workspaceRoot)
          }
      writeFileSync(path, JSON.stringify(report, null, 2), { encoding: 'utf8', mode: 0o600 })
      chmodSync(path, 0o600)
      this.prune()
      return path
    } catch {
      return null
    }
  }

  acknowledgeLatest(): { path: string; report: CrashReport } | null {
    const latest = join(this.directory(), 'latest.json')
    if (!existsSync(latest)) return null
    try {
      const report = JSON.parse(readFileSync(latest, 'utf8')) as CrashReport
      const path = join(
        this.ensureDirectory(),
        `acknowledged-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.json`
      )
      renameSync(latest, path)
      chmodSync(path, 0o600)
      this.prune()
      return { path, report }
    } catch {
      rmSync(latest, { force: true })
      return null
    }
  }

  clear(): void {
    rmSync(this.directory(), { recursive: true, force: true })
  }

  count(): number {
    try {
      return readdirSync(this.directory()).filter((name) => name.endsWith('.json')).length
    } catch {
      return 0
    }
  }

  private prune(): void {
    const directory = this.ensureDirectory()
    const now = Date.now()
    const reports = readdirSync(directory)
      .filter((name) => name.endsWith('.json') && name !== 'latest.json')
      .map((name) => ({ name, modified: statSync(join(directory, name)).mtimeMs }))
      .sort((a, b) => b.modified - a.modified)
    for (const report of reports) {
      if (now - report.modified > MAX_AGE_MS) rmSync(join(directory, report.name), { force: true })
    }
    const retained = reports.filter((report) => existsSync(join(directory, report.name)))
    for (const report of retained.slice(MAX_REPORTS)) {
      rmSync(join(directory, report.name), { force: true })
    }
  }
}
