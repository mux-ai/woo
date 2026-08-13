export function StatusBar({
  errors,
  warnings,
  infos,
  knowledgeReady,
  autosave,
  onToggleAutosave
}: {
  errors: number
  warnings: number
  infos: number
  knowledgeReady: boolean
  autosave: boolean
  onToggleAutosave: () => void
}) {
  return (
    <div className="statusbar">
      <span className={`status-dot ${knowledgeReady ? 'ok' : 'off'}`} />
      <span>{knowledgeReady ? 'knowledge: ready' : 'knowledge: unavailable'}</span>
      <span className="status-diags">
        ⊗ {errors} ⚠ {warnings} ⓘ {infos}
      </span>
      <div className="status-spacer" />
      <button
        className="status-toggle"
        title="Write dirty buffers to disk after a 2s typing pause (feeds knowledge sync)"
        onClick={onToggleAutosave}
      >
        {autosave ? '● autosave' : '○ autosave off'}
      </button>
      <span>🛡 secret broker active</span>
      <span>UTF-8</span>
    </div>
  )
}
