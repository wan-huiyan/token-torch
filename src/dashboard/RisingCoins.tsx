/* Rising coins — pixel coins spawn at the bottom, float up and fade (money
 * burning). Spawns on an interval; each coin self-removes after its animation.
 * Disabled under reduced motion. All timers cleaned up on unmount. */
import { useEffect, useRef } from "react";
import { spriteCanvas, type Frame, type Palette } from "./sprites";
import { usePrefersReducedMotion } from "./helpers";

export function RisingCoins({ frames, pal }: { frames: Frame[]; pal: Palette }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const layer = layerRef.current;
    if (!layer) return;
    const removers: number[] = [];
    const interval = window.setInterval(() => {
      const c = spriteCanvas(frames, pal, 3);
      c.className = "coin";
      c.style.left = 16 + Math.random() * 66 + "%";
      c.style.bottom = "18px";
      c.style.animation = "tt-riseFade 2.6s ease-out forwards";
      layer.appendChild(c);
      removers.push(window.setTimeout(() => c.remove(), 2700));
    }, 1000);
    return () => {
      window.clearInterval(interval);
      removers.forEach((id) => window.clearTimeout(id));
      layer.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  return (
    <div
      ref={layerRef}
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", borderRadius: "20px" }}
    />
  );
}
