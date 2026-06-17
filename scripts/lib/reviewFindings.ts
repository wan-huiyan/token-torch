/* ============================================================================
 * Review-findings ("mistakes caught") extractor — issue #72. A SECOND game stat
 * for the Build Streak calendar: confirmed findings raised by code reviews.
 *
 * HIGH-PRECISION FLOOR (by design). The naive approach — tally "P0/P1/P2" tokens
 * across review transcripts — overcounts ~316× on the real corpus, because the
 * review PROMPT defines the severity scale ("rate each finding P0…P3"), so the
 * tokens appear thousands of times without a single confirmed bug. We avoid the
 * trap two ways:
 *   1. Read ONLY the FINAL assistant message (the verdict) — never the prompt's
 *      scale text or mid-review scratch.
 *   2. Count a finding only when a severity tag `[Pn]` INTRODUCES a line
 *      (markdown header `### [P1]`, list item `- [P1]`, ordered `1. [P1]`,
 *      optionally bold). Inline prose mentions ("a [P1] concern") don't count.
 *
 * Two things stay `unknown` (NEVER zero-filled — honesty spine):
 *   • Reviews that write findings as free PROSE (the corpus norm) — we can't
 *     count them without re-introducing the overcount trap, so they're unknown.
 *   • PANEL per-reviewer transcripts (nested under subagents/workflows/) — the
 *     CONFIRMED, post-adjudication set is the judge's synthesis in the PARENT
 *     transcript, not the individual reviewer file. Summing per-reviewer findings
 *     would be a softer version of the very overcount we're avoiding.
 *
 * Net: coverage is intentionally partial (see the dashboard's review_findings
 * note). `confirmed` is a real, never-fabricated lower bound on mistakes caught.
 * ========================================================================== */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";

/** Caveat copy for the dashboard's review_findings summary — names the floor honestly. */
export const REVIEW_FINDINGS_NOTE =
  "A high-precision floor. Counts only severity-tagged findings (`[P0]`–`[P3]`) in a " +
  "review's final verdict. Most reviews write findings as prose, and panel reviewers' " +
  "findings are adjudicated elsewhere — those are unknown, never counted as zero. The " +
  "real number of mistakes caught is higher.";

export interface ReviewFindings {
  /** Σ severity-tagged confirmed findings across this session's PARSEABLE reviews. */
  confirmed: number;
  /** review subagents found for this session (foreground + panel-nested), deduped by file. */
  reviews_total: number;
  /** reviews whose final verdict yielded ≥1 tagged finding (the parsed subset; rest are unknown). */
  reviews_parsed: number;
}

interface ReviewMeta {
  description?: string;
  agentType?: string;
}

/** A subagent is a review iff its meta description has the word "review" or its
 *  agentType names a reviewer. (Same signal extractShipped uses for review links.) */
export function isReviewMeta(meta: ReviewMeta): boolean {
  const desc = `${meta.description ?? ""} ${meta.agentType ?? ""}`;
  return /\breview/i.test(desc);
}

/** A severity tag `[Pn]` introducing a line: optional leading whitespace, then an
 *  optional markdown header / list / ordered-list marker, optional bold, then `[Pn]`. */
const FINDING_RE = /^[ \t]*(?:#{1,6}[ \t]+|[-*+][ \t]+|\d+\.[ \t]+)?(?:\*\*|__)?\[P[0-3]\]/gm;

/** Count confirmed, severity-tagged findings in a verdict string. Pure. */
export function countConfirmedFindings(finalText: string): number {
  if (!finalText) return 0;
  const m = finalText.match(FINDING_RE);
  return m ? m.length : 0;
}

/** Flatten a message.content (string | block[]) to plain text. */
function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content.map((b: any) => (typeof b === "string" ? b : b?.type === "text" ? b.text ?? "" : "")).join("\n");
  return "";
}

/** The LAST non-empty assistant message text from a JSONL transcript string. Pure. */
export function parseFinalAssistantText(raw: string): string {
  const lines = raw.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const role = o.type ?? o.message?.role;
    if (role !== "assistant") continue;
    const txt = contentToText(o.message?.content).trim();
    if (txt) return txt;
  }
  return "";
}

function readMeta(agentPath: string): ReviewMeta {
  try {
    const d = JSON.parse(readFileSync(agentPath.replace(/\.jsonl$/, ".meta.json"), "utf8"));
    return { description: d.description || undefined, agentType: d.agentType || undefined };
  } catch {
    return {};
  }
}

/** Recursively collect agent-*.jsonl under a dir, recording whether each is panel-nested
 *  (under a workflows/ segment) so the caller can treat panel reviewers as unknown. */
function walkReviewFiles(dir: string, nested: boolean, out: { path: string; nested: boolean }[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkReviewFiles(p, nested || e === "workflows", out);
    else if (/^agent-.*\.jsonl$/.test(e)) out.push({ path: p, nested });
  }
}

/** Extract confirmed review findings for one session (8-char id). Returns undefined
 *  when the session dispatched NO review subagents (the caller omits the field then). */
export function extractReviewFindings(id8: string, index: Map<string, string[]>): ReviewFindings | undefined {
  const dirs = index.get(id8.toLowerCase()) ?? [];
  if (!dirs.length) return undefined;

  // collect agent files across all matching session dirs (worktree fanout-safe),
  // deduped by filename (the same review can appear under multiple worktree dirs).
  const byName = new Map<string, { path: string; nested: boolean }>();
  for (const dir of dirs) {
    const found: { path: string; nested: boolean }[] = [];
    walkReviewFiles(join(dir, "subagents"), false, found);
    for (const f of found) if (!byName.has(basename(f.path))) byName.set(basename(f.path), f);
  }
  if (!byName.size) return undefined;

  let confirmed = 0;
  let reviews_total = 0;
  let reviews_parsed = 0;
  for (const { path, nested } of byName.values()) {
    if (!isReviewMeta(readMeta(path))) continue; // not a review subagent → ignore
    reviews_total++;
    if (nested) continue; // panel per-reviewer: confirmed set is the judge's, not here → unknown
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const n = countConfirmedFindings(parseFinalAssistantText(raw));
    if (n > 0) {
      confirmed += n;
      reviews_parsed++;
    }
    // n === 0 → unknown (prose findings or a clean approve); never claimed as zero.
  }

  if (reviews_total === 0) return undefined;
  return { confirmed, reviews_total, reviews_parsed };
}
