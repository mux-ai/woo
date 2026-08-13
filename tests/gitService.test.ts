import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, renameSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import { GitService } from '../src/main/gitService'

let root: string
let git: GitService

function sh(...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf-8' })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'woo-git-'))
  git = new GitService(root)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('GitService', () => {
  it('reports non-repo', async () => {
    const status = await git.status()
    expect(status.isRepo).toBe(false)
  })

  it('init → untracked → stage → commit → clean', async () => {
    await git.init()
    sh('config', 'user.email', 'test@example.com')
    sh('config', 'user.name', 'Test')
    writeFileSync(join(root, 'a.txt'), 'hello\n')

    let status = await git.status()
    expect(status.isRepo).toBe(true)
    expect(status.changes).toEqual([{ path: 'a.txt', status: 'U', staged: false }])

    await git.stage('a.txt')
    status = await git.status()
    expect(status.changes).toEqual([{ path: 'a.txt', status: 'A', staged: true }])

    const summary = await git.commit('feat: add a.txt')
    expect(summary).toContain('feat: add a.txt')
    status = await git.status()
    expect(status.changes).toEqual([])
  })

  it('unstage works before first commit (no HEAD)', async () => {
    await git.init()
    writeFileSync(join(root, 'a.txt'), 'hello\n')
    await git.stage('a.txt')
    await git.unstage('a.txt')
    const status = await git.status()
    expect(status.changes).toEqual([{ path: 'a.txt', status: 'U', staged: false }])
  })

  it('modified file staged and re-modified shows both sides', async () => {
    await git.init()
    sh('config', 'user.email', 'test@example.com')
    sh('config', 'user.name', 'Test')
    writeFileSync(join(root, 'a.txt'), 'one\n')
    await git.stage('a.txt')
    await git.commit('init')
    writeFileSync(join(root, 'a.txt'), 'two\n')
    await git.stage('a.txt')
    writeFileSync(join(root, 'a.txt'), 'three\n')
    const status = await git.status()
    expect(status.changes).toContainEqual({ path: 'a.txt', status: 'M', staged: true })
    expect(status.changes).toContainEqual({ path: 'a.txt', status: 'M', staged: false })
  })

  it('parses staged renames to the new path', async () => {
    await git.init()
    sh('config', 'user.email', 'test@example.com')
    sh('config', 'user.name', 'Test')
    writeFileSync(join(root, 'old.txt'), 'content stays identical\n')
    await git.stage('old.txt')
    await git.commit('init')
    renameSync(join(root, 'old.txt'), join(root, 'new.txt'))
    sh('add', '-A')
    const status = await git.status()
    expect(status.changes).toContainEqual({ path: 'new.txt', status: 'R', staged: true })
  })

  it('branch name reported', async () => {
    await git.init()
    const status = await git.status()
    expect(status.branch).toBeTruthy()
  })
})
