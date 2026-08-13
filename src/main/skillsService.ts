import { promises as fs } from 'fs'
import { homedir } from 'os'
import { basename, isAbsolute, join, relative, sep } from 'path'
import { splitFrontmatter } from './knowledge/loader'
import type { SkillProvider, SkillInfo, SkillInstallTarget, SkillScope } from '../shared/types'

/**
 * Skills manager for both agent ecosystems, two scopes each:
 *
 *  - account: the connected CLI's personal skills — `~/.claude/skills` /
 *    `~/.codex/skills`. These follow the signed-in account's machine setup
 *    and apply in every project.
 *  - project: workspace copies — `.claude/skills` / `.codex/skills`,
 *    shareable via the repo.
 *
 * Claude skills (both scopes) auto-load in the agent session (SDK `skills`
 * option + default setting sources). Codex skills are invoked as `$name` by
 * the Codex CLI. Skills cannot override Secret Broker enforcement; every
 * tool call they trigger still passes canUseTool + output scrubbing.
 */

const SKILL_DIR_NAME: Record<SkillProvider, string> = {
  claude: '.claude',
  codex: '.codex'
}

const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

const TEMPLATE = (name: string) => `---
name: ${name}
description: One-line description the agent uses to decide when this skill applies.
---

Step-by-step instructions for the agent when this skill is invoked.

1. Explain the first step here.
2. Add supporting files next to this SKILL.md and reference them by relative path.
`

export class SkillsService {
  constructor(
    private workspaceRoot: string,
    private homeRoot: string = homedir()
  ) {}

  private base(scope: SkillScope): string {
    return scope === 'account' ? this.homeRoot : this.workspaceRoot
  }

  /** Skills dir for a provider+scope, absolute. */
  private skillsDirAbs(provider: SkillProvider, scope: SkillScope): string {
    return join(this.base(scope), SKILL_DIR_NAME[provider], 'skills')
  }

  /**
   * Resolve a skill-relative path and guard it inside the provider's skills
   * dir for that scope — nothing outside skills dirs is ever touched.
   */
  private resolveSkillPath(provider: SkillProvider, scope: SkillScope, name: string): string {
    const dir = this.skillsDirAbs(provider, scope)
    const abs = join(dir, name)
    const rel = relative(dir, abs)
    if (!rel || rel.startsWith('..') || rel.split(sep).includes('..')) {
      throw new Error('Path escapes skills directory')
    }
    return abs
  }

  /** The path stored on SkillInfo: workspace-relative for project scope. */
  private displayPath(provider: SkillProvider, scope: SkillScope, name: string): string {
    const abs = join(this.skillsDirAbs(provider, scope), name, 'SKILL.md')
    return scope === 'project'
      ? relative(this.workspaceRoot, abs).split(sep).join('/')
      : abs
  }

  /** Absolute skill FOLDER for trash-delete, validated against known layouts. */
  resolveSkillFolder(skillMdPath: string): string {
    for (const provider of ['claude', 'codex'] as SkillProvider[]) {
      for (const scope of ['account', 'project'] as SkillScope[]) {
        const dir = this.skillsDirAbs(provider, scope)
        const abs = isAbsolute(skillMdPath)
          ? skillMdPath
          : join(this.workspaceRoot, skillMdPath)
        const rel = relative(dir, abs).split(sep).join('/')
        if (/^[^/]+\/SKILL\.md$/.test(rel)) {
          return join(dir, rel.split('/')[0])
        }
      }
    }
    throw new Error('path must be a SKILL.md inside a known skills directory')
  }

  private async listOne(provider: SkillProvider, scope: SkillScope): Promise<SkillInfo[]> {
    let entries
    try {
      entries = await fs.readdir(this.skillsDirAbs(provider, scope), { withFileTypes: true })
    } catch {
      return []
    }
    const skills: SkillInfo[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      let raw: string
      try {
        raw = await fs.readFile(
          join(this.resolveSkillPath(provider, scope, entry.name), 'SKILL.md'),
          'utf-8'
        )
      } catch {
        continue // folder without SKILL.md is not a skill
      }
      const parsed = splitFrontmatter(raw)
      skills.push({
        provider,
        scope,
        name: String(parsed?.meta?.name ?? entry.name),
        description: String(parsed?.meta?.description ?? ''),
        path: this.displayPath(provider, scope, entry.name)
      })
    }
    skills.sort((a, b) => a.name.localeCompare(b.name))
    return skills
  }

  async list(): Promise<SkillInfo[]> {
    const parts = await Promise.all(
      (['claude', 'codex'] as SkillProvider[]).flatMap((provider) =>
        (['account', 'project'] as SkillScope[]).map((scope) => this.listOne(provider, scope))
      )
    )
    return parts.flat()
  }

  private assertName(name: string): void {
    if (!SKILL_NAME.test(name)) {
      throw new Error(
        'Skill name must be letters, digits, dots, dashes or underscores (max 64 chars).'
      )
    }
  }

  /** Scaffold a new skill; returns its SKILL.md path (see displayPath). */
  async create(provider: SkillProvider, scope: SkillScope, name: string): Promise<string> {
    this.assertName(name)
    const dirAbs = this.resolveSkillPath(provider, scope, name)
    await fs.mkdir(dirAbs, { recursive: true })
    await fs.writeFile(join(dirAbs, 'SKILL.md'), TEMPLATE(name), {
      encoding: 'utf-8',
      flag: 'wx'
    })
    return this.displayPath(provider, scope, name)
  }

  /** Install a skill folder from anywhere on disk into one or both providers. */
  async install(
    sourceDirAbs: string,
    target: SkillInstallTarget,
    scope: SkillScope
  ): Promise<string[]> {
    const name = basename(sourceDirAbs)
    this.assertName(name)
    const stat = await fs.stat(sourceDirAbs)
    if (!stat.isDirectory()) throw new Error('Skill source must be a folder.')
    try {
      await fs.access(join(sourceDirAbs, 'SKILL.md'))
    } catch {
      throw new Error('Folder has no SKILL.md — not a skill.')
    }
    const providers: SkillProvider[] = target === 'both' ? ['claude', 'codex'] : [target]
    const installed: string[] = []
    for (const provider of providers) {
      await fs.cp(sourceDirAbs, this.resolveSkillPath(provider, scope, name), {
        recursive: true,
        errorOnExist: true,
        force: false
      })
      installed.push(this.displayPath(provider, scope, name))
    }
    return installed
  }
}
