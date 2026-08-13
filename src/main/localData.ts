import { createHash } from 'crypto'
import { chmodSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'

/** Stable, non-identifying local storage root for one workspace. */
export function workspaceDataRoot(userDataRoot: string, workspaceRoot: string): string {
  const id = createHash('sha256').update(resolve(workspaceRoot)).digest('hex').slice(0, 32)
  const root = join(userDataRoot, 'workspaces', id)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  chmodSync(root, 0o700)
  return root
}
