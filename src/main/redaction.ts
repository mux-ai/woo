import { homedir } from 'os'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Redact common credentials and identifying local paths from diagnostics. */
export function redactDiagnostic(value: unknown, workspaceRoot?: string): string {
  let text = String(value ?? '')
  const roots = [workspaceRoot, homedir()].filter((root): root is string => Boolean(root))
  for (const root of roots.sort((a, b) => b.length - a.length)) {
    text = text.replace(new RegExp(escapeRegExp(root), 'g'), root === workspaceRoot ? '<workspace>' : '<home>')
  }

  text = text
    .replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/gi, '<concealed-private-key>')
    .replace(/\b(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, '$1<concealed>')
    .replace(/\b([A-Za-z0-9_]*(?:secret|token|password|passwd|credential|api[_-]?key)[A-Za-z0-9_]*\s*[=:]\s*)[^\s,;]+/gi, '$1<concealed>')
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^:/@\s]+:)[^@\s]+@/gi, '$1<concealed>@')
    .replace(/\b(?:sk|ghp|github_pat|xox[baprs])-[-A-Za-z0-9_]{12,}\b/g, '<concealed-token>')

  return text.slice(0, 16_000)
}
