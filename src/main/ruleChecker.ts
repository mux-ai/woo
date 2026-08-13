import type { Diagnostic } from '../shared/types'
import { KnowledgeEngine } from './knowledge/engine'

/**
 * Rule Checker — turns Business Rule knowledge docs into diagnostics.
 *
 * A rule opts into machine checking with frontmatter:
 *
 *   checks:
 *     - pattern: 'Result\.retry\(\)'
 *       severity: warning
 *       message: Declined payment branch must not retry.
 *
 * Every match in a checked file produces a Diagnostic bound to that rule.
 * Rules without checks are advisory (agent-enforced only). A built-in
 * check flags likely hardcoded secrets in any file.
 */

interface CompiledCheck {
  ruleId: string
  ruleTitle: string
  definedIn: string
  regex: RegExp
  severity: Diagnostic['severity']
  message: string
}

const BUILTIN_SECRET_LITERAL: CompiledCheck = {
  ruleId: 'SEC-BUILTIN',
  ruleTitle: 'No hardcoded secrets',
  definedIn: 'built-in',
  regex: /(api[_-]?key|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9+/_-]{16,}['"]/gi,
  severity: 'warning',
  message: 'Possible hardcoded secret — move it to a secret store.'
}

export class RuleChecker {
  constructor(private knowledge: KnowledgeEngine) {}

  private async loadChecks(): Promise<CompiledCheck[]> {
    const checks: CompiledCheck[] = [BUILTIN_SECRET_LITERAL]
    try {
      for (const check of await this.knowledge.ruleChecks()) {
        try {
          checks.push({
            ruleId: check.ruleId,
            ruleTitle: check.ruleTitle,
            definedIn: check.definedIn,
            regex: new RegExp(check.pattern, 'gm'),
            severity: check.severity,
            message: check.message
          })
        } catch {
          // invalid regex in knowledge doc — skip, never crash the checker
        }
      }
    } catch {
      // knowledge unavailable — built-ins only
    }
    return checks
  }

  /**
   * `woo-ignore` on the flagged line or the line above suppresses matches:
   * bare form suppresses every rule, `woo-ignore RULE-ID` only that rule.
   */
  private isSuppressed(lines: string[], lineIdx: number, ruleId: string): boolean {
    for (const line of [lines[lineIdx], lines[lineIdx - 1]]) {
      if (line == null) continue
      const m = /woo-ignore(?:\s+([A-Za-z0-9_-]+))?/.exec(line)
      if (m && (!m[1] || m[1].toLowerCase() === ruleId.toLowerCase())) return true
    }
    return false
  }

  async check(filePath: string, content: string): Promise<Diagnostic[]> {
    // Don't lint the knowledge base against itself — patterns inside rule
    // definitions would match their own text.
    if (filePath.startsWith('.woo/')) return []
    const checks = await this.loadChecks()
    const diagnostics: Diagnostic[] = []
    const lines = content.split('\n')
    for (const check of checks) {
      for (let i = 0; i < lines.length; i++) {
        check.regex.lastIndex = 0
        const m = check.regex.exec(lines[i])
        if (m && !this.isSuppressed(lines, i, check.ruleId)) {
          diagnostics.push({
            ruleId: check.ruleId,
            message: `${check.ruleId}: ${check.message}`,
            file: filePath,
            line: i + 1,
            column: (m.index ?? 0) + 1,
            severity: check.severity,
            source: check.definedIn === 'built-in' ? 'Woo Rules' : 'Knowledge Rules',
            definedIn: check.definedIn
          })
        }
      }
    }
    return diagnostics
  }
}
