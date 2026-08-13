import type { AccountChoice, AuthProvider, ModelChoice, ModelTier } from '../shared/types'

/**
 * Intelligent model routing — deterministic, local, free. Scores task
 * difficulty from observable signals (no model call to pick a model) and
 * maps the tier onto each provider's model lineup. `auto` is the default;
 * the user can force a tier per run.
 *
 * Plan phase routes through the same scorer as execution: a hard task gets
 * a strong planner (plan quality drives execution quality — proven in the
 * 2026-08-10 live benchmark), a trivial one keeps the light model. Plans
 * are short output, so even deep-tier planning stays cheap.
 */

const HARD_SIGNALS: [RegExp, string][] = [
  [/refactor|restructure|rearchitect|redesign/i, 'refactor'],
  [/architect|design\b|architecture/i, 'design'],
  [/debug|investigate|diagnose|root.?cause|why (is|does|did)/i, 'debugging'],
  [/migrat|upgrade\b/i, 'migration'],
  [/optimi[sz]e|performance|perf\b|latency|memory leak/i, 'performance'],
  [/security|vulnerab|exploit|auth(entication|orization)/i, 'security'],
  [/concurren|race condition|deadlock|thread/i, 'concurrency'],
  [/rewrite|from scratch|overhaul/i, 'rewrite'],
  [/algorithm|complexity|data structure/i, 'algorithms']
]

// Sensitive-area hints: a casually-worded task touching one of these still
// deserves extra care even without an explicit hard-signal word like
// "security". Weighted lower than HARD_SIGNALS since a bare area mention is
// a weaker signal than an explicit difficulty word.
const AREA_SIGNALS: [RegExp, string][] = [
  [/\b(payment|billing|checkout|invoice|stripe)\b/i, 'payment-sensitive area'],
  [/\b(authentication|authorization|\bauth\/|login|session|oauth)\b/i, 'auth-sensitive area'],
  [/\b(crypto|encryption|cipher|jwt|token)\b/i, 'crypto-sensitive area'],
  [/(\.env\b|credentials?|secrets?)/i, 'secret-sensitive area']
]

const EASY_SIGNALS: [RegExp, string][] = [
  [/typo|spelling/i, 'typo'],
  [/rename\b/i, 'rename'],
  [/comment|docstring|jsdoc/i, 'comments'],
  [/format|prettier|lint\b/i, 'formatting'],
  [/readme|documentation|changelog/i, 'docs'],
  [/bump|version\b/i, 'version bump'],
  [/add (a )?log\b|console\.log|print statement/i, 'logging']
]

// Softer than EASY_SIGNALS: phrases that only hint "small" rather than
// naming a specific trivial change type.
const SOFT_EASY_SIGNALS: [RegExp, string][] = [
  [/\btrivial\b/i, 'trivial'],
  [/\bquick (fix|change|tweak)\b|\bquickly\b/i, 'quick'],
  [/\bsmall (fix|change|tweak)\b/i, 'small change'],
  [/\bminor (fix|change|tweak)\b/i, 'minor change']
]

const BROAD_SCOPE = /across|all files|every file|entire|project.?wide|whole (repo|project|codebase)/i

// A signal word preceded by a negation within a short window shouldn't
// count — "don't worry about performance" isn't a performance task.
const NEGATION = /\b(no|not|don'?t|never|isn'?t|without)\b/i
const NEGATION_WINDOW = 30

function isNegated(task: string, matchIndex: number): boolean {
  const windowStart = Math.max(0, matchIndex - NEGATION_WINDOW)
  return NEGATION.test(task.slice(windowStart, matchIndex))
}

export function scoreTask(
  task: string,
  packTokens = 0,
  packDocs = 0,
  planSteps = 0
): { tier: ModelTier; score: number; reasons: string[] } {
  // Baseline 20 = standard: an ordinary implementation task deserves the
  // standard model. Easy signals subtract toward light; hard signals and
  // scope push toward deep.
  let score = 20
  const reasons: string[] = []

  const words = task.trim().split(/\s+/).length
  score += Math.min(20, Math.floor(words / 8))
  if (words > 60) reasons.push('long task description')

  let hard = 0
  for (const [re, label] of HARD_SIGNALS) {
    const match = re.exec(task)
    if (match && hard < 3 && !isNegated(task, match.index)) {
      hard++
      score += 15
      reasons.push(label)
    }
  }
  let area = 0
  for (const [re, label] of AREA_SIGNALS) {
    const match = re.exec(task)
    if (match && area < 2 && !isNegated(task, match.index)) {
      area++
      score += 12
      reasons.push(label)
    }
  }
  // Easy/soft-easy signals only pull the score toward light when nothing
  // above already flagged real difficulty — otherwise "rename the function
  // in the auth refactor" would cancel out a genuinely hard task.
  if (hard === 0 && area === 0) {
    let easy = 0
    for (const [re, label] of EASY_SIGNALS) {
      if (re.test(task) && easy < 3) {
        easy++
        score -= 12
        reasons.push(label)
      }
    }
    let soft = 0
    for (const [re, label] of SOFT_EASY_SIGNALS) {
      if (re.test(task) && soft < 2) {
        soft++
        score -= 8
        reasons.push(label)
      }
    }
  }
  if (BROAD_SCOPE.test(task)) {
    score += 15
    reasons.push('broad scope')
  }
  if (packTokens > 4000 || packDocs > 3) {
    score += 8
    reasons.push('knowledge-heavy context')
  }
  if (planSteps > 4) {
    score += 8
    reasons.push(`${planSteps}-step plan`)
  }

  const tier: ModelTier = score < 15 ? 'light' : score < 45 ? 'standard' : 'deep'
  if (reasons.length === 0) reasons.push('no strong signals')
  return { tier, score, reasons }
}

/** Provider model lineups per tier. */
const MODELS: Record<AuthProvider, Record<ModelTier, string>> = {
  claude: {
    light: 'claude-haiku-4-5',
    standard: 'claude-sonnet-5',
    deep: 'claude-opus-5'
  },
  codex: {
    // Same model, reasoning effort scales — codex's own routing lever.
    light: 'gpt-5-codex',
    standard: 'gpt-5-codex',
    deep: 'gpt-5-codex'
  },
  opencode: {
    // opencode routes via the user's own provider config; Woo does not
    // override models it can't enumerate. Tier still shown for transparency.
    light: '',
    standard: '',
    deep: ''
  },
  // Same reasoning — opencodeAgentRunner picks the actual Go model itself
  // (mostly open-weights lineup; see resolveGoLineup for the real list).
  'opencode-go': {
    light: '',
    standard: '',
    deep: ''
  }
}

export const CODEX_EFFORT: Record<ModelTier, 'low' | 'medium' | 'high'> = {
  light: 'low',
  standard: 'medium',
  deep: 'high'
}

export function chooseModel(
  provider: AuthProvider,
  task: string,
  opts: { packTokens?: number; packDocs?: number; planSteps?: number; force?: ModelTier } = {}
): ModelChoice {
  const scored = opts.force
    ? { tier: opts.force, score: -1, reasons: ['user override'] }
    : scoreTask(task, opts.packTokens, opts.packDocs, opts.planSteps)
  return {
    provider,
    tier: scored.tier,
    model: MODELS[provider][scored.tier],
    reason: scored.reasons.slice(0, 3).join(', ')
  }
}

/**
 * Which connected account plans a task vs which executes it — no manual
 * picker, Woo decides. Priority order is static, tuned from the 2026-08-10
 * live cross-provider benchmarks (see project memory): codex drafts cheap,
 * effective plans regardless of task tier (plan output is short either
 * way); claude's deep tier produced the most complete + reliable execution
 * (full test suites, race-safety) while codex's deep tier over-built scope
 * on the same task for more cost without matching gain — so deep-tier
 * execution prefers claude, light/standard prefer whichever was cheaper in
 * those runs. Restricted to whatever's actually connected; single-account
 * setups collapse plan and execute onto that one account.
 *
 * 'opencode-go' (open-weights only — deepseek/kimi/qwen/glm/minimax, no
 * claude/gpt) is untested by that benchmark, so it's placed last except for
 * light tasks where its cost/speed profile is a natural fit — and last in
 * planning too, since one open model (deepseek-v4-flash) is known to stall
 * indefinitely on planning-style prompts (see project memory).
 */
const PLAN_PRIORITY: AuthProvider[] = ['codex', 'claude', 'opencode', 'opencode-go']
const EXECUTE_PRIORITY: Record<ModelTier, AuthProvider[]> = {
  light: ['codex', 'opencode-go', 'opencode', 'claude'],
  standard: ['claude', 'codex', 'opencode', 'opencode-go'],
  deep: ['claude', 'opencode', 'codex', 'opencode-go']
}

function pickConnected(priority: AuthProvider[], connected: AuthProvider[]): AuthProvider {
  for (const candidate of priority) {
    if (connected.includes(candidate)) return candidate
  }
  return connected[0]
}

export function chooseAccount(
  task: string,
  connected: AuthProvider[],
  opts: { packTokens?: number; packDocs?: number; planSteps?: number } = {}
): AccountChoice {
  if (connected.length === 0) throw new Error('No connected accounts.')
  const planProvider = pickConnected(PLAN_PRIORITY, connected)
  if (connected.length === 1) {
    return { planProvider, executeProvider: planProvider, reason: `only ${planProvider} connected` }
  }
  const { tier, reasons } = scoreTask(task, opts.packTokens, opts.packDocs, opts.planSteps)
  const executeProvider = pickConnected(EXECUTE_PRIORITY[tier], connected)
  return {
    planProvider,
    executeProvider,
    reason: `${tier} task (${reasons.slice(0, 2).join(', ')})`
  }
}
