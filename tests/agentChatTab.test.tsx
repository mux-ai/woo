// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentChatTab } from '../src/renderer/src/components/AgentChatTab'

afterEach(cleanup)

function renderComposer(overrides: Partial<Parameters<typeof AgentChatTab>[0]> = {}) {
  const onSubmit = vi.fn()
  const onStop = vi.fn()
  render(
    <AgentChatTab
      events={[]}
      running={false}
      planning={false}
      task="Explain this module"
      onTaskChange={() => {}}
      modelMode="auto"
      onModelModeChange={() => {}}
      estimate={null}
      onSubmit={onSubmit}
      onStop={onStop}
      {...overrides}
    />
  )
  return { onSubmit, onStop }
}

describe('AgentChatTab composer', () => {
  it('submits with Enter and keeps Shift+Enter for a newline', () => {
    const { onSubmit } = renderComposer()
    const input = screen.getByPlaceholderText(/Describe a task/)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledOnce()
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('does not submit while an IME composition is active', () => {
    const { onSubmit } = renderComposer()
    fireEvent.keyDown(screen.getByPlaceholderText(/Describe a task/), {
      key: 'Enter',
      isComposing: true
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('keeps a compact accessible send/stop fallback without a Run button', () => {
    const first = renderComposer()
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(first.onSubmit).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: /Run/ })).toBeNull()
    cleanup()

    const second = renderComposer({ running: true })
    fireEvent.click(screen.getByRole('button', { name: 'Stop agent' }))
    expect(second.onStop).toHaveBeenCalledOnce()
  })

  it('does not reserve an empty transcript before the first message', () => {
    const { container } = render(
      <AgentChatTab
        events={[]}
        running={false}
        planning={false}
        task=""
        onTaskChange={() => {}}
        modelMode="auto"
        onModelModeChange={() => {}}
        estimate={null}
        onSubmit={() => {}}
        onStop={() => {}}
      />
    )

    expect(container.querySelector('.agent-stream')).toBeNull()
  })
})
