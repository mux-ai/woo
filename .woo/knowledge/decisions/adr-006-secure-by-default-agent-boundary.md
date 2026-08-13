---
title: ADR-006 Secure-by-Default Agent Boundary
type: decision
description: Default to a sandboxed renderer, private local retention, and no agent shell execution.
relationships:
  - predicate: follows
    to: ADR-003 Tool-Layer Secret Enforcement
  - predicate: uses
    to: Secret Broker
  - predicate: depends-on
    to: IPC Bridge
---

## Decision

Production data protection is fail-closed. The renderer is sandboxed and all
privileged IPC is main-frame sender validated. Local recovery is private,
bounded, off-repository, and user-deletable. The vault uses versioned strong
scrypt derivation, AES-256-GCM, atomic `0600` files, and automatic locking.

Agent file paths are canonicalized and constrained to the workspace. Agent
shell execution is disabled unless the operator explicitly launches Woo with
`WOO_ALLOW_AGENT_SHELL=1`, which the UI labels as reduced protection. OpenCode
remains separately experimental and disabled by default.
