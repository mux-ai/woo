---
title: ADR-003 Tool-Layer Secret Enforcement
type: decision
description: Secrets are blocked at the file-access layer, never via prompt instructions.
---

## Decision

Provider adapters enforce the strongest Secret Broker boundary their SDK makes
available before or after local tool execution. Claude declares tool availability with Agent SDK `tools`, never bare
`allowedTools`, because those entries auto-approve before `canUseTool`. An
authoritative PreToolUse hook denies secret paths and environment dumps before
execution and emits the UI tool event even if the permission callback is
shadowed. `canUseTool` independently repeats the check, while PostToolUse
rewrites known secret values. Codex uses command hooks: PreToolUse denies secret
paths and environment dumps, while PostToolUse replaces results containing
known secret values with generic blocked feedback. Both adapters scrub UI
events and sanitize the subprocess environment. Secret-path prompt text is
defense in depth, not the enforcement boundary.

## Consequences

The model can neither directly read recognized secret files nor receive known
secret values in command output. Claude calls are blocked by a hook that is not
dependent on the SDK permission prompt path, and its results are rewritten; Codex results
containing a known value are replaced by hook feedback. OpenCode has no
post-tool transcript hook, so it is experimental: path denial, environment
sanitization, disabled web fetch, default-deny permissions, and display
scrubbing apply, but transcript-level output scrubbing is not guaranteed.
Values not loaded by the broker remain protected by path denial and environment
sanitization.
