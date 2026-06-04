/* ============================================================================
 * TOKEN TORCH redesign — RECOMMENDATIONS tab.
 * Recreates 00-dashboard.html `.recs` (`.flags` + `.insights`) + dashboard.js
 * renderRecs. Binds the REAL data.flags[] and data.insights_md; honesty mined
 * from the old Recommendations.tsx:
 *   - flags render only when present (honest-empty state otherwise — no fab);
 *   - the AI-written provenance tag appears ONLY when insights_source === "llm",
 *     and uses a pixel STAR sprite (no emoji glyph) for chat-no-emoji chrome;
 *   - the LLM prose itself (md()-rendered) may contain emoji — that's the model's
 *     content/voice, rendered verbatim (the no-fab validator gates it at gen-time);
 *   - null insights_md → tasteful placeholder (no fabrication).
 * Flag icon mapping (verbatim from renderRecs's icoFor):
 *   metric "parallel" → bolt · metric "cache" → coin ·
 *   else level "warn" → flame (mountFlame inferno) · else → star.
 * ========================================================================== */
import type { DashboardData, Flag } from "../../types";
import { md } from "../helpers";
import { Sprite } from "../Sprite";
import { mountFlame, mountMascot, mountIcon } from "../spriteEngine";

/** Mount the pixel-sprite icon for a flag, keyed on metric/level — verbatim from
 *  renderRecs's icoFor() + its mount switch (flame uses mountFlame inferno; all
 *  other icons use mountIcon). */
function FlagIcon({ flag }: { flag: Flag }) {
  // The `.fi` box (display:grid;place-items:center) wraps the Sprite host, because
  // Sprite hard-sets display:inline-flex inline and would otherwise defeat .fi's
  // own centering — keeping the pixel icon centered in the 24px chip.
  return (
    <div className="fi">
      <Sprite
        mount={(host) => {
          if (flag.metric === "parallel") return void mountIcon(host, "bolt", 2);
          if (flag.metric === "cache") return void mountIcon(host, "coin", 2);
          if (flag.level === "warn") return mountFlame(host, 2, "inferno");
          return void mountIcon(host, "star", 2);
        }}
      />
    </div>
  );
}

export function RecsTab({ data }: { data: DashboardData }) {
  const ins = md(data.insights_md);
  return (
    <div className="recs">
      <div className="flags">
        {data.flags.length > 0 ? (
          data.flags.map((f, i) => (
            <div className={"flag " + f.level} key={i}>
              <FlagIcon flag={f} />
              <div>
                <div className="ft">{f.title}</div>
                <div className="fd">{f.detail}</div>
              </div>
            </div>
          ))
        ) : (
          <div className="fd" style={{ padding: "15px 17px", fontFamily: "var(--mono)" }}>
            No flags — nothing notable to surface for this window.
          </div>
        )}
      </div>

      <div className="insights">
        <div className="ih">
          <Sprite className="ihbot" mount={(host) => mountMascot(host, 2)} />
          <span>auto-generated insights</span>
          {data.insights_source === "llm" && (
            <span className="ai-tag" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
              <Sprite mount={(host) => void mountIcon(host, "star", 2)} />
              AI-written
            </span>
          )}
        </div>
        {ins ? (
          // md() returns a trusted, HTML-escaped string emitting only <p>/<ul>/<li>/<strong>.
          // The LLM prose content (incl. any emoji it wrote) is rendered verbatim.
          <div dangerouslySetInnerHTML={{ __html: ins }} />
        ) : (
          <div className="insights-empty">
            <p>No auto-insight generated for this window.</p>
            <p>Insights appear once there's enough signal.</p>
          </div>
        )}
      </div>
    </div>
  );
}
