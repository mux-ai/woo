import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

function exactElectronVersion(projectRoot) {
  const metadata = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
  const version = metadata.devDependencies?.electron
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('devDependencies.electron must be pinned to an exact version')
  }
  return version
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${options.label} exited with status ${result.status}`)
  }
}

/**
 * Rebuild node-pty outside the checkout and copy only its generated Release
 * directory back. node-gyp currently rejects module paths containing spaces.
 */
export function rebuildNodePty({
  targetProjectRoot,
  toolsProjectRoot = targetProjectRoot,
  targetArch = process.arch
}) {
  const sourceModule = join(targetProjectRoot, 'node_modules/node-pty')
  const sourceAddonApi = join(targetProjectRoot, 'node_modules/node-addon-api')
  const nodeGyp = join(toolsProjectRoot, 'node_modules/node-gyp/bin/node-gyp.js')
  for (const required of [sourceModule, sourceAddonApi, nodeGyp]) {
    if (!existsSync(required)) throw new Error(`Required native build input missing: ${required}`)
  }

  const electronVersion = exactElectronVersion(targetProjectRoot)
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'woo-native-'))
  const temporaryModules = join(temporaryRoot, 'node_modules')
  const temporaryModule = join(temporaryModules, 'node-pty')
  let succeeded = false

  try {
    mkdirSync(temporaryModules, { recursive: true })
    cpSync(sourceModule, temporaryModule, { recursive: true, force: true })
    cpSync(sourceAddonApi, join(temporaryModules, 'node-addon-api'), {
      recursive: true,
      force: true
    })

    run(process.execPath, [
      nodeGyp,
      'rebuild',
      '--runtime=electron',
      `--target=${electronVersion}`,
      `--arch=${targetArch}`,
      '--dist-url=https://www.electronjs.org/headers',
      '--build-from-source'
    ], {
      cwd: temporaryModule,
      env: {
        ...process.env,
        npm_config_devdir: join(tmpdir(), 'woo-node-gyp-cache')
      },
      label: 'node-pty rebuild'
    })

    const builtRelease = join(temporaryModule, 'build/Release')
    if (!existsSync(join(builtRelease, 'pty.node'))) {
      throw new Error('node-pty rebuild did not produce build/Release/pty.node')
    }
    cpSync(builtRelease, join(sourceModule, 'build/Release'), {
      recursive: true,
      force: true
    })
    succeeded = true
    return join(sourceModule, 'build/Release/pty.node')
  } finally {
    if (succeeded) {
      rmSync(temporaryRoot, { recursive: true, force: true })
    } else {
      console.error(`Native build directory retained for diagnostics: ${temporaryRoot}`)
    }
  }
}
