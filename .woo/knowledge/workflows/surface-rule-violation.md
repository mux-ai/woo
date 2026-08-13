---
title: Surface Rule Violation
type: workflow
description: From saved file to actionable diagnostic.
relationships:
  - predicate: uses
    to: Rule Checker
  - predicate: applies-to
    to: Rule Violation
---

## Steps

1. File opened or saved. 2. Rule Checker fetches applicable rules for the file's domain. 3. Violations rendered as squiggles, hover card (rule ID, description, defined-in path, Quick Fix / Fix with Agent / Open Rule / Suppress), and Problems rows grouped by file.
