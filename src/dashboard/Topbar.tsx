import type { DashboardData } from "../types";
import { fmtDate, fmtStamp } from "./helpers";
import { PixelSprite } from "./PixelSprite";
import { BOT_OPEN, BOT_BLINK, BOT_PAL } from "./sprites";

/** Topbar — mascot (blinks on a timer, happy-blinks on click) + wordmark + live meta. */
export function Topbar({ meta }: { meta: DashboardData["meta"] }) {
  return (
    <header className="topbar">
      <div className="brand">
        {/* The pixel mascot replaces the abstract mark; it blinks on a timer and
            happy-blinks on click (its own ambient bob is a CSS animation). */}
        <span className="mark-btn" title="hi! i'm torch, your token mascot">
          <PixelSprite
            frames={[BOT_OPEN, BOT_BLINK]}
            pal={BOT_PAL}
            scale={4}
            className="mascot"
            mode={{ kind: "clickBlinkLoop" }}
          />
        </span>
        <div>
          <h1>
            TOKEN&nbsp;TORCH
          </h1>
          <div className="tag">tokens, time &amp; spend — every run, lit up</div>
        </div>
      </div>
      <div className="meta-r">
        <div className="live">
          <i /> MISSION CONTROL · LIVE
        </div>
        <div>
          GENERATED <b>{fmtStamp(meta.generated_at)}</b>
        </div>
        <div>
          WINDOW{" "}
          <b>
            {fmtDate(meta.date_range.from)} → {fmtDate(meta.date_range.to)}
          </b>{" "}
          · SCHEMA <b>{meta.schema_version}</b>
        </div>
      </div>
    </header>
  );
}
