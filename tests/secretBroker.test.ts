import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SecretBroker } from '../src/main/secretBroker'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'woo-broker-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('SecretBroker.checkPath (SEC-001)', () => {
  it('denies .env and variants anywhere by basename', () => {
    const broker = new SecretBroker(root)
    for (const p of [
      join(root, '.env'),
      join(root, '.env.production'),
      join(root, 'deep', 'nested', '.env.local'),
      join(root, 'certs', 'server.pem'),
      join(root, 'certs', 'signing.key'),
      join(root, '.ssh', 'id_rsa'),
      join(root, 'aws', 'credentials'),
      join(root, 'config', 'secrets.yaml'),
      join(root, 'gcp', 'service-account-prod.json'),
      join(root, '.netrc'),
      join(root, '.npmrc')
    ]) {
      expect(broker.checkPath(p).allowed, p).toBe(false)
    }
  })

  it('allows ordinary source files', () => {
    const broker = new SecretBroker(root)
    for (const p of [
      join(root, 'src', 'index.ts'),
      join(root, 'package.json'),
      join(root, 'README.md'),
      join(root, 'src', 'environment.ts'), // name contains "env" but is not .env
      join(root, 'keyboard.ts') // contains "key" but not *.key
    ]) {
      expect(broker.checkPath(p).allowed, p).toBe(true)
    }
  })

  it('denials are audited', () => {
    const broker = new SecretBroker(root)
    broker.checkPath(join(root, '.env'))
    const audit = broker.getAudit()
    expect(audit.length).toBe(1)
    expect(audit[0].action).toBe('denied-read')
  })

  it('human whitelist overrides denial', () => {
    const broker = new SecretBroker(root)
    const p = join(root, '.env')
    broker.whitelistPath(p)
    expect(broker.checkPath(p).allowed).toBe(true)
  })

  it('denies paths outside the workspace and symlinks that escape it', () => {
    const broker = new SecretBroker(root)
    expect(broker.checkPath(join(root, '..', 'outside.txt')).allowed).toBe(false)
    if (process.platform !== 'win32') {
      const outside = mkdtempSync(join(tmpdir(), 'woo-outside-'))
      try {
        writeFileSync(join(outside, 'ordinary.txt'), 'outside')
        symlinkSync(join(outside, 'ordinary.txt'), join(root, 'linked.txt'))
        expect(broker.checkPath(join(root, 'linked.txt')).allowed).toBe(false)
      } finally {
        rmSync(outside, { recursive: true, force: true })
      }
    }
  })
})

describe('SecretBroker.scrub (SEC-002)', () => {
  function brokerWithEnv(env: string): SecretBroker {
    writeFileSync(join(root, '.env'), env)
    return new SecretBroker(root)
  }

  it('conceals plain values from .env', () => {
    const broker = brokerWithEnv('API_KEY=sk_live_supersecret123\n')
    expect(broker.scrub('the key is sk_live_supersecret123 ok')).toBe(
      'the key is <concealed> ok'
    )
  })

  it('conceals JSON-escaped variants', () => {
    const broker = brokerWithEnv('TOKEN="abc\\"def_longenough"\n')
    // Value as loaded: abc\"def_longenough — JSON-escaped in tool output.
    const toolOutput = JSON.stringify({ stdout: 'token=abc\\"def_longenough' })
    expect(broker.scrub(toolOutput)).not.toContain('def_longenough')
  })

  it('conceals url-embedded passwords separately', () => {
    const broker = brokerWithEnv(
      'DATABASE_URL=postgres://admin:hunter2hunter2@db.example.com/prod\n'
    )
    expect(broker.scrub('psql password hunter2hunter2 failed')).toBe(
      'psql password <concealed> failed'
    )
  })

  it('ignores short and common values', () => {
    const broker = brokerWithEnv('PORT=3000\nNODE_ENV=production\nFLAG=true\n')
    expect(broker.scrub('port 3000 production true')).toBe('port 3000 production true')
  })

  it('handles quoted values', () => {
    const broker = brokerWithEnv("SECRET='quotedsecretvalue'\n")
    expect(broker.scrub('x quotedsecretvalue y')).toBe('x <concealed> y')
  })

  it('scrubs every occurrence, including overlapping content', () => {
    const broker = brokerWithEnv('A_KEY=firstsecretvalue\nB_KEY=secondsecretval\n')
    const text = 'firstsecretvalue then secondsecretval then firstsecretvalue'
    const out = broker.scrub(text)
    expect(out).not.toContain('firstsecretvalue')
    expect(out).not.toContain('secondsecretval')
  })

  it('reload picks up newly created secret files', () => {
    const broker = new SecretBroker(root)
    expect(broker.scrub('freshsecretvalue1')).toBe('freshsecretvalue1')
    writeFileSync(join(root, '.env'), 'NEW=freshsecretvalue1\n')
    broker.reload()
    expect(broker.scrub('freshsecretvalue1')).toBe('<concealed>')
  })

  it('loads values from nested secret files for defense in depth', () => {
    mkdirSync(join(root, 'sub'))
    writeFileSync(join(root, 'sub', '.env'), 'DEEP=deepsecretvalue99\n')
    const broker = new SecretBroker(root)
    expect(broker.scrub('deepsecretvalue99')).toBe('<concealed>')
    expect(broker.checkPath(join(root, 'sub', '.env')).allowed).toBe(false)
  })

  it('extracts nested JSON credential values for scrubbing', () => {
    mkdirSync(join(root, 'cloud'))
    writeFileSync(
      join(root, 'cloud', 'service-account-prod.json'),
      JSON.stringify({ private_key_id: 'json_private_key_value_42', nested: { token: 'json_nested_token_99' } })
    )
    const broker = new SecretBroker(root)
    expect(broker.scrub('json_private_key_value_42 json_nested_token_99')).toBe(
      '<concealed> <concealed>'
    )
  })
})
