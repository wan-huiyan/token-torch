/* ============================================================================
 * TOKEN TORCH — session-detail pixel sprite engine + sprite definitions.
 * Ported VERBATIM from the canonical prototype "sessions/67948bdb.html" inline
 * <canvas> sprites (NOT the dashboard's sprites.ts, which diverges: different
 * COIN/MOON, and no THINK/SPARK/HOUR). A sprite FRAME is string[] (rows); each
 * char maps to a colour in the palette; any char absent from the palette
 * (e.g. ".") is transparent. Offline, no deps.
 * ========================================================================== */

export type Palette = Record<string, string>;
export type Frame = string[];

/** A canvas element with an attached `_draw(frameIndex)` method. */
export interface SpriteCanvas extends HTMLCanvasElement {
  _draw: (fi: number) => void;
}

export function spriteCanvas(frames: Frame[], pal: Palette, scale: number): SpriteCanvas {
  const w = Math.max(...frames.flat().map((r) => r.length));
  const h = frames[0].length;
  const cv = document.createElement("canvas") as SpriteCanvas;
  cv.width = w * scale;
  cv.height = h * scale;
  cv.style.width = w * scale + "px";
  cv.style.height = h * scale + "px";
  cv.style.imageRendering = "pixelated";
  const ctx = cv.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  cv._draw = (fi: number) => {
    ctx.clearRect(0, 0, cv.width, cv.height);
    const rows = frames[((fi % frames.length) + frames.length) % frames.length];
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const c = pal[row[x]];
        if (c) {
          ctx.fillStyle = c;
          ctx.fillRect(x * scale, y * scale, scale, scale);
        }
      }
    }
  };
  cv._draw(0);
  return cv;
}

/* ---------------- mascot (topbar) ---------------- */
export const BOT_PAL: Palette = { K: "#0c0e14", C: "#2ee6ff", W: "#08161c", L: "#b6ff3d", M: "#ff5ad0" };
export const BOT_OPEN: Frame = ["....MM....", "....KK....", ".KKKKKKKK.", "KCCCCCCCCK", "KCWWWWWWCK", "KCWLWWLWCK", "KCWLWWLWCK", "KCWWWWWWCK", "KCWMWWMWCK", "KCCCCCCCCK", ".KKKKKKKK.", ".K......K."];
export const BOT_BLINK: Frame = ["....MM....", "....KK....", ".KKKKKKKK.", "KCCCCCCCCK", "KCWWWWWWCK", "KCWLLLLWCK", "KCWLLLLWCK", "KCWWWWWWCK", "KCWMWWMWCK", "KCCCCCCCCK", ".KKKKKKKK.", ".K......K."];

/* ---------------- flame (header) + tiny tier flame ---------------- */
export const FLM_PAL: Palette = { Y: "#ffe14d", O: "#ffb43d", R: "#ff6a2b" };
export const FLM: Frame[] = [
  ["...YY...", "..YOOY..", "..YOOY..", ".YOOOOY.", ".YORROY.", "YORRRROY", "YORRRROY", "YOORROOY", ".YOOOOY.", "..YOOY..", "...OO..."],
  ["..YY....", "..YOY...", ".YOOY...", ".YOOOY..", ".YORROY.", "YORRRROY", "YORRRROY", "YOORROOY", ".YOOOOY.", "..YOOY..", "...OO..."],
  ["....YY..", "...YOY..", "...YOOY.", "..YOOOY.", ".YORROY.", "YORRRROY", "YORRRROY", "YOORROOY", ".YOOOOY.", "..YOOY..", "...OO..."],
];
/* Tiny tier flame. Note: references "H" which is absent from FLM_PAL → that
   pixel is transparent. Faithful port of the prototype's FLM_S. */
export const FLM_S: Frame[] = [["..YY", ".YH.", "YYH.", "YYYY", ".HYY", "..YY", ".YY."]];

/* ---------------- ribbon phase illustrations ---------------- */
export const THINK_PAL: Palette = { C: "#2ee6ff", P: "#0c1418" };
export const THINK: Frame = [".CCCCCC.", "CCCCCCCC", "CPCPCPCC", "CCCCCCCC", ".CCCCCC.", "..CC....", ".C......"];
export const SPARK_PAL: Palette = { L: "#b6ff3d" };
export const SPARK: Frame = ["...L...", ".L.L.L.", "..LLL..", "LLLLLLL", "..LLL..", ".L.L.L.", "...L..."];
export const RMOON_PAL: Palette = { S: "#ffe88a" };
export const RMOON: Frame = ["..SSS..", ".SS..S.", "SS.....", "SS.....", "SS.....", ".SS..S.", "..SSS.."];
export const HOUR_PAL: Palette = { O: "#ffb43d", S: "#ffe14d" };
export const HOUR: Frame = ["OOOOO", ".SSS.", "..O..", ".SSS.", "OOOOO"];

/* ---------------- coin (inversion fall) ---------------- */
export const COIN_PAL: Palette = { G: "#c89b2e", Y: "#ffe14d", O: "#b8860b" };
export const COIN: Frame = [".GG.", "GYYG", "GYYG", ".GG."];
