# Woo Studio threat model

## Protected assets

- Workspace source code and personal information.
- Credentials, signing keys, cloud configuration, and encrypted vault values.
- Provider credentials and transcripts owned by external CLIs.
- Release artifacts and update/signing credentials.

## Trust boundaries

1. The sandboxed renderer is untrusted relative to the Electron main process.
2. Main-process IPC validates the originating WebContents and main frame.
3. Agent providers are external processors; only developer-approved task context
   should cross that boundary.
4. Agent-generated commands and paths are untrusted input.
5. Workspace files may contain malicious instructions, symlinks, or build scripts.

## Primary controls

- CSP, renderer sandboxing, context isolation, denied navigation/windows/permissions,
  typed preload APIs, IPC payload validation, and sender validation.
- Workspace-bound canonical path checks, symlink-escape denial, expanded secret-file
  classification, recursive value discovery, sanitized provider environments, and
  output scrubbing.
- Default denial of agent shell execution and network access where provider controls
  permit it.
- AES-256-GCM vault encryption with versioned strong scrypt derivation, atomic
  `0600` storage, 30-minute automatic locking, and authenticated deletion.
- Private off-repository recovery storage, bounded retention, redacted crash reports,
  user deletion controls, signed release workflows, SBOMs, and provenance.

## Residual risks

- A developer may explicitly enable agent shell execution. Shell syntax and project
  build scripts cannot be reliably classified by regular expressions.
- A selected provider receives approved context and controls its own server-side
  retention and account history.
- OpenCode has no pre-transcript output-scrubbing hook and remains experimental.
- A process running as the same operating-system user may be able to inspect memory,
  terminal processes, or files that user can access.
- Secret classification is conservative but cannot recognize every organization-
  specific format. Organization patterns and provider contracts still require review.

## Release gate

Public production release requires green automated security tests, signed artifacts
on each platform, real-provider canary tests, an external developer trial, and an
independent review of the renderer/IPC and agent-execution boundaries.
