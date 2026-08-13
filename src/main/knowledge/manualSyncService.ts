import { query, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '@anthropic-ai/claude-agent-sdk'
import { promises as fs } from 'fs'
import { join, resolve, sep } from 'path'
import type { KnowledgeSyncReview } from '../../shared/types'
import { SecretBroker } from '../secretBroker'
import { KnowledgeEngine } from './engine'
import { KNOWLEDGE_DIR } from './loader'
import { KnowledgeSyncService, type ProposalDraft } from './syncService'

/**
 * Manual-edit knowledge sync (KNOW-001, the other direction): when the
 * developer edits and saves code BY HAND, batch the saved files, ask one
 * tool-less model turn whether the affected knowledge docs need real content
 * updates, and surface the result through the existing review/apply UI —
 * nothing is written without explicit approval.
 *
 * Cost control: saves are debounced (45s of quiet), one review in flight at
 * a time, bounded file and doc payloads. Loop guard: saves under .woo/ are
 * ignored, so applying a proposal can never re-trigger a review of itself.
 */

type ClaudeQuery = typeof query

const DEBOUNCE_MS = 45_000
const REVIEW_TIMEOUT_MS = 60_000
const MAX_BATCH_FILES = 12
const MAX_FILE_CHARS = 8_000
const MAX_DOCS = 3
const MAX_DOC_CHARS = 12_000
const MAX_PROPOSAL_CHARS = 32_000

function cacheableSystemPrompt(staticBlock: string): string[] | undefined {
  return staticBlock ? [staticBlock, SYSTEM_PROMPT_DYNAMIC_BOUNDARY] : undefined
}

export class ManualKnowledgeSync {
  private pendingPaths = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private aborter: AbortController | null = null
  private running = false

  constructor(
    private workspaceRoot: string,
    private broker: SecretBroker,
    private knowledge: KnowledgeEngine,
    private sync: KnowledgeSyncService,
    private notify: (review: KnowledgeSyncReview) => void,
    private queryClient: ClaudeQuery = query,
    private debounceMs = DEBOUNCE_MS
  ) {}

  /** Call on every successful editor save (workspace-relative path). */
  noteSaved(path: string): void {
    // Loop guard + noise guard: knowledge/apply writes, VCS internals, and
    // secret-named files never trigger an AI review.
    if (path.startsWith('.woo/') || path.startsWith('.git/')) return
    if (!this.broker.checkPath(path).allowed) return
    this.pendingPaths.add(path)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void this.flush()
    }, this.debounceMs)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pendingPaths.clear()
    this.aborter?.abort()
    this.aborter = null
  }

  /** Run the batched review now (also the debounce target). */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.running || this.pendingPaths.size === 0) return
    const changedFiles = [...this.pendingPaths].slice(0, MAX_BATCH_FILES)
    this.pendingPaths.clear()
    this.running = true
    try {
      const review = await this.review(changedFiles)
      if (review && review.proposals.length > 0) this.notify(review)
    } catch {
      // Best-effort background feature — a failed review must never surface
      // as an error popup for a plain file save.
    } finally {
      this.running = false
    }
  }

  private buildAgentEnv(): Record<string, string> {
    const SECRET_NAME = /(secret|token|password|passwd|private|credential|api[_-]?key)/i
    const env: Record<string, string> = {}
    for (const [name, value] of Object.entries(process.env)) {
      if (value == null) continue
      if (name.startsWith('ANTHROPIC_') || name.startsWith('CLAUDE_')) {
        env[name] = value
        continue
      }
      if (SECRET_NAME.test(name)) continue
      if (this.broker.scrub(value) !== value) continue
      env[name] = value
    }
    return env
  }

  private async review(changedFiles: string[]): Promise<KnowledgeSyncReview | null> {
    // Current content of the manually edited files (scrubbed, bounded).
    const fileBlocks: string[] = []
    for (const path of changedFiles) {
      try {
        const raw = await fs.readFile(join(this.workspaceRoot, path), 'utf-8')
        fileBlocks.push(`<file path="${path}">\n${this.broker.scrub(raw.slice(0, MAX_FILE_CHARS))}\n</file>`)
      } catch {
        // Deleted between save and review — skip.
      }
    }
    if (fileBlocks.length === 0) return null

    // Candidate knowledge docs: retrieval over the changed paths, raw
    // markdown read from disk (the model must return a full replacement
    // document, frontmatter included).
    const pack = await this.knowledge.retrieve(changedFiles.join(' '), { mode: 'summary' })
    const knowledgeRoot = resolve(this.workspaceRoot, KNOWLEDGE_DIR)
    const candidates: { id: string; title: string; path: string; content: string }[] = []
    for (const doc of pack.documents) {
      if (candidates.length >= MAX_DOCS) break
      if (!doc.path) continue
      const absolute = resolve(this.workspaceRoot, doc.path)
      if (absolute !== knowledgeRoot && !absolute.startsWith(`${knowledgeRoot}${sep}`)) continue
      try {
        const content = await fs.readFile(absolute, 'utf-8')
        if (content.length > MAX_DOC_CHARS) continue
        candidates.push({ id: doc.id, title: doc.title, path: doc.path, content })
      } catch {
        // Doc listed but unreadable — skip.
      }
    }
    if (candidates.length === 0) return null

    const controller = new AbortController()
    this.aborter?.abort()
    this.aborter = controller
    const timeout = setTimeout(() => controller.abort(), REVIEW_TIMEOUT_MS)
    let text = ''
    try {
      const session = this.queryClient({
        prompt:
          'The developer manually edited the workspace files below. Review the knowledge documents ' +
          'and decide whether any of them are now stale: outdated rules, wrong descriptions, missing ' +
          'or obsolete relationships, incorrect checks.\n\n' +
          'Reply with ONLY a JSON array (no markdown fences). One entry per document that genuinely ' +
          'needs a change: {"path": "<document path exactly as given>", "reason": "<one sentence>", ' +
          '"updatedMarkdown": "<the complete replacement document, YAML frontmatter included>"}. ' +
          'Keep each document\'s existing frontmatter schema. Reply with [] when nothing needs updating — ' +
          'most saves change no knowledge.\n\n' +
          `<changed-files>\n${fileBlocks.join('\n')}\n</changed-files>\n\n` +
          '<knowledge-documents>\n' +
          candidates
            .map((doc) => `<document path="${doc.path}" title="${doc.title}">\n${doc.content}\n</document>`)
            .join('\n') +
          '\n</knowledge-documents>',
        options: {
          cwd: this.workspaceRoot,
          systemPrompt: cacheableSystemPrompt(
            'You maintain a project knowledge base of Markdown documents with YAML frontmatter. ' +
              'You only propose updates that a reviewer would accept: factual, minimal, grounded in the code shown.'
          ),
          abortController: controller,
          permissionMode: 'default',
          tools: [],
          maxTurns: 1,
          env: this.buildAgentEnv(),
          settingSources: []
        }
      })
      for await (const message of session) {
        if (message.type === 'assistant') {
          for (const block of message.message.content) {
            if (block.type === 'text') text += block.text
          }
        }
      }
      ;(session as { close?: () => void }).close?.()
    } finally {
      clearTimeout(timeout)
      if (this.aborter === controller) this.aborter = null
    }
    if (controller.signal.aborted) return null

    const drafts = this.parseProposals(text, candidates)
    if (drafts.length === 0) return null
    const review = this.sync.registerReview(
      `Manual edits: ${changedFiles.join(', ')}`.slice(0, 200),
      changedFiles,
      drafts
    )
    return review
  }

  private parseProposals(
    text: string,
    candidates: { id: string; title: string; path: string; content: string }[]
  ): ProposalDraft[] {
    const unfenced = text.replace(/^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/, '$1').trim()
    let parsed: unknown
    try {
      parsed = JSON.parse(unfenced)
    } catch {
      return []
    }
    if (!Array.isArray(parsed)) return []
    const drafts: ProposalDraft[] = []
    for (const entry of parsed.slice(0, MAX_DOCS)) {
      if (entry == null || typeof entry !== 'object') continue
      const { path, reason, updatedMarkdown } = entry as Record<string, unknown>
      if (typeof path !== 'string' || typeof reason !== 'string' || typeof updatedMarkdown !== 'string') continue
      const doc = candidates.find((candidate) => candidate.path === path)
      if (!doc) continue // the model may only touch the documents it was shown
      const proposedContent = this.broker.scrub(updatedMarkdown)
      if (
        proposedContent.length === 0 ||
        proposedContent.length > MAX_PROPOSAL_CHARS ||
        !proposedContent.startsWith('---') ||
        proposedContent === doc.content
      ) {
        continue
      }
      drafts.push({
        documentId: doc.id,
        documentTitle: doc.title,
        path: doc.path,
        reason: reason.slice(0, 300),
        diff: `@@ ${doc.title} · AI update after manual edits @@\n${reason.slice(0, 300)}`,
        tokenDeltaEstimate: Math.round((proposedContent.length - doc.content.length) / 4),
        originalContent: doc.content,
        proposedContent
      })
    }
    return drafts
  }
}
