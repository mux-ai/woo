import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { InlineCompletionService } from '../src/main/inlineCompletionService'
import type { KnowledgeEngine } from '../src/main/knowledge/engine'
import { SecretBroker } from '../src/main/secretBroker'
import type { ContextPack, InlineCompletionRequest } from '../src/shared/types'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'woo-inline-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const pack = (context: string, documents: unknown[] = []): ContextPack => ({
  task: 'task',
  context,
  sources: [],
  tokenEstimate: 0,
  documents: documents as ContextPack['documents']
})

function knowledgeWith(context: string, documentCount = 0): KnowledgeEngine {
  return {
    retrieve: vi.fn(async () => pack(context, new Array(documentCount).fill({ id: 'doc' })))
  } as unknown as KnowledgeEngine
}

/**
 * Fake persistent streaming session: one query() call whose prompt is the
 * push queue; every user message produces one assistant + result pair.
 */
function streamingSession(
  replyFor: (userText: string) => string | Promise<string>,
  captured: { args?: any; userTexts: string[]; sessions: number }
) {
  return ((args: any) => {
    captured.args = args
    captured.sessions += 1
    async function* stream(): AsyncGenerator<any> {
      for await (const userMessage of args.prompt) {
        const userText = String(userMessage.message.content)
        captured.userTexts.push(userText)
        const text = await replyFor(userText)
        yield { type: 'assistant', message: { content: [{ type: 'text', text }] } }
        yield { type: 'result' }
      }
    }
    return stream()
  }) as any
}

const request = (overrides: Partial<InlineCompletionRequest> = {}): InlineCompletionRequest => ({
  path: 'src/app.ts',
  language: 'typescript',
  prefix: 'const total = ',
  suffix: '\nexport {}',
  terms: ['total', 'price'],
  ...overrides
})

describe('InlineCompletionService (persistent session)', () => {
  it('grounds each request in retrieved knowledge and keeps session options tight', async () => {
    const captured = { args: undefined as any, userTexts: [] as string[], sessions: 0 }
    const service = new InlineCompletionService(
      root,
      new SecretBroker(root),
      knowledgeWith('RULE: totals are integers in cents', 2),
      streamingSession(() => 'price * quantity', captured)
    )
    const result = await service.complete(request())
    expect(result).toBe('price * quantity')
    expect(captured.args.options.tools).toEqual([])
    expect(captured.args.options.settingSources).toEqual([])
    expect(captured.args.options.systemPrompt[0]).toContain('inline code completion engine')
    expect(captured.userTexts[0]).toContain('RULE: totals are integers in cents')
    expect(captured.userTexts[0]).toContain('const total = <CURSOR>')
    service.stop()
  })

  it('reuses ONE session across requests and recycles it after the turn budget', async () => {
    const captured = { args: undefined as any, userTexts: [] as string[], sessions: 0 }
    const service = new InlineCompletionService(
      root,
      new SecretBroker(root),
      knowledgeWith(''),
      streamingSession(() => 'x', captured)
    )
    for (let i = 0; i < 3; i++) await service.complete(request())
    expect(captured.sessions).toBe(1)
    for (let i = 0; i < 20; i++) await service.complete(request())
    expect(captured.sessions).toBeGreaterThan(1)
    service.stop()
  })

  it('refuses secret-named paths outright', async () => {
    const queryClient = vi.fn()
    const service = new InlineCompletionService(
      root,
      new SecretBroker(root),
      knowledgeWith(''),
      queryClient as any
    )
    expect(await service.complete(request({ path: '.env' }))).toBe('')
    expect(queryClient).not.toHaveBeenCalled()
  })

  it('scrubs known secret values from the outbound code context and the reply', async () => {
    writeFileSync(join(root, '.env'), 'TOKEN=hunter2hunter2hunter2\n')
    const captured = { args: undefined as any, userTexts: [] as string[], sessions: 0 }
    const service = new InlineCompletionService(
      root,
      new SecretBroker(root),
      knowledgeWith(''),
      streamingSession(() => 'use hunter2hunter2hunter2 here', captured)
    )
    const result = await service.complete(
      request({ prefix: 'const token = "hunter2hunter2hunter2"\nconst next = ' })
    )
    expect(captured.userTexts[0]).not.toContain('hunter2hunter2hunter2')
    expect(result).not.toContain('hunter2hunter2hunter2')
    service.stop()
  })

  it('unwraps a fenced reply', async () => {
    const captured = { args: undefined as any, userTexts: [] as string[], sessions: 0 }
    const service = new InlineCompletionService(
      root,
      new SecretBroker(root),
      knowledgeWith(''),
      streamingSession(() => '```ts\nprice * quantity\n```', captured)
    )
    expect(await service.complete(request())).toBe('price * quantity')
    service.stop()
  })

  it('a superseded request returns empty and never steals the newer reply', async () => {
    const captured = { args: undefined as any, userTexts: [] as string[], sessions: 0 }
    let releaseFirst: () => void = () => {}
    const firstGate = new Promise<void>((resolveGate) => { releaseFirst = resolveGate })
    let call = 0
    const service = new InlineCompletionService(
      root,
      new SecretBroker(root),
      knowledgeWith(''),
      streamingSession(async () => {
        call += 1
        if (call === 1) { await firstGate; return 'reply 1' }
        return 'reply 2'
      }, captured)
    )
    const first = service.complete(request())
    await new Promise((resolveTick) => setTimeout(resolveTick, 10))
    const second = service.complete(request({ prefix: 'const other = ' }))
    await new Promise((resolveTick) => setTimeout(resolveTick, 10))
    releaseFirst()
    expect(await second).toBe('reply 2')
    expect(await first).toBe('') // superseded: own reply consumed + discarded
    service.stop()
  })
})
