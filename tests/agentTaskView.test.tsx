// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentTaskView } from '../src/renderer/src/components/AgentTaskView'

afterEach(cleanup)

function renderPlan(overrides: Partial<Parameters<typeof AgentTaskView>[0]> = {}) {
  const onImprovePlan = vi.fn()
  const onUndoImprovement = vi.fn()
  render(
    <AgentTaskView
      planText={'1. Inspect the service\n2. Add tests'}
      onPlanTextChange={() => {}}
      editingPlan
      onToggleEditingPlan={() => {}}
      accountChoice={null}
      improvingPlan={false}
      improveError={null}
      canUndoImprovement={false}
      onImprovePlan={onImprovePlan}
      onUndoImprovement={onUndoImprovement}
      onRunPlan={() => {}}
      onDiscard={() => {}}
      {...overrides}
    />
  )
  return { onImprovePlan, onUndoImprovement }
}

describe('AgentTaskView knowledge improvement', () => {
  it('improves only after an explicit button or keyboard action', () => {
    const state = renderPlan()
    expect(state.onImprovePlan).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '◈ Improve with Knowledge' }))
    fireEvent.keyDown(screen.getByRole('textbox'), { code: 'Space', ctrlKey: true })
    expect(state.onImprovePlan).toHaveBeenCalledTimes(2)
  })

  it('locks execution while improving and exposes errors and undo', () => {
    const state = renderPlan({
      improvingPlan: true,
      improveError: 'Planner unavailable',
      canUndoImprovement: true
    })

    expect(screen.getByRole('button', { name: '▶ Run Plan' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('Planner unavailable')
    expect(
      screen.getByRole('button', { name: '↶ Undo Improvement' }).hasAttribute('disabled')
    ).toBe(true)
    expect(state.onUndoImprovement).not.toHaveBeenCalled()
  })
})
