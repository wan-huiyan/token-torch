/* ============================================================================
 * TOKEN TORCH — pixel sprite engine (ES module port of the redesign prototype).
 * Crisp pixel art from string grids → <canvas>, plus fairy dust.
 *
 * Ported VERBATIM from design-handoff-2026-06-04-redesign/project/sprites.js —
 * every sprite grid string and hex colour is the visual contract and is
 * preserved exactly. The vanilla `window.TT` IIFE is replaced by named ES
 * exports (no global).
 *
 * React-correctness change vs the source: every function that starts a
 * setInterval / recursive setTimeout / rAF loop returns a cleanup `() => void`
 * that clears its timers + listeners and removes any nodes it appended, so
 * React can dispose it on unmount (the originals leaked forever). Functions
 * that only draw a static canvas return that canvas as before.
 * ========================================================================== */

import { initReduced, isReduced, trackAnimation } from "./motionRegistry";

/** A sprite FRAME is string[] (rows); a multi-frame sprite is string[][]. */
export type Frame = string[];
/** Each char in a frame maps to a colour; any char absent (e.g. ".") is transparent. */
export type Palette = Record<string, string>;
/** A canvas element with an attached `_draw(frameIndex)` method. */
export type SpriteCanvas = HTMLCanvasElement & { _draw(fi: number): void };

/* PRODUCT DECISION — "MAXIMUM FUN" (supersedes the #38 runtime-reduced-motion gating):
 * Token Torch's decorative pixel-art ALWAYS animates. It deliberately does NOT honor
 * prefers-reduced-motion for these tiny, localized, idle/pointer-driven sprites — they are
 * core to the arcade identity and carry no information, so freezing them only stripped the
 * charm (owner call, S15). We seed the engine as "motion allowed" and never subscribe to a
 * matchMedia change, so isReduced() stays false and every sprite loop runs. The registry /
 * trackAnimation infra is retained (dormant) so a future OPT-IN "reduce animations" toggle
 * could drive it — that is the accessible alternative if it's ever wanted. */
initReduced(false);

export function spriteCanvas(frames: Frame[], pal: Palette, scale = 4): SpriteCanvas {
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

/* ---- palettes ---- */
export const PAL: Record<string, Palette> = {
  bot: { K: "#0c0e14", C: "#2ee6ff", W: "#08161c", L: "#b6ff3d", M: "#ff5ad0" },
  flame: { Y: "#ffe14d", O: "#ffb43d", R: "#ff6a2b" },
  coin: { G: "#cdd3e2", Y: "#ffe14d", O: "#ffb43d" },
  moon: { S: "#ffe88a", D: "#caa84a" },
  crown: { Y: "#ffe14d", O: "#ffb43d", M: "#ff5ad0" },
  bolt: { Y: "#ffe14d", O: "#ffb43d", H: "#fff7c0" },
};

/* ---- mascot (topbar robot) ---- */
const BOT: Record<"open" | "blink", Frame> = {
  open: ["....MM....", "....KK....", ".KKKKKKKK.", "KCCCCCCCCK", "KCWWWWWWCK", "KCWLWWLWCK", "KCWLWWLWCK", "KCWWWWWWCK", "KCWMWWMWCK", "KCCCCCCCCK", ".KKKKKKKK.", ".K......K."],
  blink: ["....MM....", "....KK....", ".KKKKKKKK.", "KCCCCCCCCK", "KCWWWWWWCK", "KCWLLLLWCK", "KCWLLLLWCK", "KCWWWWWWCK", "KCWMWWMWCK", "KCCCCCCCCK", ".KKKKKKKK.", ".K......K."],
};
/** Appends the mascot canvas + starts the ambient blink loop. Cleanup: stop loop, drop listener, remove canvas. */
export function mountMascot(host: HTMLElement, scale = 4): () => void {
  const bot = spriteCanvas([BOT.open, BOT.blink], PAL.bot, scale);
  bot.style.cursor = "pointer";
  bot.className = "mascot";
  host.appendChild(bot);
  const onClick = () => {
    bot._draw(1);
    window.setTimeout(() => bot._draw(0), 260);
  };
  bot.addEventListener("click", onClick);
  let live = true;
  let t: number | undefined;
  let untrack: (() => void) | undefined;
  if (!isReduced()) {
    const loop = () => {
      t = window.setTimeout(() => {
        if (!live) return;
        bot._draw(1);
        t = window.setTimeout(() => {
          bot._draw(0);
          if (Math.random() < 0.35) {
            t = window.setTimeout(() => {
              if (!live) return;
              bot._draw(1);
              t = window.setTimeout(() => {
                bot._draw(0);
                loop();
              }, 130);
            }, 160);
          } else loop();
        }, 140);
      }, 1400 + Math.random() * 2600);
    };
    loop();
    untrack = trackAnimation(() => {
      live = false;
      if (t) window.clearTimeout(t);
      bot._draw(0);
    });
  }
  return () => {
    live = false;
    if (t) window.clearTimeout(t);
    untrack?.();
    bot.removeEventListener("click", onClick);
    bot.remove();
  };
}

/* ---- flame (burn-tier) ---- */
// shared ticker: one timer animates every registered flame (scales to hundreds cheaply)
const _flames: { cv: SpriteCanvas; i: number }[] = [];
let _flameIv: number | undefined;
function _startFlameTicker(): void {
  if (_flameIv !== undefined) return; // already running
  _flameIv = window.setInterval(() => {
    for (let k = _flames.length - 1; k >= 0; k--) {
      const a = _flames[k];
      if (!a.cv.isConnected) {
        _flames.splice(k, 1);
        continue;
      }
      a.cv._draw(++a.i);
    }
  }, 120);
  // Issue #38: this one module-lifetime ticker drives ALL flames + ~70 mini-flames
  // (no per-mount cleanup of its own), so register its stop so a runtime flip-to-
  // reduce halts it. After the flip, mounts gate on isReduced() and skip _regFlame.
  trackAnimation(() => {
    if (_flameIv !== undefined) {
      window.clearInterval(_flameIv);
      _flameIv = undefined;
    }
  });
}
function _regFlame(cv: SpriteCanvas): void {
  // (Re)start the shared ticker so flames that mount after a runtime motion-RESTORE
  // animate again and the loop's self-pruning resumes — otherwise a dead ticker would
  // let _flames accumulate frozen, detached canvases (issue #38 review-panel catch).
  // Idempotent via the _flameIv guard; call sites already gate on !isReduced(), so this
  // is the single lazy entry point for the ticker lifecycle (no module-load start).
  _startFlameTicker();
  _flames.push({ cv, i: Math.floor(Math.random() * 3) });
}
export const FLAME: Frame[] = [
  ["...YY...", "..YOOY..", "..YOOY..", ".YOOOOY.", ".YORROY.", "YORRRROY", "YORRRROY", "YOORROOY", ".YOOOOY.", "..YOOY..", "...OO..."],
  ["..YY....", "..YOY...", ".YOOY...", ".YOOOY..", ".YORROY.", "YORRRROY", "YORRRROY", "YOORROOY", ".YOOOOY.", "..YOOY..", "...OO..."],
  ["....YY..", "...YOY..", "...YOOY.", "..YOOOY.", ".YORROY.", "YORRRROY", "YORRRROY", "YOORROOY", ".YOOOOY.", "..YOOY..", "...OO..."],
];
// tier tints: inferno=magenta-hot, campfire=amber, ember=cool-lime
export const FLAME_TINT: Record<"inferno" | "campfire" | "ember", Palette> = {
  inferno: { Y: "#ffd24d", O: "#ff7ad0", R: "#ff3aa0" },
  campfire: { Y: "#ffe14d", O: "#ffb43d", R: "#ff6a2b" },
  ember: { Y: "#e8ff9a", O: "#b6ff3d", R: "#6fd83a" },
};
type FlameTier = keyof typeof FLAME_TINT;
/** Appends one flame canvas (registered on the shared self-pruning ticker). Cleanup: remove the canvas. */
export function mountFlame(host: HTMLElement, scale = 4, tier?: FlameTier): () => void {
  const fl = spriteCanvas(FLAME, (tier && FLAME_TINT[tier]) || PAL.flame, scale);
  fl.className = "flame-cv";
  host.appendChild(fl);
  if (!isReduced()) _regFlame(fl);
  return () => {
    fl.remove();
  };
}
// small inline mini-flames (n flames in a row) for card titles/badges
/** Appends n mini-flame canvases. Cleanup: remove them all. */
export function miniFlames(host: HTMLElement, n: number, tier?: FlameTier, scale = 2): () => void {
  const cvs: SpriteCanvas[] = [];
  for (let k = 0; k < n; k++) {
    const fl = spriteCanvas(FLAME, (tier && FLAME_TINT[tier]) || PAL.flame, scale);
    fl.className = "miniflame";
    host.appendChild(fl);
    cvs.push(fl);
    if (!isReduced()) _regFlame(fl);
  }
  return () => {
    for (const fl of cvs) fl.remove();
  };
}

const COIN: Frame = ["..GGGG..", ".GYYYYG.", "GYYYYYYG", "GYYOOYYG", "GYYOOYYG", "GYYYYYYG", ".GYYYYG.", "..GGGG.."];
const MOON: Frame = ["..SSS...", ".SSSS...", "SSSD....", "SSS.....", "SSS.....", "SSSD....", ".SSSS...", "..SSS..."];
const CROWN: Frame = ["Y.Y.Y", "YYYYY", "YMYMY", "YYYYY", "OOOOO"];
const BOLT: Frame = ["..YY", ".YH.", "YYH.", "YYYY", ".HYY", "..YY", ".YY.", "YY..", "Y..."];
const STAR: Frame = ["..H..", "..H..", "H.H.H", ".HHH.", "HHHHH", ".HHH.", "H.H.H", "..H..", "..H.."];
const TROPHY: Frame = [".YYYYY.", "YGYYYGY", "YGYYYGY", ".YYYYY.", "..YYY..", "...Y...", "..YYY..", ".OOOOO."];
const HOURGLASS: Frame = ["YYYYY", ".GYG.", "..G..", "..Y..", "..G..", ".GYG.", "YYYYY"];
const PEN: Frame = ["......EE", ".....WWE", "....WWB.", "...WWB..", "..WWB...", ".WWB....", "WGB.....", "G......."];
const PEN_PAL: Palette = { W: "#ffe14d", B: "#ffb43d", E: "#ff8fb0", G: "#cfd4e3" };
const WRENCH: Frame = ["LH..HL..", "HH..HH..", "HHHHHH..", ".HHHH...", "..HH....", "..HH....", "..HH....", "..HHH..."];
const WRENCH_PAL: Palette = { H: "#aab0c2", L: "#eef1f8" };
/* ---- custom scorecard sprites ---- */
// banknote with a $ — burn rate
const MONEY: Frame = ["GGGGGGGGGGG", "GOOOOOOOOOG", "GO...Y...OG", "GO..YYY..OG", "GO..YY...OG", "GO...YY..OG", "GO..YYY..OG", "GO...Y...OG", "GOOOOOOOOOG", "GGGGGGGGGGG"];
const MONEY_PAL: Palette = { G: "#1f8a5b", O: "#34c07d", Y: "#ffe14d" };
// manila folder with code lines — distinct codebases
const FOLDER: Frame = ["FFFF.......", "F..F.......", "FFFFFFFFFFF", "FOOOOOOOOOF", "FO.LLLL..OF", "FO.LL....OF", "FO.LLLLL.OF", "FOOOOOOOOOF", "FFFFFFFFFFF"];
const FOLDER_PAL: Palette = { F: "#d99a3a", O: "#ffce7a", L: "#b6ff3d" };
// terminal window with prompt + blinking cursor — autonomous runs
const TERM_A: Frame = ["KKKKKKKKKK", "KRYGWWWWWK", "KWWWWWWWWK", "KWLWWWWWWK", "KWLCCCCWWK", "KWLCCWWWWK", "KWWWWWCWWK", "KKKKKKKKKK"];
const TERM_B: Frame = ["KKKKKKKKKK", "KRYGWWWWWK", "KWWWWWWWWK", "KWLWWWWWWK", "KWLCCCCWWK", "KWLCCWWWWK", "KWWWWWWWWK", "KKKKKKKKKK"];
const TERM_PAL: Palette = { K: "#0c0e14", W: "#08161c", R: "#ff5a4d", Y: "#ffe14d", G: "#b6ff3d", C: "#2ee6ff", L: "#2ee6ff" };
/** Appends a terminal canvas + cursor-blink loop. Cleanup: stop loop, remove canvas. */
export function mountTerminal(host: HTMLElement, scale = 2): () => void {
  const cv = spriteCanvas([TERM_A, TERM_B], TERM_PAL, scale);
  cv.className = "tt-icon term-cv";
  host.appendChild(cv);
  let live = true;
  let t: number | undefined;
  let untrack: (() => void) | undefined;
  if (!isReduced()) {
    const loop = () => {
      t = window.setTimeout(() => {
        if (!live) return;
        cv._draw(1);
        t = window.setTimeout(() => {
          cv._draw(0);
          loop();
        }, 480);
      }, 520);
    };
    loop();
    untrack = trackAnimation(() => {
      live = false;
      if (t) window.clearTimeout(t);
      cv._draw(0);
    });
  }
  return () => {
    live = false;
    if (t) window.clearTimeout(t);
    untrack?.();
    cv.remove();
  };
}
// mommy robot + two babies — subagent dispatches
const FAM_OPEN: Frame = ["....MM..........", "....KK..........", ".KKKKKK.........", "KCCCCCCK........", "KCLWWLCK........", "KCCCCCCK.M...M..", "KCMWWMCK.CC..CC.", ".KKKKKK.CLLCCLLC", ".K....K..CC..CC."];
const FAM_BLINK: Frame = ["....MM..........", "....KK..........", ".KKKKKK.........", "KCCCCCCK........", "KCWWWWCK........", "KCCCCCCK.M...M..", "KCMWWMCK.CC..CC.", ".KKKKKK.CWWCCWWC", ".K....K..CC..CC."];
/** Appends the family canvas + blink loop. Cleanup: stop loop, remove canvas. */
export function mountFamily(host: HTMLElement, scale = 2): () => void {
  const cv = spriteCanvas([FAM_OPEN, FAM_BLINK], PAL.bot, scale);
  cv.className = "fam-cv";
  host.appendChild(cv);
  let live = true;
  let t: number | undefined;
  let untrack: (() => void) | undefined;
  if (!isReduced()) {
    const loop = () => {
      t = window.setTimeout(() => {
        if (!live) return;
        cv._draw(1);
        t = window.setTimeout(() => {
          cv._draw(0);
          loop();
        }, 160);
      }, 1600 + Math.random() * 2400);
    };
    loop();
    untrack = trackAnimation(() => {
      live = false;
      if (t) window.clearTimeout(t);
      cv._draw(0);
    });
  }
  return () => {
    live = false;
    if (t) window.clearTimeout(t);
    untrack?.();
    cv.remove();
  };
}
const STAR_PAL: Palette = { H: "#fff7c0" };
const TROPHY_PAL: Palette = { Y: "#ffe14d", G: "#caa84a", O: "#b8860b" };
const HG_PAL: Palette = { Y: "#ffe14d", G: "#ffb43d" };
const SUN: Frame = ["..Y.Y..", "Y.OOO.Y", ".OOOOO.", "YOOOOOY", ".OOOOO.", "Y.OOO.Y", "..Y.Y.."];
const SUN_PAL: Palette = { Y: "#ffe14d", O: "#ffb43d" };
const OWL_OPEN: Frame = [".K.....K.", "KFKKKKKFK", "KFWWWWWFK", "KWCKKKCWK", "KWWWWWWWK", "KFWWOWWFK", "KFFWWWFFK", ".KFFFFFK.", "..K...K.."];
const OWL_BLINK: Frame = [".K.....K.", "KFKKKKKFK", "KFWWWWWFK", "KWKKKKKWK", "KWWWWWWWK", "KFWWOWWFK", "KFFWWWFFK", ".KFFFFFK.", "..K...K.."];
const OWL_PAL: Palette = { K: "#0c0e14", F: "#ff5ad0", W: "#f4f5f8", C: "#2ee6ff", O: "#ffb43d" };

type EffortKind = "team" | "low" | "max" | "high" | "ultra-high" | string;
/** Appends 1-4 robot canvases + decorative spans for the given effort kind, with blink loops.
 *  Cleanup: stop all loops, remove all appended nodes, undo the host class mutation. */
export function mountEffortBot(host: HTMLElement, kind: EffortKind, scale = 3): () => void {
  const timers: number[] = [];
  const nodes: Element[] = [];
  let live = true;
  let untrack: (() => void) | undefined;
  function one(cls: string, sleeping?: boolean): SpriteCanvas {
    const cv = spriteCanvas([BOT.open, BOT.blink], PAL.bot, scale);
    cv.className = "effbot " + cls;
    host.appendChild(cv);
    nodes.push(cv);
    if (sleeping) {
      cv._draw(1);
      return cv;
    }
    if (!isReduced()) {
      const loop = () => {
        if (!cv.isConnected || !live) return;
        timers.push(
          window.setTimeout(() => {
            if (!cv.isConnected || !live) return;
            cv._draw(1);
            timers.push(
              window.setTimeout(() => {
                cv._draw(0);
                loop();
              }, 150),
            );
          }, 1500 + Math.random() * 3000),
        );
      };
      loop();
    }
    return cv;
  }
  function addCode(n: number, color: string): void {
    if (isReduced()) return;
    const ch = "01{}<>;/=()+".split("");
    for (let i = 0; i < n; i++) {
      const s = document.createElement("span");
      s.className = "eff-code";
      s.textContent = ch[(Math.random() * ch.length) | 0];
      s.style.cssText =
        "left:" + Math.random() * 100 + "%;top:" + Math.random() * 88 + "%;color:" + color + ";animation:codefloat " + (1.1 + Math.random() * 0.9).toFixed(2) + "s ease-in-out " + (Math.random() * 0.8).toFixed(2) + "s infinite";
      host.appendChild(s);
      nodes.push(s);
    }
  }
  function addOrbit(): void {
    if (isReduced()) return;
    const wrap = document.createElement("span");
    wrap.className = "max-orbit";
    const ch = "01{}<>;/=".split("");
    for (let i = 0; i < 5; i++) {
      const s = document.createElement("span");
      s.className = "max-orbit-c";
      s.textContent = ch[(Math.random() * ch.length) | 0];
      s.style.transform = "rotate(" + i * 72 + "deg) translateY(-20px)";
      wrap.appendChild(s);
    }
    host.appendChild(wrap);
    nodes.push(wrap);
  }
  if (kind === "team") {
    host.classList.add("eff-team");
    one("eb-master");
    one("eb-mini");
    one("eb-mini");
    one("eb-mini");
  } else if (kind === "low") {
    one("eff-low", true);
    const z = document.createElement("span");
    z.className = "eff-zzz";
    z.textContent = "z";
    host.appendChild(z);
    nodes.push(z);
  } else if (kind === "max") {
    one("eff-max", true);
    addOrbit();
  } else {
    one("eff-" + kind);
    if (kind === "high") addCode(3, "#b6ff3d");
    else if (kind === "ultra-high") addCode(9, "#b6ff3d");
  }
  if (!isReduced()) {
    untrack = trackAnimation(() => {
      live = false;
      for (const id of timers) window.clearTimeout(id);
    });
  }
  return () => {
    live = false;
    for (const id of timers) window.clearTimeout(id);
    for (const node of nodes) node.remove();
    untrack?.();
    if (kind === "team") host.classList.remove("eff-team");
  };
}
const BIRD_A: Frame = ["...YYY..", "..YYYYY.", "YYBYYYO.", ".YYYYY..", "..YYY...", "..Y.Y..."];
const BIRD_B: Frame = ["........", "...YYY..", "..YYYYY.", "YYBYYYO.", ".YYYYWW.", "..Y.Y..."];
const BIRD_PAL: Palette = { Y: "#ffb43d", B: "#0c0e14", O: "#ffe14d", W: "#ff5ad0" };
/** Appends a bird canvas + flap loop. Cleanup: stop loop, remove canvas. */
export function mountBird(host: HTMLElement, scale = 4): () => void {
  const cv = spriteCanvas([BIRD_A, BIRD_B], BIRD_PAL, scale);
  cv.className = "bird-cv";
  host.appendChild(cv);
  let live = true;
  let t: number | undefined;
  let untrack: (() => void) | undefined;
  if (!isReduced()) {
    const loop = () => {
      t = window.setTimeout(() => {
        if (!live) return;
        cv._draw(1);
        t = window.setTimeout(() => {
          cv._draw(0);
          loop();
        }, 260);
      }, 1400 + Math.random() * 2200);
    };
    loop();
    untrack = trackAnimation(() => {
      live = false;
      if (t) window.clearTimeout(t);
      cv._draw(0);
    });
  }
  return () => {
    live = false;
    if (t) window.clearTimeout(t);
    untrack?.();
    cv.remove();
  };
}
/** Appends an owl canvas + blink loop. Cleanup: stop loop, remove canvas. */
export function mountOwl(host: HTMLElement, scale = 4): () => void {
  const cv = spriteCanvas([OWL_OPEN, OWL_BLINK], OWL_PAL, scale);
  cv.className = "owl-cv";
  host.appendChild(cv);
  let live = true;
  let t: number | undefined;
  let untrack: (() => void) | undefined;
  if (!isReduced()) {
    const loop = () => {
      t = window.setTimeout(() => {
        if (!live) return;
        cv._draw(1);
        t = window.setTimeout(() => {
          cv._draw(0);
          loop();
        }, 150);
      }, 2200 + Math.random() * 3000);
    };
    loop();
    untrack = trackAnimation(() => {
      live = false;
      if (t) window.clearTimeout(t);
      cv._draw(0);
    });
  }
  return () => {
    live = false;
    if (t) window.clearTimeout(t);
    untrack?.();
    cv.remove();
  };
}

type IconDef = readonly [Frame, Palette];
const ICONS = {
  coin: [COIN, PAL.coin] as IconDef,
  moon: [MOON, PAL.moon] as IconDef,
  crown: [CROWN, PAL.crown] as IconDef,
  bolt: [BOLT, PAL.bolt] as IconDef,
  star: [STAR, STAR_PAL] as IconDef,
  trophy: [TROPHY, TROPHY_PAL] as IconDef,
  hourglass: [HOURGLASS, HG_PAL] as IconDef,
  sun: [SUN, SUN_PAL] as IconDef,
  pen: [PEN, PEN_PAL] as IconDef,
  wrench: [WRENCH, WRENCH_PAL] as IconDef,
  money: [MONEY, MONEY_PAL] as IconDef,
  folder: [FOLDER, FOLDER_PAL] as IconDef,
};
type IconName = keyof typeof ICONS;

/* ---- podium full-body mascots (evil / cool / nervous) ---- */
const COM: Palette = { K: "#0c0e14", W: "#0a141a", G: "#ffffff" };
const EVIL_PAL: Palette = { ...COM, X: "#ff5ad0", E: "#ff5a4d", P: "#2a0a0a", H: "#ffe2e2", M: "#2a0a12", B: "#3a0a14", A: "#ff8fb0", R: "#ff5a4d" };
const COOL_PAL: Palette = { ...COM, X: "#2ee6ff", E: "#b6ff3d", P: "#0c1418", H: "#ffffff", M: "#ffffff", A: "#ff9ed8" };
const NERV_PAL: Palette = { ...COM, X: "#b6ff3d", E: "#2ee6ff", P: "#0c1418", H: "#ffffff", M: "#ff5ad0", B: "#7cbf2a", A: "#ff9ed8", S: "#9ad8ff" };
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
const MASCOTS: Record<"evil" | "cool" | "nervous", { frames: Frame[]; pal: Palette; cls: string }> = {
  evil: { frames: [bot18(ANT_H, EVIL_A, BODY_A), bot18(ANT_H, EVIL_B, BODY_B)], pal: EVIL_PAL, cls: "mv-evil" },
  cool: { frames: [bot18(ANT_N, COOL_A, BODY_A), bot18(ANT_N, COOL_B, BODY_B)], pal: COOL_PAL, cls: "mv-cool" },
  nervous: { frames: [bot18(ANT_N, NERV_A, BODY_A), bot18(ANT_N, NERV_B, BODY_B)], pal: NERV_PAL, cls: "mv-nervous" },
};
type PodiumKind = keyof typeof MASCOTS;
/** Appends a full-body podium mascot + frame-cycle interval. Cleanup: stop interval, remove canvas. */
export function mountPodiumBot(host: HTMLElement, kind: PodiumKind, scale = 4): () => void {
  const m = MASCOTS[kind] || MASCOTS.cool;
  const cv = spriteCanvas(m.frames, m.pal, scale);
  cv.className = "pbot " + m.cls;
  host.appendChild(cv);
  let iv: number | undefined;
  let untrack: (() => void) | undefined;
  if (!isReduced()) {
    let i = 0;
    iv = window.setInterval(() => cv._draw(++i), 420);
    untrack = trackAnimation(() => {
      if (iv) {
        window.clearInterval(iv);
        iv = undefined;
      }
    });
  }
  return () => {
    if (iv) window.clearInterval(iv);
    untrack?.();
    cv.remove();
  };
}
/** Static single-frame sprite (no timer). Returns the canvas (or null for an unknown name). */
export function mountSprite(host: HTMLElement, name: string, scale = 3): SpriteCanvas | null {
  const map: Record<string, IconDef> = {
    coin: [COIN, PAL.coin],
    moon: [MOON, PAL.moon],
    crown: [CROWN, PAL.crown],
    bolt: [BOLT, PAL.bolt],
  };
  const d = map[name];
  if (!d) return null;
  const cv = spriteCanvas([d[0]], d[1], scale);
  host.appendChild(cv);
  return cv;
}
// static pixel icon (no timer)
/** Static pixel icon (no timer). Returns the canvas (or null for an unknown name). */
export function mountIcon(host: HTMLElement, name: IconName, scale = 3): SpriteCanvas | null {
  const d = ICONS[name];
  if (!d) return null;
  const cv = spriteCanvas([d[0]], d[1], scale);
  cv.className = "tt-icon";
  host.appendChild(cv);
  return cv;
}
// bounded celebratory sparkle/coin spawner around a host (pops + fades upward)
/** Starts an interval spawning fading confetti sprites. Cleanup: stop the spawner interval. */
export function confettiAround(host: HTMLElement, opts?: { kinds?: IconName[]; every?: number }): () => void {
  if (isReduced()) return () => {};
  const o = opts || {};
  const kinds: IconName[] = o.kinds || ["star", "coin", "star"];
  const iv = window.setInterval(() => {
    if (document.hidden || host.childElementCount > 10) return;
    const name = kinds[(Math.random() * kinds.length) | 0];
    const d = ICONS[name];
    let pal: Palette = d[1];
    if (name === "star") {
      const hue = ["#2ee6ff", "#b6ff3d", "#ff5ad0", "#ffe14d"][(Math.random() * 4) | 0];
      pal = { H: hue };
    }
    const cv = spriteCanvas([d[0]], pal, 2);
    cv.className = "confetti";
    cv.style.cssText += ";position:absolute;left:" + Math.random() * 100 + "%;top:" + (20 + Math.random() * 60) + "%;opacity:0;pointer-events:none;z-index:5";
    host.appendChild(cv);
    const dx = (Math.random() * 40 - 20).toFixed(0);
    const done = () => {
      cv.remove();
    };
    cv.animate(
      [
        { transform: "translate(-50%,0) scale(.6)", opacity: 0 },
        { opacity: 1, offset: 0.25 },
        { transform: "translate(calc(-50% + " + dx + "px),-28px) scale(1.1)", opacity: 0 },
      ],
      { duration: 1400 + Math.random() * 600, easing: "ease-out" },
    ).onfinish = done;
    window.setTimeout(done, 2100);
  }, o.every || 900);
  const untrack = trackAnimation(() => window.clearInterval(iv));
  return () => {
    window.clearInterval(iv);
    untrack();
  };
}

/* ---- fairy dust ---- */
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; grav: number; tw: number };
/** Mounts a fullscreen fairy-dust canvas reacting to pointer move/down. Cleanup: drop listeners, cancel rAF, remove canvas. */
export function initFairyDust(colors?: string[]): () => void {
  if (isReduced()) return () => {};
  const cols = colors || ["#2ee6ff", "#b6ff3d", "#ff5ad0", "#ffe14d", "#ffffff"];
  const cv = document.createElement("canvas");
  cv.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9999";
  document.body.appendChild(cv);
  const ctx = cv.getContext("2d")!;
  let W = 0,
    H = 0,
    DPR = 1;
  function rs(): void {
    DPR = Math.min(devicePixelRatio || 1, 2);
    cv.width = innerWidth * DPR;
    cv.height = innerHeight * DPR;
    cv.style.width = innerWidth + "px";
    cv.style.height = innerHeight + "px";
    W = innerWidth;
    H = innerHeight;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }
  rs();
  addEventListener("resize", rs);
  const P: Particle[] = [];
  const MAX = 240;
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  function sp(x: number, y: number, o?: Partial<Particle>): void {
    const opt = o || {};
    if (P.length >= MAX) return;
    P.push({
      x,
      y,
      vx: opt.vx == null ? rnd(-0.3, 0.3) : opt.vx,
      vy: opt.vy == null ? rnd(-0.2, 0.6) : opt.vy,
      life: 0,
      max: opt.max || rnd(46, 82),
      size: opt.size || ((Math.random() * 2) | 0) + 2,
      color: opt.color || cols[(Math.random() * cols.length) | 0],
      grav: opt.grav == null ? 0.012 : opt.grav,
      tw: rnd(0, 6.28),
    });
  }
  let lx: number | null = null,
    ly: number | null = null;
  const onMove = (e: PointerEvent) => {
    const x = e.clientX,
      y = e.clientY;
    if (lx !== null && ly !== null && Math.hypot(x - lx, y - ly) < 6) return;
    lx = x;
    ly = y;
    for (let i = 0, n = 1 + ((Math.random() * 2) | 0); i < n; i++) sp(x + rnd(-3, 3), y + rnd(-3, 3), { vy: rnd(0.05, 0.6), vx: rnd(-0.25, 0.25) });
  };
  const onDown = (e: PointerEvent) => {
    const x = e.clientX,
      y = e.clientY;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * 6.283 + rnd(-0.2, 0.2),
        s = rnd(1.2, 3.4);
      sp(x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, grav: 0.045, max: rnd(28, 54) });
    }
    for (let j = 0; j < 6; j++) sp(x + rnd(-6, 6), y + rnd(-6, 6), { vy: rnd(-0.5, 0.1), grav: 0.008, max: rnd(54, 84) });
  };
  addEventListener("pointermove", onMove, { passive: true });
  addEventListener("pointerdown", onDown, { passive: true });
  let stopped = false;
  let raf = 0;
  function tick(): void {
    if (stopped) return;
    ctx.clearRect(0, 0, W, H);
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.life++;
      p.vy += p.grav;
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.99;
      if (p.life >= p.max) {
        P.splice(i, 1);
        continue;
      }
      const t = 1 - p.life / p.max,
        tw = 0.5 + 0.5 * Math.sin(p.tw + p.life * 0.35);
      ctx.globalAlpha = Math.max(0, t) * tw;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 6;
      const s = p.size * (0.6 + t * 0.6);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);
  const untrack = trackAnimation(() => {
    stopped = true;
    cancelAnimationFrame(raf);
  });
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    untrack();
    removeEventListener("resize", rs);
    removeEventListener("pointermove", onMove);
    removeEventListener("pointerdown", onDown);
    cv.remove();
  };
}

/* ---- rising-coins burner (money burning) ---- */
/** Starts an interval spawning rising coin sprites. Cleanup: stop the spawner interval. */
export function mountCoinBurst(host: HTMLElement): () => void {
  if (isReduced()) return () => {};
  const iv = window.setInterval(() => {
    if (document.hidden || host.childElementCount > 14) return;
    const c = spriteCanvas([COIN], PAL.coin, 3);
    c.className = "coin";
    c.style.cssText += ";left:" + (10 + Math.random() * 70) + "%;bottom:8px;opacity:0";
    host.appendChild(c);
    c.animate(
      [
        { transform: "translateY(0) rotate(0)", opacity: 0 },
        { opacity: 1, offset: 0.15 },
        { transform: "translateY(-72px) rotate(26deg)", opacity: 0 },
      ],
      { duration: 1600, easing: "ease-out" },
    ).onfinish = () => {
      c.remove();
    };
    window.setTimeout(() => {
      c.remove();
    }, 1900);
  }, 900);
  const untrack = trackAnimation(() => window.clearInterval(iv));
  return () => {
    window.clearInterval(iv);
    untrack();
  };
}

/* ---- rising flame embers (money burning, with fire) ---- */
/** Starts an interval spawning rising animated ember sprites. Cleanup: stop the spawner interval. */
export function mountEmberRise(host: HTMLElement, tier?: FlameTier): () => void {
  if (isReduced()) return () => {};
  const pal = (tier && FLAME_TINT[tier]) || FLAME_TINT.inferno;
  const iv = window.setInterval(() => {
    if (document.hidden || host.childElementCount > 14) return;
    const fl = spriteCanvas(FLAME, pal, 2);
    fl.style.cssText += ";position:absolute;left:" + (6 + Math.random() * 88) + "%;bottom:0;opacity:0;pointer-events:none;z-index:1";
    host.appendChild(fl);
    let i = 0;
    const innerIv = window.setInterval(() => fl._draw(++i), 110);
    const drift = (Math.random() * 34 - 17).toFixed(0);
    const done = () => {
      window.clearInterval(innerIv);
      fl.remove();
    };
    fl.animate(
      [
        { transform: "translateY(6px) scale(1)", opacity: 0 },
        { opacity: 0.95, offset: 0.18 },
        { transform: "translateY(-118px) translateX(" + drift + "px) scale(0.45)", opacity: 0 },
      ],
      { duration: 2000 + Math.random() * 800, easing: "ease-out" },
    ).onfinish = done;
    window.setTimeout(done, 3000);
  }, 520);
  // NOTE (dead export): each spawned ember runs its OWN inner setInterval (innerIv, 110ms)
  // cleared only by its own done(); this registry stop clears just the outer spawner. If
  // mountEmberRise is ever wired to a live host, track + clear the inner intervals too so a
  // flip-to-reduce halts them instantly (issue #38 review-panel note).
  const untrack = trackAnimation(() => window.clearInterval(iv));
  return () => {
    window.clearInterval(iv);
    untrack();
  };
}

/** Same surface as the source's `root.TT.sprites` — the raw single-frame grids. */
export const sprites = { COIN, MOON, CROWN, BOLT, STAR, TROPHY, HOURGLASS, PEN, WRENCH };
