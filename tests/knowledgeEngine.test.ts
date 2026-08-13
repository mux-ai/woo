import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { KnowledgeEngine } from '../src/main/knowledge/engine'

let root: string

function writeDoc(rel: string, title: string, type: string, body: string, extra = ''): void {
  const file = join(root, '.woo', 'knowledge', rel)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(
    file,
    `---\ntitle: ${title}\ntype: ${type}\ndescription: ${title} description\n${extra}---\n${body}\n`
  )
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'woo-knowledge-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('KnowledgeEngine retrieval', () => {
  it('versions existing knowledge and creates a pre-migration backup', async () => {
    writeDoc('rules/existing.md', 'Existing Rule', 'rule', 'Existing content')
    const engine = new KnowledgeEngine(root)
    await engine.status()
    expect(readFileSync(join(root, '.woo/knowledge/.schema-version'), 'utf8')).toBe('1\n')
    expect(
      existsSync(join(root, '.woo/backups'))
    ).toBe(true)
  })
  it('serializes concurrent first-use schema migration', async () => {
    writeDoc('rules/existing.md', 'Existing Rule', 'rule', 'Existing content')
    const engine = new KnowledgeEngine(root)
    await expect(Promise.all([
      engine.retrieve('existing rule'),
      engine.retrieve('existing rule'),
      engine.status()
    ])).resolves.toHaveLength(3)
    expect(readFileSync(join(root, '.woo/knowledge/.schema-version'), 'utf8')).toBe('1\n')
  })
  it('ranks title matches above body matches and expands one hop', async () => {
    writeDoc(
      'entities/payment-worker.md',
      'Payment Worker',
      'entity',
      'Processes payment jobs.',
      'relationships:\n  - predicate: follows\n    to: Retry Decision\n'
    )
    writeDoc('decisions/retry.md', 'Retry Decision', 'decision', 'Declined payments never retry.')
    writeDoc('entities/unrelated.md', 'Logging Sink', 'entity', 'Collects logs, mentions payment once.')

    const engine = new KnowledgeEngine(root)
    const pack = await engine.retrieve('fix payment worker retries')

    const ids = pack.sources.map((s) => s.id)
    expect(ids[0]).toBe('entities/payment-worker')
    // 1-hop target included even though the task never names it directly.
    expect(ids).toContain('decisions/retry')
    expect(pack.context).toContain('Payment Worker')
    expect(pack.tokenEstimate).toBeGreaterThan(0)
  })

  it('skips low-confidence body-only matches', async () => {
    writeDoc('decisions/architecture.md', 'Architecture Decision', 'decision', 'A fix may be documented here.')
    writeDoc('entities/violation.md', 'Rule Violation', 'entity', 'A typo can cause a violation.')

    const pack = await new KnowledgeEngine(root).retrieve('write a README typo fix')

    expect(pack.documents).toEqual([])
    expect(pack.context).toBe('')
    expect(pack.tokenEstimate).toBe(0)
  })

  it('caps graph-expanded execution packs at five documents', async () => {
    for (let i = 0; i < 10; i++) {
      writeDoc(`entities/payment-${i}.md`, `Payment Component ${i}`, 'entity', 'Payment behavior.')
    }

    const pack = await new KnowledgeEngine(root).retrieve('change payment components')

    expect(pack.documents).toHaveLength(5)
  })

  it('uses descriptions without document bodies in summary mode', async () => {
    writeDoc(
      'rules/payment.md',
      'Payment Security',
      'rule',
      'FULL_BODY_MARKER with detailed implementation guidance.'
    )
    const engine = new KnowledgeEngine(root)

    const summary = await engine.retrieve('payment security', { mode: 'summary' })
    const full = await engine.retrieve('payment security')

    expect(summary.context).toContain('Payment Security description')
    expect(summary.context).not.toContain('FULL_BODY_MARKER')
    expect(full.context).toContain('FULL_BODY_MARKER')
    expect(summary.tokenEstimate).toBeLessThan(full.tokenEstimate)
  })

  it('aliases weigh like titles and resolve relationship targets', async () => {
    writeDoc(
      'components/auth.md',
      'Auth Service',
      'component',
      'Shells out to provider CLIs.',
      'aliases:\n  - login\n  - sign-in\n'
    )
    writeDoc(
      'workflows/connect.md',
      'Connect Provider',
      'workflow',
      'Connect an account.',
      'relationships:\n  - predicate: depends-on\n    to: login\n'
    )
    const engine = new KnowledgeEngine(root)

    // Query shares NO words with title/description/body — only the alias.
    const pack = await engine.retrieve('user login problems')
    expect(pack.sources.some((s) => s.id === 'components/auth' && s.seed)).toBe(true)

    // Relationship written against an alias resolves to the doc.
    const graph = await engine.graph()
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        from: 'workflows/connect',
        to: 'components/auth',
        predicate: 'depends-on'
      })
    )
  })

  it('validate reports dangling relationship edges', async () => {
    writeDoc(
      'entities/thing.md',
      'Thing',
      'entity',
      'A thing.',
      'relationships:\n  - predicate: uses\n    to: Nonexistent Doc\n  - predicate: follows\n    to: Other Thing\n'
    )
    writeDoc('entities/other.md', 'Other Thing', 'entity', 'Exists.')
    const engine = new KnowledgeEngine(root)

    const diags = await engine.validate()
    expect(diags).toHaveLength(1)
    expect(diags[0]).toMatchObject({
      ruleId: 'KNOW-EDGE',
      file: '.woo/knowledge/entities/thing.md',
      severity: 'warning',
      source: 'Knowledge Graph'
    })
    expect(diags[0].message).toContain('Nonexistent Doc')
  })

  it('stays fast on a 1k-doc knowledge base (token cache)', async () => {
    for (let i = 0; i < 1000; i++) {
      writeDoc(
        `entities/doc-${i}.md`,
        `Entity Number ${i}`,
        'entity',
        `Body text for document ${i} covering topic-${i % 50} and shared vocabulary padding `.repeat(20)
      )
    }
    const engine = new KnowledgeEngine(root)
    await engine.available() // index build (loads + tokenizes once)

    const start = performance.now()
    for (let q = 0; q < 10; q++) {
      await engine.retrieve(`entity number ${q * 7} topic-${q} vocabulary`)
    }
    const perRetrieve = (performance.now() - start) / 10
    expect(perRetrieve).toBeLessThan(300)
  })
})
