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

const request = (overrides: Partial<InlineCompletionRequest> = {}): InlineCompletionRequest => ({
  path: 'src/app.ts',
  language: 'typescript',
  prefix: 'const total = ',
  suffix: '\nexport {}',
  terms: ['total', 'price'],
  ...overrides
})

describe('InlineCompletionService', () => {
  it('grounds the cacheable system prompt in retrieved project knowledge', async () => {
    let captured: any
    const service = new InlineCompletionService(
      root,
      new SecretBroker(root),
      knowledgeWith('RULE: totals are integers in cents', 2),
      textSession('price * quantity', (args) => { captured = args })
    )
    const result = await service.complete(request())
    expect(result).toBe('price * quantity')
    expect(captured.options.systemPrompt[0]).toContain('RULE: totals are integers in cents')
    expect(captured.options.tools).toEqual([])
    expect(captured.options.maxTurns).toBe(1)
    expect(captured.options.settingSources).toEqual([])
    expect(captured.prompt).toContain('const total = <CURSOR>')
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
    let captured: any
    const service = new InlineCompletionService(
      root,
      new SecretBroker(root),
      knowledgeWith(''),
      textSession('use hunter2hunter2hunter2 here', (args) => { captured = args })
    )
    const result = await service.complete(
      request({ prefix: 'const token = "hunter2hunter2hunter2"\nconst next = ' })
    )
    expect(captured.prompt).not.toContain('hunter2hunter2hunter2')
    expect(result).not.toContain('hunter2hunter2hunter2')
  })

  it('unwraps a fenced reply', async () => {
    const service = new InlineCompletionService(
      root,
      new SecretBroker(root),
      knowledgeWith(''),
      textSession('```ts\nprice * quantity\n```')
    )
    expect(await service.complete(request())).toBe('price * quantity')
  })

  it('aborts the previous in-flight request when a new one arrives', async () => {
    const controllers: AbortSignal[] = []
    let releaseFirst: () => void = () => {}
    const firstBlocked = new Promise<void>((resolveBlock) => { releaseFirst = resolveBlock })
    let call = 0
    const queryClient = ((args: any) => {
      const index = ++call
      controllers.push(args.options.abortController.signal)
      async function* session(): AsyncGenerator<any> {
        if (index === 1) await firstBlocked
        yield { type: 'assistant', message: { content: [{ type: 'text', text: `reply ${index}` }] } }
        yield { type: 'result' }
      }
      return session()
    }) as any
    const service = new InlineCompletionService(root, new SecretBroker(root), knowledgeWith(''), queryClient)

    const first = service.complete(request())
    // Yield so the first call reaches its (blocked) session before the second starts.
    await new Promise((resolveTick) => setTimeout(resolveTick, 10))
    const second = service.complete(request({ prefix: 'const other = ' }))
    await new Promise((resolveTick) => setTimeout(resolveTick, 10))
    releaseFirst()

    expect(await second).toBe('reply 2')
    expect(controllers[0].aborted).toBe(true)
    expect(await first).toBe('')
  })
})
