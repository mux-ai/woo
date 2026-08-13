---
title: IPC Bridge
type: component
description: Preload-exposed typed API between renderer and main.
relationships:
  - predicate: follows
    to: ADR-001 Electron Desktop Shell
---

## Responsibility

contextBridge.exposeInMainWorld surface with channels for workspace/file
operations, project knowledge, agent session control, and diagnostics. Every
channel validates its payload and requires the expected BrowserWindow main
frame as sender; no generic "run this in node" channel exists. The renderer
uses context isolation and Chromium sandboxing with CSP, navigation, popup,
and permission denial.

Opening another folder keeps the BrowserWindow and renderer alive. The main
process constructs a complete replacement workspace session, confirms any
unsaved-edit discard, stops the old agents/terminal/watcher, and atomically
rebinds file, knowledge, Secret Broker, Git, skills, vault, and graph services.
A generation guard prevents late events from an aborted old agent task from
appearing in the new workspace.
