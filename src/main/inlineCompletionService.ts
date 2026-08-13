import { query, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '@anthropic-ai/claude-agent-sdk'
import type { InlineCompletionRequest } from '../shared/types'
import { SecretBroker } from './secretBroker'
import { KnowledgeEngine } from './knowledge/engine'
import { projectPolicyPrompt } from './projectPolicy'

/**
 * AI inline (ghost-text) completion — one tool-less model turn per request,
 * grounded in retrieved project knowledge (KNOW-001) and scrubbed on both
 * sides of the wire (SEC-002).
 *
 * Latency note: each call spawns an SDK CLI subprocess, so suggestions land
 * roughly 1.5-3s after the editor pauses. Single-flight below guarantees a
 * burst of keystrokes never stacks subprocesses — every new request aborts
 * the previous one first.
 */

type ClaudeQuery = typeof query

const COMPLETION_TIMEOUT_MS = 8_000

/**
 * Same cache trick as agentRunner: policy + knowledge are stable across the
 * keystrokes of an editing session, so they form the cacheable prefix and
 * only the per-request code pays full price.
 */
function cacheableSystemPrompt(staticBlock: string): string[] | undefined {
  return staticBlock ? [staticBlock, SYSTEM_PROMPT_DYNAMIC_BOUNDARY] : undefined
}

export class InlineCompletionService {
  private aborter: AbortController | null = null
  private activeQuery: ReturnType<ClaudeQuery> | null = null

  constructor(
    private workspaceRoot: string,
    private broker: SecretBroker,
    private knowledge: KnowledgeEngine,
    private queryClient: ClaudeQuery = query
  ) {}

  stop(): void {
    this.aborter?.abort()
    ;(this.activeQuery as { close?: () => void } | null)?.close?.()
    this.aborter = null
    this.activeQuery = null
  }

  /**
   * Environment for the SDK subprocess: withhold secret-named shell vars and
   * any var whose value the broker knows to be a secret. ANTHROPIC_* and
   * CLAUDE_* stay — the SDK needs them to authenticate. (Deliberate copy of
   * AgentRunner's policy; the classes stay independent.)
   */
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

  async complete(request: InlineCompletionRequest): Promise<string> {
    if (!this.broker.checkPath(request.path).allowed) return ''

    // Cancel the in-flight request — the editor has moved on.
    this.stop()
    const controller = new AbortController()
    this.aborter = controller

    // The code around the cursor is file content: scrub it before it leaves
    // the process, exactly like every other agent-bound text.
    const prefix = this.broker.scrub(request.prefix)
    const suffix = this.broker.scrub(request.suffix)

    let contextBlock = ''
    try {
      const pack = await this.knowledge.retrieve(
        `${request.path} ${request.language} ${request.terms.join(' ')}`.slice(0, 2_000),
        { mode: 'summary' }
      )
      if (pack.documents.length > 0) {
        contextBlock = `<project-knowledge-summary>\n${pack.context}\n</project-knowledge-summary>\n\n`
      }
    } catch {
      // no knowledge — complete without it
    }
    const policyBlock = await projectPolicyPrompt(this.workspaceRoot)

    let session: ReturnType<ClaudeQuery> | null = null
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
      ;(session as { close?: () => void } | null)?.close?.()
    }, COMPLETION_TIMEOUT_MS)
    try {
      session = this.queryClient({
        prompt:
          'You are an inline code completion engine. Continue the code exactly at <CURSOR>. ' +
          'Reply with ONLY the raw code continuation (max 6 lines) — no explanations, no markdown fences, no repetition of existing code. ' +
          'Prefer identifiers, functions, and conventions from the project knowledge above when relevant. ' +
          'If no useful continuation exists, reply with an empty message.\n\n' +
          `File: ${request.path} (${request.language})\n\n` +
          '<code>\n' +
          prefix +
          '<CURSOR>' +
          suffix +
          '\n</code>',
        options: {
          cwd: this.workspaceRoot,
          systemPrompt: cacheableSystemPrompt(policyBlock + contextBlock),
          abortController: controller,
          permissionMode: 'default',
          tools: [],
          maxTurns: 1,
          env: this.buildAgentEnv(),
          // Operator's ~/.claude files must not steer completions either.
          settingSources: []
        }
      })
      this.activeQuery = session
      let text = ''
      for await (const message of session) {
        if (message.type === 'assistant') {
          for (const block of message.message.content) {
            if (block.type === 'text') text += block.text
          }
        }
      }
      // A newer request may have aborted this one while its stream drained —
      // its result is stale, never surface it.
      if (controller.signal.aborted) return ''
      // Models occasionally fence the answer anyway — unwrap before use.
      const unfenced = text.replace(/^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/, '$1')
      return this.broker.scrub(unfenced.replace(/\s+$/, ''))
    } catch (error: any) {
      if (timedOut || controller.signal.aborted || error?.name === 'AbortError') return ''
      throw error
    } finally {
      clearTimeout(timeout)
      if (this.activeQuery === session) {
        this.activeQuery = null
        this.aborter = null
      }
      ;(session as { close?: () => void } | null)?.close?.()
    }
  }
}
