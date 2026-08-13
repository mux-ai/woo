---
title: SEC-002 Tool Output Scrubbed Of Secret Values
type: rule
description: Secret values appearing in any tool output are replaced before
  reaching the model.
relationships:
  - predicate: applies-to
    to: Secret Resource
  - predicate: enforced-by
    to: Secret Broker
---

## Rule

For providers with a post-tool hook, values loaded from Secret Resources are
replaced with `<concealed>` in stdout, stderr, and file contents before the
transcript sees the bytes. Claude uses its Agent SDK PostToolUse hook; Codex
uses its command output hook. OpenCode cannot fully satisfy this rule because
its SDK exposes no equivalent hook, so Woo labels that adapter experimental
and applies stricter path and permission controls plus display scrubbing.
Only values the broker has loaded from workspace secret files are scrubbable;
unknown secrets remain covered by path denial and subprocess environment
sanitization.
