/* ============================================================================
 * Pure, React-free minute formatter. Lives in src/shared/ so both dashboard
 * and session helpers can re-export it (src/session/ may not import ../dashboard/)
 * and so it can be unit-tested directly under tsx without loading React.
 *
 * Round the TOTAL minutes ONCE, then split into h/m — this fixes the carry bug
 * where Math.round(n % 60) could yield 60 (e.g. n=719.7 → "11h 60m"). No `num`
 * helper needed: the no-hours branch only fires for n < 60 where there is no
 * thousands separator to format.
 * ========================================================================== */

/** "1h 23m" / "45m" / "12h 0m". Carry-safe: rounds total minutes, then splits. */
export function mins(n: number): string {
  const total = Math.round(n);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${m}m` : `${total}m`;
}
