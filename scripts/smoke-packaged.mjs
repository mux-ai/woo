import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'

const projectRoot = resolve(import.meta.dirname, '..')

function packagedExecutable() {
  if (process.platform === 'win32') {
    return join(projectRoot, 'release/win-unpacked/Woo Studio.exe')
  }
  if (process.platform === 'darwin') {
    for (const directory of ['mac', 'mac-arm64']) {
      const candidate = join(
        projectRoot,
        `release/${directory}/Woo Studio.app/Contents/MacOS/Woo Studio`
      )
      if (existsSync(candidate)) return candidate
    }
  }
  return join(projectRoot, 'release/linux-unpacked/woo-studio')
}

async function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => error ? reject(error) : resolvePort(port))
    })
  })
}

async function waitForCdp(port, processState) {
  const endpoint = `http://127.0.0.1:${port}/json/version`
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (processState.exited) {
      throw new Error(`Packaged app exited before CDP was ready.\n${processState.output}`)
    }
    try {
      const response = await fetch(endpoint)
      if (response.ok) return
    } catch {
      // App is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200))
  }
  throw new Error(`Timed out waiting for packaged app CDP.\n${processState.output}`)
}

const executable = packagedExecutable()
assert.ok(existsSync(executable), `Packaged executable missing: ${executable}`)

const testRoot = mkdtempSync(join(tmpdir(), 'woo-packaged-smoke-'))
const workspace = join(testRoot, 'workspace')
const profile = join(testRoot, 'profile')
const sourcePath = join(workspace, 'hello.ts')
const state = { exited: false, output: '' }
let child
let browser

try {
  const { mkdirSync } = await import('node:fs')
  mkdirSync(workspace, { recursive: true })
  writeFileSync(sourcePath, 'export const greeting = "hello"\n')
  const port = await availablePort()
  child = spawn(executable, [
    `--workspace=${workspace}`,
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    '--disable-gpu'
  ], {
    env: { ...process.env, WOO_SMOKE_TEST: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', (data) => { state.output += data.toString() })
  child.stderr.on('data', (data) => { state.output += data.toString() })
  child.once('exit', () => { state.exited = true })

  await waitForCdp(port, state)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const context = browser.contexts()[0]
  const page = context.pages()[0] ?? await context.waitForEvent('page')
  const explorerButton = page.getByTitle('Explorer')
  if (!(await explorerButton.evaluate((button) => button.classList.contains('active')))) {
    await explorerButton.click()
  }
  // At narrow CI/Xvfb window sizes the agent is intentionally an overlay.
  // Close it before exercising the workspace, exactly as a developer would.
  if (await page.locator('.agent-panel').isVisible()) {
    await page.getByTitle('Toggle Agent Panel').click()
  }
  await page.waitForSelector('.tree-name', { timeout: 20_000 })
  assert.equal(await page.title(), 'Woo Studio')

  await page.getByText('hello.ts', { exact: true }).click()
  const editor = page.locator('.monaco-editor textarea.inputarea')
  await editor.waitFor({ timeout: 20_000 })
  // Monaco may sit beneath a responsive overlay in the tiny smoke-test
  // viewport. Focus its keyboard textarea directly so layout overlays cannot
  // make this launch/save check flaky.
  const editorFocused = await editor.evaluate((element) => {
    ;(element).focus()
    return document.activeElement === element
  })
  assert.equal(editorFocused, true, 'Monaco input could not receive focus')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  await page.keyboard.insertText('export const greeting = "packaged smoke passed"\n')
  await page.waitForSelector('.tab-dirty', { timeout: 10_000 })
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S')

  const saveDeadline = Date.now() + 10_000
  while (!readFileSync(sourcePath, 'utf8').includes('packaged smoke passed')) {
    if (Date.now() > saveDeadline) {
      throw new Error(
        `Editor save did not reach disk. Current content: ${JSON.stringify(readFileSync(sourcePath, 'utf8'))}\n${state.output}`
      )
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }

  const result = await page.evaluate(async () => {
    const initialized = await window.woo.knowledgeInit()
    const diagnostics = await window.woo.knowledgeValidate()
    const agentEvents = []
    const completed = new Promise((resolveDone, reject) => {
      const timeout = setTimeout(() => reject(new Error('Mock agent timed out')), 5_000)
      const unsubscribe = window.woo.onAgentEvent((event) => {
        agentEvents.push(event.type)
        if (event.type === 'done') {
          clearTimeout(timeout)
          unsubscribe()
          resolveDone(undefined)
        }
      })
    })
    await window.woo.agentRun('claude', 'summarize the greeting module')
    await completed
    return {
      documentCount: initialized.documents.length,
      diagnostics,
      agentEvents,
      workspace: await window.woo.workspaceInfo()
    }
  })

  assert.equal(result.workspace.root, workspace)
  assert.ok(result.documentCount >= 3)
  assert.deepEqual(result.diagnostics, [])
  assert.ok(result.agentEvents.includes('context-pack'))
  assert.ok(result.agentEvents.includes('done'))
  console.log('Packaged smoke passed: launch, edit/save, knowledge, and mock agent.')
} finally {
  await browser?.close().catch(() => {})
  if (child && !state.exited) {
    const exited = new Promise((resolveExit) => child.once('exit', resolveExit))
    child.kill('SIGTERM')
    await Promise.race([
      exited,
      new Promise((resolveWait) => setTimeout(resolveWait, 2_000))
    ])
  }
  rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
