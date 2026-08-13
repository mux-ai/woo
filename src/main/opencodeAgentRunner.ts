import { spawn, type ChildProcess } from 'child_process'
import type {
  AgentPlan,
  AgentSessionEvent,
  ContextPack,
  ContextTokenEstimate
} from '../shared/types'
import { SecretBroker } from './secretBroker'
import { KnowledgeEngine } from './knowledge/engine'
import { evaluateOpencodePermission, type OpencodePermission } from './opencodePolicy'
import { agentShellEnabled } from './agentSecurity'
import { execFile } from 'child_process'
import { chooseModel } from './modelRouter'
import { ModelCatalog, type DetectedModel } from './modelCatalog'
import type { ModelMode, ModelTier } from '../shared/types'

export type OpencodeVariant = 'zen' | 'go'

// Model quality heuristic for OpenCode Go. Mostly open-weights (deepseek/
// kimi/qwen/glm/minimax), though the live lineup has since grown to include
// some closed models too (verified 2026-08-11: opencode-go/gpt-5.6-luna,
// opencode-go/grok-4.5 both present) — the claude-name matching
// resolveLineup() uses for Zen still doesn't apply here since none of these
// carry claude/haiku/sonnet/opus/fable in their names. Preference order
// below is tuned from the 2026-08-10 live opencode-go test in project
// memory, NOT a formal benchmark like the claude/codex cross-provider one —
// revisit if a real comparison ever runs. deepseek-v4-flash is known to
// stall indefinitely on planning-style prompts, so it's excluded outright
// rather than ranked low.
const GO_EXCLUDE = /deepseek-v4-flash/i
const GO_PREFERENCE = [/kimi-k3/i, /kimi-k2\.7-code/i, /kimi/i, /qwen/i, /glm/i, /minimax/i]

export function resolveGoLineup(models: DetectedModel[]): Record<ModelTier, string> {
  const usable = models.map((m) => m.value).filter((v) => !GO_EXCLUDE.test(v))
  const best = GO_PREFERENCE.map((re) => usable.find((v) => re.test(v))).find(Boolean) ?? usable[0] ?? ''
  return { light: best, standard: best, deep: best }
}

/**
 * opencode provider adapter. Woo spawns `opencode serve` ITSELF (not the
 * SDK helper) so the server gets a sanitized environment, then drives it
 * over the HTTP SDK client.
 *
 * Enforcement (honest scope — differs from the Claude path):
 *  - Config forces every edit/bash/webfetch through a permission ask;
 *    Woo's handler answers from `opencodePolicy` (default-deny) against
 *    the live broker. Mid-session vault unlocks apply IMMEDIATELY — the
 *    handler reads live state, unlike the codex per-run snapshot.
 *  - Sanitized spawn env: secret-named/valued vars withheld; vault values
 *    absent from process.env by construction.
 *  - NO transcript-scrub hook exists in opencode (no PostToolUse analog):
 *    tool outputs enter opencode's own transcript unscrubbed. All text Woo
 *    DISPLAYS is scrubbed, and the deny wall is stricter to compensate
 *    (webfetch off, default-deny unknown permission types). The UI states
 *    this reduced enforcement whenever the provider is selected.
 */

const SERVE_TIMEOUT_MS = 15000
const IDLE_EXTRA_TOOLS: Record<string, boolean> = {}

export class OpencodeAgentRunner {
  private child: ChildProcess | null = null
  private aborter: AbortController | null = null
  private pinned = false
  private lastPack: ContextPack | null = null

  // Which credential set (Zen or Go) the next plan()/runTask() call routes
  // to — set by the caller (ipc.ts) right before dispatch, since Woo spawns
  // one `opencode serve` regardless: both credentials live under the same
  // CLI/account, only the model reference passed per-request differs. Defer
  // to Zen by default so an unset variant behaves exactly as before Go
  // existed as a distinct choice.
  private variant: OpencodeVariant = 'zen'
  private goLineupCache: { at: number; lineup: Record<ModelTier, string> } | null = null

  private catalog: ModelCatalog

  constructor(
    private workspaceRoot: string,
    private broker: SecretBroker,
    private knowledge: KnowledgeEngine,
    catalog?: ModelCatalog
  ) {
    this.catalog = catalog ?? new ModelCatalog(() => this.detectModels((id) => id === 'opencode'))
  }

  setVariant(variant: OpencodeVariant): void {
    this.variant = variant
  }

  /**
   * `opencode models` lists every model the connected account can use,
   * across BOTH credential sets at once — filter by the model ref's
   * provider id ("opencode/…" vs "opencode-go/…") to scope to one variant.
   */
  private detectModels(filter: (providerID: string) => boolean): Promise<DetectedModel[]> {
    return new Promise((resolve, reject) => {
      execFile(
        'opencode',
        ['models'],
        { env: this.buildAgentEnv(), timeout: 15000 },
        (err, stdout) => {
          if (err) return reject(err)
          resolve(
            stdout
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
              .filter((value) => {
                const slash = value.indexOf('/')
                return filter(slash > 0 ? value.slice(0, slash) : value)
              })
              .map((value) => ({ value }))
          )
        }
      )
    })
  }

  /** Go has no claude-named models to pattern-match, so it skips ModelCatalog. */
  private async goLineup(): Promise<Record<ModelTier, string>> {
    const TTL_MS = 10 * 60 * 1000
    if (this.goLineupCache && Date.now() - this.goLineupCache.at < TTL_MS) {
      return this.goLineupCache.lineup
    }
    try {
      const models = await this.detectModels((id) => id === 'opencode-go')
      const lineup = resolveGoLineup(models)
      this.goLineupCache = { at: Date.now(), lineup }
      return lineup
    } catch {
      return { light: '', standard: '', deep: '' }
    }
  }

  private lineup(): Promise<Record<ModelTier, string>> {
    return this.variant === 'go' ? this.goLineup() : this.catalog.lineup()
  }

  /** "opencode/claude-sonnet-5" → prompt-body model reference. */
  private static toModelRef(id: string): { providerID: string; modelID: string } | undefined {
    const slash = id.indexOf('/')
    if (slash <= 0) return undefined
    return { providerID: id.slice(0, slash), modelID: id.slice(slash + 1) }
  }

  stop(): void {
    this.aborter?.abort()
    this.aborter = null
    this.killServer()
  }

  private killServer(): void {
    if (this.child) {
      this.child.kill()
      this.child = null
    }
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

  /** Same sanitization as the other runners: agent env never carries secrets. */
  buildAgentEnv(): Record<string, string> {
    const secretName = /(secret|token|password|passwd|private|credential|api[_-]?key)/i
    const env: Record<string, string> = {}
    for (const [name, value] of Object.entries(process.env)) {
      if (value == null) continue
      if (secretName.test(name)) continue
      if (this.broker.scrub(value) !== value) continue
      env[name] = value
    }
    return env
  }

  /** Spawn `opencode serve` with sanitized env; resolve its base URL. */
  private async startServer(): Promise<string> {
    this.killServer()
    const port = 41000 + Math.floor(Math.random() * 4000)
    const config = {
      permission: { edit: 'ask', bash: 'ask', webfetch: 'ask' }
    }
    const child = spawn('opencode', ['serve', '--hostname=127.0.0.1', `--port=${port}`], {
      cwd: this.workspaceRoot,
      env: { ...this.buildAgentEnv(), OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.child = child
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.killServer()
        reject(new Error(`opencode serve did not start within ${SERVE_TIMEOUT_MS}ms`))
      }, SERVE_TIMEOUT_MS)
      let output = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString()
        const match = /https?:\/\/\S+/.exec(output)
        if (match) {
          clearTimeout(timer)
          resolve(match[0])
        }
      })
      child.once('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer)
        reject(
          err.code === 'ENOENT'
            ? new Error('opencode CLI is not installed — install it and sign in (`opencode auth login`).')
            : err
        )
      })
      child.once('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`opencode serve exited early (code ${code}).`))
      })
    })
  }

  private async contextBlock(task: string, onEvent?: (e: AgentSessionEvent) => void): Promise<string> {
    try {
      const pack =
        this.pinned && this.lastPack ? this.lastPack : await this.knowledge.retrieve(task)
      onEvent?.({ type: 'context-pack', pack })
      if (pack.documents.length > 0) {
        this.lastPack = pack
        return `<project-knowledge>\n${pack.context}\n</project-knowledge>\n\nRetrieved project rules above are binding.\n\n`
      }
    } catch {
      onEvent?.({
        type: 'text',
        text: '(no project knowledge found — initialize .woo/knowledge to ground the agent)\n'
      })
    }
    return ''
  }

  async plan(task: string): Promise<AgentPlan> {
    const context = await this.contextBlock(task)
    const planProvider = this.variant === 'go' ? 'opencode-go' : 'opencode'
    const text = await this.runSession(
      context +
        `If this is casual conversation, a greeting, or a question that isn't asking for a code change, reply with exactly this line and nothing else: NOT_A_TASK\nOtherwise produce a short numbered implementation plan (3-6 steps, one line each, no preamble) for this task. Do not execute anything.\n\nTask: ${task}`,
      () => {},
      {
        toolless: true,
        // Plan tier follows the same difficulty scorer as execution.
        model: OpencodeAgentRunner.toModelRef(
          (await this.lineup())[chooseModel(planProvider, task).tier]
        )
      }
    )
    const steps = this.broker
      .scrub(text)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^\d+[.)]\s+/.test(l))
      .map((l) => l.replace(/^\d+[.)]\s+/, ''))
    return { task, steps }
  }

  async runTask(
    task: string,
    onEvent: (e: AgentSessionEvent) => void,
    planText?: string,
    modelMode: ModelMode = 'auto'
  ): Promise<void> {
    const context = await this.contextBlock(task, onEvent)
    // Real routing: the account's model list (`opencode models`) resolves
    // the tier — same lineup logic as the Claude provider. Falls back to
    // the account's own default model when detection fails.
    const executeProvider = this.variant === 'go' ? 'opencode-go' : 'opencode'
    const choice = chooseModel(executeProvider, task, {
      force: modelMode === 'auto' ? undefined : modelMode
    })
    const lineup = await this.lineup()
    const routed = lineup[choice.tier]
    const modelRef = OpencodeAgentRunner.toModelRef(routed)
    onEvent({
      type: 'model-choice',
      text: modelRef
        ? `${choice.tier} → ${routed} (${choice.reason})${
            this.variant === 'zen' && choice.tier === 'deep' && this.catalog.fableAvailable()
              ? ' · account has Fable 5'
              : ''
          }`
        : `${choice.tier} → opencode default model (${choice.reason})`
    })
    const planBlock = planText?.trim()
      ? `Follow this approved plan:\n${planText.trim()}\n\n`
      : ''
    try {
      await this.runSession(context + planBlock + task, onEvent, { toolless: false, model: modelRef })
      onEvent({ type: 'done' })
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') onEvent({ type: 'done' })
      else onEvent({ type: 'error', error: this.broker.scrub(String((err as Error)?.message ?? err)) })
    } finally {
      this.killServer()
    }
  }

  /** Drive one session to idle; returns final assistant text. */
  private async runSession(
    prompt: string,
    onEvent: (e: AgentSessionEvent) => void,
    opts: { toolless: boolean; model?: { providerID: string; modelID: string } }
  ): Promise<string> {
    const baseUrl = await this.startServer()
    const { createOpencodeClient } = await import('@opencode-ai/sdk')
    const client = createOpencodeClient({ baseUrl })
    this.aborter = new AbortController()
    const signal = this.aborter.signal

    const created = await client.session.create({ body: { title: 'Woo agent task' } })
    const sessionID = (created.data as { id: string }).id

    // Event pump: permissions answered from policy; text parts streamed.
    // prompt() below resolves with the finished turn, so the pump is a side
    // channel only — never awaited for completion (some builds emit idle as
    // `session.status {type:'idle'}` instead of `session.idle`; treat both
    // as pump-exit signals, but rely on neither).
    const pumpAbort = new AbortController()
    const events = await client.event.subscribe({ signal: pumpAbort.signal })
    let finalText = ''
    let sessionError: Error | null = null
    const pump = (async () => {
      for await (const raw of events.stream) {
        const event = raw as { type: string; properties?: Record<string, unknown> }
        if (signal.aborted || pumpAbort.signal.aborted) break
        if (event.type === 'permission.updated') {
          const permission = event.properties as unknown as OpencodePermission
          if (permission.sessionID !== sessionID) continue
          const denial = opts.toolless
            ? 'Blocked: planning phase is tool-less.'
            : evaluateOpencodePermission(permission, agentShellEnabled())
          if (denial) onEvent({ type: 'tool-denied', toolName: permission.type, toolInput: denial })
          else {
            onEvent({
              type: 'tool-use',
              toolName: permission.type,
              toolInput: this.broker.scrub(permission.title ?? '').slice(0, 400)
            })
          }
          await client.postSessionIdPermissionsPermissionId({
            path: { id: sessionID, permissionID: permission.id },
            body: { response: denial ? 'reject' : 'once' }
          })
        } else if (event.type === 'message.part.updated') {
          const part = (event.properties as { part?: { sessionID?: string; type?: string; text?: string } }).part
          if (part?.sessionID === sessionID && part.type === 'text' && part.text) {
            finalText = part.text
            onEvent({ type: 'text-stream', text: this.broker.scrub(part.text) })
          }
        } else if (event.type === 'session.idle') {
          const props = event.properties as { sessionID?: string }
          if (props?.sessionID === sessionID) break
        } else if (event.type === 'session.status') {
          const props = event.properties as { sessionID?: string; status?: { type?: string } }
          if (props?.sessionID === sessionID && props.status?.type === 'idle') break
        } else if (event.type === 'session.error') {
          const props = event.properties as { sessionID?: string; error?: unknown }
          if (props?.sessionID == null || props.sessionID === sessionID) {
            sessionError = new Error(
              this.broker.scrub(JSON.stringify(props.error ?? 'opencode session error'))
            )
            break
          }
        }
      }
    })().catch(() => {
      /* pump aborted mid-read — expected on completion */
    })

    const result = await client.session.prompt({
      path: { id: sessionID },
      body: {
        parts: [{ type: 'text', text: prompt }],
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.toolless ? { tools: IDLE_EXTRA_TOOLS } : {})
      },
      signal
    })
    // The prompt response carries the finished turn — authoritative text.
    const parts = (result.data as { parts?: { type?: string; text?: string }[] } | undefined)
      ?.parts
    const responseText = (parts ?? [])
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text)
      .join('\n')
    if (responseText) finalText = responseText

    pumpAbort.abort()
    await pump
    if (sessionError) throw sessionError
    if (finalText) onEvent({ type: 'text', text: this.broker.scrub(finalText) })
    return finalText
  }
}
