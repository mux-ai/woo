---
title: KNOW-001 Retrieve Before Execute
type: rule
description: Every agent task retrieves a Context Pack before its first tool call.
relationships:
  - predicate: applies-to
    to: Context Pack
  - predicate: enforced-by
    to: Agent Runner
---

## Rule

The agent runner calls Woo's native `KnowledgeEngine.retrieve` with the task
prompt and injects the resulting Context Pack before execution. The UI shows
the "Retrieved relevant project knowledge before execution" badge only when
retrieval returned relevant documents; retrieved rules are binding on the
agent's plan.
