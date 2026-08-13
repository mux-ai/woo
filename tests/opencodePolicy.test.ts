import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { evaluateOpencodePermission, type OpencodePermission } from '../src/main/opencodePolicy'
import { parseOpencodeStatus } from '../src/main/authService'
import { OpencodeAgentRunner } from '../src/main/opencodeAgentRunner'
import { SecretBroker } from '../src/main/secretBroker'
import { KnowledgeEngine } from '../src/main/knowledge/engine'

function permission(overrides: Partial<OpencodePermission>): OpencodePermission {
  return {
    id: 'perm_1',
    type: 'bash',
    sessionID: 's_1',
    title: '',
    metadata: {},
    ...overrides
  }
}

describe('evaluateOpencodePermission (default-deny wall)', () => {
  it('allows ordinary edits and explicitly enabled commands', () => {
    expect(
      evaluateOpencodePermission(permission({ type: 'edit', title: 'Edit src/app.ts' }))
    ).toBeNull()
    expect(
      evaluateOpencodePermission(permission({ type: 'bash', title: 'npm test' }), true)
    ).toBeNull()
  })

  it('denies shell execution by default', () => {
    expect(
      evaluateOpencodePermission(permission({ type: 'bash', title: 'npm test' }))
    ).toContain('disabled by default')
  })

  it('denies secret-bearing paths across all fields', () => {
    expect(
      evaluateOpencodePermission(permission({ type: 'edit', title: 'Edit .env' }))
    ).toMatch(/secret-bearing/)
    expect(
      evaluateOpencodePermission(permission({ type: 'bash', title: 'cat certs/server.pem' }))
    ).toMatch(/secret-bearing/)
    expect(
      evaluateOpencodePermission(
        permission({ type: 'bash', title: 'run', metadata: { command: 'cat .env.production' } })
      )
    ).toMatch(/secret-bearing/)
    expect(
      evaluateOpencodePermission(permission({ type: 'edit', pattern: ['src/x.ts', '.npmrc'] }))
    ).toMatch(/secret-bearing/)
  })

  it('denies environment dumps', () => {
    expect(
      evaluateOpencodePermission(permission({ type: 'bash', title: 'printenv' }))
    ).toMatch(/environment dumps/)
  })

  it('denies webfetch outright (no transcript scrub behind it)', () => {
    expect(
      evaluateOpencodePermission(permission({ type: 'webfetch', title: 'https://example.com' }))
    ).toMatch(/webfetch is disabled/)
  })

  it('default-denies unrecognized permission types', () => {
    expect(
      evaluateOpencodePermission(permission({ type: 'future_tool', title: 'anything' }))
    ).toMatch(/default-deny/)
  })
})

describe('parseOpencodeStatus', () => {
  it('parses credential list output, Zen and Go independently', () => {
    const raw = {
      exitCode: 0,
      stdout:
        '\n┌  Credentials ~/.local/share/opencode/auth.json\n│\n●  OpenCode Zen api\n│\n●  OpenCode Go api\n│\n└  2 credentials\n',
      stderr: ''
    }
    const zen = parseOpencodeStatus(raw, 'opencode')
    expect(zen.authenticated).toBe(true)
    expect(zen.account).toBe('1 credential')
    expect(zen.authMethod).toBe('OpenCode Zen api')

    const go = parseOpencodeStatus(raw, 'opencode-go')
    expect(go.authenticated).toBe(true)
    expect(go.account).toBe('1 credential')
    expect(go.authMethod).toBe('OpenCode Go api')
  })

  it('not installed and empty cases', () => {
    expect(parseOpencodeStatus({ exitCode: null, stdout: '', stderr: '', notFound: true }).installed).toBe(false)
    expect(
      parseOpencodeStatus({ exitCode: 0, stdout: '└  0 credentials\n', stderr: '' }).authenticated
    ).toBe(false)
  })
})

describe('opencode agent env', () => {
  it('sanitized env excludes secret-valued and secret-named vars', () => {
    const root = mkdtempSync(join(tmpdir(), 'woo-oc-'))
    try {
      writeFileSync(join(root, '.env'), 'X=opencode_secret_value_1\n')
      const broker = new SecretBroker(root)
      const runner = new OpencodeAgentRunner(root, broker, new KnowledgeEngine(root))
      process.env.WOO_TEST_PLAIN = 'plain-value'
      process.env.WOO_TEST_API_KEY = 'name-filtered'
      process.env.WOO_TEST_LEAK = 'opencode_secret_value_1'
      const env = runner.buildAgentEnv()
      expect(env.WOO_TEST_PLAIN).toBe('plain-value')
      expect(env.WOO_TEST_API_KEY).toBeUndefined()
      expect(env.WOO_TEST_LEAK).toBeUndefined()
    } finally {
      delete process.env.WOO_TEST_PLAIN
      delete process.env.WOO_TEST_API_KEY
      delete process.env.WOO_TEST_LEAK
      rmSync(root, { recursive: true, force: true })
    }
  })
})
