import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const expectedAllowlist = ['bin/woo.js', 'out/**', 'README.md', 'LICENSE']

if (JSON.stringify(manifest.files) !== JSON.stringify(expectedAllowlist)) {
  process.stderr.write(
    `Unsafe package allowlist. Expected exactly: ${expectedAllowlist.join(', ')}\n`
  )
  process.exit(1)
}

for (const required of ['package.json', 'bin/woo.js', 'README.md', 'LICENSE', 'out/main/index.js']) {
  if (!existsSync(required)) {
    process.stderr.write(`Required package file is missing: ${required}\n`)
    process.exit(1)
  }
}

function fileCount(directory) {
  return readdirSync(directory, { withFileTypes: true }).reduce(
    (total, entry) => total + (entry.isDirectory() ? fileCount(join(directory, entry.name)) : 1),
    0
  )
}

const compiledFiles = fileCount('out')
if (compiledFiles === 0) {
  process.stderr.write('Compiled output is empty. Run npm run build.\n')
  process.exit(1)
}

process.stdout.write(
  `Package boundary verified: strict allowlist with ${compiledFiles} compiled files.\n`
)
