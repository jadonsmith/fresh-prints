// Drawings: checking what phones send, and doodling our own.
//
// A drawing is { bg, ops }. bg is the shirt colour the artist picked. Each op
// is [kind, ink, size, x0, y0, x1, y1, ...] with integer coordinates on a
// COORD x COORD grid: a brush stroke, an eraser stroke, or a bucket fill
// (one point). Clients replay the ops onto a canvas, so nothing a player
// sends is ever treated as markup.

import { COORD, INKS, SHIRTS, SIZES, LIMITS, OP } from "../public/js/palette.js";

export { COORD };

// Returns a clean copy, or null if anything is off.
export function cleanArt(a) {
  if (!a || typeof a !== "object") return null;
  const bg = Number.isInteger(a.bg) && a.bg >= 0 && a.bg < SHIRTS.length ? a.bg : 0;
  if (!Array.isArray(a.ops) || a.ops.length > LIMITS.ops) return null;
  let total = 0;
  const ops = [];
  for (const op of a.ops) {
    if (!Array.isArray(op) || op.length < 5) return null;
    const [k, c, s] = op;
    if (k !== OP.BRUSH && k !== OP.ERASE && k !== OP.FILL) return null;
    if (!Number.isInteger(c) || c < 0 || c >= INKS.length) return null;
    if (!Number.isInteger(s) || s < 0 || s >= SIZES.length) return null;
    const n = op.length - 3;
    if (n % 2 || n > LIMITS.stroke || (k === OP.FILL && n !== 2)) return null;
    for (let i = 3; i < op.length; i++) {
      const v = op[i];
      if (!Number.isInteger(v) || v < 0 || v >= COORD) return null;
    }
    total += n;
    if (total > LIMITS.coords) return null;
    ops.push(op.slice());
  }
  return { bg, ops };
}

// Nothing but eraser marks counts as blank.
export function isBlank(art) {
  return !art || !art.ops.some((op) => op[0] !== OP.ERASE);
}

// ---------- doodles (bots and the house designs) ----------
const cl = (v) => Math.max(0, Math.min(COORD - 1, Math.round(v)));
const flat = (pts) => pts.flatMap(([x, y]) => [cl(x), cl(y)]);
const line = (ink, size, pts) => [OP.BRUSH, ink, size, ...flat(pts)];
const fill = (ink, x, y) => [OP.FILL, ink, 0, cl(x), cl(y)];

function ring(cx, cy, rx, ry = rx, n = 44, a0 = 0) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}
function arc(cx, cy, r, a0, a1, n = 20) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}
function starPts(cx, cy, r1, r2, k = 5, rot = -Math.PI / 2) {
  const out = [];
  for (let i = 0; i <= k * 2; i++) {
    const r = i % 2 ? r2 : r1;
    const a = rot + (i / (k * 2)) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

const BLACK = 0;
const WHITE = 1;
const BRIGHT = [2, 3, 4, 5, 6, 7, 8, 9];

function pick(a, rng) {
  return a[Math.floor(rng() * a.length)];
}

const MAKERS = {
  smiley(rng) {
    const c = pick([4, 3, 9, 6], rng);
    return [
      line(BLACK, 1, ring(500, 500, 300)),
      fill(c, 500, 500),
      line(BLACK, 2, [[400, 400], [400, 440]]),
      line(BLACK, 2, [[600, 400], [600, 440]]),
      line(BLACK, 2, arc(500, 520, 170, 0.25 * Math.PI, 0.75 * Math.PI)),
    ];
  },
  sun(rng) {
    const ops = [line(BLACK, 1, ring(500, 500, 190)), fill(pick([4, 3], rng), 500, 500)];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ops.push(line(pick([3, 4, 2], rng), 2, [[500 + Math.cos(a) * 240, 500 + Math.sin(a) * 240], [500 + Math.cos(a) * 360, 500 + Math.sin(a) * 360]]));
    }
    ops.push(line(BLACK, 3, [[380, 470], [620, 470]]));
    return ops;
  },
  star(rng) {
    const c = pick(BRIGHT, rng);
    const ops = [line(BLACK, 1, starPts(500, 520, 340, 150)), fill(c, 500, 520)];
    ops.push(line(pick(BRIGHT, rng), 1, [[150, 170], [150, 250]]), line(pick(BRIGHT, rng), 1, [[110, 210], [190, 210]]));
    ops.push(line(pick(BRIGHT, rng), 1, [[830, 780], [830, 860]]), line(pick(BRIGHT, rng), 1, [[790, 820], [870, 820]]));
    return ops;
  },
  heart(rng) {
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const t = (i / 60) * Math.PI * 2;
      const x = 16 * Math.sin(t) ** 3;
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      pts.push([500 + x * 19, 470 - y * 19]);
    }
    return [line(BLACK, 1, pts), fill(pick([2, 9], rng), 500, 470), line(WHITE, 2, arc(390, 380, 60, Math.PI, 1.5 * Math.PI, 8))];
  },
  flower(rng) {
    const petal = pick(BRIGHT, rng);
    const ops = [line(5, 3, [[500, 560], [510, 760], [500, 960]])];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const cx = 500 + Math.cos(a) * 150;
      const cy = 400 + Math.sin(a) * 150;
      ops.push(line(BLACK, 1, ring(cx, cy, 100, 100, 32)), fill(petal, cx + Math.cos(a) * 40, cy + Math.sin(a) * 40));
    }
    ops.push(line(BLACK, 1, ring(500, 400, 95)), fill(4, 500, 400));
    return ops;
  },
  bolt(rng) {
    const pts = [[560, 90], [300, 540], [480, 540], [400, 910], [720, 400], [540, 400], [640, 90], [560, 90]];
    return [line(BLACK, 1, pts), fill(pick([4, 3, 6], rng), 520, 300)];
  },
  mountains(rng) {
    const ops = [line(BLACK, 1, ring(720, 280, 110)), fill(pick([4, 3, 9], rng), 720, 280)];
    const ridge = [[0, 760], [180, 470], [330, 650], [520, 330], [720, 640], [850, 500], [999, 700]];
    ops.push(line(BLACK, 1, ridge), fill(pick([5, 7, 8, 6], rng), 520, 900));
    ops.push(line(WHITE, 2, [[460, 420], [520, 330], [580, 420]]));
    return ops;
  },
  fish(rng) {
    const body = pick(BRIGHT, rng);
    return [
      line(BLACK, 1, ring(450, 500, 280, 170)),
      fill(body, 450, 500),
      line(BLACK, 1, [[720, 500], [930, 330], [930, 670], [720, 500]]),
      fill(pick(BRIGHT, rng), 860, 500),
      line(BLACK, 2, [[300, 450], [302, 452]]),
      line(BLACK, 1, arc(450, 500, 120, -0.4 * Math.PI, 0.4 * Math.PI)),
    ];
  },
  cat(rng) {
    const fur = pick([3, 11, 10, 0], rng);
    const ink = fur === 0 ? WHITE : BLACK;
    return [
      line(ink, 1, ring(500, 560, 280, 250)),
      line(ink, 1, [[290, 400], [300, 120], [460, 315]]),
      line(ink, 1, [[540, 315], [700, 120], [710, 400]]),
      fill(fur, 500, 560),
      fill(fur, 330, 300),
      fill(fur, 670, 300),
      line(ink, 3, [[410, 520], [412, 522]]),
      line(ink, 3, [[590, 520], [592, 522]]),
      line(9, 2, [[480, 610], [520, 610], [500, 640], [480, 610]]),
      line(ink, 0, [[430, 650], [260, 620]]),
      line(ink, 0, [[430, 670], [260, 690]]),
      line(ink, 0, [[570, 650], [740, 620]]),
      line(ink, 0, [[570, 670], [740, 690]]),
    ];
  },
  planet(rng) {
    return [
      line(BLACK, 1, ring(500, 500, 230)),
      fill(pick(BRIGHT, rng), 500, 500),
      line(pick(BRIGHT, rng), 2, ring(500, 500, 420, 110, 60, 0.15)),
      line(WHITE, 1, ring(800, 180, 18)),
      line(WHITE, 1, ring(170, 820, 12)),
    ];
  },
  ghost(rng) {
    const pts = [[260, 820], ...arc(500, 450, 240, Math.PI, 2 * Math.PI, 24)];
    pts.push([740, 820], [660, 760], [580, 830], [500, 760], [420, 830], [340, 760], [260, 820]);
    return [
      line(BLACK, 1, pts),
      fill(WHITE, 500, 500),
      line(BLACK, 3, [[420, 450], [422, 452]]),
      line(BLACK, 3, [[580, 450], [582, 452]]),
      line(BLACK, 1, ring(500, 570, 34, 50, 20)),
      line(pick(BRIGHT, rng), 1, [[120, 200], [180, 160], [240, 200]]),
    ];
  },
  scribble(rng) {
    const ops = [];
    const n = 3 + Math.floor(rng() * 4);
    for (let k = 0; k < n; k++) {
      const pts = [];
      let x = 150 + rng() * 700;
      let y = 150 + rng() * 700;
      let a = rng() * Math.PI * 2;
      for (let i = 0; i < 40; i++) {
        a += (rng() - 0.5) * 0.9;
        x = Math.max(60, Math.min(940, x + Math.cos(a) * 22));
        y = Math.max(60, Math.min(940, y + Math.sin(a) * 22));
        pts.push([x, y]);
      }
      ops.push(line(pick(BRIGHT, rng), Math.floor(rng() * 4), pts));
    }
    for (let k = 0; k < 6; k++) {
      const x = 100 + rng() * 800;
      const y = 100 + rng() * 800;
      ops.push(line(pick([0, ...BRIGHT], rng), 2, [[x, y], [x + 2, y + 2]]));
    }
    return ops;
  },
};
const KINDS = Object.keys(MAKERS);

// A random doodle, on a shirt colour it reads well on.
export function doodle(rng = Math.random) {
  const kind = pick(KINDS, rng);
  const ops = MAKERS[kind](rng);
  const wantsDark = kind === "ghost" || kind === "planet";
  const pool = SHIRTS.map((s, i) => [s, i]).filter(([s]) => s.dark === wantsDark);
  return { bg: pick(pool, rng)[1], ops, kind };
}
