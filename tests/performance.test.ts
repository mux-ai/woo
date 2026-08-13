import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FileService } from '../src/main/fileService'
import { SecretBroker } from '../src/main/secretBroker'
import { RuleChecker } from '../src/main/ruleChecker'
import { KnowledgeEngine } from '../src/main/knowledge/engine'
import { parseMarkdown } from '../src/renderer/src/markdownLite'

/**
 * Performance floor for the hot paths. Bounds are deliberately loose (CI
 * machines vary) — they catch order-of-magnitude regressions, not noise.
 * Each test logs its measurement so `npm test` doubles as a perf report.
 */

let root: string

function ms(fn: () => void): number {
  const t0 = performance.now()
  fn()
  return performance.now() - t0
}

async function msAsync(fn: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now()
  await fn()
  return performance.now() - t0
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'woo-perf-'))
  // Synthetic workspace: 40 dirs × 50 files ≈ 2000 files, ~1KB each.
  for (let d = 0; d < 40; d++) {
    const dir = join(root, `pkg-${d}`)
    mkdirSync(dir, { recursive: true })
    for (let f = 0; f < 50; f++) {
      writeFileSync(
        join(dir, `mod-${f}.ts`),
        `export function handler${f}() {\n  return 'payload'\n}\n`.repeat(15)
      )
    }
  }
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('15ms interactive budget', () => {
  // User-set budget: every CPU-bound interactive operation completes in
  // ≤15ms at realistic sizes. Excluded by physics, not preference:
  // agent runs (network + model inference) and full-workspace search
  // (disk I/O, linear in repo size — UI debounces it 250ms regardless).
  // Best-of-3: parallel test files fight for CPU; scheduler contention is
  // not the operation's cost.
  const BUDGET_MS = 15

  async function bestOf3(fn: () => Promise<unknown> | unknown): Promise<number> {
    let best = Infinity
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now()
      await fn()
      best = Math.min(best, performance.now() - t0)
    }
    return best
  }

  it('knowledge retrieve stays in budget', async () => {
    const { KnowledgeEngine } = await import('../src/main/knowledge/engine')
    const engine = new KnowledgeEngine(process.cwd())
    await engine.available() // warm index once, like a running app
    const t = await bestOf3(() => engine.retrieve('how are secrets protected from the agent'))
    console.log(`  retrieve (real KB, warm): ${t.toFixed(1)}ms`)
    expect(t).toBeLessThan(BUDGET_MS)
  })

  it('rule check on a large file stays in budget', async () => {
    const rulesDir = join(root, '.woo', 'knowledge', 'rules')
    mkdirSync(rulesDir, { recursive: true })
    const checker = new RuleChecker(new KnowledgeEngine(root))
    const content = 'const ok = safeCall()\n'.repeat(2000)
    await checker.check('src/warm.ts', content)
    const t = await bestOf3(() => checker.check('src/warm.ts', content))
    console.log(`  rule check (2k lines, warm): ${t.toFixed(1)}ms`)
    expect(t).toBeLessThan(BUDGET_MS)
  })

  it('markdown parse of a typical agent message stays in budget', async () => {
    const text = '## Step\n\nSome **bold** and `code`.\n- item\n```ts\nx()\n```\n'.repeat(400) // ~20KB
    const t = await bestOf3(() => parseMarkdown(text))
    console.log(`  markdown parse ~20KB: ${t.toFixed(1)}ms`)
    expect(t).toBeLessThan(BUDGET_MS)
  })

  it('scrub of a typical tool result stays in budget', async () => {
    writeFileSync(
      join(root, '.env'),
      Array.from({ length: 50 }, (_, i) => `KEY_${i}=secretvalue_${i}_padpadpad`).join('\n')
    )
    const broker = new SecretBroker(root)
    const toolResult = 'output line with ordinary text content\n'.repeat(2500) // ~100KB
    const t = await bestOf3(() => broker.scrub(toolResult))
    console.log(`  scrub 100KB/50 secrets: ${t.toFixed(1)}ms`)
    expect(t).toBeLessThan(BUDGET_MS)
  })

  it('stream flush cost stays in budget per event', async () => {
    const broker = new SecretBroker(root)
    let acc = ''
    for (let i = 0; i < 400; i++) acc += 'accumulated streamed message text chunk '
    const t = await bestOf3(() => broker.scrub(acc)) // one 50ms-batched flush
    console.log(`  single stream flush (~16KB): ${t.toFixed(1)}ms`)
    expect(t).toBeLessThan(BUDGET_MS)
  })

  it('palette path walk stays in budget', async () => {
    const files = new FileService(root)
    const t = await bestOf3(() => files.allPaths())
    console.log(`  allPaths 2k files: ${t.toFixed(1)}ms`)
    expect(t).toBeLessThan(BUDGET_MS)
  })
})

describe('performance floors', () => {
  it('search: substring scan over ~2k files', async () => {
    const files = new FileService(root)
    const t = await msAsync(() => files.search('handler12'))
    console.log(`  search 2k files: ${t.toFixed(0)}ms`)
    expect(t).toBeLessThan(2000)
  })

  it('allPaths: full path walk over ~2k files', async () => {
    const files = new FileService(root)
    const t = await msAsync(() => files.allPaths())
    console.log(`  allPaths 2k files: ${t.toFixed(0)}ms`)
    expect(t).toBeLessThan(500)
  })

  it('scrub: 50 secrets against 1MB of text, single pass', () => {
    writeFileSync(
      join(root, '.env'),
      Array.from({ length: 50 }, (_, i) => `KEY_${i}=secretvalue_${i}_padpadpad`).join('\n')
    )
    const broker = new SecretBroker(root)
    const text = 'lorem ipsum dolor sit amet '.repeat(40000) // ~1MB
    const t = ms(() => broker.scrub(text))
    console.log(`  scrub 1MB/50 secrets: ${t.toFixed(0)}ms`)
    expect(t).toBeLessThan(1000)
  })

  it('scrub: streaming accumulation pattern (500 deltas) — quadratic hotspot', () => {
    const broker = new SecretBroker(root) // 50 secrets from previous test
    const delta = 'streamed model output chunk with some text '
    let acc = ''
    const t = ms(() => {
      for (let i = 0; i < 500; i++) {
        acc += delta
        broker.scrub(acc) // mirrors agentRunner text-stream handling
      }
    })
    console.log(`  scrub 500-delta stream (full re-scrub each): ${t.toFixed(0)}ms`)
    expect(t).toBeLessThan(5000)
  })

  it('rule check: 2k-line file', async () => {
    const rulesDir = join(root, '.woo', 'knowledge', 'rules')
    mkdirSync(rulesDir, { recursive: true })
    for (let i = 0; i < 10; i++) {
      writeFileSync(
        join(rulesDir, `rule-${i}.md`),
        `---\ntitle: R-${i} Rule\ntype: rule\ndescription: rule ${i}\nchecks:\n  - pattern: 'forbidden_${i}\\('\n    severity: warning\n    message: no\n---\nBody.\n`
      )
    }
    const checker = new RuleChecker(new KnowledgeEngine(root))
    const content = 'const ok = safeCall()\n'.repeat(2000)
    await checker.check('src/big.ts', content) // warm knowledge index
    const t = await msAsync(() => checker.check('src/big.ts', content))
    console.log(`  rule check 2k lines / 11 checks: ${t.toFixed(0)}ms`)
    expect(t).toBeLessThan(500)
  })

  it('markdown: parse 200KB streamed transcript', () => {
    const text = (
      '## Heading\n\nSome **bold** text with `code` and more prose here.\n' +
      '- list item one\n- list item two\n\n```ts\nconst x = 1\n```\n'
    ).repeat(1500)
    const t = ms(() => parseMarkdown(text))
    console.log(`  markdown parse ${(text.length / 1024).toFixed(0)}KB: ${t.toFixed(0)}ms`)
    expect(t).toBeLessThan(500)
  })
})
