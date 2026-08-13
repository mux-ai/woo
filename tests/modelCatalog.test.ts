import { describe, it, expect } from 'vitest'
import { resolveLineup, ModelCatalog, STATIC_LINEUP } from '../src/main/modelCatalog'

describe('resolveLineup', () => {
  it('prefers Fable 5 for deep when the account has it', () => {
    const { lineup, fableAvailable } = resolveLineup([
      { value: 'claude-haiku-4-5' },
      { value: 'sonnet', resolvedModel: 'claude-sonnet-5' },
      { value: 'opus', resolvedModel: 'claude-opus-5' },
      { value: 'fable', resolvedModel: 'claude-fable-5' }
    ])
    expect(fableAvailable).toBe(true)
    expect(lineup.deep).toBe('claude-fable-5')
    expect(lineup.standard).toBe('claude-sonnet-5')
    expect(lineup.light).toBe('claude-haiku-4-5')
  })

  it('routes deep to opus when Fable is not on the account', () => {
    const { lineup, fableAvailable } = resolveLineup([
      { value: 'claude-haiku-4-5' },
      { value: 'claude-sonnet-5' },
      { value: 'claude-opus-5' }
    ])
    expect(fableAvailable).toBe(false)
    expect(lineup.deep).toBe('claude-opus-5')
  })

  it('resolves aliases through resolvedModel', () => {
    const { lineup } = resolveLineup([{ value: 'opus', resolvedModel: 'claude-opus-5' }])
    expect(lineup.deep).toBe('claude-opus-5')
    // Missing tiers fall back to the static lineup.
    expect(lineup.light).toBe(STATIC_LINEUP.light)
    expect(lineup.standard).toBe(STATIC_LINEUP.standard)
  })

  it('empty detection falls back entirely to the static lineup', () => {
    expect(resolveLineup([]).lineup).toEqual(STATIC_LINEUP)
  })
})

describe('ModelCatalog', () => {
  it('serves the detected lineup and caches it', async () => {
    let calls = 0
    const catalog = new ModelCatalog(async () => {
      calls++
      return [{ value: 'claude-fable-5' }, { value: 'claude-sonnet-5' }]
    })
    const first = await catalog.lineup()
    const second = await catalog.lineup()
    expect(first.deep).toBe('claude-fable-5')
    expect(second.deep).toBe('claude-fable-5')
    expect(catalog.fableAvailable()).toBe(true)
    expect(calls).toBe(1) // cached
  })

  it('falls back to static lineup when detection fails', async () => {
    const catalog = new ModelCatalog(async () => {
      throw new Error('signed out')
    })
    expect(await catalog.lineup()).toEqual(STATIC_LINEUP)
    expect(catalog.fableAvailable()).toBe(false)
  })
})

describe('opencode lineup resolution', () => {
  it('maps Zen marketplace ids (opencode/claude-*) onto tiers', () => {
    const { lineup, fableAvailable } = resolveLineup([
      { value: 'opencode/big-pickle' },
      { value: 'opencode/claude-fable-5' },
      { value: 'opencode/claude-haiku-4-5' },
      { value: 'opencode/claude-sonnet-5' },
      { value: 'opencode/claude-opus-5' },
      { value: 'opencode/gpt-5' }
    ])
    expect(fableAvailable).toBe(true)
    expect(lineup).toEqual({
      light: 'opencode/claude-haiku-4-5',
      standard: 'opencode/claude-sonnet-5',
      deep: 'opencode/claude-fable-5'
    })
  })
})

describe('resolveCodexLineup', () => {
  const realCache = [
    { slug: 'gpt-5.6-sol', description: 'Latest frontier agentic coding model.', visibility: 'list', priority: 1 },
    { slug: 'gpt-5.6-sol-wm', description: 'Work Mode routing alias for GPT-5.6 Sol.', visibility: 'hide', priority: 1 },
    { slug: 'gpt-5.6-terra', description: 'Balanced agentic coding model for everyday work.', visibility: 'list', priority: 2 },
    { slug: 'gpt-5.6-luna', description: 'Fast and affordable agentic coding model.', visibility: 'list', priority: 3 },
    { slug: 'gpt-5.5', description: 'Frontier model for complex coding, research, and real-world work.', visibility: 'list', priority: 7 },
    { slug: 'gpt-5.4-mini', description: 'Small, fast, and cost-efficient model for simpler coding tasks.', visibility: 'list', priority: 23 },
    { slug: 'codex-auto-review', description: 'Automatic approval review model for Codex.', visibility: 'hide', priority: 43 }
  ]

  it("tiers the user's real codex cache by self-description", async () => {
    const { resolveCodexLineup } = await import('../src/main/modelCatalog')
    expect(resolveCodexLineup(realCache)).toEqual({
      deep: 'gpt-5.6-sol',      // "frontier", priority 1 (5.5 also frontier but lower priority)
      standard: 'gpt-5.6-terra', // "balanced ... everyday"
      light: 'gpt-5.6-luna'      // "fast and affordable"
    })
  })

  it('hidden models never selected; empty cache yields null', async () => {
    const { resolveCodexLineup } = await import('../src/main/modelCatalog')
    const lineup = resolveCodexLineup(realCache)!
    expect(Object.values(lineup)).not.toContain('gpt-5.6-sol-wm')
    expect(Object.values(lineup)).not.toContain('codex-auto-review')
    expect(resolveCodexLineup([])).toBeNull()
  })
})
