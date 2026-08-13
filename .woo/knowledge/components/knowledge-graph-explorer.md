---
title: Knowledge Graph Explorer
type: component
description: Interactive task-impact view over native project knowledge and optional source imports.
relationships:
  - predicate: uses
    to: Context Pack
  - predicate: uses
    to: Sync Project Knowledge
---

## Responsibility

Renders native knowledge nodes by type and predicate. Current Context Pack
nodes, knowledge-sync candidates, and changed source files have distinct visual
states; unrelated nodes dim when an impact set exists. Developers can search,
fit or zoom the canvas, drag to pan, isolate a selected node's one-hop
neighborhood, follow relationships in the inspector, and open the backing
document or source file.

An optional source layer scans at most 400 TypeScript/JavaScript files, skips
dependencies and build output, and visualizes resolvable relative
`import`/`export from`/`require` relationships. It is off by default so the
knowledge graph remains readable and the scan never consumes provider tokens.
