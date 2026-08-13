---
title: UI-001 Renderer Never Touches Disk
type: rule
description: All filesystem and process access lives in the Electron main process.
relationships:
  - predicate: enforced-by
    to: IPC Bridge
  - predicate: follows
    to: ADR-001 Electron Desktop Shell
---

## Rule

The renderer runs with context isolation on and Node integration off. File
reads, writes, watches, native knowledge operations, and agent sessions are IPC
calls handled in main. This keeps the Secret Broker unbypassable from web
content.
