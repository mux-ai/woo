# Contributing to Woo Studio

## Development loop

Use Node.js 22.12+ and npm 10+.

```bash
npm ci
npm run dev
```

Before submitting a change, run:

```bash
npm run typecheck
npm test
npm run build
npm run package:check
```

Use `npm run dist:dir` when a change touches startup, preload/main boundaries,
native modules, or packaging. The unpacked application is written under
`release/`.

## Keep project knowledge trustworthy

Woo uses its own `.woo/knowledge/` base while developing Woo. Update the
relevant rule, entity, component, workflow, or architecture decision whenever
behavior changes. Knowledge must describe current implementation—not planned
or superseded behavior—because Woo injects relevant documents into agent runs.

After editing knowledge, open the project in Woo and check the Problems panel
for `KNOW-EDGE` relationship warnings. Use exact document titles or stable IDs
for relationship targets.

## Security boundaries

- Renderer code must not access disk or processes directly; expose a narrow,
  validated IPC operation from the main process and preload bridge.
- Agent-visible reads and outputs must pass the Secret Broker at the strongest
  hook supported by the provider.
- Never add `.env`, credentials, local provider settings, build output, or
  release artifacts to the source or npm package boundary.
- OpenCode is experimental until it supports transcript-level post-tool output
  scrubbing equivalent to Claude and Codex.

## Packaging

`electron-builder.yml` contains the per-platform targets. Build installers on
their target operating systems and configure code-signing credentials outside
the repository. `scripts/package-desktop.mjs` performs a minimal, space-safe
native rebuild before calling electron-builder. Do not commit generated `out/`
or `release/` files.

Before a public usability milestone, run the anonymized external trial in
`docs/DEVELOPER_TRIAL.md`. Raw `trial-results/` stay local and ignored; only
aggregate findings belong in repository issues.
