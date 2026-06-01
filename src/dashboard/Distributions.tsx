import type { DashboardData } from "../types";
import { num, pct, useGrowWidth } from "./helpers";
import { prettyModel } from "./aggregate";
import { Section } from "./Section";

const COLS = ["var(--cyan)", "var(--lime)", "var(--magenta)", "var(--amber)"];

/**
 * Make long MCP tool ids readable:
 *   mcp__plugin_playwright_playwright__browser_take_screenshot → "playwright · browser_take_screenshot"
 *   mcp__atom-of-thoughts__AoT-full                            → "atom-of-thoughts · AoT-full"
 * Non-MCP names pass through unchanged. The full id is still shown via title= on hover.
 */
function prettyTool(name: string): string {
  if (!name.startsWith("mcp__")) return name;
  const rest = name.slice(5);
  const i = rest.indexOf("__");
  if (i === -1) return rest;
  let server = rest.slice(0, i).replace(/^plugin_/, "");
  const parts = server.split("_");
  if (parts.length >= 2 && parts[parts.length - 1] === parts[parts.length - 2]) {
    server = parts.slice(0, -1).join("_"); // collapse "playwright_playwright" → "playwright"
  }
  return `${server} · ${rest.slice(i + 2)}`;
}

/** One ranked tool row: truncating name · grow-on-mount bar · right-aligned count. */
function ToolRow({ name, widthPct, value, color }: { name: string; widthPct: number; value: number; color: string }) {
  return (
    <div className="trow">
      <div className="tname" title={name}>
        {prettyTool(name)}
      </div>
      <div className="tbar">
        <i style={useGrowWidth(widthPct, { background: color })} />
      </div>
      <div className="tval">{num(value)}</div>
    </div>
  );
}

/** A single segment of the model-mix stacked bar (own component so the grow hook is valid in a map). */
function Seg({ widthPct, color, title }: { widthPct: number; color: string; title: string }) {
  return <i title={title} style={useGrowWidth(widthPct, { background: color })} />;
}

export function Distributions({ data }: { data: DashboardData }) {
  const d = data.distributions;

  const modelEntries = Object.entries(d.model_mix).sort((a, b) => b[1] - a[1]);
  const tools = Object.entries(d.tools_aggregate).sort((a, b) => b[1] - a[1]);
  const tmax = Math.max(1, ...tools.map((t) => t[1]));

  const ts = d.time_split;
  const span = ts.active_min + ts.idle_min;
  const aP = span ? (ts.active_min / span) * 100 : 0;
  const iP = span ? (ts.idle_min / span) * 100 : 0;

  // honest about single-model windows (and ready for when the mix actually diversifies)
  const modelCap =
    modelEntries.length <= 1
      ? `100% ${prettyModel(modelEntries[0]?.[0] ?? "")} — no model diversity in this window yet.`
      : `${modelEntries.length} models in the mix.`;

  return (
    <Section title="Distributions" n="tools · model · time">
      <div className="dist">
        {/* dominant column: the real content */}
        <div className="panel tools">
          <h4>Top tools — call counts ({tools.length})</h4>
          <div className="tgrid">
            {tools.map(([k, v], i) => (
              <ToolRow key={k} name={k} widthPct={(v / tmax) * 100} value={v} color={COLS[i % COLS.length]} />
            ))}
          </div>
        </div>

        {/* slim side column */}
        <div className="side">
          <div className="panel">
            <h4>Model mix</h4>
            <div className="stackbar">
              {modelEntries.map(([k, v], i) => (
                <Seg key={k} widthPct={v} color={COLS[i % COLS.length]} title={`${prettyModel(k)} ${v}%`} />
              ))}
            </div>
            <div className="legend">
              {modelEntries.map(([k, v], i) => (
                <span key={k}>
                  <b style={{ background: COLS[i % COLS.length] }} />
                  {prettyModel(k)} {pct(v, 0)}
                </span>
              ))}
            </div>
            <div className="tl-cap">{modelCap}</div>
          </div>

          <div className="panel">
            <h4>Active vs idle time</h4>
            <div className="timesplit">
              <div className="a" style={useGrowWidth(aP)}>
                <span>ACTIVE {pct(aP, 0)}</span>
              </div>
              <div className="i" style={useGrowWidth(iP)}>
                <span>IDLE {pct(iP, 0)}</span>
              </div>
            </div>
            <div className="tl-cap">
              {num(ts.active_min, 0)} active min vs {num(ts.idle_min, 0)} idle min. Idle time is you stepping away — it
              doesn't cost tokens.
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
