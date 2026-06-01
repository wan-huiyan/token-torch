import type { DashboardData } from "../types";
import { md } from "./helpers";
import { Section } from "./Section";

/** flags[] → alert chips (warn=amber, info=cyan); insights_md → markdown panel
 *  (bold + bullets). Null insights_md → tasteful placeholder. */
export function Recommendations({ data }: { data: DashboardData }) {
  const ins = md(data.insights_md);
  return (
    <Section title="Recommendations" n="flags + insights">
      <div className="recs">
        <div className="flags">
          {data.flags.map((f, i) => (
            <div className={`flag ${f.level}`} key={i}>
              <div className="fi">{f.level === "warn" ? "!" : "i"}</div>
              <div>
                <div className="ft">{f.title}</div>
                <div className="fd">{f.detail}</div>
              </div>
            </div>
          ))}
        </div>
        {ins ? (
          <div className="insights">
            <div className="ih">◇ what to do next</div>
            {data.insights_source === "llm" && (
              <div className="ai-tag" style={{ fontSize: ".72rem", opacity: 0.7, marginBottom: ".3rem" }}>
                ✨ AI-written · {data.meta.generated_at.slice(0, 10)}
              </div>
            )}
            {/* md() only emits <p>/<ul>/<li>/<strong> from a trusted, HTML-escaped string. */}
            <div dangerouslySetInnerHTML={{ __html: ins }} />
          </div>
        ) : (
          <div className="insights placeholder">
            <div style={{ fontSize: "1.8rem" }}>🗒️</div>
            <div>No auto-insight generated for this window.</div>
            <div style={{ fontSize: ".78rem" }}>Insights appear once there's enough signal.</div>
          </div>
        )}
      </div>
    </Section>
  );
}
