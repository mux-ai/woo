import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { KnowledgeEngine } from '../src/main/knowledge/engine'

describe('npm package boundary', () => {
  it('uses a compiled-output allowlist and ignores local secrets', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      files: string[]
      scripts: Record<string, string>
    }
    expect(packageJson.files).toEqual([
      'bin/woo.js',
      'out/**',
      'README.md',
      'LICENSE'
    ])
    expect(packageJson.scripts['package:check']).toBe('node scripts/verify-package.mjs')
    expect(packageJson.scripts['dist:dir']).toContain('scripts/package-desktop.mjs --dir')
    expect(packageJson.scripts['postinstall']).toBe('npm run native:rebuild')
    expect(readFileSync('scripts/package-desktop.mjs', 'utf8')).toContain(
      "mkdtempSync(join(tmpdir(), 'woo-package-'))"
    )

    const ignored = readFileSync('.gitignore', 'utf8').split('\n')
    expect(ignored).toEqual(expect.arrayContaining([
      '.env',
      '.env.*',
      '!.env.example',
      '.claude/settings.local.json',
      '.woo/backups/',
      '.woo/recovery/',
      '.woo/vault.enc',
      'out/',
      'release/'
    ]))
  })

  it('keeps the repository knowledge graph valid', async () => {
    expect(await new KnowledgeEngine(process.cwd()).validate()).toEqual([])
  })
})
