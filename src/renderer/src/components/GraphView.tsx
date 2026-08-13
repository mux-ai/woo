import { useEffect, useMemo, useRef, useState } from 'react'
import type { KnowledgeGraph, SourceGraph } from '../../../shared/types'

const TYPE_STYLE: Record<string, { fill: string; stroke: string; shape: 'rect' | 'diamond' }> = {
  'Application Component': { fill: '#0f2418', stroke: '#3fb950', shape: 'rect' },
  'Domain Entity': { fill: '#0d1f33', stroke: '#4493f8', shape: 'rect' },
  'Business Rule': { fill: '#2a1a05', stroke: '#d29922', shape: 'diamond' },
  'Architecture Decision': { fill: '#221436', stroke: '#ab7df8', shape: 'rect' },
  Workflow: { fill: '#2a2205', stroke: '#d4a72c', shape: 'rect' },
  'Source File': { fill: '#161b22', stroke: '#8c959f', shape: 'rect' }
}

const COLUMN_ORDER = [
  'Architecture Decision',
  'Business Rule',
  'Application Component',
  'Domain Entity',
  'Workflow'
]

const NODE_W = 190
const NODE_H = 44
const COL_GAP = 250
const ROW_GAP = 72
const CODE_ROWS_PER_COLUMN = 10

interface GraphImpact {
  contextDocumentIds: string[]
  affectedDocumentIds: string[]
  changedFiles: string[]
}

export function GraphView({
  graph,
  sourceGraph,
  focus,
  impact,
  onOpen
}: {
  graph: KnowledgeGraph | null
  sourceGraph: SourceGraph | null
  focus: string | null
  impact: GraphImpact
  onOpen: (path: string) => void
}) {
  const [zoom, setZoom] = useState(1)
  const [selected, setSelected] = useState<string | null>(focus)
  const [typeFilter, setTypeFilter] = useState<Record<string, boolean>>({})
  const [showCode, setShowCode] = useState(false)
  const [neighborhoodOnly, setNeighborhoodOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [panning, setPanning] = useState(false)
  const canvasRef = useRef<HTMLDivElement>(null)
  const panRef = useRef({ pointerId: -1, x: 0, y: 0, left: 0, top: 0 })

  useEffect(() => {
    if (focus) setSelected(focus)
  }, [focus])

  const combined = useMemo<KnowledgeGraph | null>(() => {
    if (!graph) return null
    if (!showCode || !sourceGraph) return graph
    return {
      nodes: [...graph.nodes, ...sourceGraph.nodes],
      edges: [...graph.edges, ...sourceGraph.edges]
    }
  }, [graph, showCode, sourceGraph])

  const selectedNode = combined?.nodes.find((node) => node.id === selected) ?? null
  const selectedNeighbors = useMemo(() => {
    const ids = new Set<string>()
    if (!combined || !selected || !neighborhoodOnly) return ids
    ids.add(selected)
    for (const edge of combined.edges) {
      if (edge.from === selected) ids.add(edge.to)
      if (edge.to === selected) ids.add(edge.from)
    }
    return ids
  }, [combined, neighborhoodOnly, selected])

  const layout = useMemo(() => {
    if (!combined) return null
    let visible = combined.nodes.filter((node) => typeFilter[node.type] !== false)
    if (neighborhoodOnly && selectedNeighbors.size > 0) {
      visible = visible.filter((node) => selectedNeighbors.has(node.id))
    }
    const ids = new Set(visible.map((node) => node.id))
    const positions = new Map<string, { x: number; y: number }>()
    COLUMN_ORDER.forEach((type, col) => {
      const nodes = visible.filter((node) => node.type === type)
      nodes.forEach((node, row) => {
        positions.set(node.id, { x: 60 + col * COL_GAP, y: 60 + row * ROW_GAP })
      })
    })
    const code = visible.filter((node) => node.type === 'Source File')
    code.forEach((node, index) => {
      const col = COLUMN_ORDER.length + Math.floor(index / CODE_ROWS_PER_COLUMN)
      const row = index % CODE_ROWS_PER_COLUMN
      positions.set(node.id, { x: 60 + col * COL_GAP, y: 60 + row * ROW_GAP })
    })
    const unknown = visible.filter(
      (node) => !COLUMN_ORDER.includes(node.type) && node.type !== 'Source File'
    )
    const unknownColumn = COLUMN_ORDER.length + Math.ceil(code.length / CODE_ROWS_PER_COLUMN)
    unknown.forEach((node, row) => {
      positions.set(node.id, { x: 60 + unknownColumn * COL_GAP, y: 60 + row * ROW_GAP })
    })
    const edges = combined.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to))
    const height = Math.max(...[...positions.values()].map((position) => position.y + NODE_H), 400) + 60
    const finalColumn = unknown.length > 0
      ? unknownColumn + 1
      : COLUMN_ORDER.length + Math.max(1, Math.ceil(code.length / CODE_ROWS_PER_COLUMN))
    const width = 60 + finalColumn * COL_GAP + NODE_W
    return { visible, positions, edges, width, height }
  }, [combined, neighborhoodOnly, selectedNeighbors, typeFilter])

  useEffect(() => {
    if (!selected || !layout || !canvasRef.current) return
    const position = layout.positions.get(selected)
    if (!position || typeof canvasRef.current.scrollTo !== 'function') return
    canvasRef.current.scrollTo({
      left: Math.max(0, (position.x + NODE_W / 2) * zoom - canvasRef.current.clientWidth / 2),
      top: Math.max(0, (position.y + NODE_H / 2) * zoom - canvasRef.current.clientHeight / 2),
      behavior: 'smooth'
    })
  }, [layout, selected, zoom])

  const contextIds = useMemo(() => new Set(impact.contextDocumentIds), [impact.contextDocumentIds])
  const affectedIds = useMemo(() => new Set(impact.affectedDocumentIds), [impact.affectedDocumentIds])
  const changedCodeIds = useMemo(
    () => new Set(impact.changedFiles.map((path) => `code:${path}`)),
    [impact.changedFiles]
  )
  const importantIds = useMemo(
    () => new Set([
      ...contextIds,
      ...affectedIds,
      ...(showCode ? changedCodeIds : [])
    ]),
    [affectedIds, changedCodeIds, contextIds, showCode]
  )
  const relatedToImpact = useMemo(() => {
    const ids = new Set(importantIds)
    if (!combined || importantIds.size === 0) return ids
    for (const edge of combined.edges) {
      if (importantIds.has(edge.from)) ids.add(edge.to)
      if (importantIds.has(edge.to)) ids.add(edge.from)
    }
    return ids
  }, [combined, importantIds])
  const searchTerm = search.trim().toLowerCase()
  const searchMatches = combined?.nodes.filter((node) =>
    searchTerm && `${node.title} ${node.path ?? ''} ${node.type}`.toLowerCase().includes(searchTerm)
  ) ?? []
  const searchIds = new Set(searchMatches.map((node) => node.id))
  const related = selectedNode && combined
    ? combined.edges.filter((edge) => edge.from === selectedNode.id || edge.to === selectedNode.id)
    : []

  const fitGraph = () => {
    if (!layout || !canvasRef.current) return
    const next = Math.min(
      1.5,
      Math.max(
        0.35,
        Math.min(
          (canvasRef.current.clientWidth - 24) / layout.width,
          (canvasRef.current.clientHeight - 24) / layout.height
        )
      )
    )
    setZoom(next)
    canvasRef.current.scrollTo({ top: 0, left: 0 })
  }

  const selectFirstSearchResult = () => {
    if (!searchMatches.length) return
    setSelected(searchMatches[0].id)
    if (neighborhoodOnly) setNeighborhoodOnly(false)
  }

  if (!graph || !layout || !combined) {
    return <div className="panel-empty">No knowledge graph yet — initialize project knowledge in the Knowledge tab.</div>
  }

  return (
    <div className="graph-view">
      <div className="graph-sidebar">
        <div className="panel-header">Explore</div>
        <div className="graph-search-row">
          <input
            className="graph-search"
            placeholder="Find a node…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') selectFirstSearchResult()
            }}
          />
          {searchTerm && <span className="graph-search-count">{searchMatches.length}</span>}
        </div>
        <button className="graph-side-action" disabled={!selectedNode} onClick={() => setNeighborhoodOnly((value) => !value)}>
          {neighborhoodOnly ? '✓ ' : ''}Show neighborhood only
        </button>
        <button className="graph-side-action" onClick={fitGraph}>Fit graph</button>
        <div className="inspector-section">Filters</div>
        {COLUMN_ORDER.map((type) => (
          <label key={type} className="graph-filter">
            <input
              type="checkbox"
              checked={typeFilter[type] !== false}
              onChange={(event) => setTypeFilter((current) => ({ ...current, [type]: event.target.checked }))}
            />
            {type}
          </label>
        ))}
        <label className="graph-filter graph-code-toggle">
          <input type="checkbox" checked={showCode} onChange={(event) => setShowCode(event.target.checked)} />
          Source imports
        </label>
        <div className="graph-zoom">
          <button className="btn" onClick={() => setZoom((value) => Math.max(0.35, value - 0.15))}>−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button className="btn" onClick={() => setZoom((value) => Math.min(2, value + 0.15))}>+</button>
        </div>
        <div className="graph-legend">
          <span><i className="legend-dot context" />Current context</span>
          <span><i className="legend-dot affected" />Knowledge update</span>
          <span><i className="legend-dot changed" />Changed source</span>
        </div>
      </div>
      <div
        className={`graph-canvas ${panning ? 'panning' : ''}`}
        ref={canvasRef}
        onPointerDown={(event) => {
          const target = event.target as Element
          if (target.closest('.graph-node')) return
          const canvas = event.currentTarget
          panRef.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            left: canvas.scrollLeft,
            top: canvas.scrollTop
          }
          canvas.setPointerCapture(event.pointerId)
          setPanning(true)
        }}
        onPointerMove={(event) => {
          if (!panning || panRef.current.pointerId !== event.pointerId) return
          const canvas = event.currentTarget
          canvas.scrollLeft = panRef.current.left - (event.clientX - panRef.current.x)
          canvas.scrollTop = panRef.current.top - (event.clientY - panRef.current.y)
        }}
        onPointerUp={(event) => {
          if (panRef.current.pointerId === event.pointerId) setPanning(false)
        }}
        onPointerCancel={() => setPanning(false)}
      >
        <svg width={layout.width * zoom} height={layout.height * zoom} viewBox={`0 0 ${layout.width} ${layout.height}`}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#57606a" />
            </marker>
          </defs>
          {layout.edges.map((edge, index) => {
            const from = layout.positions.get(edge.from)
            const to = layout.positions.get(edge.to)
            if (!from || !to) return null
            const x1 = from.x + NODE_W / 2
            const y1 = from.y + NODE_H / 2
            const x2 = to.x + NODE_W / 2
            const y2 = to.y + NODE_H / 2
            const mx = (x1 + x2) / 2
            const selectedEdge = !!selectedNode && (edge.from === selectedNode.id || edge.to === selectedNode.id)
            const impactEdge = importantIds.has(edge.from) || importantIds.has(edge.to)
            const dimmed = importantIds.size > 0 && !relatedToImpact.has(edge.from) && !relatedToImpact.has(edge.to)
            return (
              <g key={`${edge.from}:${edge.to}:${index}`} opacity={dimmed ? 0.15 : 1}>
                <path
                  d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={selectedEdge ? '#58a6ff' : impactEdge ? '#8c959f' : '#30363d'}
                  strokeWidth={selectedEdge ? 2.4 : impactEdge ? 1.7 : 1.2}
                  strokeDasharray={edge.layer === 'code' || edge.predicate === 'follows' || edge.predicate === 'enforced-by' ? '5 4' : undefined}
                  markerEnd="url(#arrow)"
                />
                {(edge.layer !== 'code' || selectedEdge) && (
                  <text x={mx} y={(y1 + y2) / 2 - 6} className="graph-edge-label" textAnchor="middle">{edge.predicate}</text>
                )}
              </g>
            )
          })}
          {layout.visible.map((node) => {
            const pos = layout.positions.get(node.id)
            if (!pos) return null
            const style = TYPE_STYLE[node.type] ?? { fill: '#161b22', stroke: '#57606a', shape: 'rect' as const }
            const isSelected = selectedNode?.id === node.id
            const isContext = contextIds.has(node.id)
            const isAffected = affectedIds.has(node.id)
            const isChanged = changedCodeIds.has(node.id)
            const isSearch = searchIds.has(node.id)
            const dimmed = importantIds.size > 0 && !relatedToImpact.has(node.id)
            const stroke = isSelected || isSearch
              ? '#e6edf3'
              : isAffected
                ? '#f85149'
                : isChanged
                  ? '#3fb950'
                  : isContext
                    ? '#58a6ff'
                    : style.stroke
            const strokeWidth = isSelected || isSearch || isAffected || isChanged || isContext ? 2.8 : 1.5
            return (
              <g
                key={node.id}
                transform={`translate(${pos.x}, ${pos.y})`}
                className="graph-node"
                opacity={dimmed ? 0.2 : 1}
                onClick={() => setSelected(node.id)}
                onDoubleClick={() => node.path && onOpen(node.path)}
              >
                {style.shape === 'diamond' ? (
                  <polygon points={`${NODE_W / 2},0 ${NODE_W},${NODE_H / 2} ${NODE_W / 2},${NODE_H} 0,${NODE_H / 2}`} fill={style.fill} stroke={stroke} strokeWidth={strokeWidth} />
                ) : (
                  <rect width={NODE_W} height={NODE_H} rx="8" fill={style.fill} stroke={stroke} strokeWidth={strokeWidth} />
                )}
                <text x={NODE_W / 2} y={NODE_H / 2 + 4} textAnchor="middle" className="graph-node-label">
                  {node.title.length > 24 ? node.title.slice(0, 23) + '…' : node.title}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      {selectedNode && (
        <div className="graph-inspector">
          <div className="panel-header">Inspector</div>
          <div className="inspector-title">{selectedNode.title}</div>
          <div className="inspector-type">{selectedNode.type}</div>
          {selectedNode.path && (
            <>
              <div className="inspector-path">{selectedNode.path}</div>
              <button className="btn inspector-open" onClick={() => onOpen(selectedNode.path!)}>Open document</button>
            </>
          )}
          {(contextIds.has(selectedNode.id) || affectedIds.has(selectedNode.id) || changedCodeIds.has(selectedNode.id)) && (
            <div className="inspector-impact">
              {contextIds.has(selectedNode.id) && <span>Used by current Context Pack</span>}
              {affectedIds.has(selectedNode.id) && <span>Suggested for knowledge sync</span>}
              {changedCodeIds.has(selectedNode.id) && <span>Changed by latest task</span>}
            </div>
          )}
          {affectedIds.has(selectedNode.id) && impact.changedFiles.length > 0 && (
            <>
              <div className="inspector-section">Changed files</div>
              {impact.changedFiles.slice(0, 12).map((path) => (
                <div className="inspector-rel" key={path} onClick={() => onOpen(path)}>
                  <span className="inspector-rel-target">{path}</span>
                </div>
              ))}
            </>
          )}
          <div className="inspector-section">Relationships</div>
          {related.length === 0 && <div className="panel-empty">No relationships.</div>}
          {related.map((edge, index) => {
            const otherId = edge.from === selectedNode.id ? edge.to : edge.from
            const other = combined.nodes.find((node) => node.id === otherId)
            const direction = edge.from === selectedNode.id ? edge.predicate : `${edge.predicate} (inverse)`
            return (
              <div key={`${edge.from}:${edge.to}:${index}`} className="inspector-rel" onClick={() => setSelected(otherId)}>
                <span className="inspector-rel-pred">{direction}</span>
                <span className="inspector-rel-target">{other?.title ?? otherId}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
