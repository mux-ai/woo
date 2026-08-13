---
title: Run Agent Task
type: workflow
description: From prompt to executed, rule-checked change.
relationships:
  - predicate: uses
    to: Agent Runner
  - predicate: uses
    to: Context Pack
---

## Steps

1. User connects Claude or Codex and chooses the active provider. OpenCode is
   available as an experimental reduced-enforcement adapter.
2. User types a task; Woo previews planning and execution knowledge tokens.
3. Agent Runner retrieves a relevance-gated Context Pack (KNOW-001).
4. The pack is shown with token count and sources; the user can inspect, pin,
   or refresh it.
5. On Run, the selected provider SDK starts with its Secret Broker hooks and
   sandbox.
6. Structured output streams to the panel and edits land in the workspace.
7. Rule Checker re-runs on changed files and reports violations.
8. Woo compares bounded before/after workspace snapshots and maps changed
   files to relevant project knowledge.
9. The developer reviews small knowledge diffs and explicitly selects which
   documents to update. Applying changes invalidates stale pinned context.
