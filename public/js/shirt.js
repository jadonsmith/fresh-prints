// A t-shirt: the silhouette, the printed design and the slogan, in one element
// that scales with its width (container query units). Also: fitting slogans
// to the print area, and exporting a finished shirt as a PNG.

import { h, hash } from "./ui.js";
import { SHIRTS, INKS } from "./palette.js";
import { artUrl, getArt, renderArt, RASTER } from "./art.js";

// ---------- the silhouette (viewBox 0 0 400 440) ----------
export const TEE = {
  body: "M148 20C160 44 240 44 252 20L314 38C340 50 372 78 394 106L354 168C340 160 322 150 306 140C304 230 306 330 310 418C240 428 160 428 90 418C94 330 96 230 94 140C78 150 60 160 46 168L6 106C28 78 60 50 86 38Z",
  inner: "M148 20C168 7 232 7 252 20C240 44 160 44 148 20Z",
  collar: "M148 20C160 44 240 44 252 20",
  folds: [
    "M306 140C292 152 284 170 282 192",
    "M94 140C108 152 116 170 118 192",
    "M130 330C150 350 168 368 176 404",
    "M268 300C258 330 252 370 254 410",
    "M354 168L312 128",
    "M46 168L88 128",
  ],
  hem: "M95 404C160 413 240 413 305 404",
  sleeveHems: ["M366 150L384 122", "M34 150L16 122"],
};

// Print styles: font, case and how big the slogan may get (px on a 400px-wide shirt).
export const STYLE = {
  block: { font: "Anton", weight: 400, upper: true, max: 38, line: 0.98, pos: "bottom" },
  varsity: { font: "Graduate", weight: 400, upper: true, max: 30, line: 1.02, pos: "top" },
  script: { font: "Pacifico", weight: 400, upper: false, max: 30, line: 1.28, pos: "bottom", rot: -5 },
  marker: { font: "Permanent Marker", weight: 400, upper: false, max: 32, line: 1.08, pos: "bottom", rot: -2.5 },
  type: { font: "Special Elite", weight: 400, upper: false, max: 26, line: 1.16, pos: "bottom" },
  sign: { font: "Bungee", weight: 400, upper: true, max: 28, line: 1.02, pos: "top" },
  retro: { font: "Shrikhand", weight: 400, upper: false, max: 34, line: 1.06, pos: "bottom", rot: -3 },
  mono: { font: "Space Mono", weight: 700, upper: false, lower: true, max: 22, line: 1.12, pos: "bottom" },
};
const MIN_PX = 9;
const ACCENTS = ["#ff5fa8", "#ffd31a", "#10b5b0", "#ff7b1c", "#1d5fe0", "#e8382f", "#7a45d8", "#1fae5b"];

function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// Colours for one shirt: the slogan ink and an accent that reads on the shirt.
// The accent is used for shadows, and as the text colour in the "sign" style,
// so it has to stand off the shirt properly; if nothing does, the ink does.
export function inksFor(sh) {
  const shirt = SHIRTS[sh.bg] || SHIRTS[0];
  const ink = shirt.dark ? INKS[1].hex : INKS[0].hex;
  const start = hash(String(sh.id || sh.art || "")) % ACCENTS.length;
  let acc = null;
  for (const need of [3, 2.4]) {
    for (let k = 0; k < ACCENTS.length && !acc; k++) {
      const c = ACCENTS[(start + k) % ACCENTS.length];
      if (contrast(c, shirt.hex) >= need && contrast(c, ink) >= 1.3) acc = c;
    }
    if (acc) break;
  }
  return { shirt: shirt.hex, dark: shirt.dark, ink, acc: acc || ink, accOk: !!acc };
}

export function sloganText(text, style) {
  const st = STYLE[style] || STYLE.block;
  const t = String(text || "");
  return st.upper ? t.toUpperCase() : st.lower ? t.toLowerCase() : t;
}

// ---------- shared SVG defs (gradients) ----------
let defsDone = false;
function ensureDefs() {
  if (defsDone) return;
  defsDone = true;
  const svg = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
    <linearGradient id="fp-side" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".2"/><stop offset=".22" stop-color="#000" stop-opacity="0"/><stop offset=".78" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient>
    <radialGradient id="fp-glow" cx=".5" cy=".32" r=".55"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="fp-drop" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset=".85" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".14"/></linearGradient>
  </defs></svg>`;
  const wrap = document.createElement("div");
  wrap.innerHTML = svg;
  document.body.append(wrap.firstChild);
}

function bodySvg() {
  const folds = TEE.folds.map((d) => `<path class="tee-fold" d="${d}"/>`).join("");
  const sleeves = TEE.sleeveHems.map((d) => `<path class="tee-stitch" d="${d}"/>`).join("");
  return `<svg class="tee-svg" viewBox="0 0 400 440" aria-hidden="true" focusable="false">
    <path class="tee-shadow" d="${TEE.body}"/>
    <path class="tee-fill" d="${TEE.body}"/>
    <path class="tee-inner" d="${TEE.inner}"/>
    <path d="${TEE.body}" fill="url(#fp-side)"/>
    <path d="${TEE.body}" fill="url(#fp-glow)"/>
    <path d="${TEE.body}" fill="url(#fp-drop)"/>
    ${folds}
    <path class="tee-stitch" d="${TEE.hem}"/>${sleeves}
    <path class="tee-collar" d="${TEE.collar}"/>
    <path class="tee-collar-hi" d="${TEE.collar}"/>
  </svg>`;
}

// ---------- fitting slogans ----------
const fitCache = new Map();
let measurer = null;

function getMeasurer() {
  if (measurer && measurer.root.isConnected) return measurer;
  const inner = h("span", { class: "tee-words" });
  const box = h("p", { class: "tee-slogan" }, inner);
  const root = h("div", { class: "tee measure", "aria-hidden": "true" }, h("div", { class: "tee-print" }, box));
  document.body.append(root);
  measurer = { root, box, inner };
  return measurer;
}

// Font size for this slogan, in cqw (percent of the shirt's width).
// Measured once per slogan and style on a hidden 400px shirt; type scales
// with the shirt, so the line breaks hold at every size. A size measured
// before the style's font has arrived isn't cached: it gets measured again
// when the font lands (see refitAll).
export function fitSlogan(text, style) {
  const key = `${style}|${text}`;
  if (fitCache.has(key)) return fitCache.get(key);
  const st = STYLE[style] || STYLE.block;
  const fontReady = !document.fonts || !document.fonts.check || document.fonts.check(`${st.weight} 20px "${st.font}"`);
  const m = getMeasurer();
  m.box.className = `tee-slogan st-${style} pos-${st.pos}`;
  m.inner.textContent = sloganText(text, style);
  let lo = MIN_PX;
  let hi = st.max;
  // Too tall, or the widest line (a word that won't wrap) wider than the print area?
  // scrollWidth can't show slack (it never drops below clientWidth), so measure the
  // text itself.
  const range = document.createRange();
  const fits = (px) => {
    m.box.style.setProperty("--fs", px + "px");
    if (m.box.scrollHeight > m.box.clientHeight || m.box.scrollWidth > m.box.clientWidth) return false;
    // measured against the print area, not the text block (which shrink-wraps a short line)
    const cs = getComputedStyle(m.box);
    const avail = m.box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    range.selectNodeContents(m.inner);
    return range.getBoundingClientRect().width <= avail - 1.5;
  };
  if (fits(hi)) lo = hi;
  else {
    for (let k = 0; k < 9 && hi - lo > 0.4; k++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
  }
  // a little slack for rounding at other sizes; the measurer is 400px wide
  const cqw = +((lo * 0.97) / 4).toFixed(2);
  if (fontReady) fitCache.set(key, cqw);
  return cqw;
}

const live = new Set(); // slogan elements to re-fit when fonts land
function refitAll() {
  fitCache.clear();
  for (const el of live) {
    if (!el.isConnected) {
      live.delete(el);
      continue;
    }
    el.style.setProperty("--fs", fitSlogan(el.dataset.text, el.dataset.style) + "cqw");
  }
}
if (typeof document !== "undefined" && document.fonts) {
  document.fonts.addEventListener?.("loadingdone", () => refitAll());
  document.fonts.ready?.then(() => refitAll());
}

// Load every slogan font early, so the first shirts don't re-flow on screen.
export function preloadFonts() {
  if (!document.fonts || !document.fonts.load) return;
  for (const st of Object.values(STYLE)) document.fonts.load(`${st.weight} 24px "${st.font}"`).catch(() => {});
}

// ---------- the element ----------
// sh: { id, art, bg, slogan, style }
export function shirtEl(sh, { cls = "", tag = "figure", label = null, onArt = null } = {}) {
  ensureDefs();
  const st = STYLE[sh.style] ? sh.style : "block";
  const col = inksFor(sh);
  const img = h("img", { class: "tee-img", alt: "", draggable: "false", decoding: "async" });
  const art = h("div", { class: "tee-art loading" }, img);
  artUrl(sh.art, (url) => {
    img.src = url;
    art.classList.remove("loading");
    if (onArt) onArt();
  });
  const words = h("span", { class: "tee-words", text: sloganText(sh.slogan, st) });
  const slogan = h("p", { class: `tee-slogan st-${st} pos-${STYLE[st].pos}`, dataset: { text: sh.slogan || "", style: st } }, words);
  slogan.style.setProperty("--fs", fitSlogan(sh.slogan || "", st) + "cqw");
  live.add(slogan);
  const el = h(
    tag,
    {
      class: `tee ${col.dark ? "dark" : "light"} ${cls}`,
      style: { "--shirt": col.shirt, "--t-ink": col.ink, "--t-acc": col.acc, "--t-bg2": col.dark ? "#1f1b24" : "#fbf7ee" },
      dataset: { id: sh.id || "" },
      role: "img",
      "aria-label": `T-shirt: "${sh.slogan || ""}"`,
    },
    h("div", { class: "tee-body", svg: bodySvg() }),
    h("div", { class: `tee-print pos-${STYLE[st].pos}` }, art, slogan),
    label,
  );
  return el;
}

// ---------- export as an image ----------
function wrapLines(ctx, text, maxW) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function loadImage(url) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });
}

// Draws the shirt into ctx with its top-left at (x, y) and width w.
export async function paintShirt(ctx, sh, x, y, w) {
  const s = w / 400;
  const st = STYLE[sh.style] ? sh.style : "block";
  const sty = STYLE[st];
  const col = inksFor(sh);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  const body = new Path2D(TEE.body);
  ctx.save();
  ctx.translate(4, 8);
  ctx.fillStyle = "rgba(31,27,36,.18)";
  ctx.fill(body);
  ctx.restore();
  ctx.fillStyle = col.shirt;
  ctx.fill(body);
  ctx.fillStyle = col.dark ? "rgba(0,0,0,.35)" : "rgba(0,0,0,.14)";
  ctx.fill(new Path2D(TEE.inner));
  const side = ctx.createLinearGradient(6, 0, 394, 0);
  side.addColorStop(0, "rgba(0,0,0,.2)");
  side.addColorStop(0.22, "rgba(0,0,0,0)");
  side.addColorStop(0.78, "rgba(0,0,0,0)");
  side.addColorStop(1, "rgba(0,0,0,.22)");
  ctx.fillStyle = side;
  ctx.fill(body);
  const glow = ctx.createRadialGradient(200, 150, 0, 200, 150, 240);
  glow.addColorStop(0, "rgba(255,255,255,.16)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fill(body);
  ctx.lineCap = "round";
  ctx.strokeStyle = col.dark ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.07)";
  ctx.lineWidth = 3;
  for (const d of TEE.folds) ctx.stroke(new Path2D(d));
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = col.dark ? "rgba(255,255,255,.18)" : "rgba(0,0,0,.16)";
  ctx.stroke(new Path2D(TEE.hem));
  for (const d of TEE.sleeveHems) ctx.stroke(new Path2D(d));
  ctx.setLineDash([]);
  ctx.lineWidth = 9;
  ctx.strokeStyle = col.dark ? "rgba(255,255,255,.1)" : "rgba(0,0,0,.12)";
  ctx.stroke(new Path2D(TEE.collar));

  // the print area: 46% wide, centred, from 18% down (matches .tee-print in style.css)
  const px = 400 * 0.27;
  const pw = 400 * 0.46;
  const top = sty.pos === "top";
  const sloganH = top ? 400 * 0.24 : 400 * 0.3;
  const artY = 440 * 0.18 + (top ? sloganH + 4 : 0);
  const art = getArt(sh.art);
  if (art) {
    const c = renderArt(art, RASTER);
    ctx.drawImage(c, px, artY, pw, pw);
  } else {
    const u = await new Promise((res) => artUrl(sh.art, res));
    ctx.drawImage(await loadImage(u), px, artY, pw, pw);
  }
  const sy = top ? 440 * 0.18 - 6 : artY + pw + 6;
  const fsPx = (fitSlogan(sh.slogan || "", st) / 100) * 400;
  ctx.font = `${sty.weight} ${fsPx}px "${sty.font}"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const text = sloganText(sh.slogan, st);
  const lines = wrapLines(ctx, text, pw);
  const lh = fsPx * sty.line;
  const cx = px + pw / 2;
  const cy = sy + sloganH / 2;
  ctx.translate(cx, cy);
  if (sty.rot) ctx.rotate((sty.rot * Math.PI) / 180);
  const y0 = -((lines.length - 1) * lh) / 2;
  const drawText = (dx, dy, color) => {
    ctx.fillStyle = color;
    lines.forEach((ln, i) => ctx.fillText(ln, dx, y0 + i * lh + dy));
  };
  if (st === "retro") {
    drawText(fsPx * 0.1, fsPx * 0.1, col.acc);
    drawText(fsPx * 0.05, fsPx * 0.05, col.dark ? "#1f1b24" : "#fbf7ee");
  }
  if (st === "varsity") drawText(fsPx * 0.07, fsPx * 0.07, col.acc);
  drawText(0, 0, st === "sign" ? col.acc : col.ink);
  ctx.restore();
}

// A 1080x1350 card: the shirt on paper, with credits. Resolves to a PNG blob.
export async function exportShirt(sh, { title = "", credit = "" } = {}) {
  if (document.fonts && document.fonts.load) {
    const st = STYLE[sh.style] || STYLE.block;
    await Promise.all([document.fonts.load(`${st.weight} 40px "${st.font}"`), document.fonts.load(`900 40px "Archivo"`), document.fonts.load(`700 20px "Space Mono"`)]).catch(() => {});
  }
  const W = 1080;
  const H = 1350;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#f4efe4";
  ctx.fillRect(0, 0, W, H);
  // halftone corner
  ctx.fillStyle = "rgba(255,72,176,.55)";
  for (let y = 0; y < 420; y += 22) for (let x = W - 420; x < W; x += 22) {
    const r = Math.max(0, 8 * (1 - Math.hypot(W - x, y) / 520));
    if (r > 0.4) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = "rgba(0,120,191,.45)";
  for (let y = H - 380; y < H; y += 20) for (let x = 0; x < 380; x += 20) {
    const r = Math.max(0, 7 * (1 - Math.hypot(x, H - y) / 460));
    if (r > 0.4) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  await paintShirt(ctx, sh, 140, 150, 800);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `900 64px "Archivo"`;
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "#ff48b0";
  ctx.fillText("FRESH PRINTS", 64, 112);
  ctx.fillStyle = "#0078bf";
  ctx.fillText("FRESH PRINTS", 68, 116);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#1f1b24";
  ctx.font = `700 30px "Space Mono"`;
  if (title) ctx.fillText(title, 64, H - 112);
  ctx.font = `400 26px "Space Mono"`;
  if (credit) ctx.fillText(credit, 64, H - 68);
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(31,27,36,.6)";
  ctx.fillText("play.jadon.me/prints", W - 64, H - 68);
  return new Promise((res) => c.toBlob((b) => res(b), "image/png"));
}

// Share (phones) or download (everything else).
export async function saveShirt(sh, meta, filename = "fresh-prints-tee.png") {
  const blob = await exportShirt(sh, meta);
  if (!blob) return false;
  const file = typeof File === "function" ? new File([blob], filename, { type: "image/png" }) : null;
  try {
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "Fresh Prints" });
      return true;
    }
  } catch (e) {
    if (e && e.name === "AbortError") return true;
  }
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}
