import { useEffect, useMemo, useRef, useState } from 'react'

export interface PaletteItem {
  id: string
  label: string
  hint?: string
  run: () => void
}

export function CommandPalette({
  items,
  onClose
}: {
  items: PaletteItem[]
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return items.slice(0, 50)
    // Every query token must appear somewhere in the label.
    const tokens = q.split(/\s+/)
    return items
      .filter((item) => {
        const label = item.label.toLowerCase()
        return tokens.every((t) => label.includes(t))
      })
      .slice(0, 50)
  }, [items, query])

  useEffect(() => {
    setSelected(0)
  }, [query])

  useEffect(() => {
    listRef.current
      ?.querySelector('.palette-row.selected')
      ?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const runItem = (item: PaletteItem | undefined) => {
    if (!item) return
    onClose()
    item.run()
  }

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Type a command or file name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSelected((s) => Math.min(s + 1, filtered.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSelected((s) => Math.max(s - 1, 0))
            } else if (e.key === 'Enter') {
              runItem(filtered[selected])
            }
          }}
        />
        <div className="palette-list" ref={listRef}>
          {filtered.length === 0 && <div className="panel-empty">No matches.</div>}
          {filtered.map((item, i) => (
            <div
              key={item.id}
              className={`palette-row ${i === selected ? 'selected' : ''}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => runItem(item)}
            >
              <span className="palette-label">{item.label}</span>
              {item.hint && <span className="palette-hint">{item.hint}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
