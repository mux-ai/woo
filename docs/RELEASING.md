# Releasing Woo Studio

Tagged releases are built independently on Linux, macOS, and Windows. The
workflow generates SHA-256 checksums, a production-dependency CycloneDX SBOM,
GitHub build provenance, and an SBOM attestation before publishing assets.

## Required GitHub secrets

macOS requires an Apple Developer ID Application certificate and notarization:

- `MAC_CSC_LINK`: base64-encoded `.p12` certificate
- `MAC_CSC_KEY_PASSWORD`: certificate password
- `APPLE_ID`: Apple developer account email
- `APPLE_APP_SPECIFIC_PASSWORD`: app-specific password
- `APPLE_TEAM_ID`: Apple Developer team identifier

Windows requires an exportable OV/EV-compatible certificate:

- `WIN_CSC_LINK`: base64-encoded `.pfx` certificate
- `WIN_CSC_KEY_PASSWORD`: certificate password

The release workflow enables electron-builder's `forceCodeSigning` setting for
macOS and Windows. Missing or invalid credentials fail the build instead of
silently publishing unsigned software. Certificates and passwords must never
be committed to the repository.

## Publish

1. Make the package version match the intended tag.
2. Ensure the CI workflow is green on all three operating systems.
3. Push a signed tag such as `v0.2.0`.
4. Verify checksums and attestations on the resulting GitHub release.

```bash
gh attestation verify Woo-Studio-0.2.0-linux-x64.AppImage --repo OWNER/REPOSITORY
sha256sum --check SHA256SUMS-linux.txt
```

Human release approval and the platform signing identities remain external
operational controls; the repository intentionally contains neither.
