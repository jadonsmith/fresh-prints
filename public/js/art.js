// Drawings on the client: replaying ops onto a canvas, the bucket fill, and a
// cache of finished images (blob URLs) for the shirts.
//
// Everything renders on a fixed RASTER x RASTER canvas, so a bucket fill lands
// the same way on every phone and on the big screen.

import { COORD, INKS, SIZES, OP } from "./palette.js";

export const RASTER = 720;

const RGB = INKS.map(({ hex }) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]);

// One stroke, smoothed through the midpoints of its samples.
export function strokePath(ctx, op, s) {
  const n = (op.length - 3) / 2;
  ctx.beginPath();
  const x0 = op[3] * s;
  const y0 = op[4] * s;
  if (n === 1) {
    ctx.arc(x0, y0, (SIZES[op[2]] * s) / 2, 0, Math.PI * 2);
    return "dot";
  }
  ctx.moveTo(x0, y0);
  if (n === 2) {
    ctx.lineTo(op[5] * s, op[6] * s);
    return "line";
  }
  for (let i = 1; i < n - 1; i++) {
    const x = op[3 + i * 2] * s;
    const y = op[4 + i * 2] * s;
    const nx = op[5 + i * 2] * s;
    const ny = op[6 + i * 2] * s;
    ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
  }
  ctx.lineTo(op[3 + (n - 1) * 2] * s, op[4 + (n - 1) * 2] * s);
  return "line";
}

export function drawStroke(ctx, op, px) {
  const s = px / COORD;
  ctx.save();
  ctx.globalCompositeOperation = op[0] === OP.ERASE ? "destination-out" : "source-over";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = SIZES[op[2]] * s;
  ctx.strokeStyle = INKS[op[1]].hex;
  ctx.fillStyle = op[0] === OP.ERASE ? "#000" : INKS[op[1]].hex;
  if (strokePath(ctx, op, s) === "dot") ctx.fill();
  else ctx.stroke();
  ctx.restore();
}

// Bucket fill on raw pixels. The region is grown from the tapped pixel, then
// grown by two more pixels and painted *underneath* what's there, so the
// soft edges of strokes stay soft instead of getting a hard halo.
export function floodFill(data, W, H, fx, fy, rgb) {
  const x0 = Math.max(0, Math.min(W - 1, Math.round(fx)));
  const y0 = Math.max(0, Math.min(H - 1, Math.round(fy)));
  const d = data;
  const i0 = (y0 * W + x0) * 4;
  const ta = d[i0 + 3];
  const tr = d[i0];
  const tg = d[i0 + 1];
  const tb = d[i0 + 2];
  if (ta > 250 && Math.abs(tr - rgb[0]) + Math.abs(tg - rgb[1]) + Math.abs(tb - rgb[2]) < 6) return false;
  const clear = ta < 128;
  const match = clear
    ? (i) => d[i + 3] < 128
    : (i) => d[i + 3] >= 128 && Math.abs(d[i] - tr) + Math.abs(d[i + 1] - tg) + Math.abs(d[i + 2] - tb) < 96;
  const mask = new Uint8Array(W * H);
  const stack = [x0, y0];
  while (stack.length) {
    const y = stack.pop();
    let x = stack.pop();
    let p = y * W + x;
    while (x > 0 && !mask[p - 1] && match((p - 1) * 4)) {
      x--;
      p--;
    }
    let up = false;
    let down = false;
    while (x < W && !mask[p] && match(p * 4)) {
      mask[p] = 1;
      if (y > 0) {
        const q = p - W;
        if (!mask[q] && match(q * 4)) {
          if (!up) {
            stack.push(x, y - 1);
            up = true;
          }
        } else up = false;
      }
      if (y < H - 1) {
        const q = p + W;
        if (!mask[q] && match(q * 4)) {
          if (!down) {
            stack.push(x, y + 1);
            down = true;
          }
        } else down = false;
      }
      x++;
      p++;
    }
  }
  // grow the mask (2 = fringe) twice
  for (let pass = 0; pass < 2; pass++) {
    const mark = pass + 2;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        if (mask[p] === 0 || mask[p] === mark) continue;
        if (x > 0 && !mask[p - 1]) mask[p - 1] = mark;
        if (x < W - 1 && !mask[p + 1]) mask[p + 1] = mark;
        if (y > 0 && !mask[p - W]) mask[p - W] = mark;
        if (y < H - 1 && !mask[p + W]) mask[p + W] = mark;
      }
    }
  }
  const [fr, fg, fb] = rgb;
  for (let p = 0; p < mask.length; p++) {
    const m = mask[p];
    if (!m) continue;
    const i = p * 4;
    // Filling an empty area: paint underneath everything, faint edge pixels included.
    // Recolouring a solid area: replace it, and paint under the edge.
    if (m === 1 && !clear) {
      d[i] = fr;
      d[i + 1] = fg;
      d[i + 2] = fb;
      d[i + 3] = 255;
    } else {
      const a = d[i + 3] / 255;
      d[i] = Math.round(d[i] * a + fr * (1 - a));
      d[i + 1] = Math.round(d[i + 1] * a + fg * (1 - a));
      d[i + 2] = Math.round(d[i + 2] * a + fb * (1 - a));
      d[i + 3] = 255;
    }
  }
  return true;
}

// Replays ops[from..] onto ctx (a px x px canvas). Runs of fills share one
// getImageData/putImageData.
export function replay(ctx, ops, px, from = 0) {
  const s = px / COORD;
  let i = from;
  while (i < ops.length) {
    const op = ops[i];
    if (op[0] !== OP.FILL) {
      drawStroke(ctx, op, px);
      i++;
      continue;
    }
    const img = ctx.getImageData(0, 0, px, px);
    while (i < ops.length && ops[i][0] === OP.FILL) {
      const f = ops[i];
      floodFill(img.data, px, px, f[3] * s, f[4] * s, RGB[f[1]]);
      i++;
    }
    ctx.putImageData(img, 0, 0);
  }
}

export function renderArt(art, px = RASTER) {
  const c = document.createElement("canvas");
  c.width = px;
  c.height = px;
  const ctx = c.getContext("2d", { willReadFrequently: art.ops.some((o) => o[0] === OP.FILL) });
  replay(ctx, art.ops, px);
  return c;
}

// ---------- the art store ----------
// Arts arrive from the server by id. Shirts ask for a URL and get called back
// when it's ready; ids nobody has sent yet get requested in one batch.

const arts = new Map(); // id -> { bg, ops }
const urls = new Map(); // id -> blob url (or a pending promise)
const waiters = new Map(); // id -> Set(fn)
const asked = new Map(); // id -> time we last asked
let requester = null;
let pending = new Set();
let flushTimer = null;

export function setArtRequester(fn) {
  requester = fn;
}

export function addArt(id, art) {
  if (!id || !art || !Array.isArray(art.ops)) return;
  arts.set(id, art);
  if (waiters.has(id)) build(id);
}

export function getArt(id) {
  return arts.get(id) || null;
}

function ask(id) {
  const t = asked.get(id) || 0;
  if (Date.now() - t < 4000) return;
  asked.set(id, Date.now());
  pending.add(id);
  if (!flushTimer)
    flushTimer = setTimeout(() => {
      flushTimer = null;
      const ids = [...pending];
      pending = new Set();
      if (ids.length && requester) requester(ids);
    }, 30);
}

// Make sure these arts are on their way (call with every view).
export function want(ids) {
  for (const id of ids) if (id && !arts.has(id)) ask(id);
}

// Queue renders so a rack of twenty doesn't freeze a phone in one go.
const queue = [];
let busy = false;
function pump() {
  if (busy) return;
  const id = queue.shift();
  if (!id) return;
  busy = true;
  const art = arts.get(id);
  const done = (url) => {
    urls.set(id, url);
    const fns = waiters.get(id);
    waiters.delete(id);
    if (fns) for (const fn of fns) fn(url);
    busy = false;
    setTimeout(pump, 0);
  };
  try {
    const c = renderArt(art);
    if (c.toBlob) c.toBlob((b) => done(b ? URL.createObjectURL(b) : c.toDataURL()), "image/png");
    else done(c.toDataURL());
  } catch {
    busy = false;
    setTimeout(pump, 0);
  }
}
function build(id) {
  if (urls.has(id) || queue.includes(id)) return;
  queue.push(id);
  pump();
}

// Calls fn(url) once the image is ready (right away if it already is).
export function artUrl(id, fn) {
  const u = urls.get(id);
  if (u) {
    fn(u);
    return;
  }
  if (!waiters.has(id)) waiters.set(id, new Set());
  waiters.get(id).add(fn);
  if (arts.has(id)) build(id);
  else ask(id);
}

// Ask again for anything still missing (after a reconnect).
export function retryMissing() {
  for (const id of waiters.keys()) {
    if (!arts.has(id)) {
      asked.delete(id);
      ask(id);
    }
  }
}
