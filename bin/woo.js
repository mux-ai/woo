#!/usr/bin/env node
/**
 * Shell launcher: `woo [dir]` opens Woo Studio on a workspace, like `code .`.
 * Wire it up once with `npm link` (or a global install when packaging lands).
 */
const { spawn } = require('child_process')
const { existsSync, statSync } = require('fs')
const { resolve, dirname, join } = require('path')

const appRoot = join(__dirname, '..')
const mainEntry = join(appRoot, 'out', 'main', 'index.js')

if (!existsSync(mainEntry)) {
  console.error('woo: app not built yet — run `npm run build` in ' + appRoot)
  process.exit(1)
}

let electron
try {
  // Resolves to the electron binary path string.
  electron = require(join(appRoot, 'node_modules', 'electron'))
} catch {
  console.error('woo: electron not installed — run `npm install` in ' + appRoot)
  process.exit(1)
}

const arg = process.argv[2] ?? '.'
let workspace = resolve(process.cwd(), arg)
let openFile = ''
if (existsSync(workspace) && statSync(workspace).isFile()) {
  // `woo some/file.ts` — VS Code style: open the file's directory as the
  // workspace and the file itself in the editor.
  openFile = workspace
  workspace = dirname(workspace)
}
if (!existsSync(workspace)) {
  console.error(`woo: no such directory: ${workspace}`)
  process.exit(1)
}

const env = { ...process.env, WOO_WORKSPACE: workspace }
if (openFile) env.WOO_OPEN_FILE = openFile.slice(workspace.length + 1)

const child = spawn(electron, [appRoot], {
  env,
  detached: true,
  stdio: 'ignore'
})
child.unref()
console.log(`woo: opening ${workspace}`)
