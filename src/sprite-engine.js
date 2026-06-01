/* ============================================================================
 * NEON MISSION CONTROL — pixel sprite engine + fairy-dust  (vanilla, no deps)
 * The cute layer of the aesthetic: crisp pixel-art drawn from tiny string grids
 * onto <canvas>, plus a cursor sparkle/burst effect. Offline-safe.
 * ----------------------------------------------------------------------------
 * USAGE
 *   const cv = spriteCanvas([FRAME_A, FRAME_B], PAL, 4);  // frames, palette, scale
 *   el.appendChild(cv);
 *   cv._draw(1);                       // switch frame (e.g. blink)
 *   initFairyDust();                   // global cursor sparkles + click bursts
 *
 * A sprite FRAME is string[] (rows). Each char maps to a color in PAL; any char
 * not in PAL (e.g. '.') is transparent. Rows may differ in length (auto-padded).
 * Keep CSS `image-rendering:pixelated` on the canvas.
 * ========================================================================== */

export function spriteCanvas(frames, pal, scale = 4) {
  const w = Math.max(...frames.flat().map(r => r.length));
  const h = frames[0].length;
  const cv = document.createElement("canvas");
  cv.width = w * scale; cv.height = h * scale;
  cv.style.width = w * scale + "px"; cv.style.height = h * scale + "px";
  cv.style.imageRendering = "pixelated";
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  cv._draw = (fi) => {
    ctx.clearRect(0, 0, cv.width, cv.height);
    const rows = frames[((fi % frames.length) + frames.length) % frames.length];
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const c = pal[row[x]];
        if (c) { ctx.fillStyle = c; ctx.fillRect(x * scale, y * scale, scale, scale); }
      }
    }
  };
  cv._draw(0);
  return cv;
}

/* Example palettes + sprites you can build on ------------------------------- */
export const PAL = {
  bot:   { K:"#0c0e14", C:"#2ee6ff", W:"#08161c", L:"#b6ff3d", M:"#ff5ad0" },
  flame: { Y:"#ffe14d", O:"#ffb43d", R:"#ff6a2b" },
  coin:  { G:"#c89b2e", Y:"#ffe14d", O:"#b8860b" },
};

/* A friendly robot mascot: open eyes + a blink frame (drive on a timer). */
export const BOT = {
  open:  ["....MM....","....KK....",".KKKKKKKK.","KCCCCCCCCK","KCWWWWWWCK","KCWLWWLWCK",
          "KCWLWWLWCK","KCWWWWWWCK","KCWMWWMWCK","KCCCCCCCCK",".KKKKKKKK.",".K......K."],
  blink: ["....MM....","....KK....",".KKKKKKKK.","KCCCCCCCCK","KCWWWWWWCK","KCWLLLLWCK",
          "KCWLLLLWCK","KCWWWWWWCK","KCWMWWMWCK","KCCCCCCCCK",".KKKKKKKK.",".K......K."],
};
/** Mount a mascot that blinks on a timer and happy-blinks on click. */
export function mountMascot(host, scale = 4) {
  const bot = spriteCanvas([BOT.open, BOT.blink], PAL.bot, scale);
  bot.style.cursor = "pointer";
  host.appendChild(bot);
  bot.addEventListener("click", () => { bot._draw(1); setTimeout(() => bot._draw(0), 260); });
  (function loop(){ setTimeout(() => { bot._draw(1); setTimeout(() => { bot._draw(0); loop(); }, 150); }, 1800 + Math.random()*3200); })();
  return bot;
}

/* A flickering flame (cycle frames ~120ms). */
export const FLAME = [
  ["...YY...","..YOOY..","..YOOY..",".YOOOOY.",".YORROY.","YORRRROY","YORRRROY","YOORROOY",".YOOOOY.","..YOOY..","...OO..."],
  ["..YY....","..YOY...",".YOOY...",".YOOOY..",".YORROY.","YORRRROY","YORRRROY","YOORROOY",".YOOOOY.","..YOOY..","...OO..."],
  ["....YY..","...YOY..","...YOOY.","..YOOOY.",".YORROY.","YORRRROY","YORRRROY","YOORROOY",".YOOOOY.","..YOOY..","...OO..."],
];
export function mountFlame(host, scale = 4) {
  const fl = spriteCanvas(FLAME, PAL.flame, scale);
  host.appendChild(fl);
  let i = 0; setInterval(() => fl._draw(++i), 120);
  return fl;
}

/* ---- Fairy dust: neon pixel sparkles on pointer-move, burst on click ------ */
export function initFairyDust(colors = ["#2ee6ff","#b6ff3d","#ff5ad0","#ffe14d","#ffffff"]) {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const cv = document.createElement("canvas");
  cv.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9999";
  document.body.appendChild(cv);
  const ctx = cv.getContext("2d"); let W, H, DPR;
  const rs = () => { DPR = Math.min(devicePixelRatio||1,2); cv.width=innerWidth*DPR; cv.height=innerHeight*DPR;
    cv.style.width=innerWidth+"px"; cv.style.height=innerHeight+"px"; W=innerWidth; H=innerHeight;
    ctx.setTransform(DPR,0,0,DPR,0,0); ctx.imageSmoothingEnabled=false; };
  rs(); addEventListener("resize", rs);
  const P = [], MAX = 240, rnd = (a,b)=>a+Math.random()*(b-a);
  const sp = (x,y,o={}) => { if (P.length>=MAX) return;
    P.push({x,y,vx:o.vx??rnd(-.3,.3),vy:o.vy??rnd(-.2,.6),life:0,max:o.max||rnd(46,82),
      size:o.size||((Math.random()*2|0)+2),color:o.color||colors[(Math.random()*colors.length)|0],
      grav:o.grav??0.012,tw:rnd(0,6.28)}); };
  let lx=null, ly=null;
  addEventListener("pointermove", e=>{ const x=e.clientX,y=e.clientY;
    if (lx!==null && Math.hypot(x-lx,y-ly)<6) return; lx=x; ly=y;
    for (let i=0,n=1+(Math.random()*2|0); i<n; i++) sp(x+rnd(-3,3),y+rnd(-3,3),{vy:rnd(.05,.6),vx:rnd(-.25,.25)}); }, {passive:true});
  addEventListener("pointerdown", e=>{ const x=e.clientX,y=e.clientY;
    for (let i=0;i<16;i++){ const a=(i/16)*6.283+rnd(-.2,.2), s=rnd(1.2,3.4); sp(x,y,{vx:Math.cos(a)*s,vy:Math.sin(a)*s,grav:.045,max:rnd(28,54)}); }
    for (let i=0;i<6;i++) sp(x+rnd(-6,6),y+rnd(-6,6),{vy:rnd(-.5,.1),grav:.008,max:rnd(54,84)}); }, {passive:true});
  (function tick(){ ctx.clearRect(0,0,W,H);
    for (let i=P.length-1;i>=0;i--){ const p=P[i]; p.life++; p.vy+=p.grav; p.x+=p.vx; p.y+=p.vy; p.vx*=.99;
      if (p.life>=p.max){ P.splice(i,1); continue; }
      const t=1-p.life/p.max, tw=.5+.5*Math.sin(p.tw+p.life*.35);
      ctx.globalAlpha=Math.max(0,t)*tw; ctx.fillStyle=p.color; ctx.shadowColor=p.color; ctx.shadowBlur=6;
      const s=p.size*(.6+t*.6); ctx.fillRect(p.x-s/2,p.y-s/2,s,s); }
    ctx.globalAlpha=1; ctx.shadowBlur=0; requestAnimationFrame(tick); })();
}

/* CommonJS-friendly export too */
if (typeof module !== "undefined") module.exports = { spriteCanvas, PAL, BOT, FLAME, mountMascot, mountFlame, initFairyDust };
