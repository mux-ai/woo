# Woo Studio current stage

Woo Studio 0.1.x is a developer beta. It is intended for local evaluation,
controlled development repositories, and teams willing to review agent plans,
retrieved knowledge, diffs, and release artifacts. It is not presented as a
zero-review autonomous coding system or a compliance-certified security tool.

## Advantages

| Area | Current advantage |
| --- | --- |
| Project knowledge | Plain Markdown and YAML live with the repository; retrieval is deterministic, bounded, local, and source-traceable. |
| Agent workflow | Planning retrieves a compact knowledge summary; execution retrieves fuller relevant documents; both remain visible to the developer. |
| Code assistance | Monaco provides language services, while explicit `Ctrl/Cmd+Space` adds local references and paths extracted from relevant knowledge with source attribution. |
| Plan assistance | A connected planner can improve a draft with project knowledge; the result remains editable, requires explicit Run, and supports one-step undo. |
| Data protection | The Electron renderer is sandboxed; IPC is typed and sender-validated; supported agents receive a sanitized environment and tool-layer secret checks. |
| Recovery | Woo creates private, bounded rolling backups before agent execution and checkpoints bounded non-secret unsaved buffers. |
| Offline core | Editing, retrieval, graphs, rules, Git, terminal, recovery, and knowledge completion do not require a Woo cloud service. |
| Distribution | Linux, macOS, and Windows packaging scripts rebuild native dependencies for Electron and support checksums, SBOMs, and provenance workflows. |
| Quality gates | Type checks, native-module validation, unit/integration tests, production builds, package-boundary checks, and a packaged-app smoke test are automated. |

## Limitations and operational consequences

| Limitation | Consequence or mitigation |
| --- | --- |
| Knowledge retrieval is lexical term overlap plus one graph hop, not embeddings or semantic search. | Use precise titles, descriptions, aliases, and relationships. Inspect the Context Pack; relevant knowledge can be missed when vocabulary differs. |
| Knowledge code completion extracts documented references and paths; it does not generate arbitrary whole functions. | Use Monaco completion for language symbols and the agent workflow for reviewed implementation work. |
| Plan improvement and agent execution use the selected external provider. | Task text, the current plan, bounded knowledge, and permitted tool results are processed under that provider's terms. Code knowledge completion itself stays local. |
| Claude and Codex have the strongest implemented tool boundaries; OpenCode lacks an equivalent pre-transcript output hook. | OpenCode is disabled by default, explicitly experimental, and should not be used where transcript-level secret protection is required. |
| Secret classification cannot identify every confidential business document or a secret value Woo has never learned. | Keep agent shell disabled, review context and tool activity, use least-sensitive workspaces, and perform an organization-specific assessment for regulated data. |
| Agent shell execution is disabled by default. | Some build/test workflows require the developer terminal. `WOO_ALLOW_AGENT_SHELL=1` is a deliberate reduced-protection override, not a routine setting. |
| Recovery snapshots are capped at five backups, 5,000 files, and 100 MiB each, and restoring does not delete newly created files. | Use Git commits for authoritative rollback and inspect new/untracked files after recovery. |
| Source graph analysis is bounded to TypeScript/JavaScript relative imports. | Other languages still have editing and syntax support but do not receive an equivalent source dependency overlay. |
| Packages are not automatically trusted merely because they build. | Build on the target OS, run verification and packaged smoke tests, configure platform signing, and follow `docs/RELEASING.md`. |
| There is no Woo-hosted collaboration, cloud sync, telemetry service, or automatic crash upload. | Repository knowledge and local recovery remain machine-local; teams distribute knowledge through their normal version-control workflow. |

## Recommended beta usage boundary

- Keep the repository under Git and commit or stash intentional work before
  agent execution.
- Review the Context Pack and plan before Run, and inspect the diff afterward.
- Prefer Claude or Codex for sensitive work; leave experimental OpenCode off.
- Keep agent shell disabled unless a specific task justifies the reduced
  protection.
- Do not use Woo as the sole control for regulated, production-secret, or
  safety-critical repositories without an independent security assessment.
- Produce signed artifacts through the documented release workflow before
  distributing them to other developers.
