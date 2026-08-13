import { useEffect, useRef } from 'react'
import type { AgentSessionEvent, ContextTokenEstimate, ModelMode } from '../../../shared/types'
import { Markdown } from './Markdown'

/** CLI-style agent chat — the AGENT tab in the bottom panel strip. Input
 *  pinned at the bottom, streaming transcript scrolls above it. */
export function AgentChatTab({
  events,
  running,
  planning,
  task,
  onTaskChange,
  modelMode,
  onModelModeChange,
  estimate,
  onSubmit,
  onStop
}: {
  events: AgentSessionEvent[]
  running: boolean
  planning: boolean
  task: string
  onTaskChange: (value: string) => void
  modelMode: ModelMode
  onModelModeChange: (value: ModelMode) => void
  estimate: ContextTokenEstimate | null
  onSubmit: () => void
  onStop: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const hasTranscript = events.length > 0 || planning

  useEffect(() => {
    const stream = scrollRef.current
    if (!stream) return
    if (typeof stream.scrollTo === 'function') stream.scrollTo({ top: stream.scrollHeight })
    else stream.scrollTop = stream.scrollHeight
  }, [events])

  return (
    <div className="agent-chat-tab">
      {hasTranscript && <div className="agent-stream" ref={scrollRef}>
        {events.map((event, i) => {
          switch (event.type) {
            case 'text':
              return (
                <div key={i} className="agent-text">
                  <Markdown text={event.text ?? ''} />
                </div>
              )
            case 'text-stream':
              return (
                <div key={i} className="agent-text">
                  <Markdown text={event.text ?? ''} />
                  <span className="agent-cursor">▍</span>
                </div>
              )
            case 'model-choice':
              return (
                <div key={i} className="agent-model-choice">
                  ◈ model: {event.text}
                </div>
              )
            case 'tool-use':
              return (
                <div key={i} className="agent-tool">
                  ⚙ {event.toolName} <span className="agent-tool-input">{event.toolInput}</span>
                </div>
              )
            case 'tool-denied':
              return (
                <div key={i} className="agent-denied">
                  🛡 {event.toolName} denied — {event.toolInput}
                </div>
              )
            case 'error':
              return (
                <div key={i} className="agent-error">
                  ✕ {event.error}
                </div>
              )
            case 'done':
              return (
                <div key={i} className="agent-done">
                  ── task finished ──
                </div>
              )
            default:
              return null
          }
        })}
        {planning && <div className="agent-tool">⚙ drafting plan…</div>}
      </div>}
      {estimate && (
        <div className="agent-token-estimate">
          Knowledge estimate: plan ~{estimate.planningTokens.toLocaleString()} + run ~{estimate.executionTokens.toLocaleString()} = ~{estimate.totalTokens.toLocaleString()} tokens · {estimate.documentCount} docs{estimate.pinned ? ' · pinned full context' : ''}
        </div>
      )}
      <div className="agent-chat-toolbar">
        <select
          className="agent-model-mode"
          title="Model routing: Auto picks light/standard/deep from task difficulty"
          value={modelMode}
          disabled={running || planning}
          onChange={(e) => onModelModeChange(e.target.value as ModelMode)}
        >
          <option value="auto">⚡ Auto</option>
          <option value="light">Light</option>
          <option value="standard">Standard</option>
          <option value="deep">Deep</option>
        </select>
        <span className="agent-submit-hint">Enter to send · Shift+Enter for newline</span>
      </div>
      <div className="agent-input-row agent-chat-input-row">
        <textarea
          className="agent-input agent-chat-textarea"
          placeholder="Describe a task…"
          rows={4}
          value={task}
          disabled={running || planning}
          onChange={(e) => onTaskChange(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              task.trim() &&
              !running &&
              !planning
            ) {
              e.preventDefault()
              onSubmit()
            }
          }}
        />
        {running ? (
          <button
            type="button"
            className="agent-send-btn stop"
            aria-label="Stop agent"
            title="Stop agent"
            onClick={onStop}
          >
            ■
          </button>
        ) : (
          <button
            type="button"
            className="agent-send-btn"
            aria-label="Send message"
            title="Send message (Enter)"
            disabled={!task.trim() || planning}
            onClick={onSubmit}
          >
            {planning ? '…' : '↑'}
          </button>
        )}
      </div>
    </div>
  )
}
