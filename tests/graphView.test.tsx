// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GraphView } from '../src/renderer/src/components/GraphView'
import type { KnowledgeGraph, SourceGraph } from '../src/shared/types'

const graph: KnowledgeGraph = {
  nodes: [
    { id: 'components/runner', title: 'Agent Runner', type: 'Application Component', path: '.woo/knowledge/components/runner.md', layer: 'knowledge' },
    { id: 'rules/security', title: 'Security Rule', type: 'Business Rule', path: '.woo/knowledge/rules/security.md', layer: 'knowledge' }
  ],
  edges: [{ from: 'components/runner', to: 'rules/security', predicate: 'follows', layer: 'knowledge' }]
}

const sourceGraph: SourceGraph = {
  nodes: [{ id: 'code:src/index.ts', title: 'index.ts', type: 'Source File', path: 'src/index.ts', layer: 'code' }],
  edges: []
}

afterEach(cleanup)

describe('GraphView', () => {
  it('searches, inspects, and opens a knowledge node', () => {
    const onOpen = vi.fn()
    render(
      <GraphView
        graph={graph}
        sourceGraph={sourceGraph}
        focus={null}
        impact={{ contextDocumentIds: ['components/runner'], affectedDocumentIds: [], changedFiles: [] }}
        onOpen={onOpen}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('Find a node…'), { target: { value: 'security' } })
    fireEvent.keyDown(screen.getByPlaceholderText('Find a node…'), { key: 'Enter' })
    expect(screen.getByText('Relationships')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open document' }))
    expect(onOpen).toHaveBeenCalledWith('.woo/knowledge/rules/security.md')
  })

  it('keeps source imports hidden until the optional layer is enabled', () => {
    render(
      <GraphView
        graph={graph}
        sourceGraph={sourceGraph}
        focus={null}
        impact={{ contextDocumentIds: [], affectedDocumentIds: [], changedFiles: ['src/index.ts'] }}
        onOpen={() => {}}
      />
    )

    expect(screen.queryByText('index.ts')).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Source imports' }))
    expect(screen.getByText('index.ts')).toBeTruthy()
  })
})
