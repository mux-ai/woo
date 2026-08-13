import { promises as fs } from 'fs'
import { basename, dirname, extname, join, relative, sep } from 'path'
import type { SourceGraph } from '../shared/types'

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.woo',
  'node_modules',
  'out',
  'dist',
  'build',
  'coverage',
  '.next',
  '.cache'
])
const MAX_FILES = 400
const MAX_FILE_BYTES = 512 * 1024
const IMPORT_PATTERN = /(?:\bimport\s+(?:[^'";]+?\s+from\s+)?|\bexport\s+[^'";]*?\s+from\s+|\brequire\s*\(|\bimport\s*\()\s*['"]([^'"]+)['"]/g

function normalize(path: string): string {
  return path.split(sep).join('/')
}

/** Bounded, offline TypeScript/JavaScript relative-import graph. */
export class SourceGraphService {
  constructor(private workspaceRoot: string) {}

  private async sourceFiles(): Promise<string[]> {
    const paths: string[] = []
    const walk = async (directory: string): Promise<void> => {
      if (paths.length >= MAX_FILES) return
      let entries
      try {
        entries = await fs.readdir(directory, { withFileTypes: true })
      } catch {
        return
      }
      entries.sort((a, b) => a.name.localeCompare(b.name))
      for (const entry of entries) {
        if (paths.length >= MAX_FILES) return
        const absolute = join(directory, entry.name)
        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name)) await walk(absolute)
        } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
          paths.push(normalize(relative(this.workspaceRoot, absolute)))
        }
      }
    }
    await walk(this.workspaceRoot)
    return paths
  }

  private resolveImport(from: string, specifier: string, paths: Set<string>): string | null {
    if (!specifier.startsWith('.')) return null
    const base = normalize(join(dirname(from), specifier))
    const candidates = [
      base,
      ...[...SOURCE_EXTENSIONS].map((extension) => `${base}${extension}`),
      ...[...SOURCE_EXTENSIONS].map((extension) => `${base}/index${extension}`)
    ]
    return candidates.find((candidate) => paths.has(candidate)) ?? null
  }

  async graph(): Promise<SourceGraph> {
    const paths = await this.sourceFiles()
    const known = new Set(paths)
    const edges: SourceGraph['edges'] = []
    const seen = new Set<string>()
    for (const path of paths) {
      const absolute = join(this.workspaceRoot, path)
      try {
        const stat = await fs.stat(absolute)
        if (stat.size > MAX_FILE_BYTES) continue
        const content = await fs.readFile(absolute, 'utf-8')
        if (content.includes('\0')) continue
        IMPORT_PATTERN.lastIndex = 0
        for (const match of content.matchAll(IMPORT_PATTERN)) {
          const target = this.resolveImport(path, match[1], known)
          if (!target) continue
          const key = `${path}|${target}`
          if (seen.has(key)) continue
          seen.add(key)
          edges.push({
            from: `code:${path}`,
            to: `code:${target}`,
            predicate: 'imports',
            layer: 'code'
          })
        }
      } catch {
        // A source file may disappear during the scan.
      }
    }
    return {
      nodes: paths.map((path) => ({
        id: `code:${path}`,
        title: basename(path),
        type: 'Source File',
        path,
        layer: 'code'
      })),
      edges
    }
  }
}
