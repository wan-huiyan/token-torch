import type { GroupBy } from "./aggregate";

const OPTIONS: { key: GroupBy; label: string }[] = [
  { key: "project", label: "Project" },
  { key: "week", label: "Week" },
  { key: "model", label: "Model version" },
  { key: "effort", label: "Effort" },
];

/** 4-way segmented control. Pure presentation — state lives in DashboardPage. */
export function GroupByToggle({ value, onChange }: { value: GroupBy; onChange: (g: GroupBy) => void }) {
  return (
    <div className="gbtoggle" role="tablist" aria-label="Group sessions by">
      {OPTIONS.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={value === o.key}
          className={`gbopt${value === o.key ? " on" : ""}`}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
