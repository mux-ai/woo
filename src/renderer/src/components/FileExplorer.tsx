import { useEffect, useState } from 'react'
import type { FileNode } from '../../../shared/types'

export interface FileOps {
  create: (path: string, type: 'file' | 'directory') => void
  rename: (from: string, to: string) => void
  remove: (path: string) => void
}

/** Inline name editor used for create + rename. */
function NameInput({
  initial,
  depth,
  onCommit,
  onCancel
}: {
  initial: string
  depth: number
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial)
  return (
    <div className="tree-row" style={{ paddingLeft: 10 + depth * 14 }}>
      <span className="tree-icon">·</span>
      <input
        className="tree-input"
        value={name}
        autoFocus
        onFocus={(e) => e.target.select()}
        onChange={(e) => setName(e.target.value)}
        onBlur={onCancel}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) onCommit(name.trim())
          if (e.key === 'Escape') onCancel()
        }}
      />
    </div>
  )
}

type Pending =
  | { kind: 'create'; parent: string; type: 'file' | 'directory' }
  | { kind: 'rename'; path: string }

function TreeNode({
  node,
  depth,
  version,
  onOpen,
  activePath,
  ops,
  pending,
  setPending
}: {
  node: FileNode
  depth: number
  version: number
  onOpen: (path: string) => void
  activePath: string | null
  ops: FileOps
  pending: Pending | null
  setPending: (p: Pending | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<FileNode[] | null>(null)
  const isDir = node.type === 'directory'
  const renaming = pending?.kind === 'rename' && pending.path === node.path
  const creatingHere = pending?.kind === 'create' && pending.parent === node.path

  // Lazy children: fetch when opened, refetch when the watcher bumps version.
  useEffect(() => {
    if (!isDir || !open) return
    let cancelled = false
    window.woo
      .filesList(node.path)
      .then((nodes) => {
        if (!cancelled) setChildren(nodes)
      })
      .catch(() => {
        if (!cancelled) setChildren([])
      })
    return () => {
      cancelled = true
    }
  }, [isDir, open, node.path, version])

  if (renaming) {
    return (
      <NameInput
        initial={node.name}
        depth={depth}
        onCancel={() => setPending(null)}
        onCommit={(name) => {
          setPending(null)
          if (name !== node.name) {
            const parent = node.path.split('/').slice(0, -1).join('/')
            ops.rename(node.path, parent ? `${parent}/${name}` : name)
          }
        }}
      />
    )
  }

  return (
    <div>
      <div
        className={`tree-row ${activePath === node.path ? 'active' : ''}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => (isDir ? setOpen((o) => !o) : onOpen(node.path))}
        role="treeitem"
        tabIndex={0}
        aria-expanded={isDir ? open : undefined}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            if (isDir) setOpen((value) => !value)
            else onOpen(node.path)
          }
        }}
      >
        <span className="tree-icon">{isDir ? (open ? '▾' : '▸') : '·'}</span>
        <span className="tree-name">{node.name}</span>
        <span className="tree-actions">
          {isDir && (
            <button
              title="New file inside"
              aria-label={`New file inside ${node.name}`}
              onClick={(e) => {
                e.stopPropagation()
                setOpen(true)
                setPending({ kind: 'create', parent: node.path, type: 'file' })
              }}
            >
              ＋
            </button>
          )}
          <button
              title="Rename"
              aria-label={`Rename ${node.name}`}
            onClick={(e) => {
              e.stopPropagation()
              setPending({ kind: 'rename', path: node.path })
            }}
          >
            ✎
          </button>
          <button
              title="Delete (moves to trash)"
              aria-label={`Delete ${node.name} (moves to trash)`}
            onClick={(e) => {
              e.stopPropagation()
              if (window.confirm(`Move ${node.path} to trash?`)) ops.remove(node.path)
            }}
          >
            🗑
          </button>
        </span>
      </div>
      {creatingHere && (
        <NameInput
          initial=""
          depth={depth + 1}
          onCancel={() => setPending(null)}
          onCommit={(name) => {
            setPending(null)
            ops.create(`${node.path}/${name}`, pending!.type)
          }}
        />
      )}
      {isDir &&
        open &&
        children?.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            version={version}
            onOpen={onOpen}
            activePath={activePath}
            ops={ops}
            pending={pending}
            setPending={setPending}
          />
        ))}
    </div>
  )
}

export function FileExplorer({
  tree,
  version,
  onOpen,
  onOpenFolder,
  activePath,
  ops
}: {
  tree: FileNode[]
  version: number
  onOpen: (path: string) => void
  onOpenFolder: () => void
  activePath: string | null
  ops: FileOps
}) {
  const [pending, setPending] = useState<Pending | null>(null)
  const creatingAtRoot = pending?.kind === 'create' && pending.parent === ''

  return (
    <div className="panel-section">
      <div className="panel-header explorer-header">
        <span>Explorer</span>
        <span className="tree-actions always">
          <button aria-label="Open folder…" title="Open folder…" onClick={onOpenFolder}>
            📂
          </button>
          <button
            title="New file"
            onClick={() => setPending({ kind: 'create', parent: '', type: 'file' })}
          >
            ＋
          </button>
          <button
            title="New folder"
            onClick={() => setPending({ kind: 'create', parent: '', type: 'directory' })}
          >
            ⊞
          </button>
        </span>
      </div>
      <div className="panel-scroll" role="tree" aria-label="Workspace files">
        {creatingAtRoot && (
          <NameInput
            initial=""
            depth={0}
            onCancel={() => setPending(null)}
            onCommit={(name) => {
              setPending(null)
              ops.create(name, pending!.type)
            }}
          />
        )}
        {tree.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            depth={0}
            version={version}
            onOpen={onOpen}
            activePath={activePath}
            ops={ops}
            pending={pending}
            setPending={setPending}
          />
        ))}
      </div>
    </div>
  )
}
