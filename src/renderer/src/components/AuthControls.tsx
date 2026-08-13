import { useCallback, useEffect, useState } from 'react'
import type { AuthProvider, AuthProviderStatus } from '../../../shared/types'

const PROVIDERS: AuthProvider[] = ['claude', 'codex', 'opencode', 'opencode-go']
const PROVIDER_NAME: Record<AuthProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
  'opencode-go': 'OpenCode Go'
}
const PROVIDER_MARK: Record<AuthProvider, string> = {
  claude: 'A',
  codex: 'C',
  opencode: 'O',
  'opencode-go': 'G'
}

export function AuthControls({
  activeProvider,
  disabled = false
}: {
  activeProvider?: AuthProvider
  disabled?: boolean
}) {
  const [statuses, setStatuses] = useState<Partial<Record<AuthProvider, AuthProviderStatus>>>({})
  const [busy, setBusy] = useState<AuthProvider | null>(null)
  const [expanded, setExpanded] = useState(false)

  const refresh = useCallback(async () => {
    const values = await window.woo.authStatus()
    setStatuses(Object.fromEntries(values.map((status) => [status.provider, status])))
  }, [])

  useEffect(() => {
    void refresh().catch(() => {})
  }, [refresh])

  const update = (status: AuthProviderStatus) => {
    setStatuses((current) => ({ ...current, [status.provider]: status }))
  }

  const login = async (provider: AuthProvider) => {
    setBusy(provider)
    try {
      update(await window.woo.authLogin(provider))
    } catch {
      update({
        provider,
        displayName: PROVIDER_NAME[provider],
        installed: true,
        authenticated: false,
        error: 'Sign-in could not be started.'
      })
    } finally {
      setBusy(null)
    }
  }

  const disconnect = async (provider: AuthProvider) => {
    const displayName = statuses[provider]?.displayName ?? provider
    if (!window.confirm(`Disconnect ${displayName} from Woo? You will stay signed in to the ${displayName} CLI.`)) return
    setBusy(provider)
    try {
      update(await window.woo.authDisconnect(provider))
    } catch {
      update({
        provider,
        displayName,
        installed: true,
        authenticated: true,
        error: `Could not disconnect ${displayName} from Woo.`
      })
    } finally {
      setBusy(null)
    }
  }

  const connected = PROVIDERS.filter((provider) => statuses[provider]?.authenticated).length
  const available = PROVIDERS.filter((provider) => statuses[provider]?.available !== false).length

  return (
    <div className={`auth-controls ${expanded ? 'expanded' : ''}`}>
      <button className="auth-summary" onClick={() => setExpanded((value) => !value)}>
        <span>Accounts</span>
        <span className="auth-summary-state">
          {connected}/{available} available connected {expanded ? '▴' : '▾'}
        </span>
      </button>
      {expanded && (
        <div className="auth-provider-list">
          {PROVIDERS.map((provider) => {
            const status = statuses[provider]
            const isBusy = busy === provider
            const displayName = status?.displayName ?? PROVIDER_NAME[provider]
            return (
              <div
                className={`auth-provider ${activeProvider === provider ? 'selected' : ''}`}
                key={provider}
              >
                <span className={`auth-provider-mark ${provider}`}>
                  {PROVIDER_MARK[provider]}
                </span>
                <div className="auth-provider-info">
                  <div className="auth-provider-name">
                    {displayName}
                    <span className={`auth-dot ${status?.authenticated ? 'connected' : ''}`} />
                  </div>
                  <div className={`auth-provider-detail ${status?.error ? 'error' : ''}`}>
                    {isBusy
                      ? 'Complete sign-in in your browser…'
                      : status == null
                        ? 'Checking…'
                        : status.error
                          ? status.error
                          : status.authenticated
                            ? (activeProvider === provider ? 'Active · ' : '') +
                              (status.account ?? status.authMethod ?? 'Connected')
                            : status.installed
                              ? 'Not connected to Woo'
                              : 'CLI not installed'}
                  </div>
                </div>
                {status?.authenticated ? (
                  <div className="auth-provider-actions">
                    <button
                      className="auth-action"
                      disabled={busy != null || disabled}
                      onClick={() => void disconnect(provider)}
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <button
                    className="auth-action primary"
                    disabled={
                      busy != null ||
                      status == null ||
                      !status.installed ||
                      status.available === false
                    }
                    onClick={() => void login(provider)}
                  >
                    {isBusy ? 'Connecting…' : 'Connect'}
                  </button>
                )}
              </div>
            )
          })}
          <div className="auth-note">
            Disconnecting affects Woo only. Your provider CLI stays signed in, and credentials
            never enter Woo's renderer.
          </div>
        </div>
      )}
    </div>
  )
}
