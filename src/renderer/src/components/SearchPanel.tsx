import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SearchMatch } from '../../../shared/types'

export function SearchPanel({
  onOpen,
  onLog
}: {
  onOpen: (path: string) => void
  onLog: (line: string) => void
}) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [useRegex, setUseRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [results, setResults] = useState<SearchMatch[]>([])
  const [error, setError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [searching, setSearching] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const runSearch = useCallback(async () => {
    const q = query.trim()
    if (!q) {
      setResults([])
      setError(null)
      setTruncated(false)
      return
    }
    setSearching(true)
    try {
      const result = await window.woo.searchQuery(q, { regex: useRegex, caseSensitive })
      setResults(result.matches)
      setError(result.error ?? null)
      setTruncated(result.truncated ?? false)
    } finally {
      setSearching(false)
    }
  }, [query, useRegex, caseSensitive])

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => void runSearch(), 250)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [runSearch])

  const replaceAll = async () => {
    const q = query.trim()
    if (!q) return
    if (
      !window.confirm(
        `Replace all ${results.length}${truncated ? '+' : ''} matches of "${q}" with "${replacement}"? Files change on disk.`
      )
    ) {
      return
    }
    const result = await window.woo.searchReplace(q, replacement, {
      regex: useRegex,
      caseSensitive
    })
    if (result.error) {
      setError(result.error)
      return
    }
    onLog(`Replace: ${result.replacements} replacement(s) in ${result.files} file(s).`)
    await runSearch()
  }

  const byFile = useMemo(() => {
    const map = new Map<string, SearchMatch[]>()
    for (const r of results) {
      const list = map.get(r.file) ?? []
      list.push(r)
      map.set(r.file, list)
    }
    return map
  }, [results])

  return (
    <div className="panel-section">
      <div className="panel-header">Search</div>
      <div className="search-input-row">
        <input
          className="panel-filter search-query"
          placeholder="Search workspace…"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className={`search-toggle ${useRegex ? 'on' : ''}`}
          title="Regular expression"
          onClick={() => setUseRegex((v) => !v)}
        >
          .*
        </button>
        <button
          className={`search-toggle ${caseSensitive ? 'on' : ''}`}
          title="Match case"
          onClick={() => setCaseSensitive((v) => !v)}
        >
          Aa
        </button>
      </div>
      <div className="search-input-row">
        <input
          className="panel-filter search-query"
          placeholder="Replace with…"
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
        />
        <button
          className="search-toggle"
          title="Replace all matches on disk"
          disabled={!query.trim() || results.length === 0}
          onClick={() => void replaceAll()}
        >
          ⤷
        </button>
      </div>
      {error && <div className="search-error">{error}</div>}
      {truncated && <div className="search-note">Showing first 500 matches.</div>}
      <div className="panel-scroll">
        {searching && <div className="panel-empty">Searching…</div>}
        {!searching && !error && query.trim() && results.length === 0 && (
          <div className="panel-empty">No results.</div>
        )}
        {[...byFile.entries()].map(([file, matches]) => (
          <div key={file}>
            <div className="search-file" onClick={() => onOpen(file)}>
              {file.split('/').pop()} <span className="count-pill">{matches.length}</span>
              <span className="search-file-dir">{file}</span>
            </div>
            {matches.map((m, i) => (
              <div key={i} className="search-row" onClick={() => onOpen(m.file)}>
                <span className="search-loc">{m.line}</span>
                <span className="search-preview">{m.preview}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
