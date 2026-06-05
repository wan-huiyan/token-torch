/* ============================================================================
 * #22 — orphaned per-session JSON detection. `generate` writes public/data/sessions/<id>.json
 * for every CURRENT session but never prunes files for sessions that have dropped out of the
 * corpus. Investigation (S15): every orphan is a session whose source transcript was
 * deleted/rotated out of ~/.claude/projects — the set is MONOTONIC (a deleted transcript never
 * returns), so a FULL-SCAN prune is safe. The destructive prune is gated behind --prune-orphans
 * in generate.ts; this module is the pure, testable set difference.
 * ========================================================================== */

const JSON_EXT = ".json";

/** The session ids present on disk (as `<id>.json` filenames) that are NOT in the current kept
 *  set. Non-.json files are ignored. Pure — the I/O (readdir/unlink/log) lives in generate.ts. */
export function orphanSessionIds(diskFiles: string[], keptIds: Set<string> | string[]): string[] {
  const kept = keptIds instanceof Set ? keptIds : new Set(keptIds);
  return diskFiles
    .filter((f) => f.endsWith(JSON_EXT))
    .map((f) => f.slice(0, -JSON_EXT.length))
    .filter((id) => !kept.has(id));
}
