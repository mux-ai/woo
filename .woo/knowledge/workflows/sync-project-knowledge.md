---
title: Sync Project Knowledge
type: workflow
description: Propose approval-only knowledge updates after an agent changes workspace files.
relationships:
  - predicate: uses
    to: Agent Runner
  - predicate: uses
    to: Context Pack
---

## Steps

1. Before execution, Woo records a bounded, secret-excluding workspace
   snapshot.
2. After execution, Woo detects added, changed, and removed workspace files.
3. Native retrieval maps the task and changed filenames to the best relevant
   knowledge document. Up to two additional relevant documents are included
   only when Woo can propose removing an older duplicate status/history block.
4. Woo proposes a compact, marked implementation-status block and shows its
   estimated context-token delta. A later sync replaces that block and migrates
   the earlier append-only Implementation history section, so task notes do not
   grow without bound or repeat across documents. Proposal content remains in the main process; the
   renderer receives preview text and opaque proposal identifiers.
5. The developer selects proposals to apply or dismisses the review.
6. Before writing, Woo verifies that each target document still matches the
   reviewed version. Approved writes invalidate cached and pinned context for
   every provider.

The workflow makes no additional model call and never reads secret files,
dependency output, build output, or `.git` while taking snapshots.
