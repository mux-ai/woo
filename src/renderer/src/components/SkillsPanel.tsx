import { useCallback, useEffect, useState } from 'react'
import type { SkillProvider, SkillInfo, SkillScope } from '../../../shared/types'

const PROVIDER_TITLE: Record<SkillProvider, string> = {
  claude: 'Claude',
  codex: 'Codex'
}

const SCOPE_HINT: Record<SkillProvider, Record<SkillScope, string>> = {
  claude: {
    account: 'Connected account skills (~/.claude/skills) — auto-active in the agent',
    project: 'This workspace (.claude/skills) — shared via the repo'
  },
  codex: {
    account: 'Connected account skills (~/.codex/skills) — invoke with $name in the terminal',
    project: 'This workspace (.codex/skills) — shared via the repo'
  }
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
  const [creating, setCreating] = useState<{ provider: SkillProvider; scope: SkillScope } | null>(
    null
  )
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

  const openSkill = (skill: SkillInfo) => {
    if (skill.scope === 'project') {
      void onOpen(skill.path)
      return
    }
    // shell.openPath resolves with an error string on failure.
    void act(async () => {
      const err = await window.woo.skillsOpenExternal(skill.path)
      if (err) throw new Error(err)
    })
  }

  const create = (provider: SkillProvider, scope: SkillScope, name: string) =>
    act(async () => {
      const path = await window.woo.skillsCreate(provider, scope, name)
      onLog(`Created ${provider} ${scope} skill "${name}".`)
      if (scope === 'project') onOpen(path)
      else await window.woo.skillsOpenExternal(path)
    })

  const install = (provider: SkillProvider, scope: SkillScope) =>
    act(async () => {
      const result = await window.woo.skillsInstall(provider, scope)
      if (!result.canceled) onLog(`Installed skill into: ${result.installed.join(', ')}`)
    })

  const remove = (skill: SkillInfo) =>
    act(async () => {
      await window.woo.skillsDelete(skill.path)
      onLog(`Moved skill "${skill.name}" (${skill.provider} ${skill.scope}) to trash.`)
    })

  const renderGroup = (provider: SkillProvider, scope: SkillScope) => {
    const group = skills.filter((s) => s.provider === provider && s.scope === scope)
    const isCreating = creating?.provider === provider && creating?.scope === scope
    return (
      <div key={`${provider}-${scope}`}>
        <div className="git-group-title skill-group-title">
          <span>
            {PROVIDER_TITLE[provider]} · {scope === 'account' ? 'Account' : 'Project'}{' '}
            {group.length > 0 && <span className="count-pill">{group.length}</span>}
          </span>
          <span className="tree-actions always">
            <button
              title={`New ${provider} ${scope} skill`}
              onClick={() => setCreating({ provider, scope })}
            >
              ＋
            </button>
            <button
              title={`Install folder as ${provider} ${scope} skill`}
              onClick={() => void install(provider, scope)}
            >
              ⤓
            </button>
          </span>
        </div>
        <div className="skill-hint">{SCOPE_HINT[provider][scope]}</div>
        {isCreating && (
          <NewSkillInput
            onCancel={() => setCreating(null)}
            onCommit={(name) => {
              setCreating(null)
              void create(provider, scope, name)
            }}
          />
        )}
        {group.length === 0 && !isCreating && <div className="panel-empty">No skills.</div>}
        {group.map((skill) => (
          <div
            key={skill.path}
            className="skill-row"
            title={skill.description}
            onClick={() => openSkill(skill)}
          >
            <span className="skill-name">{skill.name}</span>
            <span className="skill-desc">{skill.description}</span>
            <span className="tree-actions">
              <button
                title="Delete (moves folder to trash)"
                onClick={(e) => {
                  e.stopPropagation()
                  if (window.confirm(`Move skill "${skill.name}" to trash?`)) {
                    void remove(skill)
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
      {error && <div className="search-error">{error}</div>}
      <div className="panel-scroll">
        {renderGroup('claude', 'account')}
        {renderGroup('claude', 'project')}
        {renderGroup('codex', 'account')}
        {renderGroup('codex', 'project')}
      </div>
      <div className="skill-footer">
        Account skills follow the signed-in CLI and apply everywhere; project skills ship
        with this repo. Neither can override the Secret Broker.
      </div>
    </div>
  )
}
