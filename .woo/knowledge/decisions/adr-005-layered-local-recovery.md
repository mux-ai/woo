---
title: ADR-005 Layered Local Recovery
type: decision
description: Protect developer work with bounded backups, buffer checkpoints, schema backups, and local crash reports.
relationships:
  - predicate: extends
    to: ADR-001 Electron Desktop Shell
  - predicate: enforces
    to: SEC-001 Agent Never Reads Secret Files
---

## Decision

Woo treats agent edits and application crashes as recoverable local events.
Agent execution creates a bounded, rolling workspace backup that excludes
secret-bearing names and generated/vendor directories. Dirty editor buffers
use a separate atomic checkpoint, and knowledge migrations copy the previous
schema before writing a version marker.

Recovery remains local and explicit. Backups, checkpoints, and schema snapshots
live in a hashed per-workspace Electron `userData` directory outside the
repository with `0700` directories and `0600` files. Developers approve
restores, restores create a new safety snapshot, and no backup or crash record
is uploaded. Crash reports are redacted, retained for at most 30 days/five
reports, and all recovery/crash data is deletable from Data and privacy.
