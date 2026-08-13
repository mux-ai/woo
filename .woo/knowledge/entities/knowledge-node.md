---
title: Knowledge Node
type: entity
description: A single document in the project knowledge base — entity, rule,
  component, workflow, or decision.
---

## Definition

A Knowledge Node is one Markdown document with YAML frontmatter under
`.woo/knowledge/`, identified by a stable path-derived ID, typed as a Domain
Entity, Business Rule, Application Component, Workflow, or Architecture
Decision, and linked to other nodes by predicates (`applies-to`, `depends-on`,
`enforced-by`, `uses`, `follows`). The knowledge sidebar and graph explorer
render these nodes.
