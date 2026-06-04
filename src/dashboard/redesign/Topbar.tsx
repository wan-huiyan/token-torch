import type { DashboardData } from "../../types";
import { fmtDate, fmtStamp } from "../helpers";
import { Sprite } from "../Sprite";
import { mountMascot } from "../spriteEngine";
import { useWindow } from "../useWindow";

/** Topbar (00-dashboard.html lines 24-37) — pixel mascot + wordmark + live meta.
 *  winMeta uses the resolved active window (useWindow().range), not the static
 *  corpus date_range, so it tracks the selected time window. */
export function Topbar({ data }: { data: DashboardData }) {
  const { range } = useWindow();
  return (
    <header className="topbar">
      <div className="brand">
        <Sprite className="mk" mount={(h) => mountMascot(h, 4)} />
        <div>
          <h1>TOKEN TORCH</h1>
          <div className="tag">tokens, time &amp; spend — every run, lit up</div>
        </div>
      </div>
      <div className="meta-r">
        <div className="live">
          <i /> MISSION CONTROL · LIVE
        </div>
        <div>
          GENERATED <b>{fmtStamp(data.meta.generated_at)}</b>
        </div>
        <div>
          WINDOW{" "}
          <b>
            {fmtDate(range.from)} → {fmtDate(range.to)}
          </b>{" "}
          · SCHEMA <b>{data.meta.schema_version}</b>
        </div>
      </div>
    </header>
  );
}
