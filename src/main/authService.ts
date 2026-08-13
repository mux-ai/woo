import { spawn } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import type { AuthProvider, AuthProviderStatus } from '../shared/types'

export interface CommandResult {
  exitCode: number | null
  stdout: string
  stderr: string
  notFound?: boolean
  timedOut?: boolean
}

export type CommandRunner = (
  executable: string,
  args: string[],
  timeoutMs: number
) => Promise<CommandResult>

const PROVIDERS: Record<
  AuthProvider,
  {
    displayName: string
    executable: string
    statusArgs: string[]
    loginArgs: string[]
  }
> = {
  claude: {
    displayName: 'Claude',
    executable: 'claude',
    statusArgs: ['auth', 'status', '--json'],
    loginArgs: ['auth', 'login']
  },
  codex: {
    displayName: 'Codex',
    executable: 'codex',
    statusArgs: ['login', 'status'],
    loginArgs: ['login']
  },
  opencode: {
    displayName: 'OpenCode',
    executable: 'opencode',
    statusArgs: ['auth', 'list'],
    loginArgs: ['auth', 'login']
  },
  // Same CLI, same subcommands as 'opencode' — `opencode auth list` can
  // report multiple credential sets at once (e.g. "OpenCode Zen" and
  // "OpenCode Go"); parseOpencodeStatus filters the shared output per
  // variant. 'opencode' means the Zen-named credential specifically.
  'opencode-go': {
    displayName: 'OpenCode Go',
    executable: 'opencode',
    statusArgs: ['auth', 'list'],
    loginArgs: ['auth', 'login']
  }
}

/**
 * Claude and Codex don't require a separately-installed system CLI: their
 * SDKs (used for actual task execution — see agentRunner.ts/
 * codexAgentRunner.ts) already bundle a real per-platform binary via npm
 * optionalDependencies. Auth previously only ever tried the system PATH
 * command, so a user without that CLI installed could never connect even
 * though execution didn't need it. These resolvers locate the same bundled
 * binary the SDKs use, so auth falls back to it when PATH lookup fails.
 */
const bundledBinaryRequire = createRequire(import.meta.url)

function resolvePackageDir(pkg: string): string | null {
  try {
    return dirname(bundledBinaryRequire.resolve(`${pkg}/package.json`))
  } catch {
    return null
  }
}

function resolveBundledClaudeBinary(): string | null {
  const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const base = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`
  // On Linux, exactly one of the glibc/musl variants is actually installed
  // (npm's os/cpu/libc matching); trying both in either order is harmless.
  const candidates = process.platform === 'linux' ? [base, `${base}-musl`] : [base]
  for (const pkg of candidates) {
    const dir = resolvePackageDir(pkg)
    if (dir == null) continue
    const bin = join(dir, binaryName)
    if (existsSync(bin)) return bin
  }
  return null
}

// Mirrors @openai/codex's own bin/codex.js platform-package resolution
// (that file can't be imported directly — it spawns on load as a CLI shim).
const CODEX_TARGET_TRIPLE: Partial<Record<string, Partial<Record<string, string>>>> = {
  linux: { x64: 'x86_64-unknown-linux-musl', arm64: 'aarch64-unknown-linux-musl' },
  darwin: { x64: 'x86_64-apple-darwin', arm64: 'aarch64-apple-darwin' },
  win32: { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' }
}
const CODEX_PLATFORM_PACKAGE: Record<string, string> = {
  'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
  'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
  'x86_64-apple-darwin': '@openai/codex-darwin-x64',
  'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
  'x86_64-pc-windows-msvc': '@openai/codex-win32-x64',
  'aarch64-pc-windows-msvc': '@openai/codex-win32-arm64'
}

function resolveBundledCodexBinary(): string | null {
  const targetTriple = CODEX_TARGET_TRIPLE[process.platform]?.[process.arch]
  if (targetTriple == null) return null
  const dir = resolvePackageDir(CODEX_PLATFORM_PACKAGE[targetTriple])
  if (dir == null) return null
  const bin = join(dir, 'vendor', targetTriple, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex')
  return existsSync(bin) ? bin : null
}

const BUNDLED_BINARY: Partial<Record<AuthProvider, () => string | null>> = {
  claude: resolveBundledClaudeBinary,
  codex: resolveBundledCodexBinary
}

const runCommand: CommandRunner = (executable, args, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn(executable, args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timer: NodeJS.Timeout

    const finish = (result: CommandResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout = (stdout + chunk).slice(-64_000)
    })
    child.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-64_000)
    })
    child.once('error', (error: NodeJS.ErrnoException) => {
      finish({ exitCode: null, stdout, stderr, notFound: error.code === 'ENOENT' })
    })
    child.once('close', (exitCode) => finish({ exitCode, stdout, stderr }))

    timer = setTimeout(() => {
      child.kill()
      finish({ exitCode: null, stdout, stderr, timedOut: true })
    }, timeoutMs)
  })

function baseStatus(provider: AuthProvider): AuthProviderStatus {
  return {
    provider,
    displayName: PROVIDERS[provider].displayName,
    installed: true,
    authenticated: false
  }
}

export function parseClaudeStatus(result: CommandResult): AuthProviderStatus {
  const status = baseStatus('claude')
  if (result.notFound) {
    return { ...status, installed: false, error: 'Claude CLI is not installed.' }
  }
  try {
    const value = JSON.parse(result.stdout) as Record<string, unknown>
    const authenticated = value.loggedIn === true
    return {
      ...status,
      authenticated,
      authMethod:
        authenticated && typeof value.authMethod === 'string' ? value.authMethod : undefined,
      account: authenticated && typeof value.email === 'string' ? value.email : undefined
    }
  } catch {
    return {
      ...status,
      error: result.timedOut
        ? 'Claude authentication check timed out.'
        : result.exitCode === 0
          ? 'Claude returned an unreadable authentication status.'
          : undefined
    }
  }
}

export function parseCodexStatus(result: CommandResult): AuthProviderStatus {
  const status = baseStatus('codex')
  if (result.notFound) {
    return { ...status, installed: false, error: 'Codex CLI is not installed.' }
  }
  const output = `${result.stdout}\n${result.stderr}`
  const match = /logged in using\s+(.+)/i.exec(output)
  if (match) {
    const method = match[1].trim().replace(/[.!]$/, '')
    return { ...status, authenticated: true, authMethod: method }
  }
  return {
    ...status,
    error: result.timedOut ? 'Codex authentication check timed out.' : undefined
  }
}

export interface ConnectionStore {
  isDisconnected(provider: AuthProvider): boolean
  setDisconnected(provider: AuthProvider, disconnected: boolean): void
}

export class MemoryConnectionStore implements ConnectionStore {
  protected disconnected = new Set<AuthProvider>()

  isDisconnected(provider: AuthProvider): boolean {
    return this.disconnected.has(provider)
  }

  setDisconnected(provider: AuthProvider, disconnected: boolean): void {
    if (disconnected) this.disconnected.add(provider)
    else this.disconnected.delete(provider)
  }
}

/** Stores only Woo's provider preference. It never reads or copies CLI credentials. */
export class FileConnectionStore extends MemoryConnectionStore {
  constructor(private filePath: string) {
    super()
    try {
      const saved = JSON.parse(readFileSync(filePath, 'utf8')) as { disconnected?: unknown }
      if (Array.isArray(saved.disconnected)) {
        for (const provider of saved.disconnected) {
          if (
            provider === 'claude' ||
            provider === 'codex' ||
            provider === 'opencode' ||
            provider === 'opencode-go'
          ) {
            this.disconnected.add(provider)
          }
        }
      }
    } catch {
      // First launch, or an unreadable preference file: default to connected.
    }
  }

  override setDisconnected(provider: AuthProvider, disconnected: boolean): void {
    const before = new Set(this.disconnected)
    super.setDisconnected(provider, disconnected)
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      writeFileSync(this.filePath, JSON.stringify({ disconnected: [...this.disconnected] }, null, 2))
    } catch (error) {
      this.disconnected = before
      throw error
    }
  }
}

// `opencode auth list` can report multiple credential sets in one call
// (e.g. "OpenCode Zen" and "OpenCode Go") — match each variant's own
// name so the two show up as independently connected/disconnected in Woo,
// even though both come from the same CLI invocation.
const OPENCODE_VARIANT_NAME: Record<'opencode' | 'opencode-go', RegExp> = {
  opencode: /\bzen\b/i,
  'opencode-go': /\bgo\b/i
}

export function parseOpencodeStatus(
  result: CommandResult,
  provider: 'opencode' | 'opencode-go' = 'opencode'
): AuthProviderStatus {
  const status = baseStatus(provider)
  if (result.notFound) {
    return { ...status, installed: false, error: 'opencode CLI is not installed.' }
  }
  // Strip ANSI, read every bullet-prefixed credential name, then keep
  // only the ones matching this variant's name.
  const plain = `${result.stdout}\n${result.stderr}`.replace(/\[[0-9;]*m/g, '')
  const names = [...plain.matchAll(/●\s+([^\n]+?)\s{2,}|●\s+([^\n]+)$/gm)]
    .map((m) => (m[1] ?? m[2] ?? '').trim())
    .filter(Boolean)
  const matched = names.filter((name) => OPENCODE_VARIANT_NAME[provider].test(name))
  if (matched.length > 0) {
    return {
      ...status,
      authenticated: true,
      authMethod: matched[0],
      account: `${matched.length} credential${matched.length === 1 ? '' : 's'}`
    }
  }
  return {
    ...status,
    error: result.timedOut ? 'opencode authentication check timed out.' : undefined
  }
}

/**
 * Owns provider login processes. OAuth credentials remain in each CLI's
 * credential store; renderer IPC receives status metadata only.
 */
export class AuthService {
  private pendingLogin = new Map<AuthProvider, Promise<AuthProviderStatus>>()

  constructor(
    private commandRunner: CommandRunner = runCommand,
    private connectionStore: ConnectionStore = new MemoryConnectionStore()
  ) {}

  /**
   * Try the system PATH command first (respects a CLI the user already has
   * installed/updated); only fall back to the SDK-bundled binary when PATH
   * lookup genuinely fails (ENOENT), so a connected account keeps working
   * with zero separate CLI install.
   */
  private async runProviderCommand(
    provider: AuthProvider,
    args: string[],
    timeoutMs: number
  ): Promise<CommandResult> {
    const config = PROVIDERS[provider]
    const primary = await this.commandRunner(config.executable, args, timeoutMs)
    if (!primary.notFound) return primary
    const bundled = BUNDLED_BINARY[provider]?.()
    if (bundled == null) return primary
    return this.commandRunner(bundled, args, timeoutMs)
  }

  private async cliStatus(provider: AuthProvider): Promise<AuthProviderStatus> {
    const config = PROVIDERS[provider]
    const result = await this.runProviderCommand(provider, config.statusArgs, 10_000)
    if (provider === 'claude') return parseClaudeStatus(result)
    if (provider === 'codex') return parseCodexStatus(result)
    return parseOpencodeStatus(result, provider)
  }

  async status(provider: AuthProvider): Promise<AuthProviderStatus> {
    const status = await this.cliStatus(provider)
    if (!this.connectionStore.isDisconnected(provider) || !status.authenticated) return status
    return { ...baseStatus(provider), installed: status.installed }
  }

  isDisconnected(provider: AuthProvider): boolean {
    return this.connectionStore.isDisconnected(provider)
  }

  statuses(): Promise<AuthProviderStatus[]> {
    return Promise.all([
      this.status('claude'),
      this.status('codex'),
      this.status('opencode'),
      this.status('opencode-go')
    ])
  }

  login(provider: AuthProvider): Promise<AuthProviderStatus> {
    const existing = this.pendingLogin.get(provider)
    if (existing) return existing

    const attempt = this.runLogin(provider).finally(() => this.pendingLogin.delete(provider))
    this.pendingLogin.set(provider, attempt)
    return attempt
  }

  private async runLogin(provider: AuthProvider): Promise<AuthProviderStatus> {
    const config = PROVIDERS[provider]
    const current = await this.cliStatus(provider)
    if (current.authenticated) {
      this.connectionStore.setDisconnected(provider, false)
      return current
    }
    if (!current.installed) return current

    const result = await this.runProviderCommand(provider, config.loginArgs, 5 * 60_000)
    if (result.notFound) {
      return {
        ...baseStatus(provider),
        installed: false,
        error: `${config.displayName} CLI is not installed.`
      }
    }
    if (result.timedOut) {
      return { ...baseStatus(provider), error: `${config.displayName} sign-in timed out.` }
    }
    if (result.exitCode !== 0) {
      return {
        ...baseStatus(provider),
        error: `${config.displayName} sign-in was cancelled or failed.`
      }
    }
    const status = await this.cliStatus(provider)
    if (status.authenticated) this.connectionStore.setDisconnected(provider, false)
    return status
  }

  async disconnect(provider: AuthProvider): Promise<AuthProviderStatus> {
    const status = await this.cliStatus(provider)
    this.connectionStore.setDisconnected(provider, true)
    return { ...baseStatus(provider), installed: status.installed }
  }
}
