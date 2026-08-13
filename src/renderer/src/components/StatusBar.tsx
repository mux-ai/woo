export function StatusBar({
  errors,
  warnings,
  infos,
  knowledgeReady
}: {
  errors: number
  warnings: number
  infos: number
  knowledgeReady: boolean
}) {
  return (
    <div className="statusbar">
      <span className={`status-dot ${knowledgeReady ? 'ok' : 'off'}`} />
      <span>{knowledgeReady ? 'knowledge: ready' : 'knowledge: unavailable'}</span>
      <span className="status-diags">
        ⊗ {errors} ⚠ {warnings} ⓘ {infos}
      </span>
      <div className="status-spacer" />
      <span>🛡 secret broker active</span>
      <span>UTF-8</span>
    </div>
  )
}
