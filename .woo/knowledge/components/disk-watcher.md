---
title: Disk Watcher
type: component
description: Chokidar workspace watcher — batches file changes, refreshes the tree, reloads clean editor buffers, and re-arms the Secret Broker when secret files change.
aliases:
  - watcher
  - file watching
  - hot reload
  - fs events
relationships:
  - predicate: uses
    to: IPC Bridge
  - predicate: depends-on
    to: Secret Broker
  - predicate: applies-to
    to: Editor Workbench
---
`src/main/watcherService.ts` watches the workspace (ignored dirs excluded),
batches events on a 200ms quiet period and sends workspace-relative paths to
the renderer. Policy: clean open buffers reload and re-run rule checks;
dirty buffers are never clobbered — a conflict line goes to the Output log.
When a changed file matches a secret pattern (.env and friends), the Secret
Broker reloads so new values become scrubbable without a restart.
