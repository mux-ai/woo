import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pty = require('node-pty')
if (typeof pty.spawn !== 'function') throw new Error('node-pty spawn API is unavailable')

console.log('Electron-compatible node-pty native module loads successfully.')
