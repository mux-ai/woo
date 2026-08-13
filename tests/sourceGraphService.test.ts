import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SourceGraphService } from '../src/main/sourceGraphService'

let root: string

function write(path: string, content: string): void {
  const absolute = join(root, path)
  mkdirSync(join(absolute, '..'), { recursive: true })
  writeFileSync(absolute, content)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'woo-source-graph-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('SourceGraphService', () => {
  it('builds a bounded graph from relative TypeScript and JavaScript imports', async () => {
    write('src/index.ts', "import { run } from './runner'\nexport { value } from './shared/value'\nrun()\n")
    write('src/runner.ts', "const value = require('./shared/value')\nexport const run = () => value\n")
    write('src/shared/value.ts', 'export const value = 1\n')

    const graph = await new SourceGraphService(root).graph()

    expect(graph.nodes).toContainEqual(expect.objectContaining({
      id: 'code:src/index.ts',
      path: 'src/index.ts',
      type: 'Source File',
      layer: 'code'
    }))
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'code:src/index.ts', to: 'code:src/runner.ts', predicate: 'imports' }),
      expect.objectContaining({ from: 'code:src/index.ts', to: 'code:src/shared/value.ts' }),
      expect.objectContaining({ from: 'code:src/runner.ts', to: 'code:src/shared/value.ts' })
    ]))
  })

  it('skips dependencies, build output, knowledge files, and package imports', async () => {
    write('src/index.ts', "import React from 'react'\n")
    write('node_modules/pkg/index.ts', "import './hidden'\n")
    write('dist/output.js', "require('./chunk')\n")
    write('.woo/knowledge/example.js', "import './hidden'\n")

    const graph = await new SourceGraphService(root).graph()

    expect(graph.nodes.map((node) => node.path)).toEqual(['src/index.ts'])
    expect(graph.edges).toEqual([])
  })
})
