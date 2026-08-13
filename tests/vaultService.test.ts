import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createCipheriv, randomBytes, scryptSync } from 'crypto'
import { VaultService } from '../src/main/vaultService'
import { SecretBroker } from '../src/main/secretBroker'

let root: string
let vault: VaultService

const vaultFile = () => join(root, '.woo', 'vault.enc')

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'woo-vault-'))
  vault = new VaultService(root)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('VaultService crypto', () => {
  it('create → set → lock → unlock roundtrip', async () => {
    await vault.create('correct horse battery')
    await vault.set('API_KEY', 'sk_live_roundtrip_value')
    vault.lock()
    await expect(async () => vault.get('API_KEY')).rejects.toThrow(/locked/i)

    await vault.unlock('correct horse battery')
    expect(vault.get('API_KEY')).toBe('sk_live_roundtrip_value')
  })

  it('vault file is 0600 and contains no plaintext', async () => {
    await vault.create('correct horse battery')
    await vault.set('API_KEY', 'sk_live_plaintext_check')
    // NTFS has no POSIX permission bits — mode asserts only hold on Unix.
    if (process.platform !== 'win32') {
      expect(statSync(vaultFile()).mode & 0o777).toBe(0o600)
    }
    const raw = readFileSync(vaultFile(), 'utf8')
    expect(raw).not.toContain('sk_live_plaintext_check')
    expect(raw).not.toContain('API_KEY')
    expect(JSON.parse(raw)).toMatchObject({ v: 2, kdf: 'scrypt', N: 131072, r: 8, p: 1 })
  })

  it('fresh salt and IV on every save', async () => {
    await vault.create('correct horse battery')
    await vault.set('A', 'value-one-longer')
    const first = JSON.parse(readFileSync(vaultFile(), 'utf8'))
    await vault.set('B', 'value-two-longer')
    const second = JSON.parse(readFileSync(vaultFile(), 'utf8'))
    expect(second.salt).not.toBe(first.salt)
    expect(second.iv).not.toBe(first.iv)
  })

  it('wrong passphrase and tampered file give the same error', async () => {
    await vault.create('correct horse battery')
    await vault.set('K', 'some-secret-value')
    vault.lock()

    await expect(vault.unlock('wrong passphrase!')).rejects.toThrow(
      /wrong passphrase or corrupted/i
    )

    // Tamper with ciphertext byte
    const file = JSON.parse(readFileSync(vaultFile(), 'utf8'))
    const data = Buffer.from(file.data, 'base64')
    data[0] ^= 0xff
    writeFileSync(vaultFile(), JSON.stringify({ ...file, data: data.toString('base64') }))
    await expect(vault.unlock('correct horse battery')).rejects.toThrow(
      /wrong passphrase or corrupted/i
    )

    // Tamper with auth tag
    const file2 = { ...file, tag: Buffer.from(file.tag, 'base64').fill(0).toString('base64') }
    writeFileSync(vaultFile(), JSON.stringify(file2))
    await expect(vault.unlock('correct horse battery')).rejects.toThrow(
      /wrong passphrase or corrupted/i
    )
  })

  it('rejects short passphrases and invalid keys', async () => {
    await expect(vault.create('short')).rejects.toThrow(/at least 12/)
    await vault.create('correct horse battery')
    await expect(vault.set('BAD KEY', 'x'.repeat(10))).rejects.toThrow(/valid env var/)
    await expect(vault.set('1LEADING', 'x'.repeat(10))).rejects.toThrow(/valid env var/)
  })

  it('imports .env content without touching the source', async () => {
    await vault.create('correct horse battery')
    const count = await vault.importEnv(
      '# comment\nAPI_KEY=imported_secret_one\nDB_URL="postgres://u:importedpass99@h/db"\n\nbad line\n'
    )
    expect(count).toBe(2)
    expect(vault.get('API_KEY')).toBe('imported_secret_one')
    expect(vault.get('DB_URL')).toContain('importedpass99')
  })

  it('list returns masked entries only', async () => {
    await vault.create('correct horse battery')
    await vault.set('SECRET_A', 'super_secret_value')
    const list = vault.list()
    expect(list).toEqual([{ key: 'SECRET_A', masked: '••••••••' }])
  })

  it('migrates a legacy v1 vault after a successful unlock', async () => {
    const passphrase = 'correct horse battery'
    const salt = randomBytes(16)
    const iv = randomBytes(12)
    const key = scryptSync(passphrase, salt, 32, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 128 * 1024 * 1024
    })
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const data = Buffer.concat([
      cipher.update(JSON.stringify({ LEGACY_KEY: 'legacy_secret_value' }), 'utf8'),
      cipher.final()
    ])
    mkdirSync(join(root, '.woo'), { recursive: true })
    writeFileSync(vaultFile(), JSON.stringify({
      v: 1,
      kdf: 'scrypt',
      N: 32768,
      r: 8,
      p: 1,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64')
    }), { mode: 0o600 })

    await vault.unlock(passphrase)
    expect(vault.get('LEGACY_KEY')).toBe('legacy_secret_value')
    expect(JSON.parse(readFileSync(vaultFile(), 'utf8'))).toMatchObject({
      v: 2,
      N: 131072,
      r: 8,
      p: 1
    })
  })

  it('requires authentication to destroy a vault and removes it permanently', async () => {
    await vault.create('correct horse battery')
    await vault.set('DELETE_ME', 'sensitive_value_here')
    await expect(vault.destroy('wrong passphrase value')).rejects.toThrow(/wrong passphrase/i)
    expect(statSync(vaultFile()).isFile()).toBe(true)
    await vault.destroy('correct horse battery')
    await expect(vault.status()).resolves.toMatchObject({ exists: false, unlocked: false })
  })

  it('automatically locks and invokes the terminal cleanup callback', async () => {
    vi.useFakeTimers()
    const cleanup = vi.fn()
    const timedVault = new VaultService(root, cleanup)
    try {
      await timedVault.create('correct horse battery')
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
      expect((await timedVault.status()).unlocked).toBe(false)
      expect(cleanup).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('vault ↔ broker ↔ agent invariants', () => {
  it('vault values scrub-register and survive broker reload', async () => {
    const broker = new SecretBroker(root)
    await vault.create('correct horse battery')
    await vault.set('TOKEN', 'vault_only_secret_42')
    broker.addSecretValues(Object.values(vault.values()))

    expect(broker.scrub('leak vault_only_secret_42 here')).toBe('leak <concealed> here')
    broker.reload() // rescans files — must NOT forget vault values
    expect(broker.scrub('again vault_only_secret_42')).toBe('again <concealed>')
    expect(broker.knownSecretValues()).toContain('vault_only_secret_42')
  })

  it('agent-blindness: vault values reach the PTY merge, never process.env', async () => {
    const { mergePtyEnv } = await import('../src/main/terminalEnv')
    await vault.create('correct horse battery')
    await vault.set('DEPLOY_KEY', 'vault_deploy_key_value')

    // The exact seam TerminalService passes to pty.spawn:
    const ptyEnv = mergePtyEnv(process.env, vault.values())
    expect(ptyEnv.DEPLOY_KEY).toBe('vault_deploy_key_value')

    // The isolation argument: both agent runners build their env from
    // process.env, and the merge must never write back into it.
    expect(process.env.DEPLOY_KEY).toBeUndefined()
    expect(Object.values(process.env)).not.toContain('vault_deploy_key_value')
  })

  it('agent is denied reading the vault blob by path', () => {
    const broker = new SecretBroker(root)
    expect(broker.checkPath(join(root, '.woo', 'vault.enc')).allowed).toBe(false)
  })
})
