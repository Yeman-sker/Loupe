"use client";

import { useEffect, useRef } from "react";

// Hero brand animation — "Scene forge". A full-bleed particle field forges a
// whole scene each cycle: (far→near) scattered, deliberately chaotic wireframe
// COMPONENTS appear with faux depth (smaller/fainter/sparser + a few degrees of
// rotation), then the "Loupe" wordmark forges centre-stage as the clear hero,
// then three Selection frames assemble — one bright frame hopping the wordmark's
// glyphs plus two dimmer, thinner, label-less frames slowly hopping the
// background components. Everything dissolves and re-forges on a slow loop. The
// wordmark IS the DOM being pointed at.
//
// Canvas 2D, hand-rolled rAF, no animation library (first-load JS stays small).
// Runs only while on-screen and the tab is visible; theme-var driven (the
// theme toggle is respected live); prefers-reduced-motion → one static frame.

// ---- tiny helpers --------------------------------------------------------
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, m: number) => a + (b - a) * m;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const mono = (size: number) => `600 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function corners(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, len: number) {
  const c = (cx: number, cy: number, dx: number, dy: number) => {
    ctx.beginPath();
    ctx.moveTo(cx + dx * len, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * len);
    ctx.stroke();
  };
  c(x, y, 1, 1);
  c(x + w, y, -1, 1);
  c(x, y + h, 1, -1);
  c(x + w, y + h, -1, -1);
}

// deterministic pseudo-random pair from an index
function rng(i: number) {
  const a = Math.sin(i * 12.9898) * 43758.5453;
  const b = Math.sin(i * 78.233) * 12543.123;
  return [a - Math.floor(a), b - Math.floor(b)] as const;
}

// ---- scene definitions ---------------------------------------------------
type Stop = { x: number; y: number; w: number; h: number; label: string };
type TextPt = { tx: number; ty: number; col: number };
type CompPt = { tx: number; ty: number; ci: number };
type Drift = { x: number; y: number; amp: number; spd: number; ph: number; size: number };
type Comp = { x: number; y: number; w: number; h: number; rot: number; depth: number };

// Procedurally scattered components — deliberately chaotic: random position,
// size (skewed small), rotation (±~15°) and depth. Seeded so the layout is
// deterministic (no reshuffle on resize). Centres are kept out of the central
// Loupe band so the wordmark stays the clear hero.
const COMP_COUNT = 16;
const COMPONENTS: Comp[] = (() => {
  const out: Comp[] = [];
  let tries = 0;
  while (out.length < COMP_COUNT && tries < COMP_COUNT * 12) {
    tries++;
    const [a, b] = rng(900 + tries * 1.37);
    const [c2, d] = rng(1700 + tries * 2.11);
    const cx = 0.05 + a * 0.9;
    const cy = 0.08 + b * 0.84;
    if (cx > 0.3 && cx < 0.7 && cy > 0.37 && cy < 0.63) continue; // keep Loupe band clearer
    const wq = 0.02 + c2 * c2 * 0.18; // skew toward small boxes
    const hq = 0.02 + d * d * 0.11;
    const [e] = rng(2500 + tries * 3.7);
    const [, f] = rng(3300 + tries * 4.3);
    const rot = (e - 0.5) * 0.52; // ±0.26 rad ≈ ±15°
    const depth = 0.15 + f * 0.85;
    out.push({ x: cx - wq / 2, y: cy - hq / 2, w: wq, h: hq, rot, depth });
  }
  return out;
})();

const FONT_PX = (w: number) => Math.min(w * 0.2, 190);
const CYCLE = 19000; // slow, silky loop
const FN_MAIN = 110;
const FN_BG = 64;
const SPACING = 11; // px between component-outline particles
const BG_HOPS = 3; // slow hops per cycle for each background frame

function compBox(c: Comp, w: number, h: number) {
  return { cx: (c.x + c.w / 2) * w, cy: (c.y + c.h / 2) * h, W: c.w * w, H: c.h * h, rot: c.rot, depth: c.depth };
}

// perimeter point of an axis-aligned box, then rotated about its centre
function rotPerim(b: ReturnType<typeof compBox>, param: number) {
  const per = 2 * (b.W + b.H);
  let d = param * per;
  let lx: number;
  let ly: number;
  if (d < b.W) { lx = -b.W / 2 + d; ly = -b.H / 2; }
  else if ((d -= b.W) < b.H) { lx = b.W / 2; ly = -b.H / 2 + d; }
  else if ((d -= b.H) < b.W) { lx = b.W / 2 - d; ly = b.H / 2; }
  else { d -= b.W; lx = -b.W / 2; ly = b.H / 2 - d; }
  const cos = Math.cos(b.rot);
  const sin = Math.sin(b.rot);
  return { x: b.cx + lx * cos - ly * sin, y: b.cy + lx * sin + ly * cos };
}

// Rasterise the "Loupe" wordmark centred in (w,h): sample its pixels into text
// targets and measure per-glyph boxes for the main frame's traversal.
function layout(w: number, h: number) {
  const off = document.createElement("canvas");
  off.width = Math.max(1, Math.round(w));
  off.height = Math.max(1, Math.round(h));
  const c = off.getContext("2d");
  const px = FONT_PX(w);
  const points: TextPt[] = [];
  const glyphs: Stop[] = [];
  const empty: Stop = { x: 0, y: 0, w, h, label: "" };
  if (!c) return { points, glyphs, full: empty };

  const text = "Loupe";
  c.font = `800 ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  c.textBaseline = "alphabetic";
  const asc = px * 0.78;
  const lineW = c.measureText(text).width;
  const x0 = (w - lineW) / 2;
  const baseY = h / 2 + asc / 2;

  c.fillStyle = "#fff";
  c.fillText(text, x0, baseY);

  let cx = x0;
  for (const ch of text) {
    const gw = c.measureText(ch).width;
    if (ch.trim()) glyphs.push({ x: cx - 2, y: baseY - asc - 2, w: gw + 4, h: px * 0.92 + 4, label: `glyph · "${ch}"` });
    cx += gw;
  }

  const img = c.getImageData(0, 0, off.width, off.height).data;
  const step = 5;
  const raw: TextPt[] = [];
  for (let y = 0; y < off.height; y += step) {
    for (let x = 0; x < off.width; x += step) {
      if (img[(y * off.width + x) * 4 + 3] > 128) raw.push({ tx: x, ty: y, col: 0 });
    }
  }
  const MAX = 640;
  const stride = raw.length > MAX ? raw.length / MAX : 1;
  for (let i = 0; i < raw.length; i += stride) points.push(raw[Math.floor(i)]);

  const fx = x0 - 18;
  const fy = baseY - asc - 16;
  const full: Stop = { x: fx, y: fy, w: lineW + 36, h: asc + px * 0.14 + 32, label: "<h1>" };
  for (const p of points) p.col = clamp01((p.tx - full.x) / Math.max(1, full.w));
  return { points, glyphs, full };
}

function makeScene() {
  let text: TextPt[] = [];
  let glyphs: Stop[] = [];
  let full: Stop = { x: 0, y: 0, w: 0, h: 0, label: "" };
  let compPts: CompPt[] = [];
  let homes: Drift[] = [];
  let built = { w: 0, h: 0 };

  function build(w: number, h: number) {
    const lay = layout(w, h);
    text = lay.points;
    glyphs = lay.glyphs;
    full = lay.full;

    compPts = [];
    for (let ci = 0; ci < COMPONENTS.length; ci++) {
      const b = compBox(COMPONENTS[ci], w, h);
      const per = 2 * (b.W + b.H);
      const n = Math.max(6, Math.round((per / SPACING) * (0.45 + 0.55 * b.depth)));
      for (let k = 0; k < n; k++) {
        const p = rotPerim(b, k / n);
        compPts.push({ tx: p.x, ty: p.y, ci });
      }
    }

    homes = [];
    const total = text.length + compPts.length + FN_MAIN + 2 * FN_BG;
    for (let i = 0; i < total; i++) {
      const [r1, r2] = rng(i);
      const r3 = (r1 + r2) % 1;
      homes.push({ x: r1 * w, y: r2 * h, amp: 4 + r3 * 16, spd: 0.4 + r1 * 0.8, ph: r2 * 7, size: 1 + r3 * 1.6 });
    }
    built = { w, h };
  }

  // forge-in window, hold, then a shared dissolve back to chaos at the end
  const assemble = (c: number, start: number, dur: number) => {
    if (c < start) return 0;
    if (c < start + dur) return easeInOut((c - start) / dur);
    if (c < 0.9) return 1;
    return 1 - easeInOut(clamp01((c - 0.9) / 0.1));
  };

  return function draw(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, reduce: boolean, v: (n: string) => string) {
    if (built.w !== w || built.h !== h || text.length === 0) build(w, h);
    const iris = v("--iris");
    const ink = v("--ink");
    const ink3 = v("--ink-3");
    const paper = v("--paper");

    const c = reduce ? 0.66 : (t % CYCLE) / CYCLE;
    const ts = t / 1000;
    let hi = 0; // particle cursor into homes[]

    // ---- background component particles (far→near forge) ----
    for (let i = 0; i < compPts.length; i++) {
      const p = compPts[i];
      const hm = homes[hi++];
      const depth = COMPONENTS[p.ci].depth;
      const start = reduce ? 0 : 0.06 + (1 - depth) * 0.12;
      const m = reduce ? 1 : assemble(c, start, 0.16);
      const dx = hm.x + Math.sin(ts * hm.spd + hm.ph) * hm.amp;
      const dy = hm.y + Math.cos(ts * hm.spd * 0.9 + hm.ph) * hm.amp;
      const x = lerp(dx, p.tx, m);
      const y = lerp(dy, p.ty, m);
      const s = 1.6;
      ctx.globalAlpha = (0.26 + 0.46 * depth) * (0.3 + 0.7 * m);
      ctx.fillStyle = ink3;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    // ---- Loupe wordmark particles ----
    for (let i = 0; i < text.length; i++) {
      const p = text[i];
      const hm = homes[hi++];
      const start = reduce ? 0 : 0.24 + p.col * 0.12;
      const m = reduce ? 1 : assemble(c, start, 0.15);
      const dx = hm.x + Math.sin(ts * hm.spd + hm.ph) * hm.amp;
      const dy = hm.y + Math.cos(ts * hm.spd * 0.9 + hm.ph) * hm.amp;
      const x = lerp(dx, p.tx, m);
      const y = lerp(dy, p.ty, m);
      ctx.globalAlpha = 0.16 + 0.84 * m;
      ctx.fillStyle = m > 0.5 ? ink : ink3;
      const s = m > 0.5 ? 1.7 : hm.size;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    // ---- frame assemble factor + traversal progress (after both forges) ----
    const fa = reduce ? 1 : assemble(c, 0.36, 0.05);
    const tp = reduce ? 0 : clamp01((c - 0.4) / 0.5);

    const mainStops: Stop[] = [full, ...glyphs];
    const bgAStops: Stop[] = [];
    const bgBStops: Stop[] = [];
    for (let i = 0; i < COMPONENTS.length; i++) {
      const b = compBox(COMPONENTS[i], w, h);
      const s: Stop = { x: b.cx - b.W / 2, y: b.cy - b.H / 2, w: b.W, h: b.H, label: "" };
      (i % 2 === 0 ? bgAStops : bgBStops).push(s);
    }

    // ride frame particles along a box perimeter, blending from drift by `fa`
    const rideFrame = (cur: Stop, count: number, alpha: number, blur: number) => {
      const b = { cx: cur.x + cur.w / 2, cy: cur.y + cur.h / 2, W: cur.w, H: cur.h, rot: 0, depth: 1 };
      ctx.save();
      ctx.shadowColor = iris;
      for (let i = 0; i < count; i++) {
        const hm = homes[hi++];
        const tgt = rotPerim(b, i / count);
        const dx = hm.x + Math.sin(ts * hm.spd + hm.ph) * hm.amp;
        const dy = hm.y + Math.cos(ts * hm.spd * 0.9 + hm.ph) * hm.amp;
        const x = lerp(dx, tgt.x, fa);
        const y = lerp(dy, tgt.y, fa);
        ctx.shadowBlur = blur * fa;
        ctx.globalAlpha = alpha * (0.3 + 0.7 * fa);
        ctx.fillStyle = iris;
        ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    };

    // background frames — dimmer, thinner, corner-only, slow (BG_HOPS hops/cycle)
    const bgFrame = (stops: Stop[], offset: number) => {
      if (fa < 0.01 || stops.length === 0) return;
      const n = stops.length;
      const pos = tp * BG_HOPS + offset;
      const k = ((Math.floor(pos) % n) + n) % n;
      const local = pos - Math.floor(pos);
      const A = stops[k];
      const B = stops[(k + 1) % n];
      const travel = easeInOut(clamp01(local / 0.72));
      const cur: Stop = {
        x: lerp(A.x, B.x, travel),
        y: lerp(A.y, B.y, travel),
        w: lerp(A.w, B.w, travel),
        h: lerp(A.h, B.h, travel),
        label: "",
      };
      rideFrame(cur, FN_BG, 0.4, 5);
      ctx.save();
      ctx.globalAlpha = fa * 0.5;
      ctx.strokeStyle = iris;
      ctx.lineWidth = 1.25;
      ctx.lineCap = "round";
      corners(ctx, cur.x, cur.y, cur.w, cur.h, 9);
      ctx.restore();
      ctx.globalAlpha = 1;
    };
    bgFrame(bgAStops, 0);
    bgFrame(bgBStops, 1.5);

    // ---- main frame on the Loupe wordmark (bright, label + dimension) ----
    if (fa > 0.01) {
      const n = mainStops.length;
      const pos = tp * (n - 1);
      const k = Math.min(n - 1, Math.floor(pos));
      const k1 = Math.min(n - 1, k + 1);
      const local = pos - k;
      const travel = easeInOut(clamp01(local / 0.72));
      const A = mainStops[k];
      const B = mainStops[k1];
      const cur: Stop = {
        x: lerp(A.x, B.x, travel),
        y: lerp(A.y, B.y, travel),
        w: lerp(A.w, B.w, travel),
        h: lerp(A.h, B.h, travel),
        label: travel > 0.5 ? B.label : A.label,
      };

      rideFrame(cur, FN_MAIN, 0.92, 6);

      ctx.globalAlpha = fa * 0.07;
      roundRectPath(ctx, cur.x, cur.y, cur.w, cur.h, 6);
      ctx.fillStyle = iris;
      ctx.fill();

      ctx.globalAlpha = fa;
      ctx.strokeStyle = iris;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      corners(ctx, cur.x, cur.y, cur.w, cur.h, 13);

      ctx.fillStyle = iris;
      ctx.font = mono(10.5);
      const dim = `${Math.round(cur.w)} × ${Math.round(cur.h)}`;
      ctx.fillText(dim, cur.x + cur.w - ctx.measureText(dim).width, cur.y - 7);

      const dwell = clamp01((local - 0.6) / 0.25) * (k > 0 ? 1 : 0);
      if (dwell > 0.02 && tp > 0.02) {
        ctx.globalAlpha = fa * dwell;
        const label = cur.label;
        ctx.font = mono(11);
        const pad = 7;
        const tw = ctx.measureText(label).width;
        roundRectPath(ctx, cur.x, cur.y + cur.h + 7, tw + pad * 2, 21, 5);
        ctx.fillStyle = iris;
        ctx.fill();
        ctx.fillStyle = paper;
        ctx.fillText(label, cur.x + pad, cur.y + cur.h + 7 + 14.5);
      }
      ctx.globalAlpha = 1;
    }
  };
}

export function HeroAnimation() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const VARS = ["--iris", "--ink", "--ink-3", "--paper"];
    const cache: Record<string, string> = {};
    const readColors = () => {
      const s = getComputedStyle(canvas);
      for (const n of VARS) cache[n] = s.getPropertyValue(n).trim();
    };
    const v = (n: string) => cache[n] || "#888";
    readColors();

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const draw = makeScene();
    let start = 0;
    let running = false;
    let raf = 0;
    const frame = (now: number) => {
      if (!start) start = now;
      ctx.clearRect(0, 0, w, h);
      draw(ctx, w, h, reduce ? CYCLE * 0.66 : now - start, reduce, v);
      if (running) raf = requestAnimationFrame(frame);
    };

    if (reduce) {
      requestAnimationFrame(frame); // one static frame, no loop
      const mo = new MutationObserver(() => {
        readColors();
        requestAnimationFrame(frame);
      });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      return () => mo.disconnect();
    }

    const startLoop = () => {
      if (running) return;
      running = true;
      start = 0;
      raf = requestAnimationFrame(frame);
    };
    const stopLoop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    const io = new IntersectionObserver(
      (es) => (es[0]?.isIntersecting && !document.hidden ? startLoop() : stopLoop()),
      { threshold: 0 },
    );
    io.observe(canvas);
    const onVis = () => (document.hidden ? stopLoop() : startLoop());
    const onResize = () => resize();
    const mo = new MutationObserver(readColors);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("resize", onResize);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      stopLoop();
      io.disconnect();
      mo.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas ref={ref} className="hero-canvas" aria-hidden="true" />;
}
