import { describe, it, expect } from 'vitest'
import { resolveGoLineup } from '../src/main/opencodeAgentRunner'

describe('resolveGoLineup', () => {
  it('prefers kimi-k3 when available', () => {
    const lineup = resolveGoLineup([
      { value: 'opencode-go/deepseek-v3' },
      { value: 'opencode-go/kimi-k2.7-code' },
      { value: 'opencode-go/kimi-k3' }
    ])
    expect(lineup.light).toBe('opencode-go/kimi-k3')
    expect(lineup.standard).toBe('opencode-go/kimi-k3')
    expect(lineup.deep).toBe('opencode-go/kimi-k3')
  })

  it('falls back down the preference order when the top pick is absent', () => {
    const lineup = resolveGoLineup([
      { value: 'opencode-go/glm-4' },
      { value: 'opencode-go/qwen-max' }
    ])
    expect(lineup.deep).toBe('opencode-go/qwen-max')
  })

  it('excludes deepseek-v4-flash outright (known to stall on planning prompts)', () => {
    const lineup = resolveGoLineup([{ value: 'opencode-go/deepseek-v4-flash' }])
    expect(lineup.deep).toBe('')
  })

  it('returns empty strings when nothing is detected', () => {
    expect(resolveGoLineup([])).toEqual({ light: '', standard: '', deep: '' })
  })
})
