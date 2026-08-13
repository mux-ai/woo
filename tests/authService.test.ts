import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  AuthService,
  FileConnectionStore,
  parseClaudeStatus,
  parseCodexStatus,
  type CommandResult,
  type CommandRunner
} from '../src/main/authService'

const result = (overrides: Partial<CommandResult> = {}): CommandResult => ({
  exitCode: 0,
  stdout: '',
  stderr: '',
  ...overrides
})

describe('authentication status parsing', () => {
  it('reads Claude JSON without exposing credential material', () => {
    expect(
      parseClaudeStatus(
        result({
          stdout: JSON.stringify({
            loggedIn: true,
            authMethod: 'claude.ai',
            email: 'developer@example.com',
            accessToken: 'must-not-cross-ipc'
          })
        })
      )
    ).toEqual({
      provider: 'claude',
      displayName: 'Claude',
      installed: true,
      authenticated: true,
      authMethod: 'claude.ai',
      account: 'developer@example.com'
    })
  })

  it('recognizes Codex ChatGPT and API-key sessions', () => {
    expect(parseCodexStatus(result({ stdout: 'Logged in using ChatGPT\n' }))).toMatchObject({
      authenticated: true,
      authMethod: 'ChatGPT'
    })
    expect(
      parseCodexStatus(result({ stdout: 'Logged in using an API key.\n' }))
    ).toMatchObject({ authenticated: true, authMethod: 'an API key' })
  })

  it('reports a missing provider CLI', () => {
    expect(parseClaudeStatus(result({ exitCode: null, notFound: true }))).toMatchObject({
      installed: false,
      authenticated: false
    })
    expect(parseCodexStatus(result({ exitCode: null, notFound: true }))).toMatchObject({
      installed: false,
      authenticated: false
    })
  })
})

describe('AuthService', () => {
  it('runs the provider-owned browser login and then refreshes status', async () => {
    let statusChecks = 0
    const runner = vi.fn<CommandRunner>(async (_executable, args) => {
      if (args.includes('status')) {
        statusChecks += 1
        return result({
          stdout: JSON.stringify({
            loggedIn: statusChecks > 1,
            authMethod: 'claude.ai',
            email: 'me@example.com'
          })
        })
      }
      return result()
    })
    const service = new AuthService(runner)

    await expect(service.login('claude')).resolves.toMatchObject({
      authenticated: true,
      account: 'me@example.com'
    })
    expect(runner.mock.calls.map(([executable, args]) => [executable, args])).toEqual([
      ['claude', ['auth', 'status', '--json']],
      ['claude', ['auth', 'login']],
      ['claude', ['auth', 'status', '--json']]
    ])
  })

  it('disconnects only from Woo and reconnects with the existing CLI session', async () => {
    const runner = vi.fn<CommandRunner>(async () =>
      result({ stdout: 'Logged in using ChatGPT\n' })
    )
    const service = new AuthService(runner)

    await expect(service.disconnect('codex')).resolves.toMatchObject({ authenticated: false })
    expect(service.isDisconnected('codex')).toBe(true)
    await expect(service.status('codex')).resolves.toMatchObject({ authenticated: false })
    await expect(service.login('codex')).resolves.toMatchObject({ authenticated: true })
    expect(service.isDisconnected('codex')).toBe(false)

    const allArgs = runner.mock.calls.map(([, args]) => args.join(' '))
    expect(allArgs).not.toContain('logout')
    expect(allArgs).not.toContain('login')
  })

  it('persists only Woo disconnect preferences, not provider credentials', () => {
    const root = mkdtempSync(join(tmpdir(), 'woo-auth-'))
    const path = join(root, 'auth-connections.json')
    try {
      new FileConnectionStore(path).setDisconnected('claude', true)
      expect(new FileConnectionStore(path).isDisconnected('claude')).toBe(true)
      expect(readFileSync(path, 'utf8')).toBe('{\n  "disconnected": [\n    "claude"\n  ]\n}')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('persists OpenCode connection preferences, Zen and Go independently', () => {
    const root = mkdtempSync(join(tmpdir(), 'woo-auth-'))
    const path = join(root, 'auth-connections.json')
    try {
      new FileConnectionStore(path).setDisconnected('opencode', true)
      expect(new FileConnectionStore(path).isDisconnected('opencode')).toBe(true)
      expect(new FileConnectionStore(path).isDisconnected('opencode-go')).toBe(false)
      new FileConnectionStore(path).setDisconnected('opencode-go', true)
      expect(new FileConnectionStore(path).isDisconnected('opencode-go')).toBe(true)
      expect(readFileSync(path, 'utf8')).not.toMatch(/token|secret|credential/i)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('checks OpenCode with no opt-in required — no separate CLI install needed', async () => {
    const runner = vi.fn<CommandRunner>(async () =>
      result({ stdout: '●  OpenCode Zen api  \n└  1 credential\n' })
    )
    const service = new AuthService(runner)

    await expect(service.status('opencode')).resolves.toMatchObject({ authenticated: true })
    expect(runner).toHaveBeenCalledWith('opencode', ['auth', 'list'], 10_000)
  })

  it('reports Zen and Go as independently connected from one `opencode auth list` call', async () => {
    const runner: CommandRunner = async () =>
      result({
        stdout:
          '\n┌  Credentials ~/.local/share/opencode/auth.json\n│\n●  OpenCode Zen api\n│\n●  OpenCode Go api\n│\n└  2 credentials\n'
      })
    const service = new AuthService(runner)

    await expect(service.status('opencode')).resolves.toMatchObject({
      authenticated: true,
      authMethod: 'OpenCode Zen api',
      account: '1 credential'
    })
    await expect(service.status('opencode-go')).resolves.toMatchObject({
      authenticated: true,
      authMethod: 'OpenCode Go api',
      account: '1 credential'
    })
  })

  it('reports Go disconnected when only Zen is authenticated', async () => {
    const runner: CommandRunner = async () =>
      result({ stdout: '●  OpenCode Zen api  \n└  1 credential\n' })
    const service = new AuthService(runner)

    await expect(service.status('opencode')).resolves.toMatchObject({ authenticated: true })
    await expect(service.status('opencode-go')).resolves.toMatchObject({ authenticated: false })
  })

  it('falls back to the SDK-bundled binary when the system CLI is not on PATH', async () => {
    const calls: Array<[string, string[]]> = []
    const runner: CommandRunner = async (executable, args) => {
      calls.push([executable, args])
      if (executable === 'claude') return result({ exitCode: null, notFound: true })
      // Second attempt should be an absolute path to the bundled binary,
      // not the bare 'claude' command — prove it actually resolved one.
      expect(executable).not.toBe('claude')
      expect(executable.endsWith('claude') || executable.endsWith('claude.exe')).toBe(true)
      return result({ stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'me@example.com' }) })
    }
    const service = new AuthService(runner)

    await expect(service.status('claude')).resolves.toMatchObject({
      installed: true,
      authenticated: true,
      account: 'me@example.com'
    })
    expect(calls[0]).toEqual(['claude', ['auth', 'status', '--json']])
    expect(calls[1][1]).toEqual(['auth', 'status', '--json'])
  })

  it('reports not installed when neither PATH nor a bundled binary resolves', async () => {
    const runner: CommandRunner = async () => result({ exitCode: null, notFound: true })
    // opencode has no bundled binary (no SDK ships one) — PATH-only, always.
    const service = new AuthService(runner)

    await expect(service.status('opencode')).resolves.toMatchObject({
      installed: false,
      authenticated: false
    })
  })

  it('returns a generic login error instead of CLI output that may contain an OAuth URL', async () => {
    const runner: CommandRunner = async () =>
      result({ exitCode: 1, stderr: 'https://example.test/callback?secret=oauth-secret' })
    const status = await new AuthService(runner).login('codex')

    expect(status.error).toBe('Codex sign-in was cancelled or failed.')
    expect(JSON.stringify(status)).not.toContain('oauth-secret')
  })
})
