import { realpathSync } from 'fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { SHELL_DISABLED_REASON } from './agentSecurity'

export const ENV_DUMP_COMMANDS = /\b(printenv|env\s*$|env\s*\||set\s*$|export\s*-p)\b/
export const SECRET_REFERENCE =
  /(\.env(?:\.[\w-]+)?\b|\.pem\b|\.key\b|\.p12\b|\.pfx\b|id_rsa|id_ed25519|id_ecdsa|credentials|\.netrc|\.npmrc|secrets?\.(?:json|ya?ml|toml)|service.?account|\.keystore\b|\.jks\b|\.tfstate\b|\.tfvars\b|kubeconfig|\.kdbx\b|\.ovpn\b|\.mobileprovision\b|\.(?:ssh|aws|azure|kube|gnupg|docker)[\\/])/i

export interface CodexHookInput {
  hook_event_name?: string
  tool_name?: string
  tool_input?: unknown
  tool_response?: unknown
}

export function codexOutputContainsSecret(input: CodexHookInput, secrets: string[]): boolean {
  if (input.hook_event_name !== 'PostToolUse' || secrets.length === 0) return false
  const output = JSON.stringify(input.tool_response ?? '')
  return secrets.some((secret) => secret.length >= 8 && output.includes(secret))
}

function escapesWorkspace(pathValue: string, workspaceRoot: string): boolean {
  const root = resolve(workspaceRoot)
  const absolute = resolve(isAbsolute(pathValue) ? pathValue : join(root, pathValue))
  let canonical = absolute
  try {
    canonical = realpathSync.native(absolute)
  } catch {
    let parent = dirname(absolute)
    while (parent !== dirname(parent)) {
      try {
        canonical = join(realpathSync.native(parent), relative(parent, absolute))
        break
      } catch {
        parent = dirname(parent)
      }
    }
  }
  return [absolute, canonical].some((path) => {
    const rel = relative(root, path)
    return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
  })
}

/** Returns a denial reason for secret-bearing Codex tool calls, otherwise null. */
export function evaluateCodexTool(
  input: CodexHookInput,
  allowShell = false,
  workspaceRoot?: string
): string | null {
  if (input.hook_event_name !== 'PreToolUse') return null
  const serialized = JSON.stringify(input.tool_input ?? {})
  if (SECRET_REFERENCE.test(serialized)) {
    return 'Blocked by Woo Secret Broker: tool input references a secret-bearing path.'
  }
  if (workspaceRoot && input.tool_input && typeof input.tool_input === 'object') {
    const record = input.tool_input as Record<string, unknown>
    const pathValue = record.file_path ?? record.path ?? record.notebook_path
    if (typeof pathValue === 'string' && escapesWorkspace(pathValue, workspaceRoot)) {
      return 'Blocked by Woo Secret Broker: path resolves outside the workspace.'
    }
  }
  if (input.tool_name === 'Bash') {
    let command = serialized
    if (input.tool_input && typeof input.tool_input === 'object') {
      const value = (input.tool_input as Record<string, unknown>).command
      if (typeof value === 'string') command = value
    }
    if (ENV_DUMP_COMMANDS.test(command)) {
      return 'Blocked by Woo Secret Broker: environment dumps are not allowed.'
    }
    if (!allowShell) return SHELL_DISABLED_REASON
  }
  return null
}
