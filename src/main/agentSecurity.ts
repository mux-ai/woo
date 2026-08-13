export const SHELL_DISABLED_REASON =
  'Blocked by Woo data protection: agent shell execution is disabled by default. Run tests in the human terminal, or explicitly launch with WOO_ALLOW_AGENT_SHELL=1 after reviewing the risk.'

export function agentShellEnabled(): boolean {
  return process.env.WOO_ALLOW_AGENT_SHELL === '1'
}
