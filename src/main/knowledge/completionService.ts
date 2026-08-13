import type {
  KnowledgeCompletion,
  KnowledgeCompletionRequest,
  KnowledgeDocSummary
} from '../../shared/types'
import type { KnowledgeEngine } from './engine'

const MAX_RESULTS = 20
const MAX_DOCUMENTS = 5
const MAX_BODY_CHARACTERS = 20_000
const COMMON_IDENTIFIERS = new Set([
  'const', 'else', 'false', 'function', 'import', 'interface', 'return', 'string',
  'true', 'type', 'undefined', 'export', 'class', 'async', 'await', 'public',
  'private', 'protected', 'static', 'extends', 'implements', 'new', 'null', 'void'
])

function normalizeCandidate(raw: string): string | null {
  const value = raw.trim().replace(/[;,]$/, '')
  if (value.length < 2 || value.length > 120 || /\s{2,}|[\r\n]/.test(value)) return null
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\([^)]{0,40}\))?$/.test(value)) {
    return value
  }
  if (/^(?:\.?\.?\/|~\/|[A-Za-z0-9_$@-]+\/)[A-Za-z0-9_$@./-]+$/.test(value)) {
    return value
  }
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(value)) return value
  return null
}

function identifiersFromCodeBlocks(body: string): string[] {
  const values: string[] = []
  for (const block of body.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    for (const match of block[1].matchAll(/\b[A-Za-z_$][A-Za-z0-9_$]{2,}(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*\b/g)) {
      if (!COMMON_IDENTIFIERS.has(match[0])) values.push(match[0])
    }
  }
  return values
}

export function extractKnowledgeCompletions(
  document: KnowledgeDocSummary,
  body: string,
  prefix = ''
): KnowledgeCompletion[] {
  const raw = [
    ...[...body.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]),
    ...identifiersFromCodeBlocks(body)
  ]
  const normalizedPrefix = prefix.toLowerCase()
  const seen = new Set<string>()
  const completions: KnowledgeCompletion[] = []
  for (const candidate of raw) {
    const value = normalizeCandidate(candidate)
    if (!value || seen.has(value)) continue
    if (normalizedPrefix && !value.toLowerCase().includes(normalizedPrefix)) continue
    seen.add(value)
    completions.push({
      label: value,
      insertText: value,
      detail: `Project knowledge · ${document.title}`,
      documentation: document.description ?? `Defined by ${document.title}.`,
      sourcePath: document.path ?? `.woo/knowledge/${document.id}.md`,
      kind: value.includes('/') ? 'path' : 'reference'
    })
  }
  return completions
}

/**
 * Local-only, deterministic completion. Retrieval and extraction never call
 * an agent provider; only explicit Monaco invocation reaches this service.
 */
export class KnowledgeCompletionService {
  constructor(private knowledge: KnowledgeEngine) {}

  async complete(request: KnowledgeCompletionRequest): Promise<KnowledgeCompletion[]> {
    const query = [request.path, request.language, ...request.terms].join(' ').slice(0, 2_000)
    const pack = await this.knowledge.retrieve(query)
    const results: KnowledgeCompletion[] = []
    const seen = new Set<string>()
    for (const summary of pack.documents.slice(0, MAX_DOCUMENTS)) {
      const document = await this.knowledge.getDocument(summary.id)
      for (const completion of extractKnowledgeCompletions(
        { ...summary, description: summary.description },
        document.content.slice(0, MAX_BODY_CHARACTERS),
        request.prefix
      )) {
        if (seen.has(completion.insertText)) continue
        seen.add(completion.insertText)
        results.push(completion)
        if (results.length >= MAX_RESULTS) return results
      }
    }
    return results
  }
}
