import { promises as fs } from 'fs'
import { join } from 'path'

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

/** Repository policy injected ahead of provider planning and execution. */
export async function projectPolicyPrompt(workspaceRoot: string): Promise<string> {
  const noliDisabled = await exists(join(workspaceRoot, '.noli', 'disabled'))
  const legacyDisabled = !noliDisabled && await exists(join(workspaceRoot, '.okf', 'disabled'))
  if (!noliDisabled && !legacyDisabled) return ''

  const marker = noliDisabled ? '.noli/disabled' : '.okf/disabled'
  return `<repository-policy>
${marker} is present: the developer explicitly opted out of Noli project knowledge.
Do not invoke noli, do not propose initializing Noli, and do not inspect the Noli skill.
Use only the Woo project knowledge supplied in this prompt plus ordinary workspace files.
</repository-policy>

`
}
