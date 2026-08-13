import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RuleChecker } from '../src/main/ruleChecker'
import { KnowledgeEngine } from '../src/main/knowledge/engine'

let root: string
let checker: RuleChecker

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'woo-rules-'))
  const rulesDir = join(root, '.woo', 'knowledge', 'rules')
  mkdirSync(rulesDir, { recursive: true })
  writeFileSync(
    join(rulesDir, 'pay-001.md'),
    `---
title: PAY-001 Declined Payments Never Retry
type: rule
description: Declined payments must never be automatically retried.
checks:
  - pattern: 'Result\\.retry\\(\\)'
    severity: error
    message: Declined payment branch must not retry.
---
Body.
`
  )
  checker = new RuleChecker(new KnowledgeEngine(root))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('RuleChecker', () => {
  it('flags knowledge-rule pattern matches', async () => {
    const diags = await checker.check('src/pay.ts', 'const x = Result.retry()\n')
    expect(diags.some((d) => d.ruleId === 'PAY-001' && d.severity === 'error')).toBe(true)
  })

  it('flags built-in hardcoded secrets', async () => {
    const diags = await checker.check(
      'src/cfg.ts',
      'const apiKey = "sk_live_abcdefghij123456"\n'
    )
    expect(diags.some((d) => d.ruleId === 'SEC-BUILTIN')).toBe(true)
  })

  it('never lints the knowledge base itself', async () => {
    const diags = await checker.check('.woo/knowledge/rules/pay-001.md', 'Result.retry()')
    expect(diags).toEqual([])
  })

  it('woo-ignore on the line above suppresses that rule', async () => {
    const diags = await checker.check(
      'src/pay.ts',
      '// woo-ignore PAY-001\nconst x = Result.retry()\n'
    )
    expect(diags.filter((d) => d.ruleId === 'PAY-001')).toEqual([])
  })

  it('bare woo-ignore on same line suppresses all rules', async () => {
    const diags = await checker.check('src/pay.ts', 'Result.retry() // woo-ignore\n')
    expect(diags).toEqual([])
  })

  it('woo-ignore scoped to another rule does not suppress', async () => {
    const diags = await checker.check(
      'src/pay.ts',
      '// woo-ignore OTHER-999\nconst x = Result.retry()\n'
    )
    expect(diags.some((d) => d.ruleId === 'PAY-001')).toBe(true)
  })
})
