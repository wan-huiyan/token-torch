/* ============================================================================
 * Pure commit↔PR linkage (Plan 6 / issue #15). Walks a chronologically-ordered
 * event stream and assigns each commit to the PR open at the time it happened.
 * Boundary is the MERGE, not the create: a commit between `gh pr create` and
 * `gh pr merge N` attaches to N (the review-fixup case), not the next PR.
 * Commits with no owning PR (direct-to-main, or a no-PR session) are returned
 * separately — honestly grouped, never mis-attributed. No I/O; fully testable.
 * ========================================================================== */

/**
 * Unwraps a heredoc / command-substitution wrapper from a commit subject.
 *
 * These sessions commit via:
 *   git commit -m "$(cat <<'EOF'\n<subject>\n<body>\nCo-Authored-By: …\nEOF\n)"
 *
 * The extractShipped caller makes heredoc and inline captures mutually exclusive
 * per command (heredoc wins when present), so this function only needs to strip
 * any residual wrapper tokens that survive in an inline capture.
 */
export function cleanCommitSubject(raw: string): string {
  const lines = raw.split("\n");
  const skipLine = (l: string): boolean => {
    const t = l.trim();
    if (!t) return true;
    // heredoc opener embedded in inline capture: $(cat <<'EOF', $(cat <<"EOF", etc.
    if (/^\$\(cat\s+<</.test(t)) return true;
    // bare heredoc marker line: <<'EOF', <<"EOF", <<EOF, <<-EOF
    if (/^<<-?\s*['"]?\w+['"]?\s*$/.test(t)) return true;
    // heredoc/command-substitution closer lines: EOF, ), )", "
    if (/^(EOF|\)|[)"]{1,2})$/.test(t)) return true;
    // Co-Authored-By trailers
    if (/^Co-Authored-By:/i.test(t)) return true;
    return false;
  };
  for (const line of lines) {
    if (skipLine(line)) continue;
    // strip a leading inline $(cat <<'EOF' token that may still be on the first meaningful line
    const cleaned = line.trim().replace(/^\$\(cat\s+<<-?\s*['"]?\w+['"]?\s+/, "").trim();
    if (cleaned) return cleaned;
  }
  // #19: no real subject line found (wrapper-only / partial-heredoc capture). Return ""
  // so the caller drops it — never echo the raw `$(cat <<'EOF'…` fragment as a "commit".
  return "";
}

export type ShipEvent =
  | { kind: "pr_open"; num: string; title: string }
  | { kind: "pr_merge"; num?: string } // num omitted = a numberless `gh pr merge` (current branch) → clears the active PR
  | { kind: "commit"; subject: string };

export interface LinkedShipped {
  /** prNum → commit subjects, in chronological order */
  prCommits: Map<string, string[]>;
  /** commits with no owning PR (direct-to-main / no-PR session) */
  unlinkedCommits: string[];
}

export function linkCommitsToPrs(events: ShipEvent[]): LinkedShipped {
  const prCommits = new Map<string, string[]>();
  const unlinkedCommits: string[] = [];
  let pending: string[] = []; // commits seen before any PR opened
  let activePr: string | null = null;

  const push = (num: string, subject: string) => {
    const arr = prCommits.get(num) ?? [];
    arr.push(subject);
    prCommits.set(num, arr);
  };

  for (const e of events) {
    if (e.kind === "commit") {
      if (activePr) push(activePr, e.subject);
      else pending.push(e.subject);
    } else if (e.kind === "pr_open") {
      // the pending pre-create commits belong to this newly-opened PR
      const arr = prCommits.get(e.num) ?? [];
      prCommits.set(e.num, [...pending, ...arr]);
      pending = [];
      activePr = e.num;
    } else if (e.kind === "pr_merge") {
      // boundary: a matching numbered merge OR a numberless `gh pr merge` (current
      // branch) closes the active PR. Without this, a numberless merge would leave
      // activePr set and mis-attribute every later commit to the prior PR.
      if (e.num === undefined || activePr === e.num) activePr = null;
    }
  }
  unlinkedCommits.push(...pending);
  return { prCommits, unlinkedCommits };
}
