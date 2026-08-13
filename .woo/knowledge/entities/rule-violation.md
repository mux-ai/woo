---
title: Rule Violation
type: entity
description: A detected mismatch between code and a Business Rule knowledge node.
relationships:
  - predicate: depends-on
    to: Knowledge Node
---

## Definition

A Rule Violation binds a Business Rule node to a concrete file/line/column, with severity (error, warning, info), source label, and the rule's defining document. Violations render as Monaco decorations, hover cards with Quick Fix / Fix with Agent / Open Rule actions, and rows in the Problems panel.
