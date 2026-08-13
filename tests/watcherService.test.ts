import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SecretBroker } from '../src/main/secretBroker'
import { WatcherService } from '../src/main/watcherService'

let root: string
let watcher: WatcherService | null = null

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'woo-watch-'))
})

afterEach(async () => {
  await watcher?.stop()
  watcher = null
  rmSync(root, { recursive: true, force: true })
})

function waitFor(pred: () => boolean, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      if (pred()) return resolve()
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timeout'))
      setTimeout(tick, 50)
    }
    tick()
  })
}

describe('WatcherService', () => {
  it('reports created files as workspace-relative batched paths', async () => {
    const batches: string[][] = []
    const broker = new SecretBroker(root)
    watcher = new WatcherService(root, broker, (paths) => batches.push(paths))
    watcher.start()
    await new Promise((r) => setTimeout(r, 300)) // let the initial scan settle

    writeFileSync(join(root, 'hello.ts'), 'const x = 1\n')
    await waitFor(() => batches.flat().includes('hello.ts'))
    expect(batches.flat()).toContain('hello.ts')
  })

  it('reloads the SecretBroker when a secret file appears', async () => {
    const broker = new SecretBroker(root)
    watcher = new WatcherService(root, broker, () => {})
    watcher.start()
    await new Promise((r) => setTimeout(r, 300))

    expect(broker.scrub('watchersecretvalue7')).toBe('watchersecretvalue7')
    writeFileSync(join(root, '.env'), 'FRESH=watchersecretvalue7\n')
    await waitFor(() => broker.scrub('watchersecretvalue7') === '<concealed>')
    expect(broker.scrub('leak watchersecretvalue7 here')).toBe('leak <concealed> here')
  })
})
