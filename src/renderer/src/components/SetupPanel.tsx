import type { SetupStatus } from '../../../shared/types'

export function SetupPanel({
  status,
  onRefresh,
  onInitializeKnowledge
}: {
  status: SetupStatus | null
  onRefresh: () => void
  onInitializeKnowledge: () => void
}) {
  return (
    <main className="setup-panel" aria-labelledby="setup-title">
      <div className="setup-heading">
        <div>
          <h1 id="setup-title">Developer setup</h1>
          <p>Verify the local runtime before sending project context to an agent.</p>
        </div>
        <button className="btn" onClick={onRefresh}>Refresh checks</button>
      </div>
      {!status ? (
        <p role="status">Checking this workstation…</p>
      ) : (
        <>
          <div className="setup-summary" role="status">
            {status.ready
              ? 'Ready for grounded agent tasks.'
              : 'Complete the highlighted actions before the first task.'}
          </div>
          <ol className="setup-checks">
            {status.checks.map((check) => (
              <li className={`setup-check ${check.status}`} key={check.id}>
                <span className="setup-check-mark" aria-hidden="true">
                  {check.status === 'pass' ? '✓' : check.status === 'action' ? '→' : '!'}
                </span>
                <div>
                  <strong>{check.label}</strong>
                  <p>{check.detail}</p>
                  {check.id === 'knowledge' && check.status !== 'pass' && (
                    <button className="btn primary" onClick={onInitializeKnowledge}>
                      Initialize project knowledge
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <p className="setup-footnote">
            Provider credentials remain in their CLI stores. OpenCode has reduced enforcement
            (no transcript-level output scrubbing) — the agent panel notes this whenever it's
            in use.
          </p>
        </>
      )}
    </main>
  )
}
