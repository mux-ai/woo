# Woo Studio

Knowledge-first desktop IDE. Electron + TypeScript + React + Monaco.

Three ideas:

1. **Project knowledge is first-class and native.** Developers write plain
   Markdown files with YAML frontmatter under `.woo/knowledge/` in their own
   repo — rules, entities, components, workflows, decisions, linked by
   predicates. Woo's built-in engine indexes them directly: deterministic
   term-overlap retrieval, 1-hop graph expansion, bounded context, full source
   traceability. No external CLI, no embeddings, no network.
2. **The agent retrieves before it executes.** Every agent task builds a
   relevance-gated Context Pack from the knowledge base. Planning gets compact
   descriptions; execution gets up to five full documents before the first
   tool call. Low-confidence matches are not injected, and retrieved rules are
   binding.
3. **Secrets are enforced at the tool layer, not the prompt.** For Claude and
   Codex, the Secret Broker in the main process (a) denies agent reads of `.env`, `*.pem`, key
   and credential files, (b) filters tool results through provider hooks so
   values loaded from workspace secret files are concealed or replaced with a
   blocked-result message before the model transcript sees them, and (c) hands
   provider subprocesses a sanitized environment with secret-named shell vars
   withheld. Scope note: value
   scrubbing covers secrets the broker has loaded from the workspace; secrets
   it has never seen are protected by path denial and env sanitizing only.
   OpenCode is available as an explicitly experimental adapter with reduced
   enforcement because its SDK has no pre-transcript output-scrubbing hook.

Woo estimates the knowledge tokens for planning and execution while a task is
being typed. After an agent task changes workspace files, it offers a bounded
**Sync Knowledge** review: relevant documents receive a small implementation
status proposal, the developer selects what to apply, and no knowledge file is
changed without approval. Later syncs replace Woo's marked status block instead
of accumulating task history; secondary proposals only remove legacy duplicate
blocks, keeping retrieved context bounded. This
synchronization is deterministic and does not make another model call. Applying
or externally editing knowledge clears stale pinned context for every provider.

## Ten-minute setup

### Prerequisites

- Node.js 22.12 or newer and npm 10 or newer.
- macOS, Windows, or a modern Linux desktop.
- Git is recommended for checkpoints and Woo's source-control panel.
- A C/C++ toolchain and Python may be needed if npm cannot download a compatible
  prebuilt `node-pty` binary. On macOS, install Xcode Command Line Tools; on
  Windows, install Visual Studio Build Tools; on Debian/Ubuntu, install the
  standard build-essential and Python packages.
- An agent-provider CLI is optional. The editor, knowledge engine, diagnostics,
  graph, terminal, Git panel, skills manager, and vault work without an account.

### 1. Install and launch

```bash
npm ci
npm run dev                      # opens the workspace picker
WOO_WORKSPACE="$PWD" npm run dev # opens this repository directly
```

Choosing **Open Folder** swaps the workspace inside the existing window. Woo
confirms unsaved edits, disposes project-bound agents, watchers, and terminal
state, then refreshes the workbench without relaunching Electron.

On the first launch, the **Setup** activity checks the runtime, native terminal,
workspace access, project knowledge, and supported provider CLIs. The editor
remains usable while optional provider checks are incomplete.

### 2. Initialize project knowledge

Open the **Knowledge** activity, then select **Initialize project knowledge**.
Woo creates a small, editable starter set under `.woo/knowledge/`: a
machine-checkable security rule, an architecture decision, and an example
entity. Replace the examples with real domain rules and decisions as soon as
possible; every relevant agent task retrieves these documents before it runs.

### 3. Connect an agent

Expand **Accounts**, connect an installed CLI, and select **Use**. Woo reuses
the CLI's existing credential store; it does not copy credentials into the
renderer or its own settings. Disconnecting a provider in Woo does not sign the
CLI out.

| Provider | Status in Woo | Setup |
| --- | --- | --- |
| Claude | Supported; path denial, sanitized environment, and pre/post-tool secret hooks | [Install Claude Code](https://docs.anthropic.com/en/docs/claude-code/getting-started), run `claude`, and complete its sign-in flow |
| Codex | Supported; workspace sandbox, path denial, sanitized environment, and pre/post-tool secret hooks | [Install and sign in to Codex CLI](https://learn.chatgpt.com/docs/codex/cli) |
| OpenCode | **Experimental**; see the reduced guarantee below | [Install OpenCode](https://opencode.ai/docs/) and run `opencode auth login` |

OpenCode is disabled by default. Developers must launch Woo with
`WOO_ENABLE_EXPERIMENTAL_OPENCODE=1` to make the provider available. OpenCode
does not expose a post-tool hook that can scrub output before it enters
OpenCode's own transcript. Woo compensates with path denial, a sanitized
environment, disabled web fetch, default-deny permissions, and renderer-output
scrubbing, but it cannot provide the same transcript-level guarantee as Claude
or Codex. Woo shows this warning whenever OpenCode is selected.

### 4. Run the first grounded task

1. Open `demo/insecureExample.ts`; the Problems panel should flag its
   intentionally hardcoded fake API key.
2. Enter `Explain the payment security rules and propose a safe fix` in the
   Agent panel.
3. Review the proposed plan and the planning/execution knowledge-token estimate.
4. Open the Context Pack to verify the source documents, then approve **Run**.
5. After files change, review the **Sync Knowledge** proposal and apply only the
   updates that remain true for the project.
6. As a boundary check, ask the agent to read `.env`. The Secret Broker should
   deny the tool call without exposing file content.

The Knowledge Graph highlights the current Context Pack and pending knowledge
updates. Its optional source layer overlays bounded TypeScript/JavaScript
relative imports without sending that graph to a provider.

## Everyday developer workflow

1. Open a repository with **Open Folder** or run `woo <path>` from a built,
   linked source checkout.
2. Initialize or review `.woo/knowledge/`. Keep rules, entities, workflows,
   components, and decisions short, current, and linked.
3. Edit normally in Monaco. Built-in language suggestions remain available;
   use **◈ Suggest** or `Ctrl/Cmd+Space` for local, source-attributed references
   retrieved from project knowledge.
4. Enter a task in **AGENT** and press Enter. Use Shift+Enter for a newline.
5. Review the generated plan and Context Pack. **Improve with Knowledge** (or
   `Ctrl/Cmd+Space` while editing the plan) creates a reviewable revision and
   keeps the previous draft available through **Undo Improvement**.
6. Select **Run Plan** only after the plan and retrieved sources are correct.
   Woo creates a bounded local recovery backup before execution.
7. Review file changes, diagnostics, and any **Sync Knowledge** proposals.
   Knowledge changes are never applied without developer selection.

If an agent change is unsuitable, run **Recovery: Restore latest agent backup**
from the command palette. Restoring replaces files captured by that backup; it
does not remove new files created after the snapshot. Recovery data can be
inspected or deleted from **Privacy**.

## Command-line launcher

For a source checkout, build once and link the local command:

```bash
npm run build
npm link
woo .
woo src/main/index.ts            # open a file and use its directory as workspace
```

## Desktop packages

Woo uses `electron-builder` and rebuilds native dependencies for the bundled
Electron version. Its release script stages compiled output in a temporary
space-free path, so native packaging also works when the checkout path contains
spaces. Build on each target operating system:

```bash
npm run dist:dir                 # unpacked app for fast local verification
npm run dist                     # configured installer/archive for this OS
npm run dist:linux               # Linux AppImage explicitly
npm run dist:mac                 # macOS DMG and ZIP (run on macOS)
npm run dist:win                 # Windows NSIS installer (run on Windows)
```

Artifacts are written to `release/`. Linux produces an AppImage, macOS produces
a DMG and ZIP, and Windows produces an NSIS installer. Public releases should
be code-signed using the target platform's signing process. The tagged release
workflow, signing secrets, checksums, SBOMs, and provenance are documented in
[`docs/RELEASING.md`](docs/RELEASING.md).

### Build from a clean checkout

```bash
npm ci                            # exact locked dependencies + native rebuild
npm run verify                    # types, native module, tests, build, boundary
npm run dev                       # development Electron window
npm run build                     # compiled production files in out/
npm run dist:dir                  # unpacked application for local inspection
npm run smoke:packaged            # launch/edit/save/knowledge/agent smoke test
npm run dist:linux                # or dist:mac / dist:win on the target OS
npm run release:metadata -- --platform=linux
```

`npm run build` compiles the application but does not create an installer.
Use the matching `dist:*` command on each target operating system; do not treat
cross-built unsigned artifacts as release-ready. Release signing and publishing
requirements are covered in [`docs/RELEASING.md`](docs/RELEASING.md).

Woo maintains bounded local workspace backups before agent execution and
checkpoints unsaved editor buffers in a private per-workspace directory under
Electron's local application data, outside the repository. After an interrupted session it offers to
restore those buffers; **Restore latest workspace backup** is also available
from the command palette. See [`docs/DEVELOPER_TRIAL.md`](docs/DEVELOPER_TRIAL.md)
for the external usability-validation protocol.

Data flows, retention, deletion controls, and residual provider risks are documented
in [`PRIVACY.md`](PRIVACY.md); vulnerability reporting and supported security
boundaries are in [`SECURITY.md`](SECURITY.md).

In the code editor, `Ctrl/Cmd+Space` includes local, source-attributed references
from relevant project knowledge alongside Monaco suggestions. Plan drafts have an
explicit **Improve with Knowledge** action (the same shortcut while editing); it
requires a connected planner, never runs the plan automatically, and can be undone.

## Current stage: developer beta

Woo 0.1.x is suitable for developer evaluation and controlled repositories. Its
main advantages are deterministic, source-traceable project knowledge; explicit
plan and knowledge-update review; local-first editor/graph/diagnostic features;
tool-layer secret controls for supported providers; bounded recovery; and a
sandboxed, typed Electron boundary.

Important current limitations include lexical rather than semantic knowledge
retrieval, reference-oriented rather than generative code completion, provider
dependency for planning and execution, unsigned local packages unless release
signing is configured, a bounded TypeScript/JavaScript-only source graph, and an
experimental OpenCode adapter with weaker transcript guarantees. Arbitrary
sensitive documents cannot be perfectly identified from filenames, and recovery
does not delete newly created files. See
[`docs/CURRENT_STAGE.md`](docs/CURRENT_STAGE.md) for the full capability and
limitation matrix before using Woo with sensitive or production repositories.

## Verification

```bash
npm run typecheck
npm test
npm run build
npm run package:check            # package boundary: no secrets or local settings
# or run every gate in sequence:
npm run verify
```

## Troubleshooting

- **`node-pty` fails during install:** confirm Node 22.12+, install the native
  build prerequisites above, then run `npm run native:rebuild` followed by
  `npm run native:check`. Woo rebuilds in a temporary space-free path, so this
  also works when the checkout path contains spaces.
- **Packaging cannot download Electron headers:** confirm access to
  `electronjs.org` and GitHub, then rerun the same `npm run dist:*` command.
  Failed temporary staging directories are printed and retained for diagnosis.
- **A provider says “CLI not installed”:** verify `claude`, `codex`, or
  `opencode` works in the same shell that launches Woo, then restart Woo.
- **Sign-in opens but Woo stays disconnected:** complete sign-in in the
  provider CLI once, reopen Accounts, and reconnect. Woo intentionally stores
  only its connected/disconnected preference.
- **A blank window appears after a workspace switch:** close Woo and run
  `npm run build`, then `npm run dev` again. Production builds display a visible
  renderer-load diagnostic when no fallback bundle is available.
- **Knowledge is unavailable:** initialize it in the Knowledge activity or add
  valid frontmatter Markdown documents under `.woo/knowledge/`.
- **A relationship disappears from the graph:** open Problems and fix the
  `KNOW-EDGE` warning; relationship targets must match another document title,
  alias, or ID.

## Architecture

```
src/main/       Electron main — owns disk, knowledge, agent (UI-001)
  secretBroker  SEC-001 path denial + SEC-002 value scrubbing
  agentRunner   Claude adapter, authoritative PreToolUse + output broker hooks
  codexAgentRunner  Codex SDK adapter, offline workspace sandbox + broker hooks
  opencodeAgentRunner  experimental adapter, strict permissions + display scrub
  knowledge/    native engine: loader (frontmatter Markdown) +
                retrieval/graph/status, approved sync proposals, mtime reindex
  ruleChecker   frontmatter `checks:` -> diagnostics
  fileService   workspace tree/read/write, path-escape guarded
  sourceGraphService  bounded offline TypeScript/JavaScript import graph
src/preload/    typed contextBridge surface (`window.woo`)
src/renderer/   React workbench: explorer, knowledge tree, Monaco,
                Problems, Agent panel, Context Pack, Graph explorer
.woo/knowledge/ project knowledge — plain Markdown, developer-authored
```

## Knowledge file format

One file per concept, anywhere under `.woo/knowledge/`:

```markdown
---
title: PAY-RETRY-002 Declined Payments Never Retry
type: rule            # rule | entity | component | workflow | decision
description: Declined payments must never be automatically retried.
relationships:
  - predicate: applies-to        # applies-to | depends-on | enforced-by | uses | follows
    to: Payment Worker           # another doc's title or id
checks:               # optional — makes the rule machine-checkable
  - pattern: 'Result\.retry\(\)'
    severity: warning
    message: Declined payment branch must not retry.
---
Free Markdown body. The agent receives this when the rule is retrieved.
```

`checks:` patterns are evaluated against open files; matches appear as
Monaco squiggles and Problems rows with the rule as source.
