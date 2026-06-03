/* ============================================================================
 * Raw-JSONL fallback extractor — per-subagent timing + cost.
 *
 * Fills the two things the processed corpus can't:
 *   1. totals.time_saved_min/_hours  — wall-clock saved by running subagents in
 *      PARALLEL = Σ(per-agent span) − union(spans). If they'd run serially it
 *      would have taken the sum; in parallel it took the union. (union, NOT sum
 *      — see skill concurrent-span-duration-union-not-sum. The global sum−union
 *      decomposes correctly across disjoint dispatch batches, so no batch
 *      grouping is needed.)
 *   2. cost.subagents_per_dispatch[] — per dispatched agent (used to FILL Schema
 *      A sessions; Schema C already carries its own per-model breakdown).
 *
 * Transcript layout (skill claude-code-workflow-subagent-tokens-nested-undercount):
 *   ~/.claude/projects/<slug>/<session-uuid>/subagents/
 *       agent-<id>.jsonl                       FOREGROUND Agent-tool dispatches
 *       workflows/wf_<run>/agent-<id>.jsonl    WORKFLOW fleet — one level DEEPER
 * We recurse (both kinds). Spans come from raw row timestamps (no dedup). Cost
 * comes from token usage deduped by message.id keeping the HIGHEST output_tokens
 * chunk (streaming chunks share an id; the first has output≈0). #files != #agents
 * (stall-retries spawn fresh transcripts) — count files, sum all; this modestly
 * inflates Σspans, so time_saved is an estimate (a lower bound under coverage).
 * ========================================================================== */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { OPUS_RATES, priceUsd, round2, type Rates, type TokenSet } from "./pricing";
import { extractUsageTokens } from "./ingest";
import type { Shipped, ShippedItem } from "../../src/types";
import { linkCommitsToPrs, cleanCommitSubject, type ShipEvent } from "./shippedLink";

export interface SubagentDispatch {
  id: string; // short agent id (matches Schema C's per-dispatch keys)
  usd: number;
  span_min: number;
  description?: string;
}

export interface JsonlFallbackResult {
  subagentTimings: SubagentDispatch[];
  timeSavedMin: number; // Σspans − union(spans)
  unionMin: number; // wall-clock the agents actually occupied (for the verify guard)
  sumMin: number; // serial-equivalent
  fileCount: number;
  available: boolean; // at least one transcript found
  /** subagent tokens split by the agent's dominant model (Option B per-model pricing). */
  subagentPerModelTokens: Record<string, TokenSet>;
  /** Σ per-dispatch base-context floor across this session's subagents (the N× catalog cost, tokens). */
  subagentScaffoldingTokens: number;
}

const EMPTY: JsonlFallbackResult = {
  subagentTimings: [],
  timeSavedMin: 0,
  unionMin: 0,
  sumMin: 0,
  fileCount: 0,
  available: false,
  subagentPerModelTokens: {},
  subagentScaffoldingTokens: 0,
};

const MS_PER_MIN = 60_000;

export const defaultProjectsDir = (): string => join(homedir(), ".claude", "projects");

/** id8 → list of `<slug>/<session-uuid>` session dirs that have a subagents/ subdir. */
export function buildSubagentIndex(projectsDir = defaultProjectsDir()): Map<string, string[]> {
  const index = new Map<string, string[]>();
  let projects: string[];
  try {
    projects = readdirSync(projectsDir);
  } catch {
    return index;
  }
  for (const proj of projects) {
    const projPath = join(projectsDir, proj);
    let entries: string[];
    try {
      if (!statSync(projPath).isDirectory()) continue;
      entries = readdirSync(projPath);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const m = /^([0-9a-f]{8})/i.exec(entry);
      if (!m) continue;
      const sessionDir = join(projPath, entry);
      if (!existsSync(join(sessionDir, "subagents"))) continue;
      const id8 = m[1].toLowerCase();
      (index.get(id8) ?? index.set(id8, []).get(id8)!).push(sessionDir);
    }
  }
  return index;
}

/** Recursively collect agent-*.jsonl under a subagents/ dir (foreground + workflows). */
function walkAgentFiles(dir: string, out: string[]): void {
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
    if (st.isDirectory()) walkAgentFiles(p, out);
    else if (/^agent-.*\.jsonl$/.test(e)) out.push(p);
  }
}

export interface AgentParse {
  startMs: number;
  endMs: number;
  tokens: TokenSet;
  totalTokens: number;
  model: string; // dominant model id of this agent's kept assistant messages (lowercased)
  scaffoldingFloor: number; // min nonzero cache_read across this dispatch's turns (base-context floor, issue #10)
  firstUserText?: string; // the task prompt handed to the subagent
}

/** flatten a message.content (string | block[]) to plain text. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((b: any) => (typeof b === "string" ? b : b?.type === "text" ? b.text : ""))
      .join(" ");
  return "";
}

/** Parse one agent transcript: span from raw timestamps; tokens deduped by
 *  message.id keeping the highest-output chunk (flat over the whole file). */
export function parseAgentFile(path: string): AgentParse | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  let startMs = Infinity;
  let endMs = -Infinity;
  let firstUserText: string | undefined;
  const usageById = new Map<string, any>();
  const modelById = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (!line) continue;
    let r: any;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof r.timestamp === "string") {
      const t = Date.parse(r.timestamp);
      if (!Number.isNaN(t)) {
        if (t < startMs) startMs = t;
        if (t > endMs) endMs = t;
      }
    }
    if (firstUserText === undefined && r.type === "user" && r.message) {
      const txt = contentText(r.message.content).trim();
      if (txt) firstUserText = txt;
    }
    if (r.type === "assistant") {
      const m = r.message;
      const u = m?.usage;
      if (m?.id && u) {
        const prev = usageById.get(m.id);
        if (!prev || (u.output_tokens ?? 0) > (prev.output_tokens ?? 0)) {
          usageById.set(m.id, u);
          modelById.set(m.id, (m.model ?? "unknown").toLowerCase());
        }
      }
    }
  }
  if (startMs === Infinity) return null;
  // Sum via the shared TOP-level funnel (same arithmetic as before, calibrated)
  // and tally the dominant model across the deduped messages.
  const tokens: TokenSet = { fresh_input: 0, output: 0, cache_write: 0, cache_read: 0 };
  const modelCount: Record<string, number> = {};
  // base-context floor for THIS dispatch (min nonzero cache_read across its turns).
  // Re-paid per dispatch → summed across a session's subagents = the "N× catalog" cost.
  let scaffoldingFloor = 0;
  for (const [id, u] of usageById) {
    const t = extractUsageTokens(u);
    tokens.fresh_input += t.fresh_input;
    tokens.output += t.output;
    tokens.cache_write += t.cache_write;
    tokens.cache_read += t.cache_read;
    if (t.cache_read > 0)
      scaffoldingFloor = scaffoldingFloor === 0 ? t.cache_read : Math.min(scaffoldingFloor, t.cache_read);
    const mdl = modelById.get(id) ?? "unknown";
    modelCount[mdl] = (modelCount[mdl] ?? 0) + 1;
  }
  const totalTokens = tokens.fresh_input + tokens.output + tokens.cache_write + tokens.cache_read;
  const model = Object.entries(modelCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
  return { startMs, endMs, tokens, totalTokens, model, scaffoldingFloor, firstUserText };
}

function readMeta(agentPath: string): { description?: string; agentType?: string } {
  const meta = agentPath.replace(/\.jsonl$/, ".meta.json");
  try {
    const d = JSON.parse(readFileSync(meta, "utf8"));
    return { description: d.description || undefined, agentType: d.agentType || undefined };
  } catch {
    return {};
  }
}

/** First meaningful line of a task prompt, trimmed for a label. The opening
 *  "You are a <role> …" line is usually the best one-line summary, so keep it
 *  (just tidy it); skip only structural noise (env preambles, paths, fences). */
function promptSnippet(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const NOISE = /^(environment\b|base directory|cwd\b|working directory|primary working|today's date|restored session|important[:!]|critical[:!]|note:|context:|the following|<|```|#{1,6}\s|[-*]\s|\/[A-Za-z])/i;
  let first = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 8 && !NOISE.test(l));
  if (!first) return undefined;
  first = first
    .replace(/\*\*|__|`/g, "") // strip md emphasis/code ticks
    .replace(/^you are an?\s+/i, "") // "You are an adversarial reviewer…" → "adversarial reviewer…"
    .replace(/^your (job|task) (is )?(to )?[:—-]?\s*/i, "")
    .trim();
  first = first.charAt(0).toUpperCase() + first.slice(1);
  // cut at the first sentence end for a tight label
  const dot = first.search(/[.!]\s/);
  if (dot > 20) first = first.slice(0, dot);
  return first.length > 90 ? first.slice(0, 88).trimEnd() + "…" : first;
}

/** Best-available label for what an agent did. */
function agentLabel(meta: { description?: string; agentType?: string }, firstUser?: string): string {
  if (meta.description) return meta.description;
  const snip = promptSnippet(firstUser);
  if (snip) return snip;
  return `workflow agent · ${meta.agentType ?? "general-purpose"}`;
}

/** union of [start,end] spans in ms (overlap-merging). */
function unionMs(spans: [number, number][]): number {
  if (!spans.length) return 0;
  const a = [...spans].sort((x, y) => x[0] - y[0]);
  let total = 0;
  let [cs, ce] = a[0];
  for (let i = 1; i < a.length; i++) {
    const [s, e] = a[i];
    if (s <= ce) ce = Math.max(ce, e);
    else {
      total += ce - cs;
      [cs, ce] = [s, e];
    }
  }
  return total + (ce - cs);
}

/** Extract per-subagent timing + cost for one session (8-char id). */
export function extractFromJsonl(
  id8: string,
  index: Map<string, string[]>,
  rates: Rates = OPUS_RATES,
): JsonlFallbackResult {
  const dirs = index.get(id8.toLowerCase()) ?? [];
  if (!dirs.length) return EMPTY;

  // collect agent files across all matching session dirs (worktree fanout-safe),
  // deduped by agent filename keeping the richest (max-token) copy.
  const best = new Map<string, { path: string; parse: AgentParse }>();
  let fileCount = 0;
  for (const dir of dirs) {
    const files: string[] = [];
    walkAgentFiles(join(dir, "subagents"), files);
    for (const f of files) {
      const parse = parseAgentFile(f);
      if (!parse) continue;
      fileCount++;
      const key = basename(f);
      const prev = best.get(key);
      if (!prev || parse.totalTokens > prev.parse.totalTokens) best.set(key, { path: f, parse });
    }
  }
  if (!best.size) return EMPTY;

  const spans: [number, number][] = [];
  let sumMs = 0;
  const subagentTimings: SubagentDispatch[] = [];
  // per-model subagent tokens over the SAME deduped agent set the cost uses.
  const subagentPerModelTokens: Record<string, TokenSet> = {};
  // Σ per-dispatch base-context floor (the N× catalog cost, issue #10).
  let subagentScaffoldingTokens = 0;
  for (const { path, parse } of best.values()) {
    spans.push([parse.startMs, parse.endMs]);
    sumMs += parse.endMs - parse.startMs;
    subagentScaffoldingTokens += parse.scaffoldingFloor;
    const idMatch = /agent-([0-9a-f]+)\.jsonl$/i.exec(path);
    subagentTimings.push({
      id: (idMatch?.[1] ?? basename(path)).slice(0, 8),
      usd: round2(priceUsd(parse.tokens, rates)),
      span_min: round2((parse.endMs - parse.startMs) / MS_PER_MIN),
      description: agentLabel(readMeta(path), parse.firstUserText),
    });
    const pk = (subagentPerModelTokens[parse.model] ??= { fresh_input: 0, output: 0, cache_write: 0, cache_read: 0 });
    pk.fresh_input += parse.tokens.fresh_input;
    pk.output += parse.tokens.output;
    pk.cache_write += parse.tokens.cache_write;
    pk.cache_read += parse.tokens.cache_read;
  }
  const union = unionMs(spans);
  return {
    subagentTimings: subagentTimings.sort((a, b) => b.usd - a.usd),
    timeSavedMin: round2(Math.max(0, sumMs - union) / MS_PER_MIN),
    unionMin: round2(union / MS_PER_MIN),
    sumMin: round2(sumMs / MS_PER_MIN),
    fileCount: best.size,
    available: true,
    subagentPerModelTokens,
    subagentScaffoldingTokens,
  };
}

/* ---------------------------------------------------------------------------
 * "What shipped" — high-precision mining from the transcripts. Only emits what
 * it can extract confidently; omits anything uncertain (the detail view hides
 * an absent shipped section). Never fabricates.
 *   prs     — gh pr create (title + resulting /pull/N) and gh pr merge #N
 *   reviews — subagent .meta.json descriptions matching /review/
 *   skills  — Write to skills/<name>/SKILL.md (authored)
 *   adrs    — Write to an ADR/decision-record .md
 * ------------------------------------------------------------------------- */

const TITLE_RE = /(?:--title|-t)[= ]+(?:"([^"]+)"|'([^']+)')/;
const PULL_RE = /github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/g;
const MERGE_RE = /gh pr merge\b[^\n]*?#?(\d+)/g;
const SKILL_RE = /(?:^|\/)skills\/([^/]+)\/SKILL\.md$/i;
const ADR_RE = /(?:adr[-/]|decisions?\/)[^/]*\.md$|\bADR-?\d+[^/]*\.md$/i;
const COMMIT_INLINE_RE = /git commit\b[^\n]*?-m\s+(?:"([^"]+)"|'([^']+)')/g;
// heredoc form: git commit -m "$(cat <<'EOF'\n<subject>\n...  → capture the subject line
const COMMIT_HEREDOC_RE = /git commit\b[^\n]*<<-?\s*['"]?\w+['"]?\s*\n\s*([^\n]+)/g;

function* mainRecords(mainJsonlPath: string): Generator<any> {
  let text: string;
  try {
    text = readFileSync(mainJsonlPath, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      yield JSON.parse(line);
    } catch {
      /* skip */
    }
  }
}

function uniqBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const k = key(it);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(it);
    }
  }
  return out;
}

export function extractShipped(
  id8: string,
  index: Map<string, string[]>,
  timings: SubagentDispatch[] = [],
): Shipped | undefined {
  const dirs = index.get(id8.toLowerCase()) ?? [];
  if (!dirs.length) return undefined;

  // (1) gather every main record across all worktree-fanout dirs, in true
  //     chronological order — so a PR's `gh pr create` never precedes its own
  //     pre-commits (claude-code-projects-jsonl-worktree-fanout).
  const stamped: { ts: number; record: any }[] = [];
  for (const sessionDir of dirs)
    for (const r of mainRecords(sessionDir + ".jsonl")) {
      const ts = Date.parse(r?.timestamp ?? "");
      stamped.push({ ts: Number.isNaN(ts) ? 0 : ts, record: r });
    }
  stamped.sort((a, b) => a.ts - b.ts);

  // (2) single pass → events + pr metadata + skills/adrs/files.
  const prByNum = new Map<string, { title?: string; merged: boolean; opened: boolean }>();
  const events: ShipEvent[] = [];
  const skills: ShippedItem[] = [];
  const adrs: ShippedItem[] = [];
  const filesTouched = new Set<string>();
  let pendingCreateTitle: string | null = null;

  for (const { record: r } of stamped) {
    const content = r?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "tool_use") {
        const name = b.name;
        const input = b.input ?? {};
        if (name === "Bash") {
          const cmd: string = input.command ?? "";
          if (/gh pr create/.test(cmd)) {
            const m = TITLE_RE.exec(cmd);
            pendingCreateTitle = m ? (m[1] ?? m[2]) : "(untitled PR)";
          }
          if (/\bgh pr merge\b/.test(cmd)) {
            let numbered = false;
            for (const mm of cmd.matchAll(MERGE_RE)) {
              numbered = true;
              const e = prByNum.get(mm[1]) ?? { merged: false, opened: false };
              e.merged = true;
              prByNum.set(mm[1], e);
              events.push({ kind: "pr_merge", num: mm[1] });
            }
            // a numberless `gh pr merge` (current branch, e.g. `--auto`) still closes the active PR
            if (!numbered) events.push({ kind: "pr_merge" });
          }
          const heredocSubs = [...cmd.matchAll(COMMIT_HEREDOC_RE)].map((m) => cleanCommitSubject(m[1]));
          if (heredocSubs.length) {
            for (const s of heredocSubs) events.push({ kind: "commit", subject: s });
          } else {
            for (const mm of cmd.matchAll(COMMIT_INLINE_RE))
              events.push({ kind: "commit", subject: cleanCommitSubject(mm[1] ?? mm[2]) });
          }
        } else if (name === "Write" || name === "Edit" || name === "NotebookEdit") {
          const fp: string = input.file_path ?? input.notebook_path ?? "";
          if (fp) filesTouched.add(fp);
          if (name === "Write") {
            const sm = SKILL_RE.exec(fp);
            if (sm) skills.push({ title: sm[1], meta: "authored" });
            else if (ADR_RE.test(fp)) adrs.push({ title: basename(fp), meta: "decision record" });
          }
        }
      } else if (b.type === "tool_result") {
        // a /pull/N URL right after a `gh pr create` → that newly-opened PR.
        const cont = b.content;
        const txt =
          typeof cont === "string"
            ? cont
            : Array.isArray(cont)
              ? cont.map((x: any) => (x?.type === "text" ? x.text : "")).join("\n")
              : "";
        for (const mm of txt.matchAll(PULL_RE)) {
          if (pendingCreateTitle != null) {
            const e = prByNum.get(mm[1]) ?? { merged: false, opened: false };
            e.opened = true;
            if (!e.title) e.title = pendingCreateTitle;
            prByNum.set(mm[1], e);
            events.push({ kind: "pr_open", num: mm[1], title: pendingCreateTitle });
            pendingCreateTitle = null;
          }
        }
      }
    }
  }

  // (3) reviews ← subagent meta descriptions mentioning "review", enriched with the
  // backing dispatch's REAL cost + duration (each review IS a subagent run).
  const costFor = (desc: string): string | undefined => {
    const t = timings.find(
      (x) => x.description && (x.description.startsWith(desc) || desc.startsWith(x.description.slice(0, 80))),
    );
    if (!t) return undefined;
    const span = t.span_min >= 1 ? `${Math.round(t.span_min)}m` : `${Math.round(t.span_min * 60)}s`;
    return `$${t.usd.toFixed(2)} · ${span}`;
  };
  const allReviews: ShippedItem[] = [];
  for (const sessionDir of dirs) {
    const metas: string[] = [];
    collectMetaFiles(join(sessionDir, "subagents"), metas);
    for (const mf of metas) {
      try {
        const d = JSON.parse(readFileSync(mf, "utf8"));
        const desc: string = d.description ?? "";
        if (/\breview\b/i.test(desc)) {
          const pr = /(?:PR\s*)?(\d{2,5})/.exec(desc);
          const meta = costFor(desc);
          allReviews.push({ title: desc.slice(0, 80), ...(pr ? { ref: `#${pr[1]}` } : {}), ...(meta ? { meta } : {}) });
        }
      } catch {
        /* skip */
      }
    }
  }
  const reviewsDeduped = uniqBy(allReviews, (r) => r.title);

  // (4) commit linkage + nesting.
  const { prCommits, unlinkedCommits } = linkCommitsToPrs(events);
  const reviewsByRef = new Map<string, ShippedItem[]>();
  const unlinkedReviews: ShippedItem[] = [];
  for (const rv of reviewsDeduped) {
    if (rv.ref && prByNum.has(rv.ref.replace(/^#/, ""))) {
      const k = rv.ref.replace(/^#/, "");
      if (!reviewsByRef.has(k)) reviewsByRef.set(k, []);
      reviewsByRef.get(k)!.push(rv);
    } else unlinkedReviews.push(rv);
  }

  const commitItem = (s: string): ShippedItem => ({ title: s.length > 80 ? s.slice(0, 78) + "…" : s });

  const prs: ShippedItem[] = [...prByNum.entries()]
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([num, e]) => {
      const nestedCommits = uniqBy((prCommits.get(num) ?? []).map(commitItem), (c) => c.title);
      const nestedReviews = reviewsByRef.get(num) ?? [];
      return {
        title: e.title ?? `Pull request #${num}`,
        ref: `#${num}`,
        meta: e.merged ? "merged" : "opened", // STATUS ONLY — never a cost (honesty: no per-PR $)
        ...(nestedCommits.length ? { commits: nestedCommits } : {}),
        ...(nestedReviews.length ? { reviews: nestedReviews } : {}),
      };
    });

  const directCommits = uniqBy(unlinkedCommits.map(commitItem), (c) => c.title);

  const shipped: Shipped = {};
  if (prs.length) shipped.prs = prs.slice(0, 12);
  if (unlinkedReviews.length) shipped.reviews = unlinkedReviews.slice(0, 12);
  if (adrs.length) shipped.adrs = uniqBy(adrs, (a) => a.title);
  if (skills.length) shipped.skills = uniqBy(skills, (s) => s.title);
  if (directCommits.length) shipped.commits = directCommits.slice(0, 10);
  if (filesTouched.size) shipped.files_touched = filesTouched.size;
  return Object.keys(shipped).length ? shipped : undefined;
}

function collectMetaFiles(dir: string, out: string[]): void {
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
    if (st.isDirectory()) collectMetaFiles(p, out);
    else if (e.endsWith(".meta.json")) out.push(p);
  }
}
