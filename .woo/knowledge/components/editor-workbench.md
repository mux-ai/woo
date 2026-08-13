---
title: Editor Workbench
type: component
description: Renderer UI - explorer, tabs, Monaco editor, panels.
relationships:
  - predicate: uses
    to: IPC Bridge
---

## Responsibility

React workbench for Woo Studio: adaptive activity bar, Project Knowledge
sidebar, first-run setup diagnostics, Monaco editor with breadcrumbs and
minimap, bottom Problems/Terminal/Output panel, and right-hand Agent panel.
Renders Rule Violations as decorations and hover cards. Monaco and its curated
language implementations load only after a file needs them. Dirty non-secret
buffers are checkpointed through the IPC Bridge and offered after a crash.

Knowledge-aware code completion is explicit and local-only: `Ctrl/Cmd+Space`
retrieves a bounded set of relevant knowledge documents, extracts documented
code references and paths, and shows source-attributed Monaco suggestions.
Ordinary typing continues to use Monaco's language services and does not query
an agent provider.
