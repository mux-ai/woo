import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from 'crypto'
import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import type { VaultEntry, VaultStatus } from '../shared/types'

/**
 * Encrypted env vault — the Claypso pattern adapted to Woo's runtime:
 *
 *  - Vault file: `.woo/vault.enc` in the workspace, mode 0600.
 *  - KDF: scrypt (N=2^15, r=8, p=1) — Node built-in memory-hard KDF.
 *    (Claypso uses Argon2id; scrypt avoids a native dependency and keeps
 *    the same GPU-resistance class. Recorded in the versioned format so a
 *    later migration to argon2 is possible.)
 *  - Cipher: AES-256-GCM — authenticated encryption like Claypso's NaCl
 *    secretbox. Fresh random salt AND IV on EVERY save; never reused.
 *  - Unlock: per-session, in main-process memory only. lock() drops the
 *    map. (JS cannot zero strings — no pretense of memory scrubbing.)
 *  - Values flow ONLY to (a) the Secret Broker scrub set — one-way, they
 *    stay scrubbed after lock — and (b) the terminal PTY spawn env on
 *    explicit request. They NEVER enter process.env, so neither agent
 *    subprocess (Claude or Codex, both built from process.env) can inherit
 *    them: the agent-blindness invariant holds by construction.
 *
 * Wrong passphrase and tampered ciphertext are indistinguishable (GCM auth
 * failure) — both surface as the same error, deliberately.
 */

const VAULT_REL = join('.woo', 'vault.enc')
const LEGACY_SCRYPT_PARAMS = { N: 32768, r: 8, p: 1 }
const SCRYPT_PARAMS = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }
const KEY_LEN = 32
const IV_LEN = 12
const SALT_LEN = 16
const MIN_PASSPHRASE_LENGTH = 12
const MAX_PASSPHRASE_LENGTH = 1024
const AUTO_LOCK_MS = 30 * 60 * 1000

interface VaultFileV1 {
  v: 1
  kdf: 'scrypt'
  N: number
  r: number
  p: number
  salt: string // base64
  iv: string // base64
  tag: string // base64
  data: string // base64 ciphertext of JSON Record<string,string>
}

interface VaultFileV2 extends Omit<VaultFileV1, 'v'> {
  v: 2
}

type VaultFile = VaultFileV1 | VaultFileV2

export class VaultService {
  private entries: Map<string, string> | null = null // null = locked
  private passphrase: string | null = null
  private lockTimer: NodeJS.Timeout | null = null

  constructor(
    private workspaceRoot: string,
    private onAutoLock: () => void = () => {}
  ) {}

  private vaultPath(): string {
    return join(this.workspaceRoot, VAULT_REL)
  }

  private async exists(): Promise<boolean> {
    try {
      await fs.access(this.vaultPath())
      return true
    } catch {
      return false
    }
  }

  async status(): Promise<VaultStatus> {
    return {
      exists: await this.exists(),
      unlocked: this.entries != null,
      entryCount: this.entries?.size ?? 0
    }
  }

  private validatePassphrase(passphrase: string): void {
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`)
    }
    if (passphrase.length > MAX_PASSPHRASE_LENGTH) throw new Error('Passphrase is too long.')
  }

  private touch(): void {
    if (this.entries == null) return
    if (this.lockTimer) clearTimeout(this.lockTimer)
    this.lockTimer = setTimeout(() => {
      this.lock()
      this.onAutoLock()
    }, AUTO_LOCK_MS)
    this.lockTimer.unref()
  }

  private encrypt(passphrase: string, plaintext: string): VaultFileV2 {
    const salt = randomBytes(SALT_LEN)
    const iv = randomBytes(IV_LEN)
    const key = scryptSync(passphrase, salt, KEY_LEN, SCRYPT_PARAMS)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return {
      v: 2,
      kdf: 'scrypt',
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64')
    }
  }

  private decrypt(passphrase: string, file: VaultFile): string {
    const allowedLegacy =
      file.v === 1 &&
      file.N === LEGACY_SCRYPT_PARAMS.N &&
      file.r === LEGACY_SCRYPT_PARAMS.r &&
      file.p === LEGACY_SCRYPT_PARAMS.p
    const allowedCurrent =
      file.v === 2 &&
      file.N === SCRYPT_PARAMS.N &&
      file.r === SCRYPT_PARAMS.r &&
      file.p === SCRYPT_PARAMS.p
    if (file.kdf !== 'scrypt' || (!allowedLegacy && !allowedCurrent)) {
      throw new Error('Unsupported or unsafe vault parameters.')
    }
    const key = scryptSync(passphrase, Buffer.from(file.salt, 'base64'), KEY_LEN, {
      ...SCRYPT_PARAMS,
      N: file.N,
      r: file.r,
      p: file.p
    })
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(file.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(file.tag, 'base64'))
    try {
      return Buffer.concat([
        decipher.update(Buffer.from(file.data, 'base64')),
        decipher.final()
      ]).toString('utf8')
    } catch {
      throw new Error('Wrong passphrase or corrupted vault.')
    }
  }

  private async save(): Promise<void> {
    if (this.entries == null || this.passphrase == null) throw new Error('Vault is locked.')
    const plaintext = JSON.stringify(Object.fromEntries(this.entries))
    const file = this.encrypt(this.passphrase, plaintext)
    const path = this.vaultPath()
    await fs.mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.tmp`
    await fs.writeFile(temporary, JSON.stringify(file), { encoding: 'utf8', mode: 0o600 })
    await fs.chmod(temporary, 0o600)
    await fs.rename(temporary, path)
    await fs.chmod(path, 0o600)
  }

  async create(passphrase: string): Promise<VaultStatus> {
    if (await this.exists()) throw new Error('Vault already exists.')
    this.validatePassphrase(passphrase)
    this.entries = new Map()
    this.passphrase = passphrase
    await this.save()
    this.touch()
    return this.status()
  }

  async unlock(passphrase: string): Promise<VaultStatus> {
    this.validatePassphrase(passphrase)
    const raw = await fs.readFile(this.vaultPath(), 'utf8').catch(() => {
      throw new Error('No vault exists yet.')
    })
    const file = JSON.parse(raw) as VaultFile
    if (file.v !== 1 && file.v !== 2) throw new Error(`Unsupported vault version ${String((file as { v?: unknown }).v)}.`)
    const plaintext = this.decrypt(passphrase, file)
    this.entries = new Map(Object.entries(JSON.parse(plaintext) as Record<string, string>))
    this.passphrase = passphrase
    if (file.v === 1) await this.save()
    this.touch()
    return this.status()
  }

  async destroy(passphrase: string): Promise<void> {
    this.validatePassphrase(passphrase)
    const raw = await fs.readFile(this.vaultPath(), 'utf8').catch(() => {
      throw new Error('No vault exists yet.')
    })
    const file = JSON.parse(raw) as VaultFile
    if (file.v !== 1 && file.v !== 2) throw new Error('Unsupported vault version.')
    this.decrypt(passphrase, file)
    this.lock()
    await fs.rm(this.vaultPath(), { force: true })
  }

  lock(): VaultStatus {
    if (this.lockTimer) clearTimeout(this.lockTimer)
    this.lockTimer = null
    this.entries = null
    this.passphrase = null
    return { exists: true, unlocked: false, entryCount: 0 }
  }

  private assertUnlocked(): Map<string, string> {
    if (this.entries == null) throw new Error('Vault is locked.')
    this.touch()
    return this.entries
  }

  /** Keys with masked placeholders only — plaintext never travels in bulk. */
  list(): VaultEntry[] {
    const entries = this.assertUnlocked()
    return [...entries.keys()].sort().map((key) => ({ key, masked: '••••••••' }))
  }

  /** Explicit per-key reveal — a human channel, same trust as the editor. */
  get(key: string): string {
    const entries = this.assertUnlocked()
    const value = entries.get(key)
    if (value == null) throw new Error(`No such key: ${key}`)
    return value
  }

  async set(key: string, value: string): Promise<void> {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error('Key must be a valid env var name (letters, digits, underscore).')
    }
    this.assertUnlocked().set(key, value)
    await this.save()
  }

  async remove(key: string): Promise<void> {
    this.assertUnlocked().delete(key)
    await this.save()
  }

  /** Values for terminal injection + broker registration. Never for agents. */
  values(): Record<string, string> {
    return Object.fromEntries(this.assertUnlocked())
  }

  /**
   * Import KEY=VALUE lines from an existing .env-style content. Leaves the
   * source file untouched — deleting the plaintext original is the user's
   * call, never Woo's.
   */
  async importEnv(content: string): Promise<number> {
    const entries = this.assertUnlocked()
    let imported = 0
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq <= 0) continue
      const key = line.slice(0, eq).trim()
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
      let value = line.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      entries.set(key, value)
      imported++
    }
    await this.save()
    return imported
  }

  /** Constant-time passphrase check for re-auth flows. */
  verifyPassphrase(candidate: string): boolean {
    if (this.passphrase == null) return false
    this.touch()
    const a = Buffer.from(candidate)
    const b = Buffer.from(this.passphrase)
    return a.length === b.length && timingSafeEqual(a, b)
  }
}
