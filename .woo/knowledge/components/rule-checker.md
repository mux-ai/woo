---
title: Rule Checker
type: component
description: Produces Rule Violations for open files.
relationships:
  - predicate: applies-to
    to: Rule Violation
---

## Responsibility

On file open/save, retrieves applicable Business Rules from the native knowledge engine, evaluates rule check patterns against the file, and emits Rule Violation diagnostics to the Problems panel and Monaco decorations.
