/**
 * PTY spawn environment merge — the single seam through which vault values
 * reach a shell. Kept in its own module (no node-pty import) so tests can
 * pin the invariant: the merge NEVER mutates the base (process.env), it
 * returns a fresh object for the spawn call only.
 */
export function mergePtyEnv(
  base: NodeJS.ProcessEnv,
  extra: Record<string, string>
): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const [name, value] of Object.entries(base)) {
    if (value != null) merged[name] = value
  }
  return Object.assign(merged, extra)
}
