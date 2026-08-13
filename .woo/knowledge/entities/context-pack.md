---
title: Context Pack
type: entity
description: The bounded set of knowledge nodes and code symbols retrieved for
  one agent task.
relationships:
  - predicate: uses
    to: Knowledge Node
---

## Definition

A Context Pack is the result of Woo's native retrieval for a task prompt:
relevant rules, entities, components, workflows, decisions, and their source
documents, with a token estimate. It is shown in the Context Pack inspector,
can be pinned or refreshed, and is injected into the agent conversation before
execution. Normal planning receives description summaries; execution receives
full bounded documents. A pinned pack is full context in both phases and is
automatically invalidated when project knowledge changes.
