import type { ModelTier } from '../shared/types'

/**
 * Account-aware model catalog for the Claude provider. Asks the connected
 * account which models it can actually use (Agent SDK `supportedModels()`
 * control request — CLI auth, no model tokens) and maps the routing tiers
 * onto the best available lineup:
 *
 *   deep     → Claude Fable 5 when the account has it, else Claude Opus 5
 *   standard → Claude Sonnet 5
 *   light    → Claude Haiku 4.5
 *
 * Falls back to the static lineup when detection fails (offline, not signed
 * in). Result cached; refreshed on TTL expiry.
 */

export interface DetectedModel {
  value: string
  resolvedModel?: string
}

export const STATIC_LINEUP: Record<ModelTier, string> = {
  light: 'claude-haiku-4-5',
  standard: 'claude-sonnet-5',
  deep: 'claude-opus-5'
}

/** Pick the account's best model for each tier from a detected model list. */
export function resolveLineup(models: DetectedModel[]): {
  lineup: Record<ModelTier, string>
  fableAvailable: boolean
} {
  const ids = models.map((m) => (m.resolvedModel ?? m.value).toLowerCase())
  const find = (needle: string): string | undefined => {
    const index = ids.findIndex((id) => id.includes(needle))
    return index === -1 ? undefined : (models[index].resolvedModel ?? models[index].value)
  }

  const fable = find('fable')
  return {
    fableAvailable: fable != null,
    lineup: {
      light: find('haiku') ?? STATIC_LINEUP.light,
      standard: find('sonnet') ?? STATIC_LINEUP.standard,
      // Most capable available wins the deep tier.
      deep: fable ?? find('opus') ?? STATIC_LINEUP.deep
    }
  }
}

export interface CodexModelEntry {
  slug: string
  description?: string
  visibility?: string
  priority?: number
}

/**
 * Tier the codex account's models by their own self-descriptions
 * (metadata from ~/.codex/models_cache.json): "frontier" → deep,
 * "balanced"/"everyday" → standard, "fast"/"affordable"/"mini" → light.
 * Lowest `priority` number wins within a tier (current generation first).
 */
export function resolveCodexLineup(models: CodexModelEntry[]): Record<ModelTier, string> | null {
  const visible = models
    .filter((m) => m.visibility !== 'hide' && m.slug)
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
  if (visible.length === 0) return null

  const byDesc = (re: RegExp) =>
    visible.find((m) => re.test(`${m.description ?? ''} ${m.slug}`))?.slug

  const deep = byDesc(/frontier/i) ?? visible[0].slug
  const light = byDesc(/fast.*affordable|affordable|mini/i) ?? visible[visible.length - 1].slug
  const standard = byDesc(/balanced|everyday/i) ?? deep
  return { light, standard, deep }
}

const CACHE_TTL_MS = 10 * 60 * 1000

export class ModelCatalog {
  private cached: { lineup: Record<ModelTier, string>; fableAvailable: boolean } | null = null
  private cachedAt = 0
  private inflight: Promise<void> | null = null

  constructor(
    private detect: () => Promise<DetectedModel[]>,
    private onLog?: (line: string) => void
  ) {}

  private async refresh(): Promise<void> {
    try {
      const models = await this.detect()
      const resolved = resolveLineup(models)
      const first = this.cached == null
      this.cached = resolved
      this.cachedAt = Date.now()
      if (first) {
        this.onLog?.(
          resolved.fableAvailable
            ? `Model catalog: account supports Claude Fable 5 — deep tier routes to ${resolved.lineup.deep}.`
            : `Model catalog: deep tier routes to ${resolved.lineup.deep}.`
        )
      }
    } catch {
      // Detection unavailable (offline / signed out) — static lineup serves.
    }
  }

  /** Best lineup known right now; never blocks on detection. */
  async lineup(): Promise<Record<ModelTier, string>> {
    const stale = Date.now() - this.cachedAt > CACHE_TTL_MS
    if ((this.cached == null || stale) && !this.inflight) {
      this.inflight = this.refresh().finally(() => {
        this.inflight = null
      })
      // First call ever: wait briefly for a real answer; later calls serve
      // the cached lineup while refreshing in the background.
      if (this.cached == null) {
        await Promise.race([this.inflight, new Promise((r) => setTimeout(r, 4000))])
      }
    }
    return this.cached?.lineup ?? STATIC_LINEUP
  }

  fableAvailable(): boolean {
    return this.cached?.fableAvailable ?? false
  }
}
