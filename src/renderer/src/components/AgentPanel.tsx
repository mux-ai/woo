import { useEffect, useState } from 'react'
import type {
  AuthProvider,
  ContextPack,
  KnowledgeSyncReview
} from '../../../shared/types'
import { AuthControls } from './AuthControls'

/**
 * Trimmed right-side agent panel — account connect/status, retrieved
 * context pack, pin control, and knowledge-sync review. The task input
 * lives in the bottom AGENT tab (AgentChatTab) and the drafted plan lives
 * in a virtual editor tab (AgentTaskView); this panel no longer owns
 * either — see App.tsx.
 */
export function AgentPanel({
  width,
  running,
  planning,
  provider,
  pack,
  syncReview,
  pinned,
  onTogglePin,
  onApplyKnowledgeSync,
  onDismissKnowledgeSync,
  onViewContext
}: {
  width: number
  running: boolean
  planning: boolean
  provider: AuthProvider
  pack: ContextPack | null
  syncReview: KnowledgeSyncReview | null
  pinned: boolean
  onTogglePin: () => void
  onApplyKnowledgeSync: (proposalIds: string[]) => Promise<void>
  onDismissKnowledgeSync: () => void
  onViewContext: () => void
}) {
  const rules = pack?.documents.filter((d) => d.type === 'Business Rule') ?? []
  const decisions = pack?.documents.filter((d) => d.type === 'Architecture Decision') ?? []
  const others = pack?.documents.filter(
    (d) => d.type !== 'Business Rule' && d.type !== 'Architecture Decision'
  ) ?? []

  return (
    <div className="agent-panel" style={{ width }}>
      <div className="panel-header">
        Woo Agent ·{' '}
        {provider === 'claude'
          ? 'Claude'
          : provider === 'codex'
            ? 'Codex'
            : provider === 'opencode-go'
              ? 'OpenCode Go'
              : 'OpenCode'}
      </div>
      <AuthControls activeProvider={provider} disabled={running || planning} />
      <div className="security-notice">
        Data-protection default: agents cannot execute shell commands. Run commands in the
        human terminal; <code>WOO_ALLOW_AGENT_SHELL=1</code> is an explicit reduced-protection
        opt-in.
      </div>
      {(provider === 'opencode' || provider === 'opencode-go') && (
        <div className="agent-caveat">
          Reduced enforcement: opencode has no transcript-scrub hook — tool outputs are
          scrubbed at display only. Path denial, env sanitization and default-deny
          permissions still apply.
        </div>
      )}

      {pack && pack.documents.length === 0 && (
        <div className="agent-context">
          <div className="agent-badge agent-badge-muted">
            Retrieval ran — nothing in project knowledge scored relevant to this task.
          </div>
        </div>
      )}
      {pack && pack.documents.length > 0 && (
        <div className="agent-context">
          <div className="agent-context-head">
            <div className="agent-badge">✓ Retrieved relevant project knowledge before execution.</div>
            <button
              className={`pin-btn ${pinned ? 'pinned' : ''}`}
              title={pinned ? 'Unpin context (retrieve fresh next run)' : 'Pin context for next runs'}
              onClick={onTogglePin}
            >
              {pinned ? '📌 Pinned' : '📌 Pin Context'}
            </button>
          </div>
          {others.length > 0 && (
            <div className="agent-context-group">
              <div className="agent-context-title">Relevant Context</div>
              {others.map((d) => (
                <div key={d.id} className="agent-context-item">
                  {d.title}
                </div>
              ))}
            </div>
          )}
          {decisions.length > 0 && (
            <div className="agent-context-group">
              <div className="agent-context-title">Architecture</div>
              {decisions.map((d) => (
                <div key={d.id} className="agent-context-item">
                  {d.title}
                </div>
              ))}
            </div>
          )}
          {rules.length > 0 && (
            <div className="agent-context-group">
              <div className="agent-context-title">Rules</div>
              {rules.map((d) => (
                <div key={d.id} className="agent-context-item">
                  {d.title}
                </div>
              ))}
            </div>
          )}
          <div className="agent-context-meta">
            Context: ~{((pack.tokenEstimate ?? 0) / 1000).toFixed(1)}K tokens · {pack.sources.length}{' '}
            knowledge nodes
          </div>
        </div>
      )}

      {syncReview && (
        <KnowledgeSyncCard
          review={syncReview}
          onApply={onApplyKnowledgeSync}
          onDismiss={onDismissKnowledgeSync}
        />
      )}

      {!pack && !syncReview && (
        <div className="panel-empty">
          Type a task in the AGENT tab below to run the agent — retrieved project knowledge
          and knowledge-sync suggestions show up here.
        </div>
      )}

      <div className="agent-actions">
        <button className="btn" onClick={onViewContext}>
          View Context
        </button>
      </div>
    </div>
  )
}

function KnowledgeSyncCard({
  review,
  onApply,
  onDismiss
}: {
  review: KnowledgeSyncReview
  onApply: (proposalIds: string[]) => Promise<void>
  onDismiss: () => void
}) {
  const [selected, setSelected] = useState(() => new Set(review.proposals.map((proposal) => proposal.id)))
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setSelected(new Set(review.proposals.map((proposal) => proposal.id)))
    setError('')
  }, [review.id, review.proposals])

  const apply = async () => {
    setApplying(true)
    setError('')
    try {
      await onApply([...selected])
    } catch (err) {
      setError(String((err as Error).message ?? err))
      setApplying(false)
    }
  }

  return (
    <div className="knowledge-sync-card">
      <div className="knowledge-sync-title">Knowledge may need an update</div>
      <div className="knowledge-sync-summary">
        The task changed {review.changedFiles.length} file{review.changedFiles.length === 1 ? '' : 's'}.
        {review.proposals.length > 0
          ? ' Review and approve the suggested documentation changes.'
          : ' No relevant knowledge document was found; no update was generated.'}
      </div>
      <div className="knowledge-sync-files" title={review.changedFiles.join('\n')}>
        {review.changedFiles.slice(0, 5).join(', ')}
        {review.changedFiles.length > 5 ? ` (+${review.changedFiles.length - 5} more)` : ''}
      </div>
      {review.proposals.map((proposal) => (
        <label className="knowledge-sync-proposal" key={proposal.id}>
          <input
            type="checkbox"
            checked={selected.has(proposal.id)}
            onChange={(event) => {
              const next = new Set(selected)
              if (event.target.checked) next.add(proposal.id)
              else next.delete(proposal.id)
              setSelected(next)
            }}
          />
          <span className="knowledge-sync-proposal-body">
            <span className="knowledge-sync-document">{proposal.documentTitle}</span>
            <span className="knowledge-sync-path">
              {proposal.path} · {proposal.tokenDeltaEstimate > 0 ? '+' : ''}{proposal.tokenDeltaEstimate} context tokens
            </span>
            <pre className="knowledge-sync-diff">{proposal.diff}</pre>
          </span>
        </label>
      ))}
      {error && <div className="agent-error">{error}</div>}
      <div className="knowledge-sync-actions">
        {review.proposals.length > 0 && (
          <button className="btn primary" disabled={applying || selected.size === 0} onClick={() => void apply()}>
            {applying ? 'Applying…' : `Apply selected (${selected.size})`}
          </button>
        )}
        <button className="btn" disabled={applying} onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  )
}
