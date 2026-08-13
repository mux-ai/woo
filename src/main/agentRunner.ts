import { query, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '@anthropic-ai/claude-agent-sdk'
import { isAbsolute, join } from 'path'
import type {
  AgentPlan,
  AgentSessionEvent,
  ContextPack,
  ContextTokenEstimate
} from '../shared/types'
import { SecretBroker } from './secretBroker'
import { KnowledgeEngine } from './knowledge/engine'
import { chooseModel } from './modelRouter'
import { ModelCatalog } from './modelCatalog'
import type { ModelMode } from '../shared/types'
import { projectPolicyPrompt } from './projectPolicy'
import { agentShellEnabled, SHELL_DISABLED_REASON } from './agentSecurity'

/**
 * Agent Runner — wraps a Claude Agent SDK session (KNOW-001, SEC-001/002).
 *
 * Enforcement points:
 *  - PreToolUse: the authoritative, fail-closed Secret Broker check before
 *    execution. This cannot be shadowed by Claude permission settings.
 *  - canUseTool: a second permission boundary for calls that require an SDK
 *    permission response. It deliberately repeats the same policy.
 *  - Bash commands that reference secret paths or dump the environment
 *    are denied outright — coarser than file checks, deliberately so.
 *  - PostToolUse hook: every tool RESULT (Bash stdout, file contents) is
 *    scrubbed via updatedToolOutput before it enters the model transcript,
 *    so a bypassed path check (e.g. `cat .e*v`) still leaks nothing the
 *    broker knows about.
 *  - The SDK subprocess gets a sanitized environment: secret-named shell
 *    vars are withheld, so even an env dump that slips past the command
 *    filter has little to show.
 *  - All streamed text shown to the UI passes through broker.scrub() too.
 */

const ENV_DUMP_COMMANDS = /\b(printenv|env\s*$|env\s*\||set\s*$|export\s*-p)\b/
const SECRET_PATH_IN_COMMAND =
  /(\.env(\.\w+)?\b|\.pem\b|\.key\b|id_rsa|id_ed25519|credentials|\.netrc|\.npmrc)/i

const FILE_TOOLS_WITH_PATH: Record<string, string> = {
  Read: 'file_path',
  Write: 'file_path',
  Edit: 'file_path',
  NotebookEdit: 'notebook_path'
}

// 'Skill' must be in this base-tools whitelist: `tools` is a restrictive
// list of built-ins, and without the Skill tool `skills: 'all'` loads
// nothing — verified live (2026-08-14): the model saw no skill listing and
// resorted to Glob/Read-ing SKILL.md files by hand.
const CLAUDE_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash', 'Skill']

export interface AgentRunnerTiming {
  planTimeoutMs: number
  idleTimeoutMs: number
  totalTimeoutMs: number
}

const DEFAULT_TIMING: AgentRunnerTiming = {
  planTimeoutMs: 120_000,
  idleTimeoutMs: 180_000,
  totalTimeoutMs: 15 * 60_000
}

export type ClaudeQuery = typeof query

/**
 * Prompt caching (Anthropic prompt cache, via the SDK's systemPrompt cache
 * boundary): project policy + retrieved knowledge are project-stable and
 * often byte-identical across calls — always so when context is pinned
 * (same pack reused by both plan() and runTask()), and opportunistically
 * whenever consecutive tasks retrieve the same docs. Putting them ahead of
 * SYSTEM_PROMPT_DYNAMIC_BOUNDARY marks them as the cacheable prefix instead
 * of paying full price to reprocess them on every call. Task-specific text
 * (the actual ask) stays in `prompt` — it never repeats, so caching it
 * would only add the cache-write premium for no future hit.
 */
function cacheableSystemPrompt(staticBlock: string): string[] | undefined {
  return staticBlock ? [staticBlock, SYSTEM_PROMPT_DYNAMIC_BOUNDARY] : undefined
}

export class AgentRunner {
  private aborter: AbortController | null = null
  private activeQuery: ReturnType<ClaudeQuery> | null = null
  private pinned = false
  private lastPack: ContextPack | null = null
  private catalog: ModelCatalog

  constructor(
    private workspaceRoot: string,
    private broker: SecretBroker,
    private knowledge: KnowledgeEngine,
    private queryClient: ClaudeQuery = query,
    timing: Partial<AgentRunnerTiming> = {},
    catalog?: ModelCatalog
  ) {
    this.configureTiming(timing)
    this.catalog = catalog ?? new ModelCatalog(() => this.detectModels())
  }

  /**
   * Ask the connected account which models it supports — a control request
   * over the CLI's own auth, no model tokens spent. Session is closed
   * immediately after the answer.
   */
  private async detectModels(): Promise<{ value: string; resolvedModel?: string }[]> {
    const session = this.queryClient({
      prompt: '',
      options: {
        cwd: this.workspaceRoot,
        permissionMode: 'default',
        tools: [],
        maxTurns: 1,
        env: this.buildAgentEnv()
      }
    })
    try {
      const models = await (
        session as unknown as {
          supportedModels(): Promise<{ value: string; resolvedModel?: string }[]>
        }
      ).supportedModels()
      return models
    } finally {
      this.closeQuery(session)
    }
  }

  private timing: AgentRunnerTiming = { ...DEFAULT_TIMING }

  private configureTiming(timing: Partial<AgentRunnerTiming>): void {
    this.timing = { ...DEFAULT_TIMING, ...timing }
  }

  stop(): void {
    this.aborter?.abort()
    this.closeQuery(this.activeQuery)
  }

  private closeQuery(session: ReturnType<ClaudeQuery> | null): void {
    // Test doubles and older compatible SDKs may only implement AsyncGenerator.
    ;(session as { close?: () => void } | null)?.close?.()
  }

  /**
   * Pin the last retrieved Context Pack: while pinned, later runs reuse it
   * instead of retrieving fresh (KNOW-001 still holds — the pack WAS
   * retrieved from project knowledge).
   */
  setPinned(pinned: boolean, pack?: ContextPack): boolean {
    if (pack?.documents.length) this.lastPack = pack
    this.pinned = pinned && this.lastPack != null
    return this.pinned
  }

  invalidateContext(): boolean {
    const wasPinned = this.pinned
    this.pinned = false
    this.lastPack = null
    return wasPinned
  }

  async estimateContext(task: string): Promise<ContextTokenEstimate> {
    if (this.pinned && this.lastPack) {
      return {
        task,
        planningTokens: this.lastPack.tokenEstimate,
        executionTokens: this.lastPack.tokenEstimate,
        totalTokens: this.lastPack.tokenEstimate * 2,
        documentCount: this.lastPack.documents.length,
        pinned: true
      }
    }
    const [planning, execution] = await Promise.all([
      this.knowledge.retrieve(task, { mode: 'summary' }),
      this.knowledge.retrieve(task)
    ])
    return {
      task,
      planningTokens: planning.tokenEstimate,
      executionTokens: execution.tokenEstimate,
      totalTokens: planning.tokenEstimate + execution.tokenEstimate,
      documentCount: execution.documents.length,
      pinned: false
    }
  }

  /**
   * Plan phase: one tool-less model turn producing a short numbered plan.
   * No tools, so no broker surface; text is still scrubbed on the way out.
   */
  async plan(task: string): Promise<AgentPlan> {
    let contextBlock = ''
    try {
      const pack =
        this.pinned && this.lastPack
          ? this.lastPack
          : await this.knowledge.retrieve(task, { mode: 'summary' })
      if (pack.documents.length > 0) {
        contextBlock = `<project-knowledge-summary>\n${pack.context}\n</project-knowledge-summary>\n\n`
      }
    } catch {
      // no knowledge — plan without it
    }
    const policyBlock = await projectPolicyPrompt(this.workspaceRoot)
    const controller = new AbortController()
    let timedOut = false
    let session: ReturnType<ClaudeQuery> | null = null
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
      this.closeQuery(session)
    }, this.timing.planTimeoutMs)
    try {
      session = this.queryClient({
        prompt: `If this is casual conversation, a greeting, or a question that isn't asking for a code change, reply with exactly this line and nothing else: NOT_A_TASK\nOtherwise produce a short numbered implementation plan (3-6 steps, one line each, no preamble) for this task. Do not execute anything.\n\nTask: ${task}`,
        options: {
          cwd: this.workspaceRoot,
          systemPrompt: cacheableSystemPrompt(policyBlock + contextBlock),
          abortController: controller,
          permissionMode: 'default',
          tools: [],
          maxTurns: 1,
          // Plan model follows the same difficulty scorer as execution: a
          // hard task deserves a strong planner (plan quality drives
          // execution quality), a trivial one keeps the light model. Plans
          // are short output, so even a deep-tier plan stays cheap.
          model: (await this.catalog.lineup())[chooseModel('claude', task).tier],
          env: this.buildAgentEnv(),
          // SDK isolation mode: the operator's own ~/.claude/CLAUDE.md and
          // settings.json must not steer a Woo task — projectPolicyPrompt
          // above is the sole source of instructions.
          settingSources: []
        }
      })
      let text = ''
      for await (const message of session) {
        if (message.type === 'assistant') {
          for (const block of message.message.content) {
            if (block.type === 'text') text += block.text + '\n'
          }
        }
      }
      const steps = this.broker
        .scrub(text)
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /^\d+[.)]\s+/.test(l))
        .map((l) => l.replace(/^\d+[.)]\s+/, ''))
      return { task, steps }
    } catch (error: any) {
      if (timedOut || (controller.signal.aborted && error?.name === 'AbortError')) {
        throw new Error('Claude planning timed out before it completed.')
      }
      throw error
    } finally {
      clearTimeout(timeout)
      this.closeQuery(session)
    }
  }

  /**
   * Environment for the SDK subprocess: withhold secret-named shell vars
   * and any var whose value the broker knows to be a secret. ANTHROPIC_*
   * and CLAUDE_* stay — the SDK needs them to authenticate.
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

  async runTask(
    task: string,
    onEvent: (e: AgentSessionEvent) => void,
    planText?: string,
    modelMode: ModelMode = 'auto'
  ): Promise<void> {
    // KNOW-001: retrieve before execute (or reuse the pinned pack).
    let contextBlock = ''
    let packTokens = 0
    let packDocs = 0
    try {
      const pack =
        this.pinned && this.lastPack ? this.lastPack : await this.knowledge.retrieve(task)
      // Always emit the pack — an empty one tells the inspector "retrieval
      // ran, nothing scored above threshold" instead of "never ran".
      onEvent({ type: 'context-pack', pack })
      packTokens = pack.tokenEstimate
      packDocs = pack.documents.length
      if (pack.documents.length > 0) {
        this.lastPack = pack
        contextBlock = `<project-knowledge>\n${pack.context}\n</project-knowledge>\n\nRetrieved project rules above are binding.\n\n`
      }
    } catch {
      onEvent({
        type: 'text',
        text: '(no project knowledge found — initialize .woo/knowledge to ground the agent)\n'
      })
    }

    const planBlock = planText?.trim()
      ? `Follow this approved plan:\n${planText.trim()}\n\n`
      : ''
    const choice = chooseModel('claude', task, {
      packTokens,
      packDocs,
      planSteps: planText ? planText.split('\n').filter((l) => l.trim()).length : 0,
      force: modelMode === 'auto' ? undefined : modelMode
    })
    // Account-aware mapping: the tier resolves against what the connected
    // account actually supports — deep prefers Claude Fable 5 when present.
    const lineup = await this.catalog.lineup()
    choice.model = lineup[choice.tier]
    onEvent({
      type: 'model-choice',
      text: `${choice.tier} → ${choice.model} (${choice.reason})${
        choice.tier === 'deep' && this.catalog.fableAvailable() ? ' · account has Fable 5' : ''
      }`
    })
    const policyBlock = await projectPolicyPrompt(this.workspaceRoot)
    this.aborter = new AbortController()
    const controller = this.aborter
    const observedToolUseIds = new Set<string>()
    let terminalEmitted = false
    let timedOut = false
    let session: ReturnType<ClaudeQuery> | null = null
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    let totalTimer: ReturnType<typeof setTimeout> | null = null
    const emitDone = () => {
      if (terminalEmitted) return
      terminalEmitted = true
      onEvent({ type: 'done' })
    }
    const emitError = (error: string) => {
      if (terminalEmitted) return
      terminalEmitted = true
      onEvent({ type: 'error', error: this.broker.scrub(error) })
    }
    const abortForTimeout = (message: string) => {
      if (terminalEmitted) return
      timedOut = true
      emitError(message)
      controller.abort()
      this.closeQuery(session)
    }
    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer)
      if (terminalEmitted) return
      idleTimer = setTimeout(
        () => abortForTimeout('Claude stopped making progress and was terminated.'),
        this.timing.idleTimeoutMs
      )
    }
    resetIdleTimer()
    totalTimer = setTimeout(
      () => abortForTimeout('Claude exceeded the maximum task duration and was terminated.'),
      this.timing.totalTimeoutMs
    )
    try {
      session = this.queryClient({
        prompt: planBlock + task,
        options: {
          cwd: this.workspaceRoot,
          systemPrompt: cacheableSystemPrompt(policyBlock + contextBlock),
          abortController: controller,
          permissionMode: 'default',
          // `tools` controls availability only. Never use `allowedTools` here:
          // bare entries auto-approve and can bypass canUseTool.
          tools: CLAUDE_TOOLS,
          model: choice.model,
          maxTurns: 50,
          // Workspace skills (.claude/skills/*/SKILL.md). Enables the Skill
          // tool automatically. Skills cannot override the Secret Broker:
          // every call they trigger still passes PreToolUse + output scrub.
          skills: 'all',
          // Token-level streaming: emit stream_event messages while the
          // model writes, instead of only whole assistant messages.
          includePartialMessages: true,
          env: this.buildAgentEnv(),
          // Partial SDK isolation: 'user' stays blocked — the operator's own
          // ~/.claude/CLAUDE.md and settings.json must not steer the task
          // (live test 2026-08-10: a connected account's personal global
          // CLAUDE.md hijacked a "create a todo app" run entirely). 'project'
          // must be loaded though: filesystem skill discovery rides on
          // setting sources, and with [] the model gets NO workspace skill
          // listing at all — skills:'all' alone is NOT a separate discovery
          // path (verified live 2026-08-14). Workspace-scoped instructions
          // are in-scope by design; account-scope skills (~/.claude/skills)
          // remain unloaded because they'd require the 'user' source.
          settingSources: ['project'],
          hooks: {
            // SEC-001: this is the authoritative pre-execution boundary.
            // It still runs when SDK permission rules bypass canUseTool.
            PreToolUse: [
              {
                hooks: [
                  async (input, toolUseID) => {
                    if (input.hook_event_name !== 'PreToolUse') return {}
                    resetIdleTimer()
                    const toolInput =
                      input.tool_input && typeof input.tool_input === 'object' && !Array.isArray(input.tool_input)
                        ? input.tool_input as Record<string, unknown>
                        : {}
                    const id = toolUseID ?? input.tool_use_id
                    if (id) observedToolUseIds.add(id)
                    const denial = this.checkToolCall(input.tool_name, toolInput)
                    if (denial) {
                      onEvent({ type: 'tool-denied', toolName: input.tool_name, toolInput: denial })
                      return {
                        hookSpecificOutput: {
                          hookEventName: 'PreToolUse' as const,
                          permissionDecision: 'deny' as const,
                          permissionDecisionReason: denial
                        }
                      }
                    }
                    onEvent({
                      type: 'tool-use',
                      toolName: input.tool_name,
                      toolInput: this.broker.scrub(JSON.stringify(toolInput)).slice(0, 400)
                    })
                    return {}
                  }
                ]
              }
            ],
            // SEC-002: scrub secret values out of every tool result before
            // it reaches the model transcript.
            PostToolUse: [
              {
                hooks: [
                  async (input) => {
                    if (input.hook_event_name !== 'PostToolUse') return {}
                    resetIdleTimer()
                    const raw = JSON.stringify(input.tool_response)
                    if (raw == null) return {}
                    const scrubbed = this.broker.scrub(raw)
                    if (scrubbed === raw) return {}
                    return {
                      hookSpecificOutput: {
                        hookEventName: 'PostToolUse' as const,
                        updatedToolOutput: JSON.parse(scrubbed)
                      }
                    }
                  }
                ]
              }
            ]
          },
          canUseTool: async (toolName, input, options) => {
            resetIdleTimer()
            const denial = this.checkToolCall(toolName, input)
            if (denial) {
              if (!observedToolUseIds.has(options.toolUseID)) {
                onEvent({ type: 'tool-denied', toolName, toolInput: denial })
              }
              return { behavior: 'deny' as const, message: denial }
            }
            if (!observedToolUseIds.has(options.toolUseID)) {
              onEvent({
                type: 'tool-use',
                toolName,
                toolInput: this.broker.scrub(JSON.stringify(input)).slice(0, 400)
              })
            }
            return { behavior: 'allow' as const, updatedInput: input }
          }
        }
      })
      this.activeQuery = session

      // Accumulates the in-flight assistant message. Deltas are batched and
      // flushed at most every STREAM_FLUSH_MS — per-token events made the
      // renderer re-parse and re-render on every single token. Each flush
      // re-sends the FULL scrubbed buffer — scrubbing per-delta would miss
      // secret values split across chunk boundaries.
      const STREAM_FLUSH_MS = 50
      let streaming = ''
      let streamDirty = false
      let flushTimer: ReturnType<typeof setTimeout> | null = null
      const flushStream = () => {
        if (flushTimer) {
          clearTimeout(flushTimer)
          flushTimer = null
        }
        if (!streamDirty) return
        streamDirty = false
        onEvent({ type: 'text-stream', text: this.broker.scrub(streaming) })
      }
      try {
        for await (const message of session) {
          resetIdleTimer()
          if (message.type === 'stream_event') {
            const event = message.event
            if (
              event.type === 'content_block_delta' &&
              event.delta.type === 'text_delta' &&
              event.delta.text
            ) {
              streaming += event.delta.text
              streamDirty = true
              if (!flushTimer) flushTimer = setTimeout(flushStream, STREAM_FLUSH_MS)
            }
          } else if (message.type === 'assistant') {
            // Final message supersedes any pending partial flush.
            if (flushTimer) clearTimeout(flushTimer)
            flushTimer = null
            streamDirty = false
            streaming = ''
            for (const block of message.message.content) {
              if (block.type === 'text') {
                onEvent({ type: 'text', text: this.broker.scrub(block.text) })
              }
            }
          } else if (message.type === 'result') {
            flushStream()
            emitDone()
            this.closeQuery(session)
            break
          }
        }
        emitDone()
      } finally {
        if (flushTimer) clearTimeout(flushTimer)
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        if (!timedOut) emitDone()
      } else emitError(String(err?.message ?? err))
    } finally {
      if (idleTimer) clearTimeout(idleTimer)
      if (totalTimer) clearTimeout(totalTimer)
      this.closeQuery(session)
      if (this.activeQuery === session) this.activeQuery = null
      if (this.aborter === controller) this.aborter = null
    }
  }

  /** Returns a denial message, or null to allow. */
  private checkToolCall(toolName: string, input: Record<string, unknown>): string | null {
    const pathField = FILE_TOOLS_WITH_PATH[toolName]
    if (pathField && typeof input[pathField] === 'string') {
      const p = input[pathField] as string
      const abs = isAbsolute(p) ? p : join(this.workspaceRoot, p)
      const decision = this.broker.checkPath(abs)
      if (!decision.allowed) return decision.reason ?? 'Blocked by Secret Broker.'
    }
    if (toolName === 'Grep' || toolName === 'Glob') {
      if (typeof input.path === 'string') {
        const decision = this.broker.checkPath(input.path)
        if (!decision.allowed) return decision.reason ?? 'Blocked by Secret Broker.'
      }
      const pattern = String(input.pattern ?? '') + ' ' + String(input.path ?? '')
      if (SECRET_PATH_IN_COMMAND.test(pattern)) {
        return 'Blocked by Secret Broker: pattern targets secret files.'
      }
    }
    if (toolName === 'Bash' && typeof input.command === 'string') {
      if (!agentShellEnabled()) return SHELL_DISABLED_REASON
      const cmd = input.command
      if (SECRET_PATH_IN_COMMAND.test(cmd)) {
        return 'Blocked by Secret Broker: command references a secret-bearing path.'
      }
      if (ENV_DUMP_COMMANDS.test(cmd)) {
        return 'Blocked by Secret Broker: environment dumps are not allowed.'
      }
    }
    return null
  }
}
