import { promises as fs } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type {
  ContextPack,
  Diagnostic,
  KnowledgeGraph,
  KnowledgeDocSummary,
  KnowledgeStatus
} from '../../shared/types'
import {
  KNOWLEDGE_DIR,
  loadKnowledge,
  knowledgeFingerprint,
  type KnowledgeDoc
} from './loader'

/**
 * Native knowledge engine — same logic noli provided, built into Woo:
 * deterministic term-overlap retrieval with title boost, seed docs
 * expanded one hop over the relationship graph, bounded by a character
 * budget, every included doc listed in sources. No embeddings, no network,
 * no external CLI. Reindexes on query when files changed (mtime probe —
 * knowledge sets are small, this is milliseconds).
 */

const MAX_SEEDS = 5
const MIN_SEED_SCORE = 2
const MAX_DOCUMENTS = 5
const MAX_CHARACTERS = 14000
const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'is', 'are',
  'with', 'that', 'this', 'it', 'as', 'be', 'by', 'at', 'from', 'add', 'make'
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
}

interface DocTokens {
  title: Set<string>
  desc: Set<string>
  body: Set<string>
}

export interface RetrieveOptions {
  mode?: 'full' | 'summary'
}

export const KNOWLEDGE_SCHEMA_VERSION = 1

export class KnowledgeEngine {
  private docs: KnowledgeDoc[] = []
  private byId = new Map<string, KnowledgeDoc>()
  private byTitle = new Map<string, KnowledgeDoc>()
  private tokens = new Map<string, DocTokens>()
  private fingerprint = ''
  private schemaReady = false
  private schemaPromise: Promise<void> | null = null

  constructor(
    private workspaceRoot: string,
    private localDataRoot = join(workspaceRoot, '.woo')
  ) {}

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) return
    if (!this.schemaPromise) this.schemaPromise = this.ensureSchemaOnce()
    try {
      await this.schemaPromise
    } finally {
      this.schemaPromise = null
    }
  }

  private async ensureSchemaOnce(): Promise<void> {
    if (this.schemaReady) return
    const dir = join(this.workspaceRoot, KNOWLEDGE_DIR)
    const marker = join(dir, '.schema-version')
    try {
      const current = Number((await fs.readFile(marker, 'utf8')).trim())
      if (current > KNOWLEDGE_SCHEMA_VERSION) {
        throw new Error(
          `Knowledge schema ${current} is newer than Woo supports (${KNOWLEDGE_SCHEMA_VERSION}).`
        )
      }
      if (current === KNOWLEDGE_SCHEMA_VERSION) {
        this.schemaReady = true
        return
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    try {
      await fs.access(dir)
    } catch {
      this.schemaReady = true
      return
    }

    const backup = join(
      this.localDataRoot,
      'backups',
      `knowledge-schema-v0-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
    )
    await fs.mkdir(backup, { recursive: true, mode: 0o700 })
    await fs.cp(dir, backup, { recursive: true, filter: (source) => source !== backup })
    await fs.writeFile(marker, `${KNOWLEDGE_SCHEMA_VERSION}\n`, 'utf8')
    this.schemaReady = true
  }

  private async ensureFresh(): Promise<void> {
    await this.ensureSchema()
    const fp = await knowledgeFingerprint(this.workspaceRoot)
    if (fp === this.fingerprint && this.docs.length > 0) return
    this.fingerprint = fp
    this.docs = await loadKnowledge(this.workspaceRoot)
    this.byId = new Map(this.docs.map((d) => [d.id, d]))
    this.byTitle = new Map(this.docs.map((d) => [d.title.toLowerCase(), d]))
    // Aliases resolve like titles (relationship targets + retrieval weight).
    for (const doc of this.docs) {
      for (const alias of doc.aliases) {
        const key = alias.toLowerCase()
        if (!this.byTitle.has(key)) this.byTitle.set(key, doc)
      }
    }
    // Tokenize once per index build — score() runs per doc per retrieve.
    this.tokens = new Map(
      this.docs.map((d) => [
        d.id,
        {
          title: new Set(tokenize([d.title, ...d.aliases].join(' '))),
          desc: new Set(tokenize(d.description)),
          body: new Set(tokenize(d.body))
        }
      ])
    )
  }

  /** Resolve a relationship target written as an id OR a title. */
  private resolve(to: string): KnowledgeDoc | undefined {
    return this.byId.get(to) ?? this.byTitle.get(to.toLowerCase())
  }

  async available(): Promise<boolean> {
    await this.ensureFresh()
    return this.docs.length > 0
  }

  async status(): Promise<KnowledgeStatus> {
    await this.ensureFresh()
    const documents: KnowledgeDocSummary[] = this.docs.map((d) => ({
      id: d.id,
      title: d.title,
      type: d.type,
      description: d.description,
      path: d.path
    }))
    const byType: Record<string, KnowledgeDocSummary[]> = {}
    for (const doc of documents) {
      ;(byType[doc.type] ??= []).push(doc)
    }
    for (const list of Object.values(byType)) {
      list.sort((a, b) => a.title.localeCompare(b.title))
    }
    return { root: KNOWLEDGE_DIR, documents, byType }
  }

  private score(doc: KnowledgeDoc, terms: string[]): number {
    if (terms.length === 0) return 0
    const cached = this.tokens.get(doc.id)
    if (!cached) return 0
    let score = 0
    for (const term of terms) {
      if (cached.title.has(term)) score += 3
      else if (cached.desc.has(term)) score += 2
      else if (cached.body.has(term)) score += 1
    }
    return score
  }

  async retrieve(task: string, options: RetrieveOptions = {}): Promise<ContextPack> {
    await this.ensureFresh()
    const terms = tokenize(task)
    const mode = options.mode ?? 'full'

    const scored = this.docs
      .map((doc) => ({ doc, score: this.score(doc, terms) }))
      // Ignore isolated body-word matches. A description match scores 2 and
      // a title match scores 3, so explicit concepts still retrieve while
      // generic prompts such as typo fixes do not pull unrelated knowledge.
      .filter((s) => s.score >= MIN_SEED_SCORE)
      .sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id))
    const seeds = scored.slice(0, MAX_SEEDS)

    // 1-hop expansion: outgoing relationships + docs pointing at a seed.
    type Picked = {
      doc: KnowledgeDoc
      seed: boolean
      score?: number
      distance: number
      relationship?: string
    }
    const picked = new Map<string, Picked>()
    for (const { doc, score } of seeds) {
      picked.set(doc.id, { doc, seed: true, score, distance: 0 })
    }
    for (const { doc } of seeds) {
      for (const rel of doc.relationships) {
        const target = this.resolve(rel.to)
        if (target && !picked.has(target.id)) {
          picked.set(target.id, {
            doc: target,
            seed: false,
            distance: 1,
            relationship: rel.predicate
          })
        }
      }
      for (const other of this.docs) {
        if (picked.has(other.id)) continue
        const rel = other.relationships.find((r) => {
          const t = this.resolve(r.to)
          return t?.id === doc.id
        })
        if (rel) {
          picked.set(other.id, {
            doc: other,
            seed: false,
            distance: 1,
            relationship: `${rel.predicate} (inverse)`
          })
        }
      }
    }

    const ordered = [...picked.values()]
      .sort(
        (a, b) =>
          a.distance - b.distance ||
          (b.score ?? 0) - (a.score ?? 0) ||
          a.doc.id.localeCompare(b.doc.id)
      )
      .slice(0, MAX_DOCUMENTS)

    let context = ordered.length > 0
      ? `${mode === 'summary' ? '# Knowledge summary' : '# Context'} for: ${task}\n\n`
      : ''
    const included: Picked[] = []
    for (const pick of ordered) {
      const detail = mode === 'summary'
        ? pick.doc.description
        : [pick.doc.description, pick.doc.body.trim()].filter(Boolean).join('\n\n')
      const section =
        `## ${pick.doc.title} (${pick.doc.type}${pick.seed ? ', seed' : ''})\n` +
        `Source: ${pick.doc.path}\n\n` +
        (detail ? `${detail}\n\n` : '')
      if (context.length + section.length > MAX_CHARACTERS && included.length > 0) break
      context += section
      included.push(pick)
    }

    return {
      task,
      context,
      sources: included.map((p) => ({
        id: p.doc.id,
        seed: p.seed,
        score: p.score,
        distance: p.distance,
        relationship: p.relationship
      })),
      documents: included.map((p) => ({
        id: p.doc.id,
        title: p.doc.title,
        type: p.doc.type,
        path: p.doc.path
      })),
      tokenEstimate: Math.round(context.length / 4)
    }
  }

  /**
   * Knowledge-base lint: relationships whose target resolves to no doc
   * (title/alias typo, deleted doc). These edges silently vanish from the
   * graph and from 1-hop retrieval — surface them as diagnostics instead.
   */
  async validate(): Promise<Diagnostic[]> {
    await this.ensureFresh()
    const diagnostics: Diagnostic[] = []
    for (const doc of this.docs) {
      for (const rel of doc.relationships) {
        if (this.resolve(rel.to)) continue
        diagnostics.push({
          ruleId: 'KNOW-EDGE',
          message: `KNOW-EDGE: relationship "${rel.predicate}: ${rel.to}" resolves to no knowledge doc — edge is dropped from the graph.`,
          file: doc.path,
          line: 1,
          column: 1,
          severity: 'warning',
          source: 'Knowledge Graph',
          definedIn: doc.path
        })
      }
    }
    return diagnostics
  }

  async graph(id?: string): Promise<KnowledgeGraph> {
    await this.ensureFresh()
    const docs = id
      ? this.neighborhood(id)
      : this.docs
    const ids = new Set(docs.map((d) => d.id))
    const nodes = docs.map((d) => ({
      id: d.id,
      title: d.title,
      type: d.type,
      path: d.path,
      layer: 'knowledge' as const
    }))
    const edges: KnowledgeGraph['edges'] = []
    const seen = new Set<string>()
    for (const doc of this.docs) {
      for (const rel of doc.relationships) {
        const target = this.resolve(rel.to)
        if (!target) continue
        if (!ids.has(doc.id) || !ids.has(target.id)) continue
        const key = `${doc.id}|${rel.predicate}|${target.id}`
        if (seen.has(key)) continue
        seen.add(key)
        edges.push({
          from: doc.id,
          to: target.id,
          predicate: rel.predicate,
          layer: 'knowledge'
        })
      }
    }
    return { nodes, edges }
  }

  private neighborhood(id: string): KnowledgeDoc[] {
    const center = this.byId.get(id)
    if (!center) return []
    const result = new Map<string, KnowledgeDoc>([[center.id, center]])
    for (const rel of center.relationships) {
      const t = this.resolve(rel.to)
      if (t) result.set(t.id, t)
    }
    for (const other of this.docs) {
      if (other.relationships.some((r) => this.resolve(r.to)?.id === center.id)) {
        result.set(other.id, other)
      }
    }
    return [...result.values()]
  }

  async getDocument(id: string): Promise<{ id: string; title: string; content: string }> {
    await this.ensureFresh()
    const doc = this.byId.get(id)
    if (!doc) throw new Error(`knowledge document not found: ${id}`)
    return { id, title: doc.title, content: doc.body }
  }

  /** All machine-checkable rules (frontmatter `checks:`). */
  async ruleChecks(): Promise<
    { ruleId: string; ruleTitle: string; definedIn: string; pattern: string; severity: 'error' | 'warning' | 'info'; message: string }[]
  > {
    await this.ensureFresh()
    const out = []
    for (const doc of this.docs) {
      if (doc.type !== 'Business Rule') continue
      for (const check of doc.checks) {
        out.push({
          ruleId: doc.title.split(' ')[0],
          ruleTitle: doc.title,
          definedIn: doc.path,
          pattern: check.pattern,
          severity: check.severity,
          message: check.message
        })
      }
    }
    return out
  }

  /** Scaffold starter knowledge for a fresh project. */
  async initialize(): Promise<void> {
    const dir = join(this.workspaceRoot, KNOWLEDGE_DIR)
    await fs.mkdir(join(dir, 'rules'), { recursive: true })
    await fs.mkdir(join(dir, 'decisions'), { recursive: true })
    await fs.mkdir(join(dir, 'entities'), { recursive: true })
    const write = async (rel: string, content: string) => {
      try {
        await fs.writeFile(join(dir, rel), content, { encoding: 'utf8', flag: 'wx' })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    await Promise.all([
      write(
        'rules/no-hardcoded-secrets.md',
        `---
title: SEC-001 No Hardcoded Secrets
type: rule
description: Secrets belong in the environment, never in source code.
relationships:
  - predicate: applies-to
    to: Example Service
checks:
  - pattern: '(api[_-]?key|secret|token|password)\\s*[:=]\\s*[\\x27"][A-Za-z0-9+/_-]{16,}[\\x27"]'
    severity: warning
    message: Possible hardcoded secret — move it to a secret store.
---
Secrets committed to source outlive rotation, leak through forks and
search indexes, and are visible to any tool that reads the repo. Keep
them in the environment or a vault; reference them by name in code.
`
      ),
      write(
        'decisions/adr-001-example.md',
        `---
title: ADR-001 Record Decisions Here
type: decision
description: Significant technology and structure choices live in .woo/knowledge/decisions.
---
One file per decision. State the decision and its consequences; link the
components it governs with relationships. The agent retrieves these
before executing tasks, so decisions written here actually steer it.
`
      ),
      write(
        'entities/example-service.md',
        `---
title: Example Service
type: entity
description: Replace with a real domain entity from this project.
relationships:
  - predicate: follows
    to: ADR-001 Record Decisions Here
---
Describe what this entity is, what state it owns, and which rules govern
it. Delete this file once real knowledge exists.
`
      )
    ])
    await fs.writeFile(join(dir, '.schema-version'), `${KNOWLEDGE_SCHEMA_VERSION}\n`, 'utf8')
    this.schemaReady = true
  }
}
