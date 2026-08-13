import { ENV_DUMP_COMMANDS, SECRET_REFERENCE } from './codexSecretPolicy'
import { SHELL_DISABLED_REASON } from './agentSecurity'

/**
 * Permission policy for the opencode provider. opencode has NO transcript
 * scrub hook (no PostToolUse analog), so this ask-handler is the only wall
 * between the model and secret content — therefore DEFAULT-DENY: anything
 * unrecognized or unparseable is rejected, never waved through.
 */

export interface OpencodePermission {
  id: string
  type: string
  pattern?: string | string[]
  sessionID: string
  title: string
  metadata: Record<string, unknown>
}

/** Returns a denial reason, or null to allow. */
export function evaluateOpencodePermission(
  permission: OpencodePermission,
  allowShell = false
): string | null {
  const patterns = Array.isArray(permission.pattern)
    ? permission.pattern
    : permission.pattern
      ? [permission.pattern]
      : []
  const surface = [permission.title, ...patterns, JSON.stringify(permission.metadata ?? {})].join(
    ' '
  )

  if (SECRET_REFERENCE.test(surface)) {
    return 'Blocked by Woo Secret Broker: references a secret-bearing path.'
  }

  switch (permission.type) {
    case 'edit':
      return null
    case 'bash': {
      if (ENV_DUMP_COMMANDS.test(surface)) {
        return 'Blocked by Woo Secret Broker: environment dumps are not allowed.'
      }
      if (!allowShell) return SHELL_DISABLED_REASON
      return null
    }
    case 'webfetch':
      // No transcript scrub behind this wall — a fetched page can carry a
      // secret out via URL. Deny outbound fetches for opencode sessions.
      return 'Blocked by Woo Secret Broker: webfetch is disabled for the opencode provider.'
    default:
      return `Blocked by Woo Secret Broker: unrecognized permission type "${permission.type}" (default-deny).`
  }
}
