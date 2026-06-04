/* ============================================================================
 * TOKEN TORCH — time-window context. Holds the active window (preset / custom),
 * resolves it against the corpus date bounds, and exposes the windowed session
 * subset + headline aggregate to every kept-top section + tab. One source of
 * truth so hero / podium / sessions / timeline / breakdown stay in lockstep.
 * ========================================================================== */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { DashboardData, SessionRow } from "../types";
import { aggregate, windowRange, winSessions, type DateRange, type WinAgg, type WindowMode, type WindowState } from "./windowAgg";

interface WindowCtx {
  state: WindowState;
  bounds: DateRange; // corpus [from,to]
  range: DateRange; // resolved active window
  sessions: SessionRow[]; // windowed subset (all session rows when mode=all)
  agg: WinAgg; // headline aggregate over the windowed subset
  isAll: boolean;
  setMode: (mode: WindowMode) => void;
  setCustom: (from: string, to: string) => void;
}

const Ctx = createContext<WindowCtx | null>(null);

export function WindowProvider({ data, children }: { data: DashboardData; children: ReactNode }) {
  const [state, setState] = useState<WindowState>({ mode: "all", from: null, to: null });
  const bounds: DateRange = { from: data.meta.date_range.from, to: data.meta.date_range.to, all: true };

  const value = useMemo<WindowCtx>(() => {
    const range = windowRange(state, bounds);
    const sessions = range.all ? data.sessions : winSessions(data.sessions, range);
    return {
      state,
      bounds,
      range,
      sessions,
      agg: aggregate(sessions),
      isAll: range.all,
      setMode: (mode) => setState({ mode, from: null, to: null }),
      setCustom: (from, to) => setState({ mode: "custom", from, to }),
    };
    // bounds is derived from data; data identity is the real dep
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, data]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWindow(): WindowCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWindow must be used within <WindowProvider>");
  return v;
}
