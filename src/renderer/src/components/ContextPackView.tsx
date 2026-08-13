import { useMemo, useState } from 'react'
import type { ContextPack, KnowledgeDocSummary } from '../../../shared/types'

const CODE_FILE_RE = /\b[\w./-]+\.(?:ts|tsx|js|jsx|kt|py|go|rs|java|swift|rb|c|cc|cpp|h)\b/g

function Section({
  title,
  count,
  children
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  if (count === 0) return null
  return (
    <div className="context-group">
      <div className="context-group-title collapsible" onClick={() => setOpen((o) => !o)}>
        <span>
          {title} <span className="count-pill">{count}</span>
        </span>
        <span className="context-chevron">{open ? '⌃' : '⌄'}</span>
      </div>
      {open && children}
    </div>
  )
}

function DocRow({
  doc,
  pack,
  badge,
  badgeClass,
  onOpen
}: {
  doc: KnowledgeDocSummary
  pack: ContextPack
  badge: string
  badgeClass: string
  onOpen: (path: string) => void
}) {
  const source = pack.sources.find((s) => s.id === doc.id)
  return (
    <div className="context-row">
      <span className="context-row-title">
        {doc.title}
        {doc.description ? ` — ${doc.description}` : ''}
      </span>
      <span className="context-row-meta">
        {source?.seed ? 'seed' : source ? `hop ${source.distance}` : ''}
      </span>
      <span className={`context-badge ${badgeClass}`}>{badge}</span>
      {doc.path && (
        <button className="context-open" title={`Open ${doc.path}`} onClick={() => onOpen(doc.path!)}>
          ↗
        </button>
      )}
    </div>
  )
}

/** Retrieve a Context Pack for any task — no agent run needed. */
function RetrieveRow({
  initial,
  onRetrieve
}: {
  initial: string
  onRetrieve: (task: string) => void
}) {
  const [task, setTask] = useState(initial)
  return (
    <div className="context-retrieve-row">
      <input
        className="agent-input"
        placeholder="Type a task to preview its knowledge context…"
        value={task}
        onChange={(e) => setTask(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && task.trim()) onRetrieve(task.trim())
        }}
      />
      <button className="btn" disabled={!task.trim()} onClick={() => onRetrieve(task.trim())}>
        ⟲ Retrieve
      </button>
    </div>
  )
}

export function ContextPackView({
  pack,
  pinned,
  onTogglePin,
  onRefresh,
  onUse,
  onOpen
}: {
  pack: ContextPack | null
  pinned: boolean
  onTogglePin: () => void
  onRefresh: (task: string) => void
  onUse: (task: string) => void
  onOpen: (path: string) => void
}) {
  const [showRaw, setShowRaw] = useState(false)

  // Source-code files mentioned anywhere in the retrieved context — the
  // nearest honest analog of the mockup's symbol index (Woo's knowledge
  // engine indexes docs, not code symbols).
  const codeFiles = useMemo(() => {
    if (!pack) return []
    const hits = pack.context.match(CODE_FILE_RE) ?? []
    return [...new Set(hits)].filter((f) => !f.endsWith('.md')).slice(0, 20)
  }, [pack])

  if (!pack) {
    return (
      <div className="ctxpack-view">
        <div className="context-header">
          <span className="context-title">▤ Context Pack</span>
        </div>
        <RetrieveRow initial="" onRetrieve={onRefresh} />
        <div className="panel-empty">
          Type a task above to preview the knowledge context the agent would receive —
          no agent run needed. Agent runs also fill this view automatically (KNOW-001).
        </div>
      </div>
    )
  }

  if (pack.documents.length === 0) {
    return (
      <div className="ctxpack-view">
        <div className="context-header">
          <span className="context-title">▤ Context Pack</span>
        </div>
        <RetrieveRow initial={pack.task} onRetrieve={onRefresh} />
        <div className="context-task">
          Task: <em>{pack.task}</em>
        </div>
        <div className="panel-empty">
          Retrieval ran (KNOW-001), but nothing in .woo/knowledge scored relevant to this
          task. Add or link knowledge docs covering this area, then retrieve again.
        </div>
      </div>
    )
  }

  const rules = pack.documents.filter((d) => d.type === 'Business Rule')
  const decisions = pack.documents.filter((d) => d.type === 'Architecture Decision')
  const symbols = pack.documents.filter(
    (d) => d.type === 'Application Component' || d.type === 'Domain Entity'
  )
  const workflows = pack.documents.filter((d) => d.type === 'Workflow')
  const sourceDocs = pack.documents.filter((d) => d.path)

  return (
    <div className="ctxpack-view">
      <div className="context-header">
        <span className="context-title">▤ Context Pack</span>
        <div className="context-actions">
          <button className={`btn ${pinned ? 'pinned-btn' : ''}`} onClick={onTogglePin}>
            📌 {pinned ? 'Pinned' : 'Pin Context'}
          </button>
          <button className="btn" onClick={() => onRefresh(pack.task)}>
            ⟳ Refresh
          </button>
          <button className="btn" onClick={() => setShowRaw((s) => !s)}>
            {showRaw ? 'Structured' : 'Raw context'}
          </button>
          <button className="btn primary" onClick={() => onUse(pack.task)}>
            ▶ Use for Task
          </button>
        </div>
      </div>
      <RetrieveRow initial={pack.task} onRetrieve={onRefresh} />
      <div className="context-task">
        Task: <em>{pack.task}</em>
      </div>
      <div className="context-meta">
        Context: ~{(pack.tokenEstimate / 1000).toFixed(1)}K tokens · Retrieved from{' '}
        {pack.sources.length} knowledge nodes
      </div>
      {showRaw ? (
        <pre className="context-raw">{pack.context}</pre>
      ) : (
        <div className="context-groups">
          <Section title="Relevant Symbols" count={symbols.length + codeFiles.length}>
            {symbols.map((d) => (
              <DocRow
                key={d.id}
                doc={d}
                pack={pack}
                badge="Knowledge"
                badgeClass="badge-knowledge"
                onOpen={onOpen}
              />
            ))}
            {codeFiles.map((file) => (
              <div key={file} className="context-row">
                <span className="context-row-title">{file.split('/').pop()}</span>
                <span className="context-row-meta">{file}</span>
                <span className="context-badge badge-code">Source Code</span>
                <button className="context-open" title={`Open ${file}`} onClick={() => onOpen(file)}>
                  ↗
                </button>
              </div>
            ))}
          </Section>
          <Section title="Applicable Rules" count={rules.length}>
            {rules.map((d) => (
              <DocRow
                key={d.id}
                doc={d}
                pack={pack}
                badge="Woo"
                badgeClass="badge-rule"
                onOpen={onOpen}
              />
            ))}
          </Section>
          <Section title="Architecture Decisions" count={decisions.length}>
            {decisions.map((d) => (
              <DocRow
                key={d.id}
                doc={d}
                pack={pack}
                badge="Documentation"
                badgeClass="badge-doc"
                onOpen={onOpen}
              />
            ))}
          </Section>
          <Section title="Workflows" count={workflows.length}>
            {workflows.map((d) => (
              <DocRow
                key={d.id}
                doc={d}
                pack={pack}
                badge="Documentation"
                badgeClass="badge-doc"
                onOpen={onOpen}
              />
            ))}
          </Section>
          <Section title="Sources" count={sourceDocs.length}>
            {sourceDocs.map((d) => (
              <div key={d.id} className="context-row">
                <span className="context-row-title">{d.path}</span>
                <span className="context-badge badge-doc">Documentation</span>
                <button
                  className="context-open"
                  title={`Open ${d.path}`}
                  onClick={() => onOpen(d.path!)}
                >
                  ↗
                </button>
              </div>
            ))}
          </Section>
        </div>
      )}
    </div>
  )
}
