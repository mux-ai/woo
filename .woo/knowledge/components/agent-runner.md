---
title: Agent Runner
type: component
description: Main-process provider router for Claude, Codex, and experimental OpenCode sessions.
relationships:
  - predicate: uses
    to: Secret Broker
  - predicate: follows
    to: ADR-003 Tool-Layer Secret Enforcement
---

## Responsibility

Owns the agent conversation: retrieves a description-only knowledge summary
for planning and a full, five-document-bounded Context Pack for execution.
Low-confidence retrieval results are not injected. The selected connected
provider powers planning, pinning, execution, streaming, and cancellation.
Claude exposes built-in tools with the SDK `tools` option but never adds them to
`allowedTools`, which would auto-approve calls before `canUseTool`. Its
authoritative PreToolUse hook blocks secret access and emits visible tool
events; `canUseTool` repeats the policy when an SDK permission response is
needed, and PostToolUse scrubs results. Codex uses its workspace-write sandbox
plus PreToolUse and PostToolUse Secret Broker hooks. Every provider subprocess
receives a sanitized environment. Claude sessions also have idle, total-run, and planning
deadlines so an SDK stream cannot remain active indefinitely.

Agent shell execution is denied by default across providers. Developers run
commands in the human terminal or explicitly accept reduced protection with
`WOO_ALLOW_AGENT_SHELL=1`; filename and command classification cannot make an
arbitrary project build script safe.

When `.noli/disabled` (or the deprecated `.okf/disabled`) exists, the runner
injects an explicit repository policy into both planning and execution. The
provider must not invoke or propose initializing Noli for that workspace.

While the developer types, the runner estimates the summary planning context
and full execution context separately. A context preview can be pinned without
first executing a task. Knowledge-file changes invalidate cached and pinned
packs for every provider so stale guidance is not reused.

Drafted plans may be explicitly improved with project knowledge. Improvement
is a separate planning request, never an execution action: the revised plan is
shown in edit mode, Run remains an explicit developer decision, and the prior
draft remains available for one-step undo.

OpenCode is disabled by default and requires the explicit
`WOO_ENABLE_EXPERIMENTAL_OPENCODE=1` process opt-in. It remains experimental
because its SDK has no PostToolUse-equivalent hook.
Woo still applies path denial, environment sanitization, default-deny tool
permissions, disables web fetches, and scrubs renderer output, but tool output
may already be present in OpenCode's own transcript. The UI must disclose this
reduced guarantee whenever OpenCode is enabled and selected.
