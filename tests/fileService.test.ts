import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FileService } from '../src/main/fileService'

let root: string
let files: FileService

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'woo-files-'))
  files = new FileService(root)
  writeFileSync(join(root, 'a.ts'), 'const apiKey = "test"\nconst Other = 1\n')
  mkdirSync(join(root, 'sub'))
  writeFileSync(join(root, 'sub', 'b.ts'), 'apikey here\nAPIKEY THERE\n')
  mkdirSync(join(root, 'node_modules', 'x'), { recursive: true })
  writeFileSync(join(root, 'node_modules', 'x', 'skip.ts'), 'apiKey ignored\n')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('FileService.search', () => {
  it('substring search is case-insensitive by default and skips ignored dirs', async () => {
    const result = await files.search('apikey')
    const filesHit = new Set(result.matches.map((m) => m.file))
    expect(filesHit).toEqual(new Set(['a.ts', 'sub/b.ts']))
    expect(result.matches.length).toBe(3)
  })

  it('case-sensitive narrows matches', async () => {
    const result = await files.search('APIKEY', { caseSensitive: true })
    expect(result.matches).toEqual([
      expect.objectContaining({ file: 'sub/b.ts', line: 2, column: 1 })
    ])
  })

  it('regex mode matches patterns', async () => {
    const result = await files.search('api[kK]ey\\b', { regex: true })
    expect(result.matches.length).toBeGreaterThan(0)
  })

  it('invalid regex returns error, not crash', async () => {
    const result = await files.search('([unclosed', { regex: true })
    expect(result.error).toMatch(/Invalid regex/)
    expect(result.matches).toEqual([])
  })

  it('plain search escapes regex metacharacters', async () => {
    writeFileSync(join(root, 'meta.ts'), 'value = a.b(c)\n')
    const result = await files.search('a.b(c)')
    expect(result.matches).toEqual([expect.objectContaining({ file: 'meta.ts', line: 1 })])
  })
})

describe('FileService.replaceAll', () => {
  it('replaces across files and reports counts', async () => {
    const result = await files.replaceAll('apikey', 'credential')
    expect(result.error).toBeUndefined()
    expect(result.files).toBe(2)
    expect(result.replacements).toBe(3)
    expect(readFileSync(join(root, 'sub', 'b.ts'), 'utf-8')).toBe(
      'credential here\ncredential THERE\n'
    )
    // ignored dirs untouched
    expect(readFileSync(join(root, 'node_modules', 'x', 'skip.ts'), 'utf-8')).toContain('apiKey')
  })

  it('regex replace supports capture groups', async () => {
    const result = await files.replaceAll('const (\\w+)', 'let $1', { regex: true, caseSensitive: true })
    expect(result.replacements).toBe(2)
    expect(readFileSync(join(root, 'a.ts'), 'utf-8')).toBe('let apiKey = "test"\nlet Other = 1\n')
  })
})

describe('FileService CRUD', () => {
  it('createFile refuses to overwrite', async () => {
    await files.createFile('fresh.ts')
    await expect(files.createFile('fresh.ts')).rejects.toThrow()
  })

  it('rename moves files', async () => {
    await files.rename('a.ts', 'renamed.ts')
    expect(readFileSync(join(root, 'renamed.ts'), 'utf-8')).toContain('apiKey')
  })

  it('rejects paths escaping the workspace', async () => {
    await expect(files.readFile('../outside.txt')).rejects.toThrow(/escapes workspace/)
  })
})
