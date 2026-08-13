import { useEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { AgentSessionEvent, ContextTokenEstimate, Diagnostic, ModelMode } from '../../../shared/types'
import { AgentChatTab } from './AgentChatTab'

const SEVERITY_BADGE: Record<Diagnostic['severity'], { label: string; className: string }> = {
  error: { label: 'Error', className: 'sev-error' },
  warning: { label: 'Warning', className: 'sev-warning' },
  info: { label: 'Info', className: 'sev-info' }
}

/** Real PTY terminal (node-pty in main, xterm here). The shell session
 *  lives in the main process and survives tab remounts; scrollback is
 *  replayed on start. */
function TerminalTab() {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const term = new Terminal({
      fontSize: 12.5,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      theme: {
        background: '#010409',
        foreground: '#e6edf3',
        cursor: '#4493f8',
        selectionBackground: '#1f6feb55'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()

    const offData = window.woo.onTerminalData((data) => term.write(data))
    const offExit = window.woo.onTerminalExit(() =>
      term.write('\r\n\x1b[90m── shell exited — close and reopen this tab to restart ──\x1b[0m\r\n')
    )
    const inputSub = term.onData((data) => void window.woo.terminalInput(data))
    void window.woo.terminalStart(term.cols, term.rows).then((scrollback) => {
      if (scrollback) term.write(scrollback)
    })

    const resizer = new ResizeObserver(() => {
      fit.fit()
      void window.woo.terminalResize(term.cols, term.rows)
    })
    resizer.observe(host)

    return () => {
      resizer.disconnect()
      inputSub.dispose()
      offData()
      offExit()
      term.dispose()
    }
  }, [])

  return <div className="terminal-host" ref={hostRef} />
}

export function ProblemsPanel({
  height,
  diagnostics,
  output,
  onJump,
  agentEvents,
  agentRunning,
  agentPlanning,
  agentTask,
  onAgentTaskChange,
  agentModelMode,
  onAgentModelModeChange,
  agentEstimate,
  onAgentSubmit,
  onAgentStop
}: {
  height: number
  diagnostics: Diagnostic[]
  output: string[]
  onJump: (path: string) => void
  agentEvents: AgentSessionEvent[]
  agentRunning: boolean
  agentPlanning: boolean
  agentTask: string
  onAgentTaskChange: (value: string) => void
  agentModelMode: ModelMode
  onAgentModelModeChange: (value: ModelMode) => void
  agentEstimate: ContextTokenEstimate | null
  onAgentSubmit: () => void
  onAgentStop: () => void
}) {
  const [filter, setFilter] = useState('')
  const [tab, setTab] = useState<'agent' | 'problems' | 'output' | 'terminal'>('problems')

  const grouped = useMemo(() => {
    const q = filter.toLowerCase()
    const filtered = diagnostics.filter(
      (d) => !q || d.message.toLowerCase().includes(q) || d.file.toLowerCase().includes(q)
    )
    const byFile = new Map<string, Diagnostic[]>()
    for (const d of filtered) {
      const list = byFile.get(d.file) ?? []
      list.push(d)
      byFile.set(d.file, list)
    }
    return byFile
  }, [diagnostics, filter])

  const counts = {
    error: diagnostics.filter((d) => d.severity === 'error').length,
    warning: diagnostics.filter((d) => d.severity === 'warning').length,
    info: diagnostics.filter((d) => d.severity === 'info').length
  }

  return (
    <div
      className={`problems-panel ${
        tab === 'agent' && agentEvents.length === 0 && !agentRunning && !agentPlanning
          ? 'agent-composer-empty'
          : ''
      }`}
      style={{ height }}
    >
      <div className="problems-tabs" role="tablist" aria-label="Bottom panel">
        <button
          className={tab === 'agent' ? 'active' : ''}
          role="tab"
          aria-selected={tab === 'agent'}
          onClick={() => setTab('agent')}
        >
          AGENT {agentRunning && <span className="agent-tab-live">●</span>}
        </button>
        <button
          className={tab === 'problems' ? 'active' : ''}
          role="tab"
          aria-selected={tab === 'problems'}
          onClick={() => setTab('problems')}
        >
          PROBLEMS {diagnostics.length > 0 && <span className="count-pill">{diagnostics.length}</span>}
        </button>
        <button className={tab === 'output' ? 'active' : ''} role="tab" aria-selected={tab === 'output'} onClick={() => setTab('output')}>
          OUTPUT
        </button>
        <button className={tab === 'terminal' ? 'active' : ''} role="tab" aria-selected={tab === 'terminal'} onClick={() => setTab('terminal')}>
          TERMINAL
        </button>
      </div>
      {tab === 'agent' && (
        <AgentChatTab
          events={agentEvents}
          running={agentRunning}
          planning={agentPlanning}
          task={agentTask}
          onTaskChange={onAgentTaskChange}
          modelMode={agentModelMode}
          onModelModeChange={onAgentModelModeChange}
          estimate={agentEstimate}
          onSubmit={onAgentSubmit}
          onStop={onAgentStop}
        />
      )}
      {tab === 'problems' && (
        <>
          <input
            className="panel-filter"
            placeholder="Filter problems…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="problems-list">
            {grouped.size === 0 && <div className="panel-empty">No problems detected.</div>}
            {[...grouped.entries()].map(([file, diags]) => (
              <div key={file}>
                <div className="problems-file">
                  {file.split('/').pop()} <span className="count-pill">{diags.length}</span>
                </div>
                {diags.map((d, i) => {
                  const badge = SEVERITY_BADGE[d.severity]
                  return (
                    <div
                      key={i}
                      className="problems-row"
                      role="button"
                      tabIndex={0}
                      onClick={() => onJump(d.file)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onJump(d.file)
                        }
                      }}
                    >
                      <span className={`sev-dot ${badge.className}`} aria-hidden="true" />
                      <span className="problems-message">{d.message}</span>
                      <span className="problems-loc">
                        {d.line}:{d.column}
                      </span>
                      <span className={`sev-label ${badge.className}`}>{badge.label}</span>
                      <span className="problems-source">{d.source}</span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          <div className="problems-footer">
            {counts.warning} warnings, {counts.error} errors, {counts.info} infos
          </div>
        </>
      )}
      {tab === 'output' && (
        <div className="output-list">
          {output.length === 0 && <div className="panel-empty">No output.</div>}
          {output.map((line, i) => (
            <div key={i} className="output-line">
              {line}
            </div>
          ))}
        </div>
      )}
      {tab === 'terminal' && <TerminalTab />}
    </div>
  )
}
