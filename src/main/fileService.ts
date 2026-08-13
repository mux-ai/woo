import { promises as fs } from 'fs'
import { join, basename, relative, sep } from 'path'
import type {
  FileNode,
  ReplaceResult,
  SearchMatch,
  SearchOptions,
  SearchResult
} from '../shared/types'

const IGNORED_DIRS = new Set(['node_modules', '.git', 'out', 'dist', '.woo-cache'])
const MAX_SEARCH_RESULTS = 500
const MAX_SEARCHABLE_BYTES = 1024 * 1024
const SEARCH_BATCH = 16

/**
 * Workspace file operations, main-process only (UI-001).
 * Human-originated reads are unrestricted — it is the user's machine.
 * Agent-originated reads never come through here; they go through the
 * Agent Runner where the Secret Broker gates them.
 */
export class FileService {
  constructor(private workspaceRoot: string) {}

  private resolveInWorkspace(relPath: string): string {
    const abs = join(this.workspaceRoot, relPath)
    const rel = relative(this.workspaceRoot, abs)
    if (rel.startsWith('..') || rel.split(sep).includes('..')) {
      throw new Error('Path escapes workspace')
    }
    return abs
  }

  async readTree(dir = ''): Promise<FileNode[]> {
    const abs = this.resolveInWorkspace(dir)
    const entries = await fs.readdir(abs, { withFileTypes: true })
    const nodes: FileNode[] = []
    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue
      const childRel = dir ? join(dir, entry.name) : entry.name
      if (entry.isDirectory()) {
        nodes.push({
          name: entry.name,
          path: childRel,
          type: 'directory',
          children: await this.readTree(childRel)
        })
      } else {
        nodes.push({ name: entry.name, path: childRel, type: 'file' })
      }
    }
    nodes.sort((a, b) =>
      a.type !== b.type ? (a.type === 'directory' ? -1 : 1) : a.name.localeCompare(b.name)
    )
    return nodes
  }

  /** One directory level, lazily loaded by the explorer. */
  async list(dir = ''): Promise<FileNode[]> {
    const abs = this.resolveInWorkspace(dir)
    const entries = await fs.readdir(abs, { withFileTypes: true })
    const nodes: FileNode[] = []
    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue
      const childRel = dir ? join(dir, entry.name) : entry.name
      nodes.push({
        name: entry.name,
        path: childRel,
        type: entry.isDirectory() ? 'directory' : 'file'
      })
    }
    nodes.sort((a, b) =>
      a.type !== b.type ? (a.type === 'directory' ? -1 : 1) : a.name.localeCompare(b.name)
    )
    return nodes
  }

  async readFile(relPath: string): Promise<string> {
    return fs.readFile(this.resolveInWorkspace(relPath), 'utf-8')
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    await fs.writeFile(this.resolveInWorkspace(relPath), content, 'utf-8')
  }

  /** Absolute path for main-process-only operations (trash, watch). */
  absolute(relPath: string): string {
    return this.resolveInWorkspace(relPath)
  }

  async createFile(relPath: string): Promise<void> {
    const abs = this.resolveInWorkspace(relPath)
    await fs.mkdir(join(abs, '..'), { recursive: true })
    await fs.writeFile(abs, '', { encoding: 'utf-8', flag: 'wx' }) // fail if exists
  }

  async createDir(relPath: string): Promise<void> {
    await fs.mkdir(this.resolveInWorkspace(relPath), { recursive: true })
  }

  async rename(fromRel: string, toRel: string): Promise<void> {
    const to = this.resolveInWorkspace(toRel)
    await fs.mkdir(join(to, '..'), { recursive: true })
    await fs.rename(this.resolveInWorkspace(fromRel), to)
  }

  workspaceName(): string {
    return basename(this.workspaceRoot)
  }

  /** All searchable file paths (workspace-relative), ignored dirs skipped. */
  private async listFiles(dir = ''): Promise<string[]> {
    const abs = this.resolveInWorkspace(dir)
    let entries
    try {
      entries = await fs.readdir(abs, { withFileTypes: true })
    } catch {
      return []
    }

    const files: string[] = []
    const directories: string[] = []
    for (const entry of entries) {
      const childRel = dir ? join(dir, entry.name) : entry.name
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) directories.push(childRel)
      } else {
        files.push(childRel)
      }
    }

    // Directory I/O is independent. A small fixed batch keeps the palette fast
    // on broad workspaces without opening an unbounded number of descriptors.
    for (let i = 0; i < directories.length; i += 32) {
      const nested = await Promise.all(
        directories.slice(i, i + 32).map((child) => this.listFiles(child))
      )
      for (const paths of nested) files.push(...paths)
    }
    return files
  }

  /** Flat path list for the command palette (capped). */
  async allPaths(): Promise<string[]> {
    return (await this.listFiles()).slice(0, 20000)
  }

  private buildPattern(queryText: string, opts: SearchOptions): RegExp | string {
    const flags = 'g' + (opts.caseSensitive ? '' : 'i')
    const source = opts.regex
      ? queryText
      : queryText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    try {
      return new RegExp(source, flags)
    } catch (err) {
      return `Invalid regex: ${String((err as Error).message)}`
    }
  }

  private async readSearchable(relPath: string): Promise<string | null> {
    try {
      const abs = this.resolveInWorkspace(relPath)
      const stat = await fs.stat(abs)
      if (stat.size > MAX_SEARCHABLE_BYTES) return null
      const content = await fs.readFile(abs, 'utf-8')
      if (content.includes('\0')) return null
      return content
    } catch {
      return null
    }
  }

  /** Workspace search: plain substring or regex, batched file reads. */
  async search(queryText: string, opts: SearchOptions = {}): Promise<SearchResult> {
    if (!queryText) return { matches: [] }
    const pattern = this.buildPattern(queryText, opts)
    if (typeof pattern === 'string') return { matches: [], error: pattern }
    const paths = await this.listFiles()
    const matches: SearchMatch[] = []
    for (let i = 0; i < paths.length && matches.length < MAX_SEARCH_RESULTS; i += SEARCH_BATCH) {
      const batch = paths.slice(i, i + SEARCH_BATCH)
      const contents = await Promise.all(batch.map((p) => this.readSearchable(p)))
      for (let j = 0; j < batch.length; j++) {
        const content = contents[j]
        if (content == null) continue
        const lines = content.split('\n')
        for (let k = 0; k < lines.length; k++) {
          pattern.lastIndex = 0
          const m = pattern.exec(lines[k])
          if (!m) continue
          matches.push({
            file: batch[j],
            line: k + 1,
            column: (m.index ?? 0) + 1,
            preview: lines[k].trim().slice(0, 200)
          })
          if (matches.length >= MAX_SEARCH_RESULTS) break
        }
        if (matches.length >= MAX_SEARCH_RESULTS) break
      }
    }
    return { matches, truncated: matches.length >= MAX_SEARCH_RESULTS }
  }

  /** Replace across the workspace. Regex replacements support $1 groups. */
  async replaceAll(
    queryText: string,
    replacement: string,
    opts: SearchOptions = {}
  ): Promise<ReplaceResult> {
    if (!queryText) return { files: 0, replacements: 0 }
    const pattern = this.buildPattern(queryText, opts)
    if (typeof pattern === 'string') return { files: 0, replacements: 0, error: pattern }
    const paths = await this.listFiles()
    let files = 0
    let replacements = 0
    for (let i = 0; i < paths.length; i += SEARCH_BATCH) {
      const batch = paths.slice(i, i + SEARCH_BATCH)
      await Promise.all(
        batch.map(async (p) => {
          const content = await this.readSearchable(p)
          if (content == null) return
          pattern.lastIndex = 0
          const count = (content.match(pattern) ?? []).length
          if (count === 0) return
          pattern.lastIndex = 0
          const next = content.replace(pattern, replacement)
          if (next === content) return
          await fs.writeFile(this.resolveInWorkspace(p), next, 'utf-8')
          files += 1
          replacements += count
        })
      )
    }
    return { files, replacements }
  }
}
