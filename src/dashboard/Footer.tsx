import type { DashboardData } from "../types";
import { fmtStamp } from "./helpers";

/** Footer — generated_at, schema_version, fidelity_note, honesty disclaimer. */
export function Footer({ meta }: { meta: DashboardData["meta"] }) {
  return (
    <footer>
      <div className="fnote">
        <b>Honest by design.</b> {meta.fidelity_note} Session costs, active/idle minutes, cache % and subagent counts
        are real; within-session main-vs-subagent splits and Read/Agent tool counts are plausible placeholders.
      </div>
      <div style={{ textAlign: "right" }}>
        GENERATED <b>{fmtStamp(meta.generated_at)}</b>
        <br />
        SCHEMA <b>{meta.schema_version}</b> · {meta.file_count} files · {meta.session_count} sessions
      </div>
    </footer>
  );
}
