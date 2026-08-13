---
title: ADR-002 Native Knowledge Engine
type: decision
description: Woo ships its own knowledge engine; developers author plain Markdown in their repo, no external CLI.
---

## Decision

Project knowledge lives as Markdown files with YAML frontmatter under
`.woo/knowledge/` in the developer's own repository — one file per rule,
entity, component, workflow, or decision, related by predicates
(applies-to, depends-on, enforced-by, uses, follows) that reference other
docs by title or id. The engine (`src/main/knowledge/`) indexes these
files directly: deterministic term-overlap retrieval with title boost,
meaningful matches (title or description confidence) selected as seeds,
then expanded one hop over the relationship graph. Execution packs are
bounded to five documents and a character budget; every included doc is
listed in sources. Planning receives descriptions only, while execution
receives full relevant documents. If no seed meets the relevance threshold,
no knowledge context is injected. Reindexing is an mtime probe on query.
After an agent task, a bounded workspace snapshot comparison can propose
deterministic implementation-history additions to relevant documents. The
developer must approve each document, and Woo verifies the preview is still
current before writing. This sync path makes no additional model call.

## Consequences

No external dependency for end developers — knowledge works the moment
they write a Markdown file. Retrieval stays deterministic and offline.
Machine-checkable rules declare `checks:` (pattern/severity/message) in
frontmatter and surface as editor diagnostics. Supersedes the earlier
decision to shell out to the noli CLI.
