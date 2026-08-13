import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { KnowledgeEngine } from '../src/main/knowledge/engine'
import { KnowledgeSyncService } from '../src/main/knowledge/syncService'

let root: string

function write(path: string, content: string): void {
  const absolute = join(root, path)
  mkdirSync(join(absolute, '..'), { recursive: true })
  writeFileSync(absolute, content)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'woo-sync-'))
  write(
    '.woo/knowledge/components/payment-service.md',
    `---
title: Payment Service
type: component
description: Handles payment authorization and retry behavior.
---
The payment service is implemented in src/payment.ts.
`
  )
  write('src/payment.ts', 'export const retry = false\n')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('KnowledgeSyncService', () => {
  it('detects task changes and applies only an approved proposal', async () => {
    const service = new KnowledgeSyncService(root, new KnowledgeEngine(root))
    const before = await service.snapshot()
    write('src/payment.ts', 'export const retry = true\n')

    const review = await service.review('change payment retry behavior', before)

    expect(review?.changedFiles).toEqual(['src/payment.ts'])
    expect(review?.proposals).toHaveLength(1)
    expect(review?.proposals[0].diff).toContain('managed implementation status')
    const result = await service.apply(review!.id, [review!.proposals[0].id])
    expect(result.updatedPaths).toEqual(['.woo/knowledge/components/payment-service.md'])
    const content = readFileSync(join(root, result.updatedPaths[0]), 'utf-8')
    expect(content).toContain('## Implementation status')
    expect(content).toContain('Recent task: change payment retry behavior')
    expect(content).toContain('Touchpoints: `src/payment.ts`')
  })

  it('replaces its managed status instead of accumulating task history', async () => {
    const service = new KnowledgeSyncService(root, new KnowledgeEngine(root))
    const firstBefore = await service.snapshot()
    write('src/payment.ts', 'export const retry = true\n')
    const first = await service.review('first payment task', firstBefore)
    await service.apply(first!.id, [first!.proposals[0].id])

    const secondBefore = await service.snapshot()
    write('src/payment.ts', 'export const retry = false\nexport const timeout = 30\n')
    const second = await service.review('second payment task', secondBefore)
    await service.apply(second!.id, [second!.proposals[0].id])

    const content = readFileSync(join(root, '.woo/knowledge/components/payment-service.md'), 'utf-8')
    expect(content.match(/## Implementation status/g)).toHaveLength(1)
    expect(content.match(/<!-- woo-sync:start -->/g)).toHaveLength(1)
    expect(content).not.toContain('first payment task')
    expect(content).toContain('second payment task')
    expect(second!.proposals[0].tokenDeltaEstimate).toBeLessThanOrEqual(0)
  })

  it('migrates the previous append-only implementation history', async () => {
    write(
      '.woo/knowledge/components/payment-service.md',
      `---
title: Payment Service
type: component
description: Handles payment authorization and retry behavior.
---
The payment service is implemented in src/payment.ts.

## Implementation history

- 2026-08-01: old task Changed: \`src/payment.ts\`.
`
    )
    const service = new KnowledgeSyncService(root, new KnowledgeEngine(root))
    const before = await service.snapshot()
    write('src/payment.ts', 'export const retry = true\n')
    const review = await service.review('current payment task', before)
    await service.apply(review!.id, [review!.proposals[0].id])

    const content = readFileSync(join(root, '.woo/knowledge/components/payment-service.md'), 'utf-8')
    expect(content).not.toContain('## Implementation history')
    expect(content).not.toContain('old task')
    expect(content).toContain('Recent task: current payment task')
  })

  it('keeps status in one document and proposes removal of relevant duplicates', async () => {
    write(
      '.woo/knowledge/components/payment-service.md',
      `---
title: Payment Service
type: component
description: Handles payment authorization and retry behavior.
---
The payment service is implemented in src/payment.ts.

## Implementation history

- 2026-08-01: duplicated old payment task Changed: \`src/payment.ts\`.
`
    )
    write(
      '.woo/knowledge/rules/payment-retry.md',
      `---
title: Payment Retry Rule
type: business-rule
description: Defines payment retry behavior in src/payment.ts.
---
Retry failed payments safely.

## Implementation history

- 2026-08-01: duplicated old payment task Changed: \`src/payment.ts\`.
`
    )
    const service = new KnowledgeSyncService(root, new KnowledgeEngine(root))
    const before = await service.snapshot()
    write('src/payment.ts', 'export const retry = true\n')
    const review = await service.review('change payment retry behavior', before)

    const cleanup = review!.proposals.find((proposal) => proposal.diff.includes('consolidate duplicate status'))
    expect(cleanup?.diff).toContain('consolidate duplicate status')
    await service.apply(review!.id, review!.proposals.map((proposal) => proposal.id))

    const primary = readFileSync(join(root, '.woo/knowledge/components/payment-service.md'), 'utf-8')
    const secondary = readFileSync(join(root, '.woo/knowledge/rules/payment-retry.md'), 'utf-8')
    expect(`${primary}\n${secondary}`.match(/## Implementation status/g)).toHaveLength(1)
    expect(primary).not.toContain('## Implementation history')
    expect(secondary).not.toContain('## Implementation history')
  })

  it('never snapshots secret files or dependency output', async () => {
    write('.env', 'TOKEN=do-not-read')
    write('node_modules/pkg/index.js', 'generated')
    const service = new KnowledgeSyncService(root, new KnowledgeEngine(root))

    const snapshot = await service.snapshot()

    expect(snapshot.has('.env')).toBe(false)
    expect(snapshot.has('node_modules/pkg/index.js')).toBe(false)
    expect(snapshot.has('src/payment.ts')).toBe(true)
  })

  it('refuses to overwrite a knowledge document changed after review', async () => {
    const service = new KnowledgeSyncService(root, new KnowledgeEngine(root))
    const before = await service.snapshot()
    write('src/payment.ts', 'export const retry = true\n')
    const review = await service.review('change payment retry behavior', before)
    write('.woo/knowledge/components/payment-service.md', 'changed by developer\n')

    await expect(service.apply(review!.id, [review!.proposals[0].id])).rejects.toThrow(
      'changed after the preview'
    )
  })
})
