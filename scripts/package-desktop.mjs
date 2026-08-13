import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { rebuildNodePty } from './lib/rebuild-node-pty.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stagingRoot = mkdtempSync(join(tmpdir(), 'woo-package-'))
const stagingProject = join(stagingRoot, 'project')
const stagingModules = join(stagingProject, 'node_modules')
const releaseDir = join(projectRoot, 'release')
const requestedArgs = process.argv.slice(2)
const signingArgs = process.env.WOO_REQUIRE_SIGNING === '1' && process.platform !== 'linux'
  ? [
      '-c.forceCodeSigning=true',
      ...(process.platform === 'darwin' ? ['-c.mac.notarize=true'] : [])
    ]
  : []
const packageMetadata = JSON.parse(
  readFileSync(join(projectRoot, 'package.json'), 'utf8')
)
const electronVersion = packageMetadata.devDependencies?.electron

if (typeof electronVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(electronVersion)) {
  throw new Error('devDependencies.electron must be pinned to an exact version')
}

const targetArch = [
  ['--arm64', 'arm64'],
  ['--armv7l', 'arm'],
  ['--ia32', 'ia32'],
  ['--x64', 'x64']
].find(([flag]) => requestedArgs.includes(flag))?.[1] ?? process.arch
const targetPlatform = requestedArgs.includes('--mac')
  ? 'darwin'
  : requestedArgs.includes('--win')
    ? 'win32'
    : requestedArgs.includes('--linux')
      ? 'linux'
      : process.platform

// Claude and Codex don't require a separately-installed system CLI — their
// SDKs bundle a real per-platform binary via npm optionalDependencies (see
// authService.ts's bundled-binary auth fallback). Rollup inlines the SDKs'
// own JS into out/main/index.js, but their `require.resolve()` calls that
// locate these platform binaries are dynamic and stay live at runtime, so
// the actual native packages must exist on disk in the packaged app.
const CODEX_TARGET_TRIPLE = {
  linux: { x64: 'x86_64-unknown-linux-musl', arm64: 'aarch64-unknown-linux-musl' },
  darwin: { x64: 'x86_64-apple-darwin', arm64: 'aarch64-apple-darwin' },
  win32: { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' }
}
const CODEX_PLATFORM_PACKAGE = {
  'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
  'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
  'x86_64-apple-darwin': '@openai/codex-darwin-x64',
  'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
  'x86_64-pc-windows-msvc': '@openai/codex-win32-x64',
  'aarch64-pc-windows-msvc': '@openai/codex-win32-arm64'
}

function copyBundledAgentBinaries(platform, arch) {
  const claudeBase = `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`
  const claudeCandidates = platform === 'linux' ? [claudeBase, `${claudeBase}-musl`] : [claudeBase]
  const claudePackage = claudeCandidates.find((pkg) => existsSync(join(projectRoot, 'node_modules', pkg)))
  if (!claudePackage) {
    throw new Error(
      `No bundled Claude binary for ${platform}-${arch} in node_modules (tried: ${claudeCandidates.join(', ')}). ` +
        'Prebuilt binaries can only be packaged for architectures already installed on this machine — cross-arch/OS packaging needs that platform package installed first.'
    )
  }
  copy(`node_modules/${claudePackage}`)

  const targetTriple = CODEX_TARGET_TRIPLE[platform]?.[arch]
  const codexPackage = targetTriple ? CODEX_PLATFORM_PACKAGE[targetTriple] : undefined
  if (!codexPackage || !existsSync(join(projectRoot, 'node_modules', codexPackage))) {
    throw new Error(
      `No bundled Codex binary for ${platform}-${arch} in node_modules (expected ${codexPackage ?? 'unknown target triple'}). ` +
        'Prebuilt binaries can only be packaged for architectures already installed on this machine — cross-arch/OS packaging needs that platform package installed first.'
    )
  }
  copy(`node_modules/${codexPackage}`)
}

function pruneNativePackage(moduleRoot) {
  const keepAtRoot = new Set(['LICENSE', 'package.json', 'lib', 'build'])
  for (const entry of readdirSync(moduleRoot, { withFileTypes: true })) {
    if (!keepAtRoot.has(entry.name)) {
      rmSync(join(moduleRoot, entry.name), { recursive: true, force: true })
    }
  }

  const pruneRuntimeTree = (directory, keepFile) => {
    if (!existsSync(directory)) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        pruneRuntimeTree(path, keepFile)
        if (readdirSync(path).length === 0) rmSync(path, { recursive: true, force: true })
      } else if (!keepFile(entry.name)) {
        rmSync(path, { force: true })
      }
    }
  }

  pruneRuntimeTree(
    join(moduleRoot, 'lib'),
    (name) => name.endsWith('.js') && !name.endsWith('.test.js')
  )
  for (const entry of readdirSync(join(moduleRoot, 'build'), { withFileTypes: true })) {
    if (entry.name !== 'Release') {
      rmSync(join(moduleRoot, 'build', entry.name), { recursive: true, force: true })
    }
  }
  pruneRuntimeTree(
    join(moduleRoot, 'build/Release'),
    (name) => /\.(?:node|exe|dll)$/i.test(name) || name === 'spawn-helper'
  )
}

function copy(relativeSource, relativeDestination = relativeSource) {
  const source = join(projectRoot, relativeSource)
  if (!existsSync(source)) {
    throw new Error(`Required packaging input is missing: ${relativeSource}`)
  }
  cpSync(source, join(stagingProject, relativeDestination), {
    recursive: true,
    force: true
  })
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? projectRoot,
    env: options.env ?? process.env,
    stdio: 'inherit'
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${options.label ?? command} exited with status ${result.status}`)
  }
}

let succeeded = false

try {
  mkdirSync(stagingModules, { recursive: true })
  copy('package.json')
  copy('package-lock.json')
  copy('electron-builder.yml')
  copy('build/icon.png')
  copy('out')
  copy('node_modules/node-pty')
  copy('node_modules/node-addon-api')
  copy('node_modules/@anthropic-ai/claude-agent-sdk')
  copy('node_modules/@openai/codex-sdk')
  copy('node_modules/@openai/codex')
  copyBundledAgentBinaries(targetPlatform, targetArch)

  rebuildNodePty({
    targetProjectRoot: stagingProject,
    toolsProjectRoot: projectRoot,
    targetArch
  })
  pruneNativePackage(join(stagingModules, 'node-pty'))

  run(process.execPath, [
    join(projectRoot, 'node_modules/electron-builder/cli.js'),
    '--projectDir', stagingProject,
    ...requestedArgs,
    ...signingArgs,
    '-c.npmRebuild=false'
  ], { label: 'electron-builder' })

  mkdirSync(releaseDir, { recursive: true })
  const stagedRelease = join(stagingProject, 'release')
  for (const entry of readdirSync(stagedRelease, { withFileTypes: true })) {
    const source = join(stagedRelease, entry.name)
    const destination = join(releaseDir, entry.name)
    // Each target is generated and ignored. Replace it instead of merging so
    // removed runtime files cannot survive from an older package.
    rmSync(destination, { recursive: true, force: true })
    // verbatimSymlinks: macOS .app bundles are built from relative framework
    // symlinks; without it cpSync rewrites them to absolute paths inside the
    // staging directory, which is deleted right after — leaving the packaged
    // app with dangling links (dyld: "Electron Framework ... no such file").
    cpSync(source, destination, { recursive: true, force: true, verbatimSymlinks: true })
  }
  succeeded = true
  console.log(`Desktop artifacts written to ${releaseDir}`)
} finally {
  if (succeeded) {
    rmSync(stagingRoot, { recursive: true, force: true })
  } else {
    console.error(`Packaging staging directory retained for diagnostics: ${stagingRoot}`)
  }
}
