/* Hash-route parsing, React-free so it is unit-testable (Plan 7 / #16).
 * Extracted from App.tsx; adds the `about` methodology route. */
export type Route =
  | { name: "dashboard" }
  | { name: "breakdown" }
  | { name: "about" }
  | { name: "session"; id: string };

export function parseHashString(hash: string): Route {
  const m = hash.match(/^#\/sessions\/([^/?#]+)/);
  if (m) return { name: "session", id: decodeURIComponent(m[1]) };
  if (/^#\/breakdown/.test(hash)) return { name: "breakdown" };
  if (/^#\/about/.test(hash)) return { name: "about" };
  return { name: "dashboard" };
}
