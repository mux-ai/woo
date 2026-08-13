---
title: Terminal PTY
type: component
description: Real pseudo-terminal in the bottom panel — node-pty shell session in the main process, xterm.js renderer, scrollback replay across tab switches.
aliases:
  - terminal
  - shell
  - pty
  - console
  - command line
relationships:
  - predicate: uses
    to: IPC Bridge
  - predicate: follows
    to: ADR-001 Electron Desktop Shell
  - predicate: enforced-by
    to: SEC-002 Tool Output Scrubbed Of Secret Values
---
`src/main/terminalService.ts` spawns the user's shell via node-pty (rebuilt
against the Electron ABI by the postinstall script). One session per window;
it survives tab remounts — output accumulates in a chunk ring buffer
(~200KB) replayed when the Terminal tab reopens. Interactive programs,
stdin, ANSI colors all work.

Strictly human-facing: terminal output streams only to the renderer tab and
NEVER enters the agent transcript; the agent has no channel into this
service.
