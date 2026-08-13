import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ManualKnowledgeSync } from '../src/main/knowledge/manualSyncService'
import { KnowledgeSyncService } from '../src/main/knowledge/syncService'
import type { KnowledgeEngine } from '../src/main/knowledge/engine'
import { SecretBroker } from '../src/main/secretBroker'
import type { ContextPack, KnowledgeSyncReview } from '../src/shared/types'

let root: string

const DOC_PATH = '.woo/knowledge/rules/totals.md'
const DOC_ORIGINAL = `---
title: Totals Rule
type: rule
description: Totals are floats.
---

Totals are stored as floats.
`
const DOC_UPDATED = `---
title: Totals Rule
type: rule
description: Totals are integer cents.
---

Totals are stored as integer cents.
`

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'woo-manual-sync-'))
  mkdirSync(join(root, '.woo', 'knowledge', 'rules'), { recursive: true })
  writeFileSync(join(root, DOC_PATH), DOC_ORIGINAL)
  writeFileSync(join(root, 'app.ts'), 'export const total = 100 // cents\n')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function knowledgeWithDoc(): KnowledgeEngine {
  const pack: ContextPack = {
    task: 'task',
    context: '',
    sources: [],
    tokenEstimate: 0,
    documents: [
      { id: 'rules/totals', title: 'Totals Rule', type: 'Business Rule', description: '', path: DOC_PATH }
    ] as ContextPack['documents']
  }
  return { retrieve: vi.fn(async () => pack) } as unknown as KnowledgeEngine
}

function textSession(text: string, onArgs?: (args: any) => void) {
  return ((args: any) => {
    onArgs?.(args)
    async function* session(): AsyncGenerator<any> {
      yield { type: 'assistant', message: { content: [{ type: 'text', text }] } }
      yield { type: 'result' }
    }
    return session()
  }) as any
}

function make(replyText: string, onArgs?: (args: any) => void, persistDir?: string) {
  const broker = new SecretBroker(root)
  const knowledge = knowledgeWithDoc()
  const sync = new KnowledgeSyncService(root, knowledge, persistDir)
  const reviews: KnowledgeSyncReview[] = []
  const manual = new ManualKnowledgeSync(
    root,
    broker,
    knowledge,
    sync,
    (review) => reviews.push(review),
    textSession(replyText, onArgs),
    50,
    persistDir
  )
  return { manual, sync, reviews }
}

const proposalReply = JSON.stringify([
  { path: DOC_PATH, reason: 'Totals switched to integer cents.', updatedMarkdown: DOC_UPDATED }
])

describe('ManualKnowledgeSync', () => {
  it('debounces saves, proposes an AI doc update, and the proposal applies through the shared service', async () => {
    let captured: any
    const { manual, sync, reviews } = make(proposalReply, (args) => { captured = args })
    manual.noteSaved('app.ts')
    await manual.flush()

    expect(reviews.length).toBe(1)
    expect(reviews[0].changedFiles).toEqual(['app.ts'])
    expect(reviews[0].proposals[0].path).toBe(DOC_PATH)
    expect(captured.prompt).toContain('export const total = 100')
    expect(captured.options.tools).toEqual([])
    expect(captured.options.maxTurns).toBe(1)

    await sync.apply(reviews[0].id, [reviews[0].proposals[0].id])
    expect(readFileSync(join(root, DOC_PATH), 'utf8')).toBe(DOC_UPDATED)
  })

  it('never reviews saves under .woo/ (apply cannot re-trigger itself) or secret paths', async () => {
    const { manual, reviews } = make(proposalReply)
    manual.noteSaved(DOC_PATH)
    manual.noteSaved('.env')
    await manual.flush()
    expect(reviews).toEqual([])
  })

  it('drops replies that are not valid JSON or touch documents it was not shown', async () => {
    const bad = make('sure! here is my update...')
    bad.manual.noteSaved('app.ts')
    await bad.manual.flush()
    expect(bad.reviews).toEqual([])

    const foreign = make(JSON.stringify([
      { path: '.woo/knowledge/other.md', reason: 'x', updatedMarkdown: DOC_UPDATED }
    ]))
    foreign.manual.noteSaved('app.ts')
    await foreign.manual.flush()
    expect(foreign.reviews).toEqual([])
  })

  it('proposes nothing when the model returns [] or an unchanged document', async () => {
    const empty = make('[]')
    empty.manual.noteSaved('app.ts')
    await empty.manual.flush()
    expect(empty.reviews).toEqual([])

    const unchanged = make(JSON.stringify([
      { path: DOC_PATH, reason: 'noop', updatedMarkdown: DOC_ORIGINAL }
    ]))
    unchanged.manual.noteSaved('app.ts')
    await unchanged.manual.flush()
    expect(unchanged.reviews).toEqual([])
  })

  it('fires via the debounce timer without an explicit flush', async () => {
    const { manual, reviews } = make(proposalReply)
    manual.noteSaved('app.ts')
    await new Promise((resolveWait) => setTimeout(resolveWait, 200))
    expect(reviews.length).toBe(1)
  })

  it('persists an un-actioned review across sessions and applies after restore', async () => {
    const persistDir = join(root, 'data')
    const first = make(proposalReply, undefined, persistDir)
    first.manual.noteSaved('app.ts')
    await first.manual.flush()
    expect(first.reviews.length).toBe(1)
    // "exit without acting" — new session, fresh services, same persistDir
    const second = make('[]', undefined, persistDir)
    await second.manual.restore()
    expect(second.reviews.length).toBe(1)
    const review = second.reviews[0]
    await second.sync.apply(review.id, [review.proposals[0].id])
    expect(readFileSync(join(root, DOC_PATH), 'utf8')).toBe(DOC_UPDATED)
  })

  it('drops a persisted review whose target doc changed while the app was closed', async () => {
    const persistDir = join(root, 'data')
    const first = make(proposalReply, undefined, persistDir)
    first.manual.noteSaved('app.ts')
    await first.manual.flush()
    writeFileSync(join(root, DOC_PATH), DOC_ORIGINAL + '\nEdited meanwhile.\n')
    const second = make('[]', undefined, persistDir)
    await second.manual.restore()
    expect(second.reviews).toEqual([])
  })

  it('persists queued saves that never reached review and resumes them on restore', async () => {
    const persistDir = join(root, 'data')
    // Long debounce = the app "exits" before the review ever runs.
    const broker = new SecretBroker(root)
    const knowledge = knowledgeWithDoc()
    const sync = new KnowledgeSyncService(root, knowledge, persistDir)
    const idle = new ManualKnowledgeSync(root, broker, knowledge, sync, () => {}, textSession('[]'), 60_000, persistDir)
    idle.noteSaved('app.ts')
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    idle.stop()

    const resumed = make(proposalReply, undefined, persistDir)
    await resumed.manual.restore()
    await resumed.manual.flush()
    expect(resumed.reviews.length).toBe(1)
    expect(resumed.reviews[0].changedFiles).toEqual(['app.ts'])
  })

  it('apply and dismiss clear the persisted review', async () => {
    const persistDir = join(root, 'data')
    const first = make(proposalReply, undefined, persistDir)
    first.manual.noteSaved('app.ts')
    await first.manual.flush()
    first.sync.dismiss(first.reviews[0].id)
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    const second = make('[]', undefined, persistDir)
    await second.manual.restore()
    expect(second.reviews).toEqual([])
  })
})
