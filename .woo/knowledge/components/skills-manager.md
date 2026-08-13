---
title: Skills Manager
type: component
description: Lists, creates, installs and deletes agent skills (SKILL.md folders) for Claude and Codex, in account and project scopes.
aliases:
  - skills
  - skill
  - SKILL.md
relationships:
  - predicate: uses
    to: IPC Bridge
  - predicate: depends-on
    to: Agent Runner
  - predicate: enforced-by
    to: SEC-001 Agent Never Reads Secret Files
---
`src/main/skillsService.ts` manages four skill homes: `~/.claude/skills` and
`~/.codex/skills` (account scope — follows the signed-in CLI everywhere) and
`.claude/skills` / `.codex/skills` in the workspace (project scope — ships
with the repo). Same SKILL.md format both ecosystems: YAML frontmatter
name/description + Markdown instructions.

Claude skills auto-load in agent runs (SDK `skills: 'all'`). Codex skills are
invoked as `$name` in the Codex CLI, including from Woo's terminal. Skill
names are regex-validated and every path resolve-guarded inside a known
skills dir; deletion goes to the OS trash. Skills cannot override the Secret
Broker — every tool call they trigger still passes canUseTool and output
scrubbing.
