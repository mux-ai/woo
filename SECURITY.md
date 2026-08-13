# Security policy

## Supported versions

Security fixes are provided for the latest published beta only. Developers should
upgrade promptly because each Woo release includes a specific Electron/Chromium
runtime and dependency set.

## Reporting a vulnerability

Do not publish suspected vulnerabilities, credentials, exploit code, provider
transcripts, or private workspace content in a public issue. Use the repository
host's private vulnerability-reporting or security-advisory channel. Include only
the minimum reproduction needed: Woo version, operating system, affected boundary,
impact, and sanitized steps.

Maintainers should acknowledge a report within three business days, establish
severity and an owner within seven days, and coordinate disclosure only after a
fix or documented mitigation is available. Compromised release credentials or an
active secret-exposure path require immediate release suspension and credential
rotation.

## Security boundaries

- The renderer is sandboxed, context-isolated, navigation-blocked, and exposed only
  to a typed, sender-validated IPC surface.
- Agent shell execution and OpenCode are disabled by default.
- Provider credentials remain in provider-owned CLI stores.
- Workspace secret paths, environment variables, and known values are blocked or
  scrubbed at the strongest hook supported by each provider.
- Local recovery and crash data are private, bounded, and user-deletable.
- Release artifacts use checksums, SBOMs, provenance, and platform signing where
  the target supports it.

See [PRIVACY.md](PRIVACY.md) and [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for
data flows, limitations, and residual risks.
