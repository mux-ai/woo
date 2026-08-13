---
title: Secret Broker
type: component
description: Main-process gatekeeper for provider file access, process environments, and Woo-visible agent output.
relationships:
  - predicate: applies-to
    to: Secret Resource
  - predicate: follows
    to: ADR-003 Tool-Layer Secret Enforcement
---

## Responsibility

Maintains secret path patterns and recursively loaded secret values for the open workspace.
Exposes `checkPath(path)` and `scrub(text)` for provider adapters and any IDE
feature that forwards content to a model. Canonicalizes paths, rejects paths
and symlinks outside the workspace, denies expanded secret formats, scrubs known
secret values where a provider exposes a pre-transcript output hook, sanitizes
provider subprocess environments, and logs denials to the UI audit trail.
OpenCode lacks a post-tool transcript hook and is therefore labeled
experimental with reduced enforcement.
