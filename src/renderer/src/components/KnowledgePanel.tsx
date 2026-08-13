import { useState } from 'react'
import type { KnowledgeStatus } from '../../../shared/types'

const TYPE_ORDER = [
  'Architecture Decision',
  'Domain Entity',
  'Business Rule',
  'Application Component',
  'Workflow'
]

const TYPE_ICONS: Record<string, string> = {
  'Architecture Decision': '▤',
  'Domain Entity': '◇',
  'Business Rule': '🛡',
  'Application Component': '⬡',
  Workflow: '⇶'
}

export function KnowledgePanel({
  status,
  onOpenNode,
  onInit
}: {
  status: KnowledgeStatus | null
  onOpenNode: (id: string) => void
  onInit: () => void
}) {
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  if (!status || status.documents.length === 0) {
    return (
      <div className="panel-section">
        <div className="panel-header">Project Knowledge</div>
        <div className="panel-empty">
          No project knowledge base yet.
          <br />
          <br />
          Knowledge lives as Markdown files with frontmatter in{' '}
          <code>.woo/knowledge/</code> — rules, entities, components,
          workflows, and decisions the agent retrieves before every task.
          <br />
          <br />
          <button className="btn primary" onClick={onInit}>
            Initialize project knowledge
          </button>
        </div>
      </div>
    )
  }

  const types = TYPE_ORDER.filter((t) => status.byType[t]?.length)
  const q = filter.toLowerCase()

  return (
    <div className="panel-section">
      <div className="panel-header">Project Knowledge</div>
      <input
        className="panel-filter"
        placeholder="Filter knowledge…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="panel-scroll">
        {types.map((type) => {
          const docs = (status.byType[type] ?? []).filter(
            (d) => !q || d.title.toLowerCase().includes(q)
          )
          if (!docs.length) return null
          const isCollapsed = collapsed[type]
          return (
            <div key={type}>
              <div
                className="tree-row group"
                onClick={() => setCollapsed((c) => ({ ...c, [type]: !c[type] }))}
              >
                <span className="tree-icon">{isCollapsed ? '▸' : '▾'}</span>
                <span className="tree-name">
                  {TYPE_ICONS[type]} {type}s
                </span>
              </div>
              {!isCollapsed &&
                docs.map((doc) => (
                  <div
                    key={doc.id}
                    className="tree-row"
                    style={{ paddingLeft: 28 }}
                    title={doc.description}
                    onClick={() => onOpenNode(doc.id)}
                  >
                    <span className="tree-name">{doc.title}</span>
                  </div>
                ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
