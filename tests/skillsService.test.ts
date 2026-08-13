import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SkillsService } from '../src/main/skillsService'

let workspace: string
let home: string
let external: string
let skills: SkillsService

function writeSkill(base: string, name: string, description: string): void {
  const dir = join(base, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\nBody.\n`)
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'woo-skills-ws-'))
  home = mkdtempSync(join(tmpdir(), 'woo-skills-home-'))
  external = mkdtempSync(join(tmpdir(), 'woo-skills-src-'))
  skills = new SkillsService(workspace, home)
})

afterEach(() => {
  for (const dir of [workspace, home, external]) rmSync(dir, { recursive: true, force: true })
})

describe('SkillsService scopes', () => {
  it('lists account (home) and project (workspace) skills for both providers', async () => {
    writeSkill(join(home, '.claude', 'skills'), 'personal-deploy', 'Account-level deploy')
    writeSkill(join(workspace, '.claude', 'skills'), 'repo-deploy', 'Project deploy')
    writeSkill(join(home, '.codex', 'skills'), 'personal-review', 'Account review')
    mkdirSync(join(home, '.claude', 'skills', 'not-a-skill'), { recursive: true })

    const list = await skills.list()
    expect(list).toContainEqual(
      expect.objectContaining({
        provider: 'claude',
        scope: 'account',
        name: 'personal-deploy',
        path: join(home, '.claude', 'skills', 'personal-deploy', 'SKILL.md')
      })
    )
    expect(list).toContainEqual(
      expect.objectContaining({
        provider: 'claude',
        scope: 'project',
        name: 'repo-deploy',
        path: '.claude/skills/repo-deploy/SKILL.md'
      })
    )
    expect(list).toContainEqual(
      expect.objectContaining({ provider: 'codex', scope: 'account', name: 'personal-review' })
    )
    expect(list.some((s) => s.name === 'not-a-skill')).toBe(false)
  })

  it('creates account skills in the home dir, project skills in the workspace', async () => {
    const accountPath = await skills.create('claude', 'account', 'acct-skill')
    expect(accountPath).toBe(join(home, '.claude', 'skills', 'acct-skill', 'SKILL.md'))
    expect(readFileSync(accountPath, 'utf-8')).toContain('name: acct-skill')

    const projectPath = await skills.create('codex', 'project', 'proj-skill')
    expect(projectPath).toBe('.codex/skills/proj-skill/SKILL.md')
    expect(existsSync(join(workspace, projectPath))).toBe(true)
  })

  it('refuses duplicates and invalid names', async () => {
    await skills.create('claude', 'account', 'dup')
    await expect(skills.create('claude', 'account', 'dup')).rejects.toThrow()
    await expect(skills.create('claude', 'project', '../evil')).rejects.toThrow(/Skill name/)
    await expect(skills.create('codex', 'account', 'has space')).rejects.toThrow(/Skill name/)
  })

  it('installs into account scope for one provider', async () => {
    writeSkill(external, 'pdf-tools', 'Work with PDFs')
    const installed = await skills.install(join(external, 'pdf-tools'), 'codex', 'account')
    expect(installed).toEqual([join(home, '.codex', 'skills', 'pdf-tools', 'SKILL.md')])
    expect(existsSync(join(home, '.codex', 'skills', 'pdf-tools', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(workspace, '.codex'))).toBe(false)
  })

  it('installs into both providers, project scope', async () => {
    writeSkill(external, 'shared', 'Shared skill')
    const installed = await skills.install(join(external, 'shared'), 'both', 'project')
    expect(installed).toEqual([
      '.claude/skills/shared/SKILL.md',
      '.codex/skills/shared/SKILL.md'
    ])
    expect(existsSync(join(workspace, '.claude', 'skills', 'shared', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(workspace, '.codex', 'skills', 'shared', 'SKILL.md'))).toBe(true)
  })

  it('rejects folders without SKILL.md', async () => {
    mkdirSync(join(external, 'plain'))
    await expect(skills.install(join(external, 'plain'), 'claude', 'account')).rejects.toThrow(
      /no SKILL\.md/
    )
  })

  it('resolveSkillFolder accepts both scopes, rejects everything else', async () => {
    await skills.create('claude', 'account', 'a-skill')
    await skills.create('claude', 'project', 'p-skill')

    expect(skills.resolveSkillFolder(join(home, '.claude/skills/a-skill/SKILL.md'))).toBe(
      join(home, '.claude', 'skills', 'a-skill')
    )
    expect(skills.resolveSkillFolder('.claude/skills/p-skill/SKILL.md')).toBe(
      join(workspace, '.claude', 'skills', 'p-skill')
    )
    expect(() => skills.resolveSkillFolder('.claude/skills')).toThrow()
    expect(() => skills.resolveSkillFolder('/etc/passwd')).toThrow()
    expect(() => skills.resolveSkillFolder('.claude/skills/../../src/x/SKILL.md')).toThrow()
    expect(() => skills.resolveSkillFolder('.claude/skills/deep/nested/SKILL.md')).toThrow()
  })
})
