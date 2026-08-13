import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { GitDiff, GitFileChange, GitLogEntry, GitStatus } from '../shared/types'

/**
 * Git operations, main-process only (UI-001). Human-originated — the agent
 * has no channel into this service.
 */
export class GitService {
  constructor(private workspaceRoot: string) {}

  private run(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        args,
        {
          cwd: this.workspaceRoot,
          maxBuffer: 4 * 1024 * 1024,
          // Never hang on credential prompts — fail fast, surface stderr.
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
        },
        (err, stdout, stderr) => {
          if (err) reject(new Error(stderr.trim() || err.message))
          else resolve(stdout)
        }
      )
    })
  }

  async status(): Promise<GitStatus> {
    let out: string
    try {
      out = await this.run(['status', '--porcelain=v1', '-b'])
    } catch {
      return { isRepo: false, changes: [] }
    }
    const lines = out.split('\n').filter(Boolean)
    let branch: string | undefined
    const changes: GitFileChange[] = []
    for (const line of lines) {
      if (line.startsWith('## ')) {
        branch = line.slice(3).split('...')[0]
        continue
      }
      const index = line[0]
      const worktree = line[1]
      let path = line.slice(3).replace(/^"|"$/g, '')
      // Renames/copies list `old -> new`; the new path is the live one.
      const arrow = path.indexOf(' -> ')
      if (arrow !== -1) path = path.slice(arrow + 4).replace(/^"|"$/g, '')
      // A file can be both staged and unstaged-modified; emit one row per side.
      if (index !== ' ' && index !== '?') {
        changes.push({ path, status: index, staged: true })
      }
      if (worktree !== ' ') {
        changes.push({ path, status: worktree === '?' ? 'U' : worktree, staged: false })
      }
    }
    return { isRepo: true, branch, changes }
  }

  async init(): Promise<void> {
    await this.run(['init'])
  }

  async stage(path: string): Promise<void> {
    await this.run(['add', '--', path])
  }

  async unstage(path: string): Promise<void> {
    try {
      await this.run(['reset', 'HEAD', '--', path])
    } catch {
      // No HEAD yet (repo without commits) — drop from the index instead.
      await this.run(['rm', '--cached', '--force', '--', path])
    }
  }

  async commit(message: string): Promise<string> {
    await this.run(['commit', '-m', message])
    return (await this.run(['log', '-1', '--format=%h %s'])).trim()
  }

  /** HEAD version vs working copy for a file (untracked → empty original). */
  async diff(path: string): Promise<GitDiff> {
    let original = ''
    try {
      original = await this.run(['show', `HEAD:${path}`])
    } catch {
      // untracked or no HEAD — diff against empty
    }
    let modified = ''
    try {
      modified = await fs.readFile(join(this.workspaceRoot, path), 'utf-8')
    } catch {
      // deleted in working tree
    }
    return { path, original, modified }
  }

  async log(limit = 50): Promise<GitLogEntry[]> {
    let out: string
    try {
      out = await this.run([
        'log',
        `-n${limit}`,
        '--date=short',
        '--format=%h%x09%an%x09%ad%x09%s'
      ])
    } catch {
      return [] // no commits yet
    }
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, author, date, ...rest] = line.split('\t')
        return { hash, author, date, subject: rest.join('\t') }
      })
  }

  async branches(): Promise<string[]> {
    try {
      const out = await this.run(['branch', '--format=%(refname:short)'])
      return out.split('\n').filter(Boolean)
    } catch {
      return []
    }
  }

  async checkout(branch: string): Promise<void> {
    await this.run(['checkout', branch])
  }

  async createBranch(name: string): Promise<void> {
    await this.run(['checkout', '-b', name])
  }

  async push(): Promise<string> {
    return (await this.run(['push'])) || 'Pushed.'
  }

  async pull(): Promise<string> {
    return (await this.run(['pull', '--ff-only'])).trim() || 'Pulled.'
  }
}
