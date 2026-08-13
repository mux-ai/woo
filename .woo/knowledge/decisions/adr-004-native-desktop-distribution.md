---
id: ADR-004
title: Native desktop distribution
type: decision
description: Package compiled Woo output per operating system with a minimal, space-safe native dependency staging step.
status: accepted
tags:
  - packaging
  - electron
  - security
relationships:
  - type: follows
    target: ADR-001
  - type: protects
    target: SEC-002
---

# Native desktop distribution

Woo uses electron-builder to create an AppImage on Linux, a DMG and ZIP on
macOS, and an NSIS installer on Windows. Releases must be built and signed on
their target operating system.

Only compiled `out/` files, `package.json`, and the runtime portion of the
production `node-pty` dependency enter the application bundle. Tests, source,
maps, foreign-platform prebuilds, and build inputs are removed after the
target-platform rebuild. Electron security fuses disable the Node CLI and
environment switches in packaged applications.

`scripts/package-desktop.mjs` stages these inputs under the operating system's
temporary directory, rebuilds `node-pty` for the pinned Electron version, and
then runs electron-builder without a second rebuild. This avoids node-gyp's
path-with-spaces limitation while preserving a strict source and secret
boundary.
