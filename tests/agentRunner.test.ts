import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AgentRunner, type ClaudeQuery } from '../src/main/agentRunner'
import type { KnowledgeEngine } from '../src/main/knowledge/engine'
import { SecretBroker } from '../src/main/secretBroker'
import type { ContextPack } from '../src/shared/types'

let root: string

const emptyPack: ContextPack = {
  task: 'task',
  context: '',
  sources: [],
  tokenEstimate: 0,
  documents: []
}

function knowledge(): KnowledgeEngine {
  return {
    retrieve: vi.fn(async () => emptyPack)
  } as unknown as KnowledgeEngine
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'woo-claude-runner-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('AgentRunner Claude security boundary', () => {
  it('uses PreToolUse for blocking and visibility without auto-approved tools', async () => {
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, '.env'), 'TOKEN=known-secret-value\n')
    writeFileSync(join(root, 'src', 'safe.ts'), 'export const safe = true\n')
    let captured: any
    let scrubbedOutput: unknown
    let deniedOutput: unknown
    const close = vi.fn()
    const queryClient = ((args: any) => {
      captured = args
      async function* session(): AsyncGenerator<any> {
        const options = args.options
        const pre = options.hooks.PreToolUse[0].hooks[0]
        const post = options.hooks.PostToolUse[0].hooks[0]
        const signal = options.abortController.signal

        deniedOutput = await pre({
          hook_event_name: 'PreToolUse',
          tool_name: 'Read',
          tool_input: { file_path: '.env' },
          tool_use_id: 'secret-read'
        }, 'secret-read', { signal })
        await pre({
          hook_event_name: 'PreToolUse',
          tool_name: 'Read',
          tool_input: { file_path: 'src/safe.ts' },
          tool_use_id: 'safe-read'
        }, 'safe-read', { signal })
        await options.canUseTool('Read', { file_path: 'src/safe.ts' }, {
          signal,
          toolUseID: 'safe-read',
          requestId: 'request-1'
        })
        scrubbedOutput = await post({
          hook_event_name: 'PostToolUse',
          tool_name: 'Read',
          tool_input: { file_path: 'src/safe.ts' },
          tool_response: { output: 'known-secret-value' },
          tool_use_id: 'safe-read'
        }, 'safe-read', { signal })
        yield { type: 'result' }
      }
      const stream = session()
      ;(stream as any).close = close
      return stream
    }) as unknown as ClaudeQuery
    const runner = new AgentRunner(root, new SecretBroker(root), knowledge(), queryClient)
    const events: any[] = []

    await runner.runTask('inspect safely', (event) => events.push(event))

    expect(captured.options.allowedTools).toBeUndefined()
    expect(captured.options.tools).toEqual(['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'])
    expect(deniedOutput).toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny'
      }
    })
    expect(events).toContainEqual({
      type: 'tool-denied',
      toolName: 'Read',
      toolInput: 'Blocked by Secret Broker: path matches secret pattern. Content is never shown to the agent.'
    })
    expect(events.filter((event) => event.type === 'tool-use')).toEqual([
      { type: 'tool-use', toolName: 'Read', toolInput: '{"file_path":"src/safe.ts"}' }
    ])
    expect(scrubbedOutput).toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        updatedToolOutput: { output: '<concealed>' }
      }
    })
    expect(events.at(-1)).toEqual({ type: 'done' })
    expect(close).toHaveBeenCalled()
  })

  it('injects the repository opt-out policy into a tool-less plan', async () => {
    mkdirSync(join(root, '.noli'))
    writeFileSync(join(root, '.noli', 'disabled'), 'developer opted out\n')
    let captured: any
    const queryClient = ((args: any) => {
      captured = args
      async function* session(): AsyncGenerator<any> {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: '1. Inspect code\n2. Implement fix\n3. Test' }] }
        }
      }
      return session()
    }) as unknown as ClaudeQuery
    const runner = new AgentRunner(root, new SecretBroker(root), knowledge(), queryClient)

    await expect(runner.plan('fix it')).resolves.toMatchObject({
      steps: ['Inspect code', 'Implement fix', 'Test']
    })
    expect(captured.options.tools).toEqual([])
    expect(captured.options.allowedTools).toBeUndefined()
    expect(captured.prompt).toContain('.noli/disabled is present')
    expect(captured.prompt).toContain('Do not invoke noli')
  })

  it('plan model follows the difficulty scorer, same as execution', async () => {
    let captured: any
    const queryClient = ((args: any) => {
      captured = args
      async function* session(): AsyncGenerator<any> {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: '1. Step one' }] }
        }
      }
      return session()
    }) as unknown as ClaudeQuery
    const runner = new AgentRunner(root, new SecretBroker(root), knowledge(), queryClient)

    await runner.plan('fix a typo in the README')
    expect(captured.options.model).toBe('claude-haiku-4-5')

    await runner.plan(
      'refactor the authentication architecture across the entire project and debug the race condition'
    )
    expect(captured.options.model).toBe('claude-opus-5')
  })

  it('aborts and reports a single error when a session stops making progress', async () => {
    const queryClient = ((args: any) => {
      async function* session(): AsyncGenerator<any> {
        await new Promise<void>((_resolve, reject) => {
          args.options.abortController.signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          }, { once: true })
        })
        yield { type: 'result' }
      }
      return session()
    }) as unknown as ClaudeQuery
    const runner = new AgentRunner(root, new SecretBroker(root), knowledge(), queryClient, {
      idleTimeoutMs: 10,
      totalTimeoutMs: 1_000
    })
    const events: any[] = []

    await runner.runTask('wait forever', (event) => events.push(event))

    expect(events.filter((event) => event.type === 'error')).toEqual([
      { type: 'error', error: 'Claude stopped making progress and was terminated.' }
    ])
    expect(events.some((event) => event.type === 'done')).toBe(false)
  })
})
