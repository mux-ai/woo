import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { KnowledgeEngine } from '../src/main/knowledge/engine'
import { KnowledgeSyncService } from '../src/main/knowledge/syncService'
import { RuleChecker } from '../src/main/ruleChecker'
import { SecretBroker } from '../src/main/secretBroker'

let root = ''

function write(path: string, content: string): void {
  const absolute = join(root, path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, content)
}

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

describe('first-run developer journey', () => {
  it('initializes knowledge, grounds a task, protects secrets, checks code, and syncs an approved change', async () => {
    root = mkdtempSync(join(tmpdir(), 'woo-first-run-'))
    write('.env', 'PAYMENT_API_KEY=first_run_secret_value\n')
    write(
      'src/paymentService.ts',
      'export const api_key = "hardcoded_payment_key_12345"\n'
    )

    const knowledge = new KnowledgeEngine(root)
    expect((await knowledge.status()).documents).toHaveLength(0)

    await knowledge.initialize()
    const status = await knowledge.status()
    expect(status.documents).toHaveLength(3)
    expect(await knowledge.validate()).toEqual([])

    const task = 'fix the hardcoded secret in the Example Service safely'
    const pack = await knowledge.retrieve(task)
    expect(pack.documents.map((document) => document.title)).toEqual(
      expect.arrayContaining(['SEC-001 No Hardcoded Secrets', 'Example Service'])
    )
    expect(pack.sources.every((source) => source.id.length > 0)).toBe(true)

    const checker = new RuleChecker(knowledge)
    const findings = await checker.check(
      'src/paymentService.ts',
      readFileSync(join(root, 'src/paymentService.ts'), 'utf8')
    )
    expect(findings.some((finding) => finding.ruleId === 'SEC-001')).toBe(true)

    const broker = new SecretBroker(root)
    expect(broker.checkPath('.env').allowed).toBe(false)
    expect(broker.scrub('value=first_run_secret_value')).toBe('value=<concealed>')

    const sync = new KnowledgeSyncService(root, knowledge)
    const before = await sync.snapshot()
    expect(before.has('.env')).toBe(false)
    write(
      'src/paymentService.ts',
      'export const api_key = process.env.PAYMENT_API_KEY ?? ""\n'
    )

    const review = await sync.review(task, before)
    expect(review?.changedFiles).toEqual(['src/paymentService.ts'])
    expect(review?.proposals.length).toBeGreaterThan(0)

    const approved = review!.proposals[0]
    const applied = await sync.apply(review!.id, [approved.id])
    expect(applied.updatedPaths).toEqual([approved.path])
    expect(readFileSync(join(root, approved.path), 'utf8')).toContain(
      'Recent task: fix the hardcoded secret in the Example Service safely'
    )
  })
})
