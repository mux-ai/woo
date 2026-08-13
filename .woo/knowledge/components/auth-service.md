---
title: Auth Service
type: component
description: Manages provider sign-in for Claude, Codex, and experimental OpenCode CLIs from the agent panel's Accounts row.
aliases:
  - authentication
  - login
  - sign-in
  - oauth
  - accounts
  - provider connection
relationships:
  - predicate: uses
    to: IPC Bridge
  - predicate: depends-on
    to: Agent Runner
---
`src/main/authService.ts` shells out to the `claude`, `codex`, and `opencode`
CLIs for provider-owned status, login, and logout operations. Credentials stay in each CLI's own
credential store — Woo never sees or stores tokens; the renderer receives
status metadata only (provider, authenticated, method, account). Connection
state persists in `auth-connections.json` under Electron userData.

The agent panel's provider selector switches which CLI the Agent Runner
drives. Sign-in runs the CLI's interactive login flow; a login
already in flight is reused, never duplicated.
