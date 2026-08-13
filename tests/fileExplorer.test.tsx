// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileExplorer } from '../src/renderer/src/components/FileExplorer'

afterEach(cleanup)

describe('FileExplorer', () => {
  it('delegates folder switching to the workspace session handler', () => {
    const onOpenFolder = vi.fn()
    render(
      <FileExplorer
        tree={[]}
        version={0}
        onOpen={() => {}}
        onOpenFolder={onOpenFolder}
        activePath={null}
        ops={{ create: () => {}, rename: () => {}, remove: () => {} }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open folder…' }))

    expect(onOpenFolder).toHaveBeenCalledOnce()
  })
})
