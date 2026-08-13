import { useCallback, useEffect, useState } from 'react'
import type { VaultEntry, VaultStatus } from '../../../shared/types'

/**
 * Encrypted env vault (Claypso pattern). Passphrase lives in the input
 * only for the duration of the IPC call — never in longer-lived state.
 * Values render masked; reveal is explicit and per-key.
 */
export function VaultPanel({ onLog }: { onLog: (line: string) => void }) {
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const [entries, setEntries] = useState<VaultEntry[]>([])
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')

  const refresh = useCallback(async () => {
    const s = await window.woo.vaultStatus()
    setStatus(s)
    if (s.unlocked) setEntries(await window.woo.vaultList())
    else {
      setEntries([])
      setRevealed({})
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError(null)
      try {
        await fn()
      } catch (err) {
        setError(String((err as Error).message ?? err))
      } finally {
        await refresh()
      }
    },
    [refresh]
  )

  const submitPassphrase = (mode: 'create' | 'unlock') =>
    act(async () => {
      const p = passphrase
      setPassphrase('') // out of state immediately
      if (mode === 'create') await window.woo.vaultCreate(p)
      else await window.woo.vaultUnlock(p)
      onLog(mode === 'create' ? 'Vault created.' : 'Vault unlocked.')
    })

  if (!status) return <div className="panel-empty">Loading vault…</div>

  if (!status.unlocked) {
    const mode = status.exists ? 'unlock' : 'create'
    return (
      <div className="panel-section">
        <div className="panel-header">🔒 Vault</div>
        <div className="panel-empty">
          {status.exists
            ? 'Vault is locked. Enter the passphrase to unlock.'
            : 'No vault yet. Choose a passphrase (min 12 chars) to create an encrypted vault at .woo/vault.enc — AES-256-GCM, strong scrypt-derived key, fresh salt and IV every save.'}
        </div>
        <div className="vault-pass-row">
          <input
            className="panel-filter vault-pass"
            type="password"
            placeholder="Passphrase…"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && passphrase) void submitPassphrase(mode)
            }}
          />
          <button
            className="btn primary"
            disabled={!passphrase}
            onClick={() => void submitPassphrase(mode)}
          >
            {status.exists ? 'Unlock' : 'Create'}
          </button>
          {status.exists && (
            <button
              className="btn danger"
              disabled={!passphrase}
              onClick={() => {
                if (!window.confirm('Permanently delete this encrypted vault and every entry?')) return
                void act(async () => {
                  const p = passphrase
                  setPassphrase('')
                  await window.woo.vaultDestroy(p)
                  onLog('Vault permanently deleted.')
                })
              }}
            >
              Delete vault
            </button>
          )}
        </div>
        {error && <div className="search-error">{error}</div>}
        <div className="skill-footer">
          Agent can never read the vault: values go only to the scrub set and, on request,
          the terminal shell — never into any agent environment.
        </div>
      </div>
    )
  }

  return (
    <div className="panel-section">
      <div className="panel-header explorer-header">
        <span>🔓 Vault · {status.entryCount}</span>
        <span className="tree-actions always">
          <button
            title="Apply values to terminal (restarts shell)"
            onClick={() =>
              void act(async () => {
                await window.woo.vaultApplyToTerminal()
                onLog('Vault: values applied to next terminal session (shell restarted).')
              })
            }
          >
            ⇥
          </button>
          <button
            title="Import from .env (file left untouched)"
            onClick={() =>
              void act(async () => {
                const n = await window.woo.vaultImportEnv('.env')
                onLog(`Vault: imported ${n} entr${n === 1 ? 'y' : 'ies'} from .env — delete the plaintext file yourself when ready.`)
              })
            }
          >
            ⤓
          </button>
          <button
            title="Lock vault"
            onClick={() =>
              void act(async () => {
                await window.woo.vaultLock()
                onLog('Vault locked.')
              })
            }
          >
            🔒
          </button>
        </span>
      </div>
      {error && <div className="search-error">{error}</div>}
      <div className="panel-scroll">
        {entries.length === 0 && <div className="panel-empty">Vault is empty. Add a key below or import from .env.</div>}
        {entries.map((entry) => (
          <div key={entry.key} className="vault-row">
            <span className="vault-key">{entry.key}</span>
            <span className="vault-value">{revealed[entry.key] ?? entry.masked}</span>
            <span className="tree-actions">
              <button
                title={revealed[entry.key] ? 'Hide' : 'Reveal'}
                onClick={() =>
                  void act(async () => {
                    if (revealed[entry.key]) {
                      setRevealed((r) => {
                        const next = { ...r }
                        delete next[entry.key]
                        return next
                      })
                    } else {
                      const value = await window.woo.vaultGet(entry.key)
                      setRevealed((r) => ({ ...r, [entry.key]: value }))
                    }
                  })
                }
              >
                👁
              </button>
              <button
                title="Delete"
                onClick={() => {
                  if (window.confirm(`Delete ${entry.key} from the vault?`)) {
                    void act(() => window.woo.vaultDelete(entry.key))
                  }
                }}
              >
                🗑
              </button>
            </span>
          </div>
        ))}
      </div>
      <div className="vault-add-row">
        <input
          className="panel-filter vault-add-key"
          placeholder="KEY"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
        />
        <input
          className="panel-filter vault-add-value"
          type="password"
          placeholder="value"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
        />
        <button
          className="btn"
          disabled={!newKey.trim() || !newValue}
          onClick={() =>
            void act(async () => {
              await window.woo.vaultSet(newKey.trim(), newValue)
              setNewKey('')
              setNewValue('')
            })
          }
        >
          ＋
        </button>
      </div>
      <div className="skill-footer">
        Values are scrub-registered the moment they exist — even a leak through agent
        output renders as &lt;concealed&gt;. Terminal injection applies on next shell.
      </div>
    </div>
  )
}
