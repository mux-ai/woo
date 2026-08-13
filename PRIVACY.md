# Woo Studio data and privacy

Woo Studio is a local desktop application. It has no Woo-operated account,
analytics endpoint, advertising SDK, or automatic crash uploader. This document
describes the application itself; a selected agent provider processes data under
that provider's own terms and retention controls.

## Data inventory

| Data | Location | Retention | Leaves the device? |
| --- | --- | --- | --- |
| Workspace files | Developer-selected repository | Controlled by the developer | Only selected task context and provider tool activity |
| Agent backups | Private per-workspace directory under Electron `userData` | Five rolling backups, at most 5,000 files/100 MiB each | No |
| Unsaved buffers | Private per-workspace directory under Electron `userData` | Latest bounded checkpoint until saved/cleared | No |
| Crash diagnostics | Electron `userData/crashes` | Five reports, at most 30 days | No automatic upload |
| Vault | `.woo/vault.enc` | Until entries or vault are deleted | No; explicit terminal injection is local |
| Provider credentials/history | Provider CLI-owned storage | Provider-controlled | Provider-controlled |
| Broker audit events | Process memory | Until Woo exits | No |

Local recovery directories use operating-system mode `0700`; recovery files and
crash reports use `0600`. Secret-named files are excluded from recovery. Crash
messages and paths are redacted before being persisted.

## Agent processing

When a developer approves a task, Woo sends the task, the displayed Context Pack,
and subsequent permitted tool results to the selected provider. Woo sanitizes the
provider subprocess environment and blocks known secret paths and values. Agent
shell execution is disabled by default; `WOO_ALLOW_AGENT_SHELL=1` is an explicit
reduced-protection override. OpenCode remains experimental and disabled by default
because it lacks transcript-level output interception.

No filename filter can classify every possible sensitive document. Do not enable
agent shell execution for regulated or highly sensitive repositories without an
organization-specific review.

## Developer controls

The **Data and privacy** activity displays recovery, crash, telemetry, and shell
status. It can delete all recovery data for the open workspace and all Woo crash
reports. The **Vault** activity can remove individual entries or permanently delete
the vault after passphrase verification. Provider data must be managed using the
selected provider's CLI and account controls.

## Scope

Woo does not determine whether a repository contains personal or regulated data.
Organizations remain responsible for classifying their data, selecting an
appropriate provider and region, establishing a lawful basis, and configuring
retention according to their jurisdiction and contracts.
