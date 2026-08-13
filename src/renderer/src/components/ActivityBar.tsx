export type ViewId =
  | 'explorer'
  | 'search'
  | 'git'
  | 'graph'
  | 'agent'
  | 'context'
  | 'skills'
  | 'vault'
  | 'privacy'
  | 'setup'

const ITEMS: { id: ViewId; icon: string; label: string }[] = [
  { id: 'explorer', icon: '🗀', label: 'Explorer' },
  { id: 'search', icon: '🔍', label: 'Search' },
  { id: 'git', icon: '⎇', label: 'Git' },
  { id: 'graph', icon: '◈', label: 'Knowledge' },
  { id: 'context', icon: '▤', label: 'Context' },
  { id: 'skills', icon: '⚡', label: 'Skills' },
  { id: 'vault', icon: '🔒', label: 'Vault' },
  { id: 'privacy', icon: '◉', label: 'Privacy' },
  { id: 'setup', icon: '✓', label: 'Setup' }
]

export function ActivityBar({
  view,
  onSelect,
  onToggleAgent
}: {
  view: ViewId
  onSelect: (v: ViewId) => void
  onToggleAgent: () => void
}) {
  return (
    <div className="activity-bar">
      {ITEMS.map((item) => (
        <button
          key={item.id}
          className={`activity-item ${view === item.id ? 'active' : ''}`}
          title={item.label}
          onClick={() => onSelect(item.id)}
        >
          <span className="activity-icon">{item.icon}</span>
          <span className="activity-label">{item.label}</span>
        </button>
      ))}
      <div className="activity-spacer" />
      <button className="activity-item" title="Toggle Agent Panel" onClick={onToggleAgent}>
        <span className="activity-icon">✦</span>
        <span className="activity-label">Agent</span>
      </button>
    </div>
  )
}
