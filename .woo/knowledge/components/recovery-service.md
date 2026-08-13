---
title: Recovery Service
type: component
description: Bounded non-secret agent backups, editor buffer recovery, knowledge migrations, and crash diagnostics.
relationships:
  - predicate: follows
    to: ADR-005 Layered Local Recovery
  - predicate: uses
    to: Secret Broker
  - predicate: protects
    to: Editor Workbench
---

## Responsibility

Before a real agent task starts, Woo copies up to 5,000 non-secret workspace
files and 100 MiB into a private hashed per-workspace directory under Electron
`userData`. Five rolling backups are retained.
Restoring a backup first snapshots the current workspace, then copies the
selected manifest's files back. Restore never accepts paths outside the
workspace.

Dirty editor buffers are atomically checkpointed in the same private local data root and
offered after restart. Secret-named files and buffers larger than 2 MiB are not
checkpointed. Knowledge schema upgrades are versioned and copy the prior
knowledge directory before migration. Fatal main-process errors leave a local
report in Electron's user-data directory.
