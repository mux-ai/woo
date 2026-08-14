import { useCallback, useEffect, useState } from 'react'
import type { SkillProvider, SkillInfo, SkillScope } from '../../../shared/types'

type SkillTarget = SkillProvider | 'both'

const SCOPE_TITLE: Record<SkillScope, string> = {
  account: 'Account',
  project: 'Project'
}

const SCOPE_HINT: Record<SkillScope, string> = {
  account:
    'Connected account skills (~/.claude/skills, ~/.codex/skills). Claude auto-invokes; Codex uses $name in the terminal.',
  project: 'This workspace (.claude/skills, .codex/skills) — shared via the repo'
}

/** One row per skill NAME; the same skill installed for both agents shows
 *  once, tagged with every provider that carries it. */
interface MergedSkill {
  name: string
  description: string
  copies: SkillInfo[]
}

function mergeByName(skills: SkillInfo[]): MergedSkill[] {
  const byName = new Map<string, MergedSkill>()
  for (const skill of skills) {
    const existing = byName.get(skill.name)
    if (existing) {
      existing.copies.push(skill)
      if (!existing.description && skill.description) existing.description = skill.description
    } else {
      byName.set(skill.name, { name: skill.name, description: skill.description, copies: [skill] })
    }
  }
  return [...byName.values()]
}

function NewSkillInput({
  onCommit,
  onCancel
}: {
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  return (
    <input
      className="panel-filter skill-name-input"
      placeholder="skill-name…"
      value={name}
      autoFocus
      onChange={(e) => setName(e.target.value)}
      onBlur={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && name.trim()) onCommit(name.trim())
        if (e.key === 'Escape') onCancel()
      }}
    />
  )
}

export function SkillsPanel({
  onOpen,
  onLog
}: {
  onOpen: (path: string) => void
  onLog: (line: string) => void
}) {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [creating, setCreating] = useState<SkillScope | null>(null)
  const [target, setTarget] = useState<SkillTarget>('claude')
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setSkills(await window.woo.skillsList())
  }, [])

  useEffect(() => {
    void refresh()
    // Project skills refresh automatically via the workspace watcher.
    // Account dirs live OUTSIDE the workspace, so external edits there are
    // not observed — the ↻ button is the refresh path for account skills.
    return window.woo.onFsChanged((paths) => {
      if (paths.some((p) => p.startsWith('.claude/skills/') || p.startsWith('.codex/skills/'))) {
        void refresh()
      }
    })
  }, [refresh])

  const act = useCallback(
    async (fn: () => Promise<void>) => {
      setError(null)
      try {
        await fn()
      } catch (err) {
        setError(String((err as Error).message ?? err))
      } finally {
        await refresh()
      }
    },
    [refresh]
  )

  const openCopy = (copy: SkillInfo) => {
    if (copy.scope === 'project') {
      void onOpen(copy.path)
      return
    }
    // shell.openPath resolves with an error string on failure.
    void act(async () => {
      const err = await window.woo.skillsOpenExternal(copy.path)
      if (err) throw new Error(err)
    })
  }

  const create = (scope: SkillScope, name: string) =>
    act(async () => {
      const providers: SkillProvider[] = target === 'both' ? ['claude', 'codex'] : [target]
      let firstPath: string | null = null
      for (const provider of providers) {
        const path = await window.woo.skillsCreate(provider, scope, name)
        firstPath = firstPath ?? path
      }
      onLog(`Created ${scope} skill "${name}" for ${providers.join(' + ')}.`)
      if (firstPath) {
        if (scope === 'project') onOpen(firstPath)
        else await window.woo.skillsOpenExternal(firstPath)
      }
    })

  const install = (scope: SkillScope) =>
    act(async () => {
      const result = await window.woo.skillsInstall(target, scope)
      if (!result.canceled) onLog(`Installed skill into: ${result.installed.join(', ')}`)
    })

  const removeAll = (merged: MergedSkill) =>
    act(async () => {
      for (const copy of merged.copies) {
        await window.woo.skillsDelete(copy.path)
      }
      onLog(
        `Moved skill "${merged.name}" (${merged.copies.map((c) => c.provider).join(', ')}) to trash.`
      )
    })

  const renderScope = (scope: SkillScope) => {
    const merged = mergeByName(skills.filter((s) => s.scope === scope)).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
    const isCreating = creating === scope
    return (
      <div key={scope}>
        <div className="git-group-title skill-group-title">
          <span>
            {SCOPE_TITLE[scope]}{' '}
            {merged.length > 0 && <span className="count-pill">{merged.length}</span>}
          </span>
          <span className="tree-actions always">
            <button title={`New ${scope} skill (target: ${target})`} onClick={() => setCreating(scope)}>
              ＋
            </button>
            <button
              title={`Install folder as ${scope} skill (target: ${target})`}
              onClick={() => void install(scope)}
            >
              ⤓
            </button>
          </span>
        </div>
        <div className="skill-hint">{SCOPE_HINT[scope]}</div>
        {isCreating && (
          <NewSkillInput
            onCancel={() => setCreating(null)}
            onCommit={(name) => {
              setCreating(null)
              void create(scope, name)
            }}
          />
        )}
        {merged.length === 0 && !isCreating && <div className="panel-empty">No skills.</div>}
        {merged.map((skill) => (
          <div
            key={skill.name}
            className="skill-row"
            title={skill.description}
            onClick={() => openCopy(skill.copies[0])}
          >
            <span className="skill-name">{skill.name}</span>
            {skill.copies.map((copy) => (
              <button
                key={copy.provider}
                className={`skill-tag skill-tag-${copy.provider}`}
                title={`Open the ${copy.provider} copy (${copy.path})`}
                onClick={(e) => {
                  e.stopPropagation()
                  openCopy(copy)
                }}
              >
                {copy.provider}
              </button>
            ))}
            <span className="skill-desc">{skill.description}</span>
            <span className="tree-actions">
              <button
                title="Delete every copy (moves folders to trash)"
                onClick={(e) => {
                  e.stopPropagation()
                  const providers = skill.copies.map((c) => c.provider).join(' + ')
                  if (window.confirm(`Move skill "${skill.name}" (${providers}) to trash?`)) {
                    void removeAll(skill)
                  }
                }}
              >
                🗑
              </button>
            </span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="panel-section">
      <div className="panel-header explorer-header">
        <span>Skills</span>
        <span className="tree-actions always">
          <button title="Refresh" onClick={() => void refresh()}>
            ↻
          </button>
        </span>
      </div>
      <div className="skill-target-row">
        <span className="skill-hint">＋ / ⤓ target:</span>
        {(['claude', 'codex', 'both'] as SkillTarget[]).map((option) => (
          <button
            key={option}
            className={`skill-target ${target === option ? 'active' : ''}`}
            onClick={() => setTarget(option)}
          >
            {option}
          </button>
        ))}
      </div>
      {error && <div className="search-error">{error}</div>}
      <div className="panel-scroll">
        {renderScope('account')}
        {renderScope('project')}
      </div>
      <div className="skill-footer">
        Account skills follow the signed-in CLI and apply everywhere; project skills ship
        with this repo. Neither can override the Secret Broker.
      </div>
    </div>
  )
}
