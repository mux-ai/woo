import { watch, type FSWatcher } from 'chokidar'
import { relative, sep, basename } from 'path'
import { isSecretFileName, SecretBroker } from './secretBroker'

const IGNORED_DIRS = new Set(['node_modules', '.git', 'out', 'dist', '.woo-cache'])
const DEBOUNCE_MS = 200

/**
 * Workspace disk watcher. Batches change events (~200ms quiet period) and
 * reports workspace-relative paths so the renderer can refresh the tree and
 * reload clean buffers. When a secret-bearing file changes, the Secret
 * Broker reloads so fresh values are scrubbable without a restart.
 */
export class WatcherService {
  private watcher: FSWatcher | null = null
  private pending = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private workspaceRoot: string,
    private broker: SecretBroker,
    private onBatch: (paths: string[]) => void
  ) {}

  start(): void {
    this.watcher = watch(this.workspaceRoot, {
      ignoreInitial: true,
      ignored: (path) => {
        const rel = relative(this.workspaceRoot, path)
        if (!rel || rel.startsWith('..')) return false
        return rel.split(sep).some((part) => IGNORED_DIRS.has(part))
      }
    })
    const record = (path: string) => {
      const rel = relative(this.workspaceRoot, path).split(sep).join('/')
      if (!rel || rel.startsWith('..')) return
      if (isSecretFileName(basename(path))) this.broker.reload()
      this.pending.add(rel)
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS)
    }
    this.watcher.on('add', record)
    this.watcher.on('change', record)
    this.watcher.on('unlink', record)
    this.watcher.on('addDir', record)
    this.watcher.on('unlinkDir', record)
  }

  private flush(): void {
    const paths = [...this.pending]
    this.pending.clear()
    this.timer = null
    if (paths.length > 0) this.onBatch(paths)
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    await this.watcher?.close()
    this.watcher = null
  }
}
