/* ============================================================================
 * TOKEN TORCH — React host for the canvas pixel sprites (session detail).
 * Mounts a spriteCanvas into a ref'd container and runs an optional per-sprite
 * animation loop. Every effect returns cleanup that clears its timers and
 * removes the canvas, so it is StrictMode- and unmount-safe (no doubled timers).
 * Ambient loops respect prefers-reduced-motion (final frame stays visible).
 * ========================================================================== */
import { useEffect, useRef } from "react";
import { spriteCanvas, type Frame, type Palette, type SpriteCanvas } from "./sprites";
import { usePrefersReducedMotion } from "./helpers";

type Mode =
  | { kind: "static" } // draw frame 0, no animation
  | { kind: "cycle"; intervalMs: number } // cycle frames on a timer (flame)
  | { kind: "clickBlinkLoop"; minMs?: number; jitterMs?: number }; // mascot

export function PixelSprite({
  frames,
  pal,
  scale,
  mode = { kind: "static" },
  className,
  title,
}: {
  frames: Frame[];
  pal: Palette;
  scale: number;
  mode?: Mode;
  className?: string;
  title?: string;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.textContent = "";
    const cv: SpriteCanvas = spriteCanvas(frames, pal, scale);
    if (className) cv.className = className;
    if (title) cv.title = title;
    host.appendChild(cv);

    let interval: number | undefined;
    let timeout: number | undefined;
    let onClick: ((e: Event) => void) | undefined;

    if (!reduced && mode.kind === "cycle") {
      let k = 0;
      interval = window.setInterval(() => cv._draw(++k), mode.intervalMs);
    }

    if (mode.kind === "clickBlinkLoop") {
      cv.style.cursor = "pointer";
      onClick = () => {
        cv._draw(1);
        window.setTimeout(() => cv._draw(0), 260);
      };
      cv.addEventListener("click", onClick);
      if (!reduced) {
        const min = mode.minMs ?? 2000;
        const jit = mode.jitterMs ?? 2600;
        const loop = () => {
          timeout = window.setTimeout(() => {
            cv._draw(1);
            timeout = window.setTimeout(() => {
              cv._draw(0);
              loop();
            }, 150);
          }, min + Math.random() * jit);
        };
        loop();
      }
    }

    return () => {
      if (interval) window.clearInterval(interval);
      if (timeout) window.clearTimeout(timeout);
      if (onClick) cv.removeEventListener("click", onClick);
      cv.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  return <span ref={hostRef} aria-hidden="true" style={{ display: "inline-flex" }} />;
}
