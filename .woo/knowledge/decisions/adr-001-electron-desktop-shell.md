---
title: ADR-001 Electron Desktop Shell
type: decision
description: Woo Studio ships as an Electron app written in TypeScript.
---

## Decision

The desktop shell is Electron with electron-vite, React, and TypeScript. Monaco
provides the code editor. The main process owns all filesystem, agent, and
native project-knowledge access; the renderer has no Node integration, uses
context isolation, and talks to main only through a typed IPC bridge exposed by
the preload script.

## Consequences

Larger binaries than Tauri or Wails, but the richest editor ecosystem (Monaco) and one language across the stack. Renderer never gets Node integration, so a compromised webview cannot read the filesystem directly.
