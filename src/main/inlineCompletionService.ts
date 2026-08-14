import { query, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '@anthropic-ai/claude-agent-sdk'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { InlineCompletionRequest } from '../shared/types'
import { SecretBroker } from './secretBroker'
import { KnowledgeEngine } from './knowledge/engine'
import { projectPolicyPrompt } from './projectPolicy'

/**
 * AI inline (ghost-text) completion — grounded in retrieved project
 * knowledge (KNOW-001) and scrubbed on both sides of the wire (SEC-002).
 *
 * Uses ONE persistent streaming-input SDK session instead of a subprocess
 * per request: the first completion pays the spawn cost (~3-6s), later ones
 * skip straight to the model turn (~1-2s). The session is recycled after
 * MAX_SESSION_TURNS completions so the growing transcript never bloats
 * token cost, and torn down + lazily recreated on any error or timeout.
 */

type ClaudeQuery = typeof query

const COMPLETION_TIMEOUT_MS = 10_000
const MAX_SESSION_TURNS = 20

function cacheableSystemPrompt(staticBlock: string): string[] | undefined {
  return staticBlock ? [staticBlock, SYSTEM_PROMPT_DYNAMIC_BOUNDARY] : undefined
}

const SESSION_INSTRUCTIONS =
  'You are an inline code completion engine. Each user message is an INDEPENDENT completion request — ' +
  'never refer to earlier requests. Continue the code exactly at <CURSOR>. ' +
  'Reply with ONLY the raw code continuation (max 6 lines) — no explanations, no markdown fences, ' +
  'no repetition of existing code. Prefer identifiers, functions, and conventions from any project ' +
  'knowledge included in the request. If no useful continuation exists, reply with an empty message.'

interface PushQueue {
  push(message: SDKUserMessage): void
  end(): void
  iterable: AsyncIterable<SDKUserMessage>
}

function makePushQueue(): PushQueue {
  const buffered: SDKUserMessage[] = []
  let wake: (() => void) | null = null
  let ended = false
  return {
    push(message) {
      buffered.push(message)
      wake?.()
    },
    end() {
      ended = true
      wake?.()
    },
    iterable: {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          while (buffered.length > 0) yield buffered.shift()!
          if (ended) return
          await new Promise<void>((resolveWake) => { wake = resolveWake })
          wake = null
        }
      }
    }
  }
}

interface Session {
  queue: PushQueue
  stream: ReturnType<ClaudeQuery>
  turns: number
  /**
   * FIFO of reply resolvers. Turns complete strictly in send order, so the
   * n-th result event always belongs to the n-th queued request — a
   * superseded request still consumes ITS OWN reply (and discards it),
   * never a later request's.
   */
  waiters: ((text: string) => void)[]
}

export class InlineCompletionService {
  private session: Session | null = null
  private requestSeq = 0

  constructor(
    private workspaceRoot: string,
    private broker: SecretBroker,
    private knowledge: KnowledgeEngine,
    private queryClient: ClaudeQuery = query
  ) {}

  stop(): void {
    this.disposeSession()
  }

  private disposeSession(): void {
    const session = this.session
    this.session = null
    if (!session) return
    for (const waiter of session.waiters.splice(0)) waiter('')
    session.queue.end()
    ;(session.stream as { close?: () => void }).close?.()
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

  private async ensureSession(): Promise<Session> {
    if (this.session) return this.session
    const policyBlock = await projectPolicyPrompt(this.workspaceRoot)
    const queue = makePushQueue()
    const stream = this.queryClient({
      prompt: queue.iterable,
      options: {
        cwd: this.workspaceRoot,
        systemPrompt: cacheableSystemPrompt(policyBlock + SESSION_INSTRUCTIONS),
        permissionMode: 'default',
        tools: [],
        maxTurns: MAX_SESSION_TURNS * 2,
        env: this.buildAgentEnv(),
        // Operator's ~/.claude files must not steer completions.
        settingSources: []
      }
    })
    const session: Session = { queue, stream, turns: 0, waiters: [] }
    this.session = session

    // Single reader loop for the session's whole life: accumulates each
    // assistant turn and resolves reply waiters strictly in FIFO order.
    void (async () => {
      let text = ''
      try {
        for await (const message of stream as AsyncIterable<any>) {
          if (message.type === 'assistant') {
            for (const block of message.message.content) {
              if (block.type === 'text') text += block.text
            }
          }
          if (message.type === 'result') {
            session.waiters.shift()?.(text)
            text = ''
          }
        }
      } catch {
        // fall through to cleanup
      }
      for (const waiter of session.waiters.splice(0)) waiter('')
      if (this.session === session) this.session = null
    })()
    return session
  }

  async complete(request: InlineCompletionRequest): Promise<string> {
    if (!this.broker.checkPath(request.path).allowed) return ''
    const seq = ++this.requestSeq

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
    if (seq !== this.requestSeq) return '' // superseded while retrieving

    const session = await this.ensureSession()
    if (seq !== this.requestSeq) return ''

    const reply = new Promise<string>((resolveReply) => {
      session.waiters.push(resolveReply)
    })
    session.queue.push({
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content:
          contextBlock +
          `File: ${request.path} (${request.language})\n\n` +
          '<code>\n' + prefix + '<CURSOR>' + suffix + '\n</code>'
      }
    })
    session.turns += 1

    const timeout = setTimeout(() => {
      if (this.session === session) this.disposeSession()
    }, COMPLETION_TIMEOUT_MS)
    let text: string
    try {
      text = await reply
    } finally {
      clearTimeout(timeout)
    }
    if (seq !== this.requestSeq) return ''
    if (session.turns >= MAX_SESSION_TURNS && this.session === session) {
      // Recycle: transcripts grow with every completion; a fresh session
      // resets token cost. The next request pays one spawn.
      this.disposeSession()
    }
    // Models occasionally fence the answer anyway — unwrap before use.
    const unfenced = text.replace(/^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/, '$1')
    return this.broker.scrub(unfenced.replace(/\s+$/, ''))
  }
}
