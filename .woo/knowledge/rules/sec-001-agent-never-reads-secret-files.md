---
title: SEC-001 Agent Never Reads Secret Files
type: rule
description: Agent file operations on secret-matching paths must be denied at
  the broker, not the prompt.
relationships:
  - predicate: applies-to
    to: Secret Resource
  - predicate: enforced-by
    to: Secret Broker
---

## Rule

Any agent-originated read, glob, grep, or shell command that resolves to a Secret Resource path is rejected by the Secret Broker with a redacted error naming the pattern, never the content. There is no allowlist override from the agent side; only the human can whitelist a path in settings.
