import type { ThreadEvent, ThreadOptions, TurnOptions } from '@openai/codex-sdk'
import { chooseModel, CODEX_EFFORT } from './modelRouter'
import { resolveCodexLineup, type CodexModelEntry } from './modelCatalog'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import type { ModelMode, ModelTier } from '../shared/types'
import { agentShellEnabled } from './agentSecurity'

/**
 * Codex model lineup from the CLI's own cache — local file read, no
 * network, no tokens. Refreshed by the codex CLI itself; null when the
 * cache is missing/unreadable (then only effort scales, model stays the
 * account default).
 */
export function codexLineupFromCache(
  cachePath = join(homedir(), '.codex', 'models_cache.json')
): Record<ModelTier, string> | null {
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as
      | CodexModelEntry[]
      | { models?: CodexModelEntry[] }
    const models = Array.isArray(parsed) ? parsed : (parsed.models ?? [])
    return resolveCodexLineup(models)
  } catch {
    return null
  }
}
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type {
  AgentPlan,
  AgentSessionEvent,
  ContextPack,
  ContextTokenEstimate
} from '../shared/types'
import { KnowledgeEngine } from './knowledge/engine'
import { SecretBroker } from './secretBroker'
import { projectPolicyPrompt } from './projectPolicy'

export interface CodexAgentRunnerTiming {
  planTimeoutMs: number
  idleTimeoutMs: number
  totalTimeoutMs: number
}

// Same values as agentRunner.ts's Claude runner — the SDK exposes no native
// turn/time cap (TurnOptions is just { outputSchema?, signal? }), so a
// stalled Codex call previously hung forever with no user-visible recourse.
const DEFAULT_TIMING: CodexAgentRunnerTiming = {
  planTimeoutMs: 120_000,
  idleTimeoutMs: 180_000,
  totalTimeoutMs: 15 * 60_000
}

interface CodexThreadLike {
  run(input: string, options?: TurnOptions): Promise<{ finalResponse: string }>
  runStreamed(
    input: string,
    options?: TurnOptions
  ): Promise<{ events: AsyncGenerator<ThreadEvent> }>
}

export interface CodexClientLike {
  startThread(options?: ThreadOptions): CodexThreadLike
}

export type CodexClientFactory = (options: {
  env: Record<string, string>
  hookCommand: string
}) => CodexClientLike | Promise<CodexClientLike>

function quoteCommandPart(value: string): string {
  if (process.platform === 'win32') return `"${value.replace(/"/g, '\\"')}"`
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function defaultClientFactory(options: {
  env: Record<string, string>
  hookCommand: string
}): Promise<CodexClientLike> {
  const { Codex } = await import('@openai/codex-sdk')
  return new Codex({
    env: options.env,
    config: {
      // KNOWN GAP (2026-08-10, unresolved): the account's own
      // ~/.codex/AGENTS.md and the cross-tool ~/.agents/skills marketplace
      // can hijack a task entirely — e.g. the operator's personal
      // noli-project-knowledge skill made a "build a todo app" run stop and
      // ask "this project has Noli installed... yes/no?" instead of
      // executing. skill_search:false and instructions:'' are left on as
      // best-effort mitigation but did NOT stop it in live testing. Fully
      // isolating $HOME/$CODEX_HOME does stop it, but also breaks Codex's
      // own Linux sandbox (codex-linux-sandbox extracts under $CODEX_HOME
      // at runtime) — confirmed live, so that route is not used here.
      // Equivalent Claude leak (via the account's ~/.claude/CLAUDE.md) IS
      // fixed — see settingSources: [] in agentRunner.ts.
      features: { hooks: true, skill_search: false },
      instructions: '',
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash|apply_patch|Edit|Write|Read',
            hooks: [{ type: 'command', command: options.hookCommand, timeout: 5 }]
          }
        ],
        PostToolUse: [
          {
            matcher: '*',
            hooks: [{ type: 'command', command: options.hookCommand, timeout: 5 }]
          }
        ]
      }
    }
  })
}

/** Codex provider adapter using the official TypeScript SDK and saved CLI auth. */
export class CodexAgentRunner {
  private aborter: AbortController | null = null
  private pinned = false
  private lastPack: ContextPack | null = null
  private timing: CodexAgentRunnerTiming

  constructor(
    private workspaceRoot: string,
    private broker: SecretBroker,
    private knowledge: KnowledgeEngine,
    private clientFactory: CodexClientFactory = defaultClientFactory,
    timing: Partial<CodexAgentRunnerTiming> = {}
  ) {
    this.timing = { ...DEFAULT_TIMING, ...timing }
  }

  stop(): void {
    this.aborter?.abort()
    this.aborter = null
  }

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

  private buildAgentEnv(): Record<string, string> {
    const secretName = /(secret|token|password|passwd|private|credential|api[_-]?key)/i
    const env: Record<string, string> = {}
    for (const [name, value] of Object.entries(process.env)) {
      if (value == null || secretName.test(name)) continue
      if (this.broker.scrub(value) !== value) continue
      env[name] = value
    }
    return env
  }

  private securityContext(): { hookCommand: string; cleanup: () => void } {
    const directory = mkdtempSync(join(tmpdir(), 'woo-codex-secrets-'))
    const snapshotPath = join(directory, 'values.json')
    writeFileSync(snapshotPath, JSON.stringify({
      secrets: this.broker.knownSecretValues(),
      allowShell: agentShellEnabled(),
      workspaceRoot: this.workspaceRoot
    }), { mode: 0o600 })
    const hookPath = join(__dirname, 'codex-secret-hook.js')
    const executable = quoteCommandPart(process.execPath)
    const script = quoteCommandPart(hookPath)
    const snapshot = quoteCommandPart(snapshotPath)
    const hookCommand = process.platform === 'win32'
      ? `set ELECTRON_RUN_AS_NODE=1&& ${executable} ${script} ${snapshot}`
      : `ELECTRON_RUN_AS_NODE=1 ${executable} ${script} ${snapshot}`
    return {
      hookCommand,
      cleanup: () => rmSync(directory, { recursive: true, force: true })
    }
  }

  private client(hookCommand: string): CodexClientLike | Promise<CodexClientLike> {
    return this.clientFactory({ env: this.buildAgentEnv(), hookCommand })
  }

  private threadOptions(
    sandboxMode: 'read-only' | 'workspace-write',
    tier: ModelTier = 'standard'
  ): ThreadOptions {
    // Both routing levers: the tiered model from the account's own lineup
    // (frontier/balanced/fast per CLI metadata) AND reasoning effort.
    const lineup = codexLineupFromCache()
    return {
      workingDirectory: this.workspaceRoot,
      skipGitRepoCheck: true,
      sandboxMode,
      approvalPolicy: 'never',
      networkAccessEnabled: false,
      webSearchMode: 'disabled',
      ...(lineup ? { model: lineup[tier] } : {}),
      modelReasoningEffort: CODEX_EFFORT[tier]
    }
  }

  async plan(task: string): Promise<AgentPlan> {
    const pack =
      this.pinned && this.lastPack
        ? this.lastPack
        : await this.knowledge.retrieve(task, { mode: 'summary' })
    const context = pack.documents.length > 0
      ? `<project-knowledge-summary>\n${pack.context}\n</project-knowledge-summary>\n\n`
      : ''
    const policy = await projectPolicyPrompt(this.workspaceRoot)
    const security = this.securityContext()
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.timing.planTimeoutMs)
    try {
      const client = await this.client(security.hookCommand)
      // Plan tier follows the same difficulty scorer as execution — strong
      // planner for hard tasks, light for trivial ones.
      const thread = client.startThread(
        this.threadOptions('read-only', chooseModel('codex', task).tier)
      )
      let result: { finalResponse: string }
      try {
        result = await thread.run(
          policy +
            context +
            `If this is casual conversation, a greeting, or a question that isn't asking for a code change, reply with exactly this line and nothing else: NOT_A_TASK\nOtherwise produce a short numbered implementation plan (3-6 steps, one line each, no preamble). Do not execute anything.\n\nTask: ${task}`,
          { signal: controller.signal }
        )
      } catch (error) {
        if (timedOut) throw new Error('Codex planning timed out before it completed.')
        throw error
      }
      const steps = this.broker
        .scrub(result.finalResponse)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^\d+[.)]\s+/.test(line))
        .map((line) => line.replace(/^\d+[.)]\s+/, ''))
      return { task, steps }
    } finally {
      clearTimeout(timeout)
      security.cleanup()
    }
  }

  async runTask(
    task: string,
    onEvent: (event: AgentSessionEvent) => void,
    planText?: string,
    modelMode: ModelMode = 'auto'
  ): Promise<void> {
    let contextBlock = ''
    let packTokens = 0
    let packDocs = 0
    try {
      const pack =
        this.pinned && this.lastPack ? this.lastPack : await this.knowledge.retrieve(task)
      packTokens = pack.tokenEstimate
      packDocs = pack.documents.length
      if (pack.documents.length > 0) {
        this.lastPack = pack
        onEvent({ type: 'context-pack', pack })
        contextBlock = `<project-knowledge>\n${pack.context}\n</project-knowledge>\n\nRetrieved project rules are binding.\n\n`
      } else {
        onEvent({ type: 'text', text: '(no sufficiently relevant project knowledge found)\n' })
      }
    } catch {
      onEvent({ type: 'text', text: '(project knowledge unavailable)\n' })
    }

    const planBlock = planText?.trim()
      ? `Follow this approved plan:\n${planText.trim()}\n\n`
      : ''
    const choice = chooseModel('codex', task, {
      packTokens,
      packDocs,
      planSteps: planText ? planText.split('\n').filter((l) => l.trim()).length : 0,
      force: modelMode === 'auto' ? undefined : modelMode
    })
    const routedModel = codexLineupFromCache()?.[choice.tier] ?? choice.model
    onEvent({
      type: 'model-choice',
      text: `${choice.tier} → ${routedModel} @ ${CODEX_EFFORT[choice.tier]} effort (${choice.reason})`
    })
    const secretBoundary =
      'Woo security boundary: never read secret-bearing files such as .env, private keys, credentials, .npmrc, or secret stores; never dump the process environment.\n\n'
    const policyBlock = await projectPolicyPrompt(this.workspaceRoot)
    this.aborter = new AbortController()
    const controller = this.aborter
    const seenTools = new Set<string>()
    const security = this.securityContext()
    // The SDK exposes no native turn/time cap (TurnOptions is just
    // { outputSchema?, signal? }) — without this, a stalled Codex task hangs
    // forever with only the manual Stop button as recourse.
    let terminalEmitted = false
    let timedOut = false
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
    }
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer)
      if (terminalEmitted) return
      idleTimer = setTimeout(
        () => abortForTimeout('Codex stopped making progress and was terminated.'),
        this.timing.idleTimeoutMs
      )
    }
    resetIdleTimer()
    const totalTimer = setTimeout(
      () => abortForTimeout('Codex exceeded the maximum task duration and was terminated.'),
      this.timing.totalTimeoutMs
    )
    try {
      const client = await this.client(security.hookCommand)
      const thread = client.startThread(this.threadOptions('workspace-write', choice.tier))
      const { events } = await thread.runStreamed(
        policyBlock + contextBlock + planBlock + secretBoundary + task,
        { signal: controller.signal }
      )
      for await (const event of events) {
        resetIdleTimer()
        if (event.type === 'item.started' || event.type === 'item.updated') {
          if (seenTools.has(event.item.id)) continue
          if (event.item.type === 'command_execution') {
            seenTools.add(event.item.id)
            onEvent({
              type: 'tool-use',
              toolName: 'Bash',
              toolInput: this.broker.scrub(event.item.command).slice(0, 400)
            })
          } else if (event.item.type === 'mcp_tool_call') {
            seenTools.add(event.item.id)
            onEvent({
              type: 'tool-use',
              toolName: `${event.item.server}.${event.item.tool}`,
              toolInput: this.broker.scrub(JSON.stringify(event.item.arguments)).slice(0, 400)
            })
          }
        } else if (event.type === 'item.completed') {
          if (event.item.type === 'agent_message') {
            onEvent({ type: 'text', text: this.broker.scrub(event.item.text) })
          } else if (event.item.type === 'file_change' && !seenTools.has(event.item.id)) {
            seenTools.add(event.item.id)
            onEvent({
              type: 'tool-use',
              toolName: 'Edit',
              toolInput: event.item.changes.map((change) => `${change.kind}: ${change.path}`).join(', ')
            })
          } else if (event.item.type === 'error') {
            emitError(event.item.message)
            return
          }
        } else if (event.type === 'turn.failed') {
          emitError(event.error.message)
          return
        } else if (event.type === 'error') {
          emitError(event.message)
          return
        } else if (event.type === 'turn.completed') {
          emitDone()
        }
      }
    } catch (error: any) {
      if (timedOut) {
        // abortForTimeout() already emitted the error — the abort itself
        // throws AbortError here, nothing more to report.
      } else if (error?.name === 'AbortError') {
        emitDone()
      } else {
        emitError(String(error?.message ?? error))
      }
    } finally {
      if (idleTimer) clearTimeout(idleTimer)
      clearTimeout(totalTimer)
      this.aborter = null
      security.cleanup()
    }
  }
}
