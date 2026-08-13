import { useCallback, useEffect, useState } from 'react'
import type { PrivacyStatus } from '../../../shared/types'

export function PrivacyPanel({ onLog }: { onLog: (line: string) => void }) {
  const [status, setStatus] = useState<PrivacyStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setError(null)
    void window.woo.privacyStatus().then(setStatus).catch((value) => {
      setError(String((value as Error).message ?? value))
    })
  }, [])

  useEffect(refresh, [refresh])

  const clearWorkspaceData = async () => {
    if (!window.confirm('Delete all Woo backups and unsaved-buffer recovery data for this workspace?')) return
    await window.woo.privacyClearWorkspaceData()
    onLog('Privacy: local workspace backups and recovery buffers deleted.')
    refresh()
  }

  const clearCrashes = async () => {
    if (!window.confirm('Delete all local Woo crash reports?')) return
    await window.woo.privacyClearCrashReports()
    onLog('Privacy: local crash reports deleted.')
    refresh()
  }

  return (
    <main className="setup-panel" aria-labelledby="privacy-title">
      <div className="setup-heading">
        <div>
          <h1 id="privacy-title">Data and privacy</h1>
          <p>Review local retention and the boundary between Woo and agent providers.</p>
        </div>
        <button className="btn" onClick={refresh}>Refresh</button>
      </div>
      {error && <p className="search-error" role="alert">{error}</p>}
      {!status ? <p role="status">Reading local data status…</p> : (
        <div className="privacy-grid">
          <section className="privacy-card">
            <h2>Local recovery</h2>
            <p>{status.backupCount} rolling backup(s) · {status.recoverableBufferCount} unsaved buffer(s).</p>
            <p>Stored outside the repository with private operating-system permissions.</p>
            <button className="btn danger" onClick={() => void clearWorkspaceData()}>
              Delete recovery data
            </button>
          </section>
          <section className="privacy-card">
            <h2>Crash diagnostics</h2>
            <p>{status.crashReportCount} local redacted report(s), with bounded retention.</p>
            <p>Woo never uploads crash reports automatically.</p>
            <button className="btn danger" onClick={() => void clearCrashes()}>
              Delete crash reports
            </button>
          </section>
          <section className="privacy-card">
            <h2>Agent boundary</h2>
            <p>Telemetry: off. Provider credentials: retained by their CLI, not Woo.</p>
            <p>
              Agent shell: {status.agentShellEnabled ? 'explicitly enabled (reduced protection)' : 'disabled'}.
              Task text, approved context, and tool results are processed by the selected provider.
            </p>
          </section>
          <section className="privacy-card">
            <h2>Encrypted vault</h2>
            <p>Vault values stay encrypted at rest and are excluded from agents.</p>
            <p>Open Vault to remove entries or permanently delete the vault with its passphrase.</p>
          </section>
        </div>
      )}
    </main>
  )
}
