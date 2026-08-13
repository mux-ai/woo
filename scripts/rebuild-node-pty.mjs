import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rebuildNodePty } from './lib/rebuild-node-pty.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = rebuildNodePty({ targetProjectRoot: projectRoot })
console.log(`Electron-native node-pty ready: ${output}`)
