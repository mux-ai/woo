import { promises as fs } from 'fs'
import { join, relative, sep } from 'path'
import { parse as parseYaml } from 'yaml'
import type { Severity } from '../../shared/types'

/**
 * Native knowledge loader — developers author plain Markdown files with
 * YAML frontmatter anywhere under `.woo/knowledge/` in their repo:
 *
 *   ---
 *   title: Declined Payments Never Retry
 *   type: rule                # rule | entity | component | workflow | decision
 *   description: Declined payments must never be automatically retried.
 *   relationships:
 *     - predicate: applies-to # applies-to | depends-on | enforced-by | uses | follows
 *       to: Payment Worker    # another doc's title or id
 *   checks:                   # optional, rules only — machine-checkable
 *     - pattern: 'Result\.retry\(\)'
 *       severity: warning
 *       message: Declined payment branch must not retry.
 *   ---
 *   Free Markdown body explaining the rule…
 *
 * Doc id = file path relative to .woo/knowledge, without extension.
 */

export const KNOWLEDGE_DIR = join('.woo', 'knowledge')

export const DOC_TYPES: Record<string, string> = {
  rule: 'Business Rule',
  entity: 'Domain Entity',
  component: 'Application Component',
  workflow: 'Workflow',
  decision: 'Architecture Decision'
}

export const PREDICATES = new Set([
  'applies-to',
  'depends-on',
  'enforced-by',
  'uses',
  'follows'
])

export interface KnowledgeCheck {
  pattern: string
  severity: Severity
  message: string
}

export interface KnowledgeDoc {
  id: string
  path: string // repo-relative file path
  title: string
  type: string // canonical label, e.g. "Business Rule"
  description: string
  aliases: string[] // synonyms; weighted like the title in retrieval
  body: string
  relationships: { predicate: string; to: string }[]
  checks: KnowledgeCheck[]
  mtimeMs: number
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(full)))
    } else if (entry.name.endsWith('.md')) {
      files.push(full)
    }
  }
  return files
}

export function splitFrontmatter(raw: string): { meta: any; body: string } | null {
  if (!raw.startsWith('---')) return null
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return null
  const metaRaw = raw.slice(3, end)
  const body = raw.slice(raw.indexOf('\n', end + 1) + 1)
  try {
    const meta = parseYaml(metaRaw)
    if (!meta || typeof meta !== 'object') return null
    return { meta, body }
  } catch {
    return null
  }
}

export async function loadKnowledge(workspaceRoot: string): Promise<KnowledgeDoc[]> {
  const rootDir = join(workspaceRoot, KNOWLEDGE_DIR)
  const files = await listMarkdownFiles(rootDir)
  const docs: KnowledgeDoc[] = []
  for (const file of files) {
    let raw: string
    let stat
    try {
      ;[raw, stat] = await Promise.all([fs.readFile(file, 'utf-8'), fs.stat(file)])
    } catch {
      continue
    }
    const parsed = splitFrontmatter(raw)
    if (!parsed) continue
    const { meta, body } = parsed
    if (!meta.title || !meta.type) continue
    const typeLabel = DOC_TYPES[String(meta.type).toLowerCase()] ?? String(meta.type)
    const id = relative(rootDir, file).split(sep).join('/').replace(/\.md$/, '')
    const relationships = Array.isArray(meta.relationships)
      ? meta.relationships
          .filter((r: any) => r && r.predicate && r.to && PREDICATES.has(String(r.predicate)))
          .map((r: any) => ({ predicate: String(r.predicate), to: String(r.to) }))
      : []
    const checks: KnowledgeCheck[] = Array.isArray(meta.checks)
      ? meta.checks
          .filter((c: any) => c && c.pattern && c.message)
          .map((c: any) => ({
            pattern: String(c.pattern),
            severity: (['error', 'warning', 'info'].includes(c.severity)
              ? c.severity
              : 'warning') as Severity,
            message: String(c.message)
          }))
      : []
    docs.push({
      id,
      path: join(KNOWLEDGE_DIR, relative(rootDir, file)).split(sep).join('/'),
      title: String(meta.title),
      type: typeLabel,
      description: String(meta.description ?? ''),
      aliases: Array.isArray(meta.aliases) ? meta.aliases.map(String) : [],
      body,
      relationships,
      checks,
      mtimeMs: stat.mtimeMs
    })
  }
  return docs
}

/** Cheap staleness probe: latest mtime + file count under .woo/knowledge. */
export async function knowledgeFingerprint(workspaceRoot: string): Promise<string> {
  const files = await listMarkdownFiles(join(workspaceRoot, KNOWLEDGE_DIR))
  let latest = 0
  for (const file of files) {
    try {
      const stat = await fs.stat(file)
      if (stat.mtimeMs > latest) latest = stat.mtimeMs
    } catch {
      /* ignore */
    }
  }
  return `${files.length}:${latest}`
}
