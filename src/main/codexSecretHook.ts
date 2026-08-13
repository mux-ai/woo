import { readFileSync } from 'fs'
import {
  codexOutputContainsSecret,
  evaluateCodexTool,
  type CodexHookInput
} from './codexSecretPolicy'

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
  raw = (raw + chunk).slice(-256_000)
})
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw) as CodexHookInput
    const snapshotPath = process.argv[2]
    const snapshot = snapshotPath
      ? JSON.parse(readFileSync(snapshotPath, 'utf8')) as string[] | { secrets?: string[]; allowShell?: boolean; workspaceRoot?: string }
      : []
    const secrets = Array.isArray(snapshot) ? snapshot : (snapshot.secrets ?? [])
    const allowShell = Array.isArray(snapshot) ? false : snapshot.allowShell === true
    const workspaceRoot = Array.isArray(snapshot) ? undefined : snapshot.workspaceRoot
    const reason = evaluateCodexTool(input, allowShell, workspaceRoot)
    if (reason) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: reason
          }
        })
      )
      return
    }
    if (codexOutputContainsSecret(input, secrets)) {
      process.stdout.write(
        JSON.stringify({
          decision: 'block',
          reason: 'Blocked by Woo Secret Broker: tool output contained a concealed secret value.'
        })
      )
    }
  } catch {
    // Malformed hook input must not crash the Codex turn.
  }
})
