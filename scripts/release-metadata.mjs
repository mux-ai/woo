import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const projectRoot = resolve(import.meta.dirname, '..')
const releaseRoot = join(projectRoot, 'release')
const platform = process.argv.find((arg) => arg.startsWith('--platform='))?.slice(11)
  ?? process.platform
const sbomName = `Woo-Studio-${platform}.sbom.cdx.json`
const checksumName = `SHA256SUMS-${platform}.txt`
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const sbom = spawnSync(npmCommand, [
  'sbom',
  '--omit=dev',
  '--sbom-format=cyclonedx',
  '--sbom-type=application'
], { cwd: projectRoot, encoding: 'utf8' })

if (sbom.error) throw sbom.error
if (sbom.status !== 0) {
  process.stderr.write(sbom.stderr)
  throw new Error(`npm sbom exited with status ${sbom.status}`)
}
JSON.parse(sbom.stdout)
writeFileSync(join(releaseRoot, sbomName), sbom.stdout)

const releaseFiles = readdirSync(releaseRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((name) =>
    name === sbomName || /\.(?:AppImage|dmg|zip|exe|blockmap|yml)$/i.test(name)
  )
  .sort()

if (releaseFiles.length < 2) {
  throw new Error('No desktop release artifact was found beside the SBOM')
}

const checksums = releaseFiles.map((name) => {
  const digest = createHash('sha256').update(readFileSync(join(releaseRoot, name))).digest('hex')
  return `${digest}  ${name}`
})
writeFileSync(join(releaseRoot, checksumName), `${checksums.join('\n')}\n`)
console.log(`Release metadata written: ${sbomName}, ${checksumName}`)
