import { describe, it, expect } from 'vitest'
import { scoreTask, chooseModel, chooseAccount, CODEX_EFFORT } from '../src/main/modelRouter'

describe('scoreTask', () => {
  it('routes trivial tasks light', () => {
    expect(scoreTask('fix a typo in the README').tier).toBe('light')
    expect(scoreTask('rename the variable foo to bar').tier).toBe('light')
    expect(scoreTask('add a comment to this function').tier).toBe('light')
  })

  it('routes ordinary tasks standard', () => {
    const { tier } = scoreTask('add a retry button to the settings page and wire it to the API')
    expect(tier).toBe('standard')
  })

  it('routes hard multi-signal tasks deep', () => {
    const { tier, reasons } = scoreTask(
      'refactor the authentication architecture across the entire project and debug the race condition in session handling'
    )
    expect(tier).toBe('deep')
    expect(reasons).toContain('refactor')
    expect(reasons).toContain('broad scope')
  })

  it('knowledge-heavy context and long plans raise the tier', () => {
    const base = scoreTask('update the payment handler', 0, 0, 0)
    const loaded = scoreTask('update the payment handler', 6000, 5, 6)
    expect(loaded.score).toBeGreaterThan(base.score)
    expect(loaded.reasons).toContain('knowledge-heavy context')
  })

  it('easy signals outweigh length', () => {
    const { tier } = scoreTask(
      'please fix the small typo in the documentation file where it says recieve instead of receive thank you'
    )
    expect(tier).toBe('light')
  })

  it('a hard signal is not cancelled by an easy signal in the same task', () => {
    const { tier, reasons } = scoreTask('refactor the auth module and rename the login function')
    expect(tier).not.toBe('light')
    expect(reasons).toContain('refactor')
    expect(reasons).not.toContain('rename')
  })

  it('negated signal words do not count as hard', () => {
    const negated = scoreTask("don't worry about performance, just add a button")
    const stated = scoreTask('improve the performance of the rendering loop')
    expect(negated.reasons).not.toContain('performance')
    expect(stated.reasons).toContain('performance')
  })

  it('sensitive areas raise the tier even without explicit difficulty words', () => {
    const { tier, reasons } = scoreTask('update the payment webhook handler')
    expect(tier).not.toBe('light')
    expect(reasons).toContain('payment-sensitive area')
  })

  it('soft easy phrasing routes light', () => {
    expect(scoreTask('just a quick fix to the button label').tier).toBe('light')
    expect(scoreTask('this is a trivial change to the footer text').tier).toBe('light')
  })

  it('matches real benchmark tasks (2026-08-10 live test)', () => {
    const simple =
      'Create a simple todo list web app with index.html, style.css, and app.js. ' +
      'Support add, toggle-complete, and delete todos, persisted to localStorage.'
    const hard =
      'Design and build a todo app with a debounced search feature, optimized rendering ' +
      'for large lists (10,000+ items) using virtual scrolling, and handle concurrent ' +
      'localStorage writes across multiple browser tabs safely (race condition safe).'
    expect(scoreTask(simple).tier).toBe('standard')
    expect(scoreTask(hard).tier).toBe('deep')
  })
})

describe('chooseModel', () => {
  it('maps tiers to the claude lineup', () => {
    expect(chooseModel('claude', 'fix typo').model).toBe('claude-haiku-4-5')
    expect(
      chooseModel('claude', 'refactor the architecture across the entire codebase and debug concurrency').model
    ).toBe('claude-opus-5')
  })

  it('codex keeps one model, scales reasoning effort', () => {
    expect(chooseModel('codex', 'fix typo').model).toBe('gpt-5-codex')
    expect(CODEX_EFFORT.light).toBe('low')
    expect(CODEX_EFFORT.deep).toBe('high')
  })

  it('user override forces the tier', () => {
    const choice = chooseModel('claude', 'fix typo', { force: 'deep' })
    expect(choice.tier).toBe('deep')
    expect(choice.reason).toBe('user override')
  })

  it('opencode never overrides the model', () => {
    expect(chooseModel('opencode', 'refactor everything across the project').model).toBe('')
  })
})

describe('chooseAccount', () => {
  it('throws when nothing is connected', () => {
    expect(() => chooseAccount('fix a typo', [])).toThrow(/no connected accounts/i)
  })

  it('collapses plan and execute onto the only connected account', () => {
    const choice = chooseAccount('refactor the architecture across the project', ['opencode'])
    expect(choice.planProvider).toBe('opencode')
    expect(choice.executeProvider).toBe('opencode')
  })

  it('prefers codex for planning and claude for deep execution when both are connected', () => {
    const choice = chooseAccount(
      'refactor the authentication architecture across the entire project and debug the race condition',
      ['claude', 'codex']
    )
    expect(choice.planProvider).toBe('codex')
    expect(choice.executeProvider).toBe('claude')
  })

  it('prefers codex execution for light tasks when both are connected', () => {
    const choice = chooseAccount('fix a typo in the README', ['claude', 'codex'])
    expect(choice.executeProvider).toBe('codex')
  })

  it('only offers connected providers as candidates', () => {
    const choice = chooseAccount('refactor everything across the project', ['opencode', 'codex'])
    expect(['opencode', 'codex']).toContain(choice.planProvider)
    expect(['opencode', 'codex']).toContain(choice.executeProvider)
  })

  it('prefers opencode-go execution for light tasks over claude when codex is absent', () => {
    const choice = chooseAccount('fix a typo in the README', ['claude', 'opencode-go'])
    expect(choice.executeProvider).toBe('opencode-go')
  })

  it('falls back to opencode-go execution last for hard tasks', () => {
    const choice = chooseAccount(
      'refactor the authentication architecture across the entire project and debug the race condition',
      ['opencode-go']
    )
    expect(choice.executeProvider).toBe('opencode-go')
    expect(choice.planProvider).toBe('opencode-go')
  })
})
