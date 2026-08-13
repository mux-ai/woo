import { readFileSync, existsSync, lstatSync, readdirSync, realpathSync } from 'fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import type { BrokerDecision, BrokerAuditEntry } from '../shared/types'

/**
 * Secret Broker — tool-layer enforcement (ADR-003, SEC-001, SEC-002).
 *
 * Supported provider adapters route file access, subprocess environments, and
 * model-facing tool output through here. Two independent defenses:
 *  1. checkPath: deny reads of secret-bearing paths outright.
 *  2. scrub: replace known secret VALUES with <concealed> in any text
 *     returned to the model when the provider exposes a post-tool hook.
 *
 * Prompt-level instructions are treated as decorative; nothing here can be
 * overridden by the agent. Only the human may whitelist via settings.
 * OpenCode lacks transcript-level post-tool output interception and is labeled
 * experimental; its path denial, environment sanitization, and UI scrub still
 * use this broker.
 */

const SECRET_FILE_PATTERNS: RegExp[] = [
  /^\.env(\..+)?$/i, // .env, .env.local, .env.production
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /^id_rsa/i,
  /^id_ed25519/i,
  /^id_ecdsa/i,
  /credentials/i, // credentials.json, aws credentials, gcloud
  /^\.netrc$/i,
  /^\.npmrc$/i, // may hold auth tokens
  /^secrets?\.(json|ya?ml|toml)$/i,
  /^vault\.enc$/i, // Woo vault blob — encrypted, but the agent still has no business reading it
  /service.?account.*\.json$/i,
  /\.keystore$/i,
  /\.jks$/i,
  /\.tfstate(?:\.backup)?$/i,
  /\.tfvars(?:\.json)?$/i,
  /^kubeconfig$/i,
  /\.kdbx$/i,
  /\.ovpn$/i,
  /\.mobileprovision$/i
]

const SECRET_DIRECTORIES = new Set(['.ssh', '.aws', '.azure', '.kube', '.gnupg', '.docker'])
const SCAN_IGNORED_DIRECTORIES = new Set(['.git', '.woo', 'node_modules', 'out', 'release', 'coverage'])
const MAX_SECRET_FILES = 200
const MAX_SECRET_FILE_BYTES = 1024 * 1024

// Minimum length for a value to be scrub-worthy; avoids concealing "true"/"3000".
const MIN_SECRET_VALUE_LENGTH = 8

const COMMON_NON_SECRETS = new Set([
  'localhost',
  'true',
  'false',
  'development',
  'production',
  'staging',
  'test'
])

/** Does this basename look like a secret-bearing file? (shared with the watcher) */
export function isSecretFileName(name: string): boolean {
  return SECRET_FILE_PATTERNS.some((p) => p.test(name))
}

export class SecretBroker {
  private secretValues = new Set<string>()
  // Vault-registered values live apart from file-derived ones: reload()
  // rescans files and must never forget what the vault told us.
  private externalValues = new Set<string>()
  private audit: BrokerAuditEntry[] = []
  private userWhitelist = new Set<string>()

  constructor(private workspaceRoot: string) {
    this.loadWorkspaceSecrets()
  }

  /** Scan workspace root (one level + common dirs) for secret files and load their values. */
  private loadWorkspaceSecrets(): void {
    const candidates: string[] = []
    const walk = (dir: string, depth: number): void => {
      if (depth > 8 || candidates.length >= MAX_SECRET_FILES) return
      let entries: string[] = []
      try {
        entries = readdirSync(dir)
      } catch {
        return
      }
      for (const entry of entries) {
        if (candidates.length >= MAX_SECRET_FILES) break
        const path = join(dir, entry)
        let stat
        try {
          stat = lstatSync(path, { throwIfNoEntry: false })
        } catch {
          continue
        }
        if (!stat || stat.isSymbolicLink()) continue
        if (stat.isDirectory()) {
          if (!SCAN_IGNORED_DIRECTORIES.has(entry)) walk(path, depth + 1)
        } else if (
          stat.isFile() &&
          stat.size <= MAX_SECRET_FILE_BYTES &&
          SECRET_FILE_PATTERNS.some((pattern) => pattern.test(entry))
        ) {
          candidates.push(path)
        }
      }
    }
    walk(this.workspaceRoot, 0)
    for (const file of candidates) {
      this.loadSecretValues(file)
    }
  }

  /** Parse common secret formats and remember values for output scrubbing. */
  private loadSecretValues(filePath: string): void {
    if (!existsSync(filePath)) return
    let content: string
    try {
      content = readFileSync(filePath, 'utf-8')
    } catch {
      return
    }
    const values: string[] = []
    try {
      const parsed = JSON.parse(content) as unknown
      const collect = (value: unknown): void => {
        if (typeof value === 'string') values.push(value)
        else if (Array.isArray(value)) value.forEach(collect)
        else if (value && typeof value === 'object') Object.values(value).forEach(collect)
      }
      collect(parsed)
    } catch {
      // Environment/YAML-like formats are handled line-by-line below.
    }
    for (const raw of content.split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const delimiter = line.includes('=') ? line.indexOf('=') : line.indexOf(':')
      if (delimiter <= 0) continue
      let value = line.slice(delimiter + 1).trim().replace(/,$/, '')
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      values.push(value)
    }
    for (const value of values) {
      if (value.length < MIN_SECRET_VALUE_LENGTH) continue
      if (COMMON_NON_SECRETS.has(value.toLowerCase())) continue
      this.secretValues.add(value)
      // Credentials embedded in URLs (postgres://user:pass@host) leak as
      // fragments too — track the password component separately.
      const urlCreds = value.match(/^[a-z][a-z0-9+.-]*:\/\/[^:/@\s]+:([^@\s]+)@/i)
      if (urlCreds && urlCreds[1].length >= MIN_SECRET_VALUE_LENGTH) {
        this.secretValues.add(urlCreds[1])
      }
    }
  }

  /** SEC-001: may the agent read this path? */
  checkPath(filePath: string): BrokerDecision {
    const absolute = resolve(isAbsolute(filePath) ? filePath : join(this.workspaceRoot, filePath))
    const root = resolve(this.workspaceRoot)
    const lexicalRelative = relative(root, absolute)
    let resolved = absolute
    try {
      resolved = realpathSync.native(absolute)
    } catch {
      let parent = dirname(absolute)
      while (parent !== dirname(parent)) {
        try {
          resolved = join(realpathSync.native(parent), relative(parent, absolute))
          break
        } catch {
          parent = dirname(parent)
        }
      }
    }
    const realRelative = relative(root, resolved)
    if (
      lexicalRelative === '..' ||
      lexicalRelative.startsWith(`..${sep}`) ||
      isAbsolute(lexicalRelative) ||
      realRelative === '..' ||
      realRelative.startsWith(`..${sep}`) ||
      isAbsolute(realRelative)
    ) {
      this.audit.push({ timestamp: Date.now(), action: 'denied-read', path: filePath, pattern: 'workspace-boundary' })
      return { allowed: false, pattern: 'workspace-boundary', reason: 'Blocked by Secret Broker: path resolves outside the workspace.' }
    }
    if (this.userWhitelist.has(absolute)) return { allowed: true }
    const parts = lexicalRelative.split(sep)
    const name = basename(absolute)
    for (const pattern of SECRET_FILE_PATTERNS) {
      if (pattern.test(name) || parts.some((part) => SECRET_DIRECTORIES.has(part))) {
        this.audit.push({
          timestamp: Date.now(),
          action: 'denied-read',
          path: filePath,
          pattern: pattern.source
        })
        return {
          allowed: false,
          pattern: pattern.source,
          reason: `Blocked by Secret Broker: path matches secret pattern. Content is never shown to the agent.`
        }
      }
    }
    return { allowed: true }
  }

  private allSecretValues(): Set<string> {
    return this.externalValues.size === 0
      ? this.secretValues
      : new Set([...this.secretValues, ...this.externalValues])
  }

  /** SEC-002: replace known secret values in any agent-bound text. */
  scrub(text: string): string {
    const values = this.allSecretValues()
    if (values.size === 0) return text
    let out = text
    let scrubbed = false
    for (const value of values) {
      // Also match the JSON-escaped form so values inside serialized tool
      // results (quotes/backslashes escaped) are still caught.
      const variants = new Set([value, JSON.stringify(value).slice(1, -1)])
      for (const variant of variants) {
        if (out.includes(variant)) {
          out = out.split(variant).join('<concealed>')
          scrubbed = true
        }
      }
    }
    if (scrubbed) {
      this.audit.push({ timestamp: Date.now(), action: 'scrubbed-output' })
    }
    return out
  }

  /** Human-only override, wired to a settings UI action — never callable by the agent. */
  whitelistPath(filePath: string): void {
    this.userWhitelist.add(resolve(isAbsolute(filePath) ? filePath : join(this.workspaceRoot, filePath)))
  }

  getAudit(): BrokerAuditEntry[] {
    return [...this.audit]
  }

  /** Main-process provider adapters use a private snapshot for output hooks. */
  knownSecretValues(): string[] {
    return [...this.allSecretValues()]
  }

  /**
   * Register externally-held secrets (vault values) into the scrub set.
   * One-way by design: values stay scrubbed even after the vault locks —
   * forgetting them would un-conceal past leaks in future output.
   */
  addSecretValues(values: string[]): void {
    for (const value of values) {
      if (value.length >= MIN_SECRET_VALUE_LENGTH && !COMMON_NON_SECRETS.has(value.toLowerCase())) {
        this.externalValues.add(value)
      }
    }
  }

  /** Re-scan after workspace changes (e.g. new .env created). */
  reload(): void {
    this.secretValues.clear()
    this.loadWorkspaceSecrets()
  }
}
