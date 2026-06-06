import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

/** One skill on disk: its dir name + whether it's hidden from the model-invocable catalog. */
export interface SkillEntry {
  name: string;
  hidden: boolean; // frontmatter `disable-model-invocation: true`
}

/** A point-in-time snapshot of the catalog's hidden state (aggregate counts only — no skill names). */
export interface CatalogSnapshot {
  date: string;                 // ISO calendar day (YYYY-MM-DD)
  total_skills: number;
  hidden_count: number;
  per_injection_tokens: number; // bare-name floor: Σ over hidden of (len(name)+3)/4
}

/** Default local store — lives with the rest of the user's corpus; NEVER committed. */
export const DEFAULT_SNAPSHOT_PATH = join(homedir(), ".claude", "usage-tracking", "context-police-snapshots.jsonl");
/** Default catalog dir. */
export const DEFAULT_SKILLS_DIR = join(homedir(), ".claude", "skills");

/** Bare-name catalog token floor: "- name\n" ≈ (len(name)+3)/4 chars→tokens, summed over HIDDEN skills. */
export function perInjectionTokens(entries: SkillEntry[]): number {
  let t = 0;
  for (const e of entries) if (e.hidden) t += (e.name.length + 3) / 4;
  return t;
}

export function computeSnapshot(date: string, entries: SkillEntry[]): CatalogSnapshot {
  return {
    date,
    total_skills: entries.length,
    hidden_count: entries.filter((e) => e.hidden).length,
    per_injection_tokens: perInjectionTokens(entries),
  };
}

/** Read a skills dir → SkillEntry[]. A skill is HIDDEN if its SKILL.md frontmatter has
 *  `disable-model-invocation: true`. Missing/unreadable SKILL.md → skipped. */
export function readSkillsDir(skillsDir: string = DEFAULT_SKILLS_DIR): SkillEntry[] {
  if (!existsSync(skillsDir)) return [];
  const out: SkillEntry[] = [];
  for (const name of readdirSync(skillsDir)) {
    const md = join(skillsDir, name, "SKILL.md");
    if (!existsSync(md)) continue;
    let text = "";
    try { text = readFileSync(md, "utf8"); } catch { continue; }
    const fmEnd = text.startsWith("---") ? text.indexOf("\n---", 3) : -1;
    const fm = fmEnd !== -1 ? text.slice(3, fmEnd) : "";
    const hidden = /^\s*disable-model-invocation:\s*true\s*$/m.test(fm);
    out.push({ name, hidden });
  }
  return out;
}

/** Append a snapshot, de-duping per calendar day (last write wins). Creates the file/dir if absent. */
export function appendSnapshot(path: string, snap: CatalogSnapshot): void {
  const existing = loadSnapshots(path).filter((s) => s.date !== snap.date);
  existing.push(snap);
  existing.sort((a, b) => a.date.localeCompare(b.date));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, existing.map((s) => JSON.stringify(s)).join("\n") + "\n");
}

/** Load all snapshots, sorted by date ascending. Missing file → []. */
export function loadSnapshots(path: string): CatalogSnapshot[] {
  if (!existsSync(path)) return [];
  const out: CatalogSnapshot[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s) as CatalogSnapshot); } catch { /* skip bad line */ }
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}
