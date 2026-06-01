/* Project-name normalization + grouping. Worktree runs append suffixes that
 * collapse to the base project; on top of that, an editable ALIAS map merges
 * name families you consider one logical project.
 *
 * Your own aliases live in a gitignored `projects.local.json` next to this file
 * (so personal/client project names never enter version control). Format — an
 * array of rules, first match wins, regex tested against the worktree-stripped
 * name:
 *
 *   [
 *     { "match": "^myproj(-|$)", "canonical": "myproj" },
 *     { "match": "^acme",        "canonical": "acme-corp", "flags": "i" }
 *   ]
 *
 * `flags` is optional (defaults to "i"). With no local file present, no aliasing
 * is applied — names are just worktree-stripped, which is the right default for
 * a fresh checkout.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export interface AliasRule {
  match: RegExp;
  canonical: string;
}

/** Generic built-in aliases (none by default — add yours via projects.local.json). */
const BUILTIN_ALIASES: AliasRule[] = [];

/** Load the optional, gitignored local override (real project names live here). */
function loadLocalAliases(): AliasRule[] {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(here, "projects.local.json"), "utf8");
    const rules = JSON.parse(raw) as { match: string; canonical: string; flags?: string }[];
    return rules.map((r) => ({ match: new RegExp(r.match, r.flags ?? "i"), canonical: r.canonical }));
  } catch {
    return []; // no local override — fine
  }
}

// Local rules first so personal overrides win on overlap.
const ALIASES: AliasRule[] = [...loadLocalAliases(), ...BUILTIN_ALIASES];

export function normalizeProject(raw: string): string {
  if (!raw) return "unknown";
  let p = raw;
  // "myproject--claude-worktrees-start-v7" → base
  p = p.replace(/--claude-worktrees-.*$/i, "");
  // "myproject (worktree start_v7)" → base
  p = p.replace(/\s*\(worktree[^)]*\)\s*$/i, "");
  p = p.trim().replace(/\s+/g, " ");
  for (const a of ALIASES) if (a.match.test(p)) return a.canonical;
  return p;
}
