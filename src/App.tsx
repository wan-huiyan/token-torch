import { useEffect, useState } from "react";
import type { DashboardData, SessionDetailData } from "./types";
import { dashboardFixture, sessionDemo } from "./fixtures";
import { DashboardPage } from "./dashboard/DashboardPage";
import { SessionPage } from "./session/SessionPage";

/* ---------------------------------------------------------------------------
 * App shell + hash router. Pure static SPA: data comes from the generator's
 * output under /data/ (public/data/{dashboard.json, sessions/<id>.json}); if
 * that's absent (generator not run), it falls back to the typed prototype
 * fixtures so the UI always renders.
 *   #/                → dashboard
 *   #/sessions/:id    → session detail
 * ------------------------------------------------------------------------- */

type Route = { name: "dashboard" } | { name: "session"; id: string };

function parseHash(): Route {
  const m = window.location.hash.match(/^#\/sessions\/([^/?#]+)/);
  return m ? { name: "session", id: decodeURIComponent(m[1]) } : { name: "dashboard" };
}

const go = (hash: string) => {
  if (window.location.hash !== hash) window.location.hash = hash;
};

function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parseHash);
  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

type Loadable<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "empty" };

/** Fetch generated JSON. A true 404 means "no such record" → empty. Any other
 *  failure (network error, server restarting/HMR reload, 5xx, bad JSON) is
 *  transient → retry once before giving up, so a momentary blip doesn't strand
 *  the page on "not found". Falls back to `fallback` when provided. */
function useStatic<T>(url: string, fallback: T | null): Loadable<T> {
  const [state, setState] = useState<Loadable<T>>({ status: "loading" });
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    const attempt = (retries: number) => {
      fetch(url)
        .then((r) => {
          if (r.ok) return r.json() as Promise<T>;
          throw { is404: r.status === 404 };
        })
        .then((d) => live && setState({ status: "ready", data: d }))
        .catch((err: unknown) => {
          if (!live) return;
          const is404 = !!(err && typeof err === "object" && (err as { is404?: boolean }).is404);
          if (!is404 && retries > 0) {
            setTimeout(() => live && attempt(retries - 1), 500); // transient → retry
            return;
          }
          setState(fallback != null ? { status: "ready", data: fallback } : { status: "empty" });
        });
    };
    attempt(1);
    return () => {
      live = false;
    };
  }, [url, fallback]);
  return state;
}

function Loading() {
  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "60vh" }}>
      <div className="nt-kicker">loading…</div>
    </main>
  );
}

function SessionRoute({ id, onBack }: { id: string; onBack: () => void }) {
  // fixture fallback: only the canonical demo session has a bundled fixture.
  const fallback = id === sessionDemo.id ? sessionDemo : null;
  const state = useStatic<SessionDetailData>(`/data/sessions/${id}.json`, fallback);
  if (state.status === "loading") return <Loading />;
  if (state.status === "empty") return <NotFound id={id} onBack={onBack} />;
  return <SessionPage data={state.data} onBack={onBack} />;
}

function NotFound({ id, onBack }: { id: string; onBack: () => void }) {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "var(--sec-gap)" }}>
      <button className="nt-kicker" onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cyan)" }}>
        ← all sessions
      </button>
      <section className="nt-panel" style={{ padding: "var(--pad)", marginTop: 16 }}>
        <div className="nt-sec-head">Session not found</div>
        <p style={{ color: "var(--ink-dim)", fontFamily: "var(--mono)", fontSize: ".85rem" }}>
          No record for <code>{id}</code>. Run <code>npm run generate</code> to (re)build the data,
          then reopen from the dashboard.
        </p>
      </section>
    </main>
  );
}

export function App() {
  const route = useRoute();
  const dashboard = useStatic<DashboardData>("/data/dashboard.json", dashboardFixture);

  if (route.name === "session") {
    return <SessionRoute id={route.id} onBack={() => go("#/")} />;
  }
  if (dashboard.status !== "ready") return <Loading />;
  return (
    <DashboardPage data={dashboard.data} onOpenSession={(id) => go(`#/sessions/${encodeURIComponent(id)}`)} />
  );
}
