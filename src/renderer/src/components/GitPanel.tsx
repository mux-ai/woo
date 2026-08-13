import { useCallback, useEffect, useState } from 'react'
import type { GitLogEntry, GitStatus } from '../../../shared/types'

export function GitPanel({
  onOpen,
  onDiff
}: {
  onOpen: (path: string) => void
  onDiff: (path: string) => void
}) {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [branches, setBranches] = useState<string[]>([])
  const [history, setHistory] = useState<GitLogEntry[]>([])
  const [message, setMessage] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newBranch, setNewBranch] = useState(false)
  const [branchName, setBranchName] = useState('')

  const refresh = useCallback(async () => {
    const s = await window.woo.gitStatus()
    setStatus(s)
    if (s.isRepo) {
      const [branchList, log] = await Promise.all([
        window.woo.gitBranches(),
        window.woo.gitLog()
      ])
      setBranches(branchList)
      setHistory(log)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true)
      setFeedback(null)
      try {
        const result = await fn()
        if (typeof result === 'string' && result.trim()) setFeedback(result.trim())
      } catch (err) {
        setFeedback(String((err as Error).message ?? err))
      } finally {
        setBusy(false)
        await refresh()
      }
    },
    [refresh]
  )

  if (!status) return <div className="panel-empty">Loading git status…</div>

  if (!status.isRepo) {
    return (
      <div className="panel-section">
        <div className="panel-header">Git</div>
        <div className="panel-empty">
          This workspace is not a git repository.
          <div style={{ marginTop: 10 }}>
            <button className="btn primary" disabled={busy} onClick={() => act(() => window.woo.gitInit())}>
              Initialize repository
            </button>
          </div>
          {feedback && <div className="git-feedback">{feedback}</div>}
        </div>
      </div>
    )
  }

  const staged = status.changes.filter((c) => c.staged)
  const unstaged = status.changes.filter((c) => !c.staged)

  return (
    <div className="panel-section">
      <div className="panel-header">Git</div>

      <div className="git-branch-row">
        {newBranch ? (
          <input
            className="panel-filter git-commit-input"
            placeholder="new branch name…"
            value={branchName}
            autoFocus
            onChange={(e) => setBranchName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && branchName.trim()) {
                setNewBranch(false)
                void act(() => window.woo.gitCreateBranch(branchName.trim()))
                setBranchName('')
              }
              if (e.key === 'Escape') setNewBranch(false)
            }}
          />
        ) : (
          <select
            className="git-branch-select"
            value={status.branch ?? ''}
            disabled={busy}
            onChange={(e) => void act(() => window.woo.gitCheckout(e.target.value))}
          >
            {!branches.includes(status.branch ?? '') && (
              <option value={status.branch ?? ''}>{status.branch ?? '(no branch)'}</option>
            )}
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        )}
        <button className="git-action" title="New branch" onClick={() => setNewBranch((v) => !v)}>
          ⎇
        </button>
        <button
          className="git-action"
          title="Pull (fast-forward only)"
          disabled={busy}
          onClick={() => void act(() => window.woo.gitPull())}
        >
          ↓
        </button>
        <button
          className="git-action"
          title="Push"
          disabled={busy}
          onClick={() => void act(() => window.woo.gitPush())}
        >
          ↑
        </button>
      </div>

      <div className="git-commit-row">
        <input
          className="panel-filter git-commit-input"
          placeholder="Commit message…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button
          className="btn primary"
          disabled={busy || !message.trim() || staged.length === 0}
          onClick={() =>
            act(async () => {
              const summary = await window.woo.gitCommit(message.trim())
              setMessage('')
              return `Committed: ${summary}`
            })
          }
        >
          ✓
        </button>
      </div>
      {feedback && <div className="git-feedback">{feedback}</div>}

      <div className="panel-scroll">
        <div className="git-group-title">
          Staged {staged.length > 0 && <span className="count-pill">{staged.length}</span>}
        </div>
        {staged.length === 0 && <div className="panel-empty">Nothing staged.</div>}
        {staged.map((c) => (
          <div key={`s-${c.path}`} className="git-row" onClick={() => onDiff(c.path)}>
            <span className={`git-status git-${c.status}`}>{c.status}</span>
            <span className="git-path" title="Show diff">{c.path}</span>
            <button
              className="git-action"
              title="Open file"
              onClick={(e) => {
                e.stopPropagation()
                onOpen(c.path)
              }}
            >
              ↗
            </button>
            <button
              className="git-action"
              title="Unstage"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation()
                void act(() => window.woo.gitUnstage(c.path))
              }}
            >
              −
            </button>
          </div>
        ))}
        <div className="git-group-title">
          Changes {unstaged.length > 0 && <span className="count-pill">{unstaged.length}</span>}
        </div>
        {unstaged.length === 0 && <div className="panel-empty">Working tree clean.</div>}
        {unstaged.map((c) => (
          <div key={`w-${c.path}`} className="git-row" onClick={() => onDiff(c.path)}>
            <span className={`git-status git-${c.status}`}>{c.status}</span>
            <span className="git-path" title="Show diff">{c.path}</span>
            <button
              className="git-action"
              title="Open file"
              onClick={(e) => {
                e.stopPropagation()
                onOpen(c.path)
              }}
            >
              ↗
            </button>
            <button
              className="git-action"
              title="Stage"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation()
                void act(() => window.woo.gitStage(c.path))
              }}
            >
              +
            </button>
          </div>
        ))}
        <div className="git-group-title">History</div>
        {history.length === 0 && <div className="panel-empty">No commits yet.</div>}
        {history.map((entry) => (
          <div key={entry.hash} className="git-log-row" title={`${entry.author} · ${entry.date}`}>
            <span className="git-log-hash">{entry.hash}</span>
            <span className="git-log-subject">{entry.subject}</span>
          </div>
        ))}
      </div>
      <div className="git-footer">
        <button className="btn" disabled={busy} onClick={() => refresh()}>
          ↻ Refresh
        </button>
      </div>
    </div>
  )
}
