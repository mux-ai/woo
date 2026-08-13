import { describe, expect, it, vi } from 'vitest'
import type { ThreadEvent, ThreadOptions } from '@openai/codex-sdk'
import type { ContextPack } from '../src/shared/types'
import {
  CodexAgentRunner,
  type CodexClientFactory,
  type CodexClientLike
} from '../src/main/codexAgentRunner'
import { evaluateCodexTool } from '../src/main/codexSecretPolicy'
import { codexOutputContainsSecret } from '../src/main/codexSecretPolicy'
import type { KnowledgeEngine } from '../src/main/knowledge/engine'
import type { SecretBroker } from '../src/main/secretBroker'

const pack: ContextPack = {
  task: 'secure task',
  context: '# Context\nA relevant rule.',
  sources: [],
  documents: [{ id: 'rules/security', title: 'Security Rule', type: 'Business Rule' }],
  tokenEstimate: 8
}

function harness(streamEvents: ThreadEvent[] = []) {
  const threadOptions: ThreadOptions[] = []
  const prompts: string[] = []
  const knowledge = {
    retrieve: vi.fn(async () => pack)
  } as unknown as KnowledgeEngine
  const broker = {
    scrub: vi.fn((text: string) => text.replaceAll('known-secret', '<concealed>')),
    knownSecretValues: vi.fn(() => ['known-secret'])
  } as unknown as SecretBroker
  const client: CodexClientLike = {
    startThread: (options) => {
      threadOptions.push(options ?? {})
      return {
        run: async (input) => {
          prompts.push(input)
          return { finalResponse: '1. Inspect code\n2. Make change\n3. Run tests' }
        },
        runStreamed: async (input) => {
          prompts.push(input)
          async function* events(): AsyncGenerator<ThreadEvent> {
            for (const event of streamEvents) yield event
          }
          return { events: events() }
        }
      }
    }
  }
  const factory = vi.fn<CodexClientFactory>(() => client)
  return {
    runner: new CodexAgentRunner('/workspace', broker, knowledge, factory),
    knowledge,
    factory,
    threadOptions,
    prompts
  }
}

describe('CodexAgentRunner', () => {
  it('plans with summary knowledge in a read-only, offline thread', async () => {
    const state = harness()

    await expect(state.runner.plan('secure task')).resolves.toEqual({
      task: 'secure task',
      steps: ['Inspect code', 'Make change', 'Run tests']
    })
    expect(state.knowledge.retrieve).toHaveBeenCalledWith('secure task', { mode: 'summary' })
    expect(state.threadOptions[0]).toMatchObject({
      workingDirectory: '/workspace',
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
      networkAccessEnabled: false,
      webSearchMode: 'disabled'
    })
    expect(state.prompts[0]).toContain('<project-knowledge-summary>')
  })

  it('streams tools, scrubbed model text, and completion events', async () => {
    const state = harness([
      {
        type: 'item.started',
        item: {
          id: 'command-1',
          type: 'command_execution',
          command: 'npm test',
          aggregated_output: '',
          status: 'in_progress'
        }
      },
      {
        type: 'item.completed',
        item: { id: 'message-1', type: 'agent_message', text: 'done known-secret' }
      },
      {
        type: 'turn.completed',
        usage: {
          input_tokens: 10,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 2,
          reasoning_output_tokens: 0
        }
      }
    ])
    const events: any[] = []

    await state.runner.runTask('secure task', (event) => events.push(event))

    expect(state.threadOptions[0]).toMatchObject({ sandboxMode: 'workspace-write' })
    expect(events).toContainEqual({ type: 'tool-use', toolName: 'Bash', toolInput: 'npm test' })
    expect(events).toContainEqual({ type: 'text', text: 'done <concealed>' })
    expect(events.at(-1)).toEqual({ type: 'done' })
    expect(state.prompts[0]).toContain('Woo security boundary')
  })

  it('passes a sanitized environment and a Secret Broker hook to Codex', async () => {
    const previous = process.env.WOO_TEST_SECRET_TOKEN
    process.env.WOO_TEST_SECRET_TOKEN = 'known-secret'
    try {
      const state = harness()
      await state.runner.plan('secure task')
      const options = state.factory.mock.calls[0][0]
      expect(options.env.WOO_TEST_SECRET_TOKEN).toBeUndefined()
      expect(options.hookCommand).toContain('codex-secret-hook.js')
    } finally {
      if (previous == null) delete process.env.WOO_TEST_SECRET_TOKEN
      else process.env.WOO_TEST_SECRET_TOKEN = previous
    }
  })

  it('estimates summary planning plus full execution context and can pin a preview pack', async () => {
    const state = harness()
    state.knowledge.retrieve = vi.fn(async (_task: string, options?: { mode?: string }) => ({
      ...pack,
      tokenEstimate: options?.mode === 'summary' ? 3 : 8
    })) as any

    await expect(state.runner.estimateContext('secure task')).resolves.toMatchObject({
      planningTokens: 3,
      executionTokens: 8,
      totalTokens: 11,
      pinned: false
    })

    expect(state.runner.setPinned(true, pack)).toBe(true)
    await expect(state.runner.estimateContext('next related task')).resolves.toMatchObject({
      planningTokens: 8,
      executionTokens: 8,
      totalTokens: 16,
      pinned: true
    })
    expect(state.runner.invalidateContext()).toBe(true)
  })
})

describe('Codex Secret Broker hook policy', () => {
  it('blocks secret paths and environment dumps', () => {
    expect(
      evaluateCodexTool({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'cat .env.local' }
      })
    ).toContain('secret-bearing path')
    expect(
      evaluateCodexTool({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'printenv' }
      })
    ).toContain('environment dumps')
  })

  it('allows ordinary workspace commands', () => {
    expect(
      evaluateCodexTool({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'npm test' }
      }, true)
    ).toBeNull()
  })

  it('denies shell execution by default', () => {
    expect(
      evaluateCodexTool({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'npm test' }
      })
    ).toContain('disabled by default')
  })

  it('denies file tools that escape the workspace boundary', () => {
    expect(
      evaluateCodexTool({
        hook_event_name: 'PreToolUse',
        tool_name: 'Read',
        tool_input: { file_path: '../outside.txt' }
      }, false, '/tmp/woo-workspace')
    ).toContain('outside the workspace')
  })

  it('detects known secret values in model-facing tool output', () => {
    expect(
      codexOutputContainsSecret(
        {
          hook_event_name: 'PostToolUse',
          tool_name: 'Bash',
          tool_response: { stdout: 'value=known-secret' }
        },
        ['known-secret']
      )
    ).toBe(true)
    expect(
      codexOutputContainsSecret(
        {
          hook_event_name: 'PostToolUse',
          tool_name: 'Bash',
          tool_response: { stdout: 'tests passed' }
        },
        ['known-secret']
      )
    ).toBe(false)
  })
})
