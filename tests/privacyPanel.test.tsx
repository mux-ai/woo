// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PrivacyPanel } from '../src/renderer/src/components/PrivacyPanel'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PrivacyPanel', () => {
  it('shows retention status and executes explicit deletion controls', async () => {
    const clearWorkspace = vi.fn().mockResolvedValue(undefined)
    const clearCrashes = vi.fn().mockResolvedValue(undefined)
    const privacyStatus = vi.fn().mockResolvedValue({
      backupCount: 2,
      recoverableBufferCount: 1,
      crashReportCount: 3,
      telemetryEnabled: false,
      agentShellEnabled: false
    })
    ;(window as any).woo = {
      privacyStatus,
      privacyClearWorkspaceData: clearWorkspace,
      privacyClearCrashReports: clearCrashes
    }
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<PrivacyPanel onLog={() => {}} />)
    expect(await screen.findByText(/2 rolling backup/)).toBeTruthy()
    expect(screen.getByText(/Telemetry: off/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete recovery data' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete crash reports' }))
    await waitFor(() => {
      expect(clearWorkspace).toHaveBeenCalledOnce()
      expect(clearCrashes).toHaveBeenCalledOnce()
    })
  })
})
