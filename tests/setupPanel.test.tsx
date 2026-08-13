// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SetupPanel } from '../src/renderer/src/components/SetupPanel'
import type { SetupStatus } from '../src/shared/types'
import axe from 'axe-core'

afterEach(cleanup)

describe('SetupPanel', () => {
  it('shows actionable first-run checks and initializes knowledge', () => {
    const initialize = vi.fn()
    const refresh = vi.fn()
    const status: SetupStatus = {
      ready: false,
      checks: [
        { id: 'runtime', label: 'Electron runtime', status: 'pass', detail: 'Ready.' },
        { id: 'knowledge', label: 'Project knowledge', status: 'action', detail: 'Initialize it.' }
      ]
    }
    render(
      <SetupPanel status={status} onRefresh={refresh} onInitializeKnowledge={initialize} />
    )

    expect(screen.getByRole('heading', { name: 'Developer setup' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Initialize project knowledge' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh checks' }))
    expect(initialize).toHaveBeenCalledOnce()
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('has no serious automated accessibility violations', async () => {
    const status: SetupStatus = {
      ready: true,
      checks: [
        { id: 'runtime', label: 'Electron runtime', status: 'pass', detail: 'Ready.' },
        { id: 'provider', label: 'Agent account', status: 'pass', detail: 'Codex connected.' }
      ]
    }
    render(<SetupPanel status={status} onRefresh={() => {}} onInitializeKnowledge={() => {}} />)
    const results = await axe.run(document.body, {
      rules: { 'color-contrast': { enabled: false } }
    })
    expect(results.violations.filter((violation) =>
      violation.impact === 'critical' || violation.impact === 'serious'
    )).toEqual([])
  })
})
