/* ============================================================================
 * TOKEN TORCH — pixel sprite engine + sprite definitions
 * Ported verbatim from the "Burn Rate Dashboard.html" prototype's inline canvas
 * sprites. Crisp pixel-art drawn from tiny string grids onto <canvas>. Offline,
 * no deps. A sprite FRAME is string[] (rows); each char maps to a colour in the
 * palette; any char absent from the palette (e.g. ".") is transparent.
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

/* ---------------- flame ---------------- */
export const FLM_PAL: Palette = { Y: "#ffe14d", O: "#ffb43d", R: "#ff6a2b" };
export const FLM: Frame[] = [
  ["...YY...", "..YOOY..", "..YOOY..", ".YOOOOY.", ".YORROY.", "YORRRROY", "YORRRROY", "YOORROOY", ".YOOOOY.", "..YOOY..", "...OO..."],
  ["..YY....", "..YOY...", ".YOOY...", ".YOOOY..", ".YORROY.", "YORRRROY", "YORRRROY", "YOORROOY", ".YOOOOY.", "..YOOY..", "...OO..."],
  ["....YY..", "...YOY..", "...YOOY.", "..YOOOY.", ".YORROY.", "YORRRROY", "YORRRROY", "YOORROOY", ".YOOOOY.", "..YOOY..", "...OO..."],
];

/* ---------------- coin ---------------- */
export const COIN_PAL: Palette = { G: "#cdd3e2", Y: "#ffe14d", O: "#ffb43d" };
export const COIN: Frame = ["..GGGG..", ".GYYYYG.", "GYYYYYYG", "GYYOOYYG", "GYYOOYYG", "GYYYYYYG", ".GYYYYG.", "..GGGG.."];

/* ---------------- moon ---------------- */
export const MOON_PAL: Palette = { S: "#ffe88a", D: "#caa84a" };
export const MOON: Frame = ["..SSS...", ".SSSS...", "SSSD....", "SSS.....", "SSS.....", "SSSD....", ".SSSS...", "..SSS..."];

/* ---------------- crown ---------------- */
export const CROWN_PAL: Palette = { Y: "#ffe14d", O: "#ffb43d", M: "#ff5ad0" };
export const CROWN: Frame = ["Y.Y.Y", "YYYYY", "YMYMY", "YYYYY", "OOOOO"];

/* ---------------- lightning bolt ---------------- */
export const BOLT_PAL: Palette = { Y: "#ffe14d", O: "#ffb43d", H: "#fff7c0" };
export const BOLT: Frame = ["..YY", ".YH.", "YYH.", "YYYY", ".HYY", "..YY", ".YY.", "YY..", "Y..."];

/* ---------------- podium mascots — full-body, expressive, personality ---------------- */
const COM: Palette = { K: "#0c0e14", W: "#0a141a", G: "#ffffff" };
export const EVIL_PAL: Palette = { ...COM, X: "#ff5ad0", E: "#ff5a4d", P: "#2a0a0a", H: "#ffe2e2", M: "#2a0a12", B: "#3a0a14", A: "#ff8fb0", R: "#ff5a4d" };
export const COOL_PAL: Palette = { ...COM, X: "#2ee6ff", E: "#b6ff3d", P: "#0c1418", H: "#ffffff", M: "#ffffff", A: "#ff9ed8" };
export const NERV_PAL: Palette = { ...COM, X: "#b6ff3d", E: "#2ee6ff", P: "#0c1418", H: "#ffffff", M: "#ff5ad0", B: "#7cbf2a", A: "#ff9ed8", S: "#9ad8ff" };

const _HTOP = ".." + "K".repeat(14) + "..";
const _HFR = "..K" + "X".repeat(12) + "K..";
const _f = (r: string) => "..KX" + r + "XK..";
const ANT_N: Frame = ["........EE........", "........KK........"];
const ANT_H: Frame = ["..R............R..", "..RK..........KR.."];
const BODY_A: Frame = [".......KXXK.......", "....KXXXXXXXXK....", "....KXXXXXXXXK....", "....KXXXXXXXXK....", "....KXXK..KXXK...."];
const BODY_B: Frame = [".......KXXK.......", "....KXXXXXXXXK....", "....KXXXXXXXXK....", "....KXXXXXXXXK....", "...KXXK....KXXK..."];
function bot18(ant: Frame, face: Frame, body: Frame): Frame {
  return [ant[0], ant[1], _HTOP, _HFR, _f(face[0]), _f(face[1]), _f(face[2]), _f(face[3]), _f(face[4]), _f(face[5]), _f(face[6]), _f(face[7]), _f(face[8]), _f(face[9]), _HFR, _HTOP].concat(body);
}
const COOL_A: Frame = ["WWWWWWWWWW", "WWWWWWWWWW", "WEEWWWWEEW", "EHEEWWEHEE", "EEEEWWEEEE", "WEEWWWWEEW", "WAWWWWWWAW", "WWWMWWMWWW", "WWWMMMMWWW", "WWWWWWWWWW"];
const COOL_B: Frame = ["WWWWWWWWWW", "WWWWWWWWWW", "WWWWWWWWWW", "WWWWWWWWWW", "EEEEWWEEEE", "WWWWWWWWWW", "WAWWWWWWAW", "WWWMWWMWWW", "WWWMMMMWWW", "WWWWWWWWWW"];
const EVIL_A: Frame = ["WWWWWWWWWW", "WBWWWWWWBW", "WEEWWWWEEW", "EHEEWWEHEE", "EEEEWWEEEE", "WEEWWWWEEW", "WAWWWWWWAW", "WWMMMMMMWW", "WWGMMMMGWW", "WWWWWWWWWW"];
const EVIL_B: Frame = ["WWWWWWWWWW", "WBWWWWWWBW", "WWWWWWWEEW", "WWWWWWEHEE", "EEEEWWEEEE", "WWWWWWWEEW", "WAWWWWWWAW", "WWMMMMMMWW", "WWGMMMMGWW", "WWWWWWWWWW"];
const NERV_A: Frame = ["WWWWWWWWWW", "WWBWWWWBWW", "WEEWWWWEEW", "EHEEWWEHEE", "EEEEWWEEEE", "WEEWWWWEEW", "WAWWWWWWAW", "WWWWWWWWWW", "WWWMMWWWWW", "WWWWWWWWWW"];
const NERV_B: Frame = ["WWWWWWWWWW", "WWBWWWWBWW", "WEEWWWWEEW", "EHEEWWEHEE", "EEEEWWEEEE", "WEEWWWWEEW", "SAWWWWWWAW", "WWWWWWWWWW", "WWWWWMMWWW", "WWWWWWWWWW"];
export const EVIL_FR: Frame[] = [bot18(ANT_H, EVIL_A, BODY_A), bot18(ANT_H, EVIL_B, BODY_B)];
export const COOL_FR: Frame[] = [bot18(ANT_N, COOL_A, BODY_A), bot18(ANT_N, COOL_B, BODY_B)];
export const NERV_FR: Frame[] = [bot18(ANT_N, NERV_A, BODY_A), bot18(ANT_N, NERV_B, BODY_B)];
