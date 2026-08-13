import { createHash, randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { basename, join, relative, resolve, sep } from 'path'
import type {
  KnowledgeSyncApplyResult,
  KnowledgeSyncProposal,
  KnowledgeSyncReview
} from '../../shared/types'
import { KnowledgeEngine } from './engine'
import { KNOWLEDGE_DIR } from './loader'

const EXCLUDED_DIRECTORIES = new Set([
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
const SECRET_FILE = /(^|\/)(\.env(?:\.[^/]*)?|\.npmrc|\.netrc|credentials(?:\.[^/]*)?|id_(?:rsa|ed25519)|[^/]+\.(?:pem|key))$/i
const MAX_FILES = 10_000
const MAX_HASH_BYTES = 512 * 1024
const MAX_CHANGED_FILES = 100
const MAX_PROPOSALS = 3
const MAX_STATUS_FILES = 5
const SYNC_START = '<!-- woo-sync:start -->'
const SYNC_END = '<!-- woo-sync:end -->'

export type WorkspaceSnapshot = Map<string, string>

export interface PendingProposal extends KnowledgeSyncProposal {
  originalContent: string
  proposedContent: string
}

/** Everything a proposal needs before it gets a review-scoped id. */
export interface ProposalDraft {
  documentId: string
  documentTitle: string
  path: string
  reason: string
  diff: string
  tokenDeltaEstimate: number
  originalContent: string
  proposedContent: string
}

interface PendingReview {
  proposals: Map<string, PendingProposal>
}

function repoPath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join('/')
}

function oneLine(value: string, max: number): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length <= max ? compact : `${compact.slice(0, max - 1)}…`
}

function managedStatusBlock(date: string, task: string, changedFiles: string[]): string {
  const shownFiles = changedFiles.slice(0, MAX_STATUS_FILES)
  const more = changedFiles.length - shownFiles.length
  const files = shownFiles.map((path) => `\`${path}\``).join(', ') + (more > 0 ? ` (+${more} more)` : '')
  return `## Implementation status

${SYNC_START}
Last verified: ${date}
Recent task: ${oneLine(task, 120)}
Touchpoints: ${files}
${SYNC_END}`
}

function replaceManagedStatus(original: string, nextBlock: string): {
  content: string
  previousBlock: string | null
} {
  const markerStart = original.indexOf(SYNC_START)
  if (markerStart >= 0) {
    const headingStart = original.lastIndexOf('\n## Implementation status', markerStart)
    const markerEnd = original.indexOf(SYNC_END, markerStart)
    if (headingStart >= 0 && markerEnd >= 0) {
      const end = markerEnd + SYNC_END.length
      const previousBlock = original.slice(headingStart + 1, end)
      return {
        content: `${original.slice(0, headingStart)}\n${nextBlock}${original.slice(end)}`.replace(/\s*$/, '\n'),
        previousBlock
      }
    }
  }

  // Migrate Woo's earlier append-only section. Stop at the next level-two
  // heading if a developer added content after it.
  const legacy = /\n## Implementation history\s*\n[\s\S]*?(?=\n## |\s*$)/.exec(original)
  if (legacy?.index != null) {
    return {
      content: `${original.slice(0, legacy.index)}\n${nextBlock}${original.slice(legacy.index + legacy[0].length)}`.replace(/\s*$/, '\n'),
      previousBlock: legacy[0].trim()
    }
  }

  return {
    content: `${original.replace(/\s*$/, '')}\n\n${nextBlock}\n`,
    previousBlock: null
  }
}

function removeManagedStatus(original: string): { content: string; previousBlock: string } | null {
  const markerStart = original.indexOf(SYNC_START)
  if (markerStart >= 0) {
    const headingStart = original.lastIndexOf('\n## Implementation status', markerStart)
    const markerEnd = original.indexOf(SYNC_END, markerStart)
    if (headingStart >= 0 && markerEnd >= 0) {
      const end = markerEnd + SYNC_END.length
      return {
        content: `${original.slice(0, headingStart)}${original.slice(end)}`
          .replace(/\n{3,}/g, '\n\n')
          .replace(/\s*$/, '\n'),
        previousBlock: original.slice(headingStart + 1, end)
      }
    }
  }
  const legacy = /\n## Implementation history\s*\n[\s\S]*?(?=\n## |\s*$)/.exec(original)
  if (legacy?.index == null) return null
  return {
    content: `${original.slice(0, legacy.index)}${original.slice(legacy.index + legacy[0].length)}`
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s*$/, '\n'),
    previousBlock: legacy[0].trim()
  }
}

/**
 * Detects files changed during one agent run and prepares bounded,
 * deterministic knowledge updates. Proposal contents stay in main-process
 * memory; the renderer can approve proposal ids but cannot submit file text.
 */
export class KnowledgeSyncService {
  private pending = new Map<string, PendingReview>()

  constructor(
    private workspaceRoot: string,
    private knowledge: KnowledgeEngine
  ) {}

  async snapshot(): Promise<WorkspaceSnapshot> {
    const result: WorkspaceSnapshot = new Map()
    let visited = 0

    const walk = async (directory: string): Promise<void> => {
      if (visited >= MAX_FILES) return
      let entries
      try {
        entries = await fs.readdir(directory, { withFileTypes: true })
      } catch {
        return
      }
      entries.sort((a, b) => a.name.localeCompare(b.name))
      for (const entry of entries) {
        if (visited >= MAX_FILES) return
        if (entry.isSymbolicLink()) continue
        const absolute = join(directory, entry.name)
        const path = repoPath(this.workspaceRoot, absolute)
        if (entry.isDirectory()) {
          if (!EXCLUDED_DIRECTORIES.has(entry.name)) await walk(absolute)
          continue
        }
        if (!entry.isFile() || SECRET_FILE.test(path)) continue
        visited++
        try {
          const stat = await fs.stat(absolute)
          let signature = `${stat.size}:${stat.mtimeMs}`
          if (stat.size <= MAX_HASH_BYTES) {
            const bytes = await fs.readFile(absolute)
            signature = createHash('sha256').update(bytes).digest('hex')
          }
          result.set(path, signature)
        } catch {
          // File changed while the snapshot was being built; the next
          // snapshot will still classify it as added or removed.
        }
      }
    }

    await walk(this.workspaceRoot)
    return result
  }

  private changedFiles(before: WorkspaceSnapshot, after: WorkspaceSnapshot): string[] {
    const paths = new Set([...before.keys(), ...after.keys()])
    return [...paths]
      .filter((path) => before.get(path) !== after.get(path))
      .sort()
      .slice(0, MAX_CHANGED_FILES)
  }

  async review(task: string, before: WorkspaceSnapshot): Promise<KnowledgeSyncReview | null> {
    const after = await this.snapshot()
    const changedFiles = this.changedFiles(before, after)
    if (changedFiles.length === 0) return null

    const search = `${task} ${changedFiles.map((path) => basename(path)).join(' ')}`
    const pack = await this.knowledge.retrieve(search, { mode: 'summary' })
    const candidates = pack.documents.filter((doc) => doc.path).slice(0, MAX_PROPOSALS)
    const reviewId = randomUUID()
    const internal = new Map<string, PendingProposal>()
    const date = new Date().toISOString().slice(0, 10)
    const statusBlock = managedStatusBlock(date, task, changedFiles)
    let primaryAssigned = false

    for (const doc of candidates) {
      const absolute = resolve(this.workspaceRoot, doc.path!)
      const knowledgeRoot = resolve(this.workspaceRoot, KNOWLEDGE_DIR)
      if (absolute !== knowledgeRoot && !absolute.startsWith(`${knowledgeRoot}${sep}`)) continue
      let originalContent: string
      try {
        originalContent = await fs.readFile(absolute, 'utf-8')
      } catch {
        continue
      }
      const isPrimary = !primaryAssigned
      const replacement = isPrimary
        ? replaceManagedStatus(originalContent, statusBlock)
        : removeManagedStatus(originalContent)
      if (!replacement) continue
      primaryAssigned = true
      const proposedContent = replacement.content
      const previousSummary = replacement.previousBlock
        ? oneLine(replacement.previousBlock.replace(/<!--.*?-->/g, ''), 100)
        : null
      const tokenDeltaEstimate = Math.round((proposedContent.length - originalContent.length) / 4)
      const id = randomUUID()
      const proposal: PendingProposal = {
        id,
        documentId: doc.id,
        documentTitle: doc.title,
        path: doc.path!,
        reason: isPrimary
          ? `This was the most relevant document and ${changedFiles.length} workspace file${changedFiles.length === 1 ? '' : 's'} changed.`
          : 'Remove a duplicate Woo implementation-status/history block; the most relevant document now owns the bounded status.',
        diff: isPrimary
          ? `@@ ${doc.title} · managed implementation status @@\n` +
            (previousSummary ? `- ${previousSummary}\n` : '') +
            `+ Last verified: ${date}\n` +
            `+ Recent task: ${oneLine(task, 120)}\n` +
            `+ Touchpoints: ${changedFiles.slice(0, MAX_STATUS_FILES).join(', ')}${changedFiles.length > MAX_STATUS_FILES ? ` (+${changedFiles.length - MAX_STATUS_FILES} more)` : ''}`
          : `@@ ${doc.title} · consolidate duplicate status @@\n- ${previousSummary}`,
        tokenDeltaEstimate,
        originalContent,
        proposedContent
      }
      internal.set(id, proposal)
    }

    const proposals = [...internal.values()].map(({ originalContent: _original, proposedContent: _proposed, ...proposal }) => proposal)
    this.pending.set(reviewId, { proposals: internal })
    return { id: reviewId, task, changedFiles, proposals }
  }

  async apply(reviewId: string, proposalIds: string[]): Promise<KnowledgeSyncApplyResult> {
    const review = this.pending.get(reviewId)
    if (!review) throw new Error('Knowledge sync review expired. Run the task or review again.')
    const selected = [...new Set(proposalIds)]
    const proposals = selected.map((id) => review.proposals.get(id))
    if (proposals.some((proposal) => !proposal)) throw new Error('Unknown knowledge sync proposal.')

    // Refuse to overwrite a document that changed after the preview.
    for (const proposal of proposals as PendingProposal[]) {
      const current = await fs.readFile(join(this.workspaceRoot, proposal.path), 'utf-8')
      if (current !== proposal.originalContent) {
        throw new Error(`${proposal.path} changed after the preview. Review it again.`)
      }
    }
    for (const proposal of proposals as PendingProposal[]) {
      await fs.writeFile(join(this.workspaceRoot, proposal.path), proposal.proposedContent, 'utf-8')
    }
    this.pending.delete(reviewId)
    return { updatedPaths: (proposals as PendingProposal[]).map((proposal) => proposal.path) }
  }

  dismiss(reviewId: string): void {
    this.pending.delete(reviewId)
  }

  /**
   * Register a review whose proposals were produced elsewhere (e.g. the
   * manual-edit AI sync) so apply()/dismiss() serve it like any other.
   */
  registerReview(task: string, changedFiles: string[], drafts: ProposalDraft[]): KnowledgeSyncReview {
    const internal = new Map<string, PendingProposal>()
    for (const draft of drafts) {
      const id = randomUUID()
      internal.set(id, { ...draft, id })
    }
    const reviewId = randomUUID()
    this.pending.set(reviewId, { proposals: internal })
    const proposals = [...internal.values()].map(
      ({ originalContent: _original, proposedContent: _proposed, ...proposal }) => proposal
    )
    return { id: reviewId, task, changedFiles, proposals }
  }
}
