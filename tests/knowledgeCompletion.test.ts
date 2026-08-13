import { describe, expect, it, vi } from 'vitest'
import {
  extractKnowledgeCompletions,
  KnowledgeCompletionService
} from '../src/main/knowledge/completionService'
import type { KnowledgeEngine } from '../src/main/knowledge/engine'

const summary = {
  id: 'components/secret-broker',
  title: 'Secret Broker',
  type: 'Application Component',
  description: 'Protects secret paths and values.',
  path: '.woo/knowledge/components/secret-broker.md'
}

describe('knowledge completion', () => {
  it('extracts source-attributed code references and paths', () => {
    const suggestions = extractKnowledgeCompletions(
      summary,
      'Use `checkPath(path)` before `src/main/secretBroker.ts`. Ignore `plain prose value`.'
    )

    expect(suggestions.map((item) => item.insertText)).toEqual([
      'checkPath(path)',
      'src/main/secretBroker.ts'
    ])
    expect(suggestions[0]).toMatchObject({
      detail: 'Project knowledge · Secret Broker',
      sourcePath: '.woo/knowledge/components/secret-broker.md'
    })
  })

  it('filters by prefix and de-duplicates retrieved documents', async () => {
    const retrieve = vi.fn(async () => ({ documents: [summary], context: '', sources: [], task: '', tokenEstimate: 0 }))
    const getDocument = vi.fn(async () => ({
      id: summary.id,
      title: summary.title,
      content: '`checkPath(path)` and `scrub(text)` and `checkPath(path)`'
    }))
    const service = new KnowledgeCompletionService({ retrieve, getDocument } as unknown as KnowledgeEngine)

    const suggestions = await service.complete({
      path: 'src/main/ipc.ts',
      language: 'typescript',
      prefix: 'check',
      terms: ['broker', 'path']
    })

    expect(retrieve).toHaveBeenCalledWith('src/main/ipc.ts typescript broker path')
    expect(suggestions.map((item) => item.insertText)).toEqual(['checkPath(path)'])
  })
})
