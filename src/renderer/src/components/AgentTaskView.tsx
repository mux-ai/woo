import type { AccountChoice } from '../../../shared/types'

/** Drafted agent plan, shown as a virtual tab in the editor area — closable
 *  like a file tab, sits alongside whatever files are open. */
export function AgentTaskView({
  planText,
  onPlanTextChange,
  editingPlan,
  onToggleEditingPlan,
  accountChoice,
  improvingPlan,
  improveError,
  canUndoImprovement,
  onImprovePlan,
  onUndoImprovement,
  onRunPlan,
  onDiscard
}: {
  planText: string
  onPlanTextChange: (value: string) => void
  editingPlan: boolean
  onToggleEditingPlan: () => void
  accountChoice: AccountChoice | null
  improvingPlan: boolean
  improveError: string | null
  canUndoImprovement: boolean
  onImprovePlan: () => void
  onUndoImprovement: () => void
  onRunPlan: () => void
  onDiscard: () => void
}) {
  const steps = planText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^\d+[.)]\s*/, ''))

  return (
    <div className="agent-task-view">
      <div className="diff-header agent-task-header">
        <span className="diff-title">Agent Task · Plan</span>
        {accountChoice && (
          <div className="agent-task-meta">
            <span className="agent-task-pill">
              <span className="agent-task-pill-label">Plan</span>
              {accountChoice.planProvider}
            </span>
            {accountChoice.planProvider !== accountChoice.executeProvider && (
              <span className="agent-task-pill">
                <span className="agent-task-pill-label">Run</span>
                {accountChoice.executeProvider}
              </span>
            )}
            <span className="agent-task-reason">{accountChoice.reason}</span>
          </div>
        )}
      </div>
      <div className="agent-task-body">
        {editingPlan ? (
          <textarea
            className="agent-plan-editor"
            value={planText}
            rows={Math.min(24, planText.split('\n').length + 2)}
            onChange={(e) => onPlanTextChange(e.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.code === 'Space') {
                event.preventDefault()
                onImprovePlan()
              }
            }}
          />
        ) : (
          <ol className="agent-plan-steps">
            {steps.map((step, i) => (
              <li key={i} className="agent-plan-step">
                <span className="agent-plan-step-num">{i + 1}</span>
                <span className="agent-plan-step-text">{step}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      {improveError && <div className="agent-plan-error" role="alert">{improveError}</div>}
      <div className="agent-plan-actions agent-task-actions">
        <button className="btn primary" disabled={improvingPlan} onClick={onRunPlan}>
          ▶ Run Plan
        </button>
        <button className="btn" disabled={improvingPlan} onClick={onToggleEditingPlan}>
          {editingPlan ? '✓ Done' : '✎ Edit Plan'}
        </button>
        <button
          className="btn"
          disabled={improvingPlan || !planText.trim()}
          title="Retrieve relevant project knowledge and revise this draft (Ctrl/Cmd+Space while editing)"
          onClick={onImprovePlan}
        >
          {improvingPlan ? '◈ Improving…' : '◈ Improve with Knowledge'}
        </button>
        {canUndoImprovement && (
          <button className="btn" disabled={improvingPlan} onClick={onUndoImprovement}>
            ↶ Undo Improvement
          </button>
        )}
        <button className="btn" disabled={improvingPlan} onClick={onDiscard}>
          ✕ Discard
        </button>
      </div>
    </div>
  )
}
