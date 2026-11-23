// Small DOM helpers shared by the phone and the big screen.
// User text only ever goes in through textContent.

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "style") {
        for (const [sk, sv] of Object.entries(v)) {
          if (sv == null) continue;
          if (sk.startsWith("--")) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      } else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k === "svg") el.innerHTML = v; // static icons written in this file only
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// replaceChildren, minus the null/false holes that conditional children leave.
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  return el;
}

export const fmt = (n) => (n ?? 0).toLocaleString("en-US");
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function hash(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return x >>> 0;
}
export const tiltFor = (s, amt = 1.6) => (((hash(s) % 1000) / 1000) * 2 - 1) * amt;

export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

// ---------- storage (never trusted, never required) ----------
export function store(ns = "") {
  const k = (key) => `fp:${ns ? ns + ":" : ""}${key}`;
  return {
    get(key) {
      try {
        const v = localStorage.getItem(k(key));
        return v == null ? null : JSON.parse(v);
      } catch {
        return null;
      }
    },
    set(key, val) {
      try {
        localStorage.setItem(k(key), JSON.stringify(val));
      } catch {}
    },
    del(key) {
      try {
        localStorage.removeItem(k(key));
      } catch {}
    },
  };
}

// ---------- clock + timers ----------
let clock = () => Date.now();
export function setClock(fn) {
  clock = fn;
}
export const now = () => clock();

const tickers = new Set();
export function onTick(fn) {
  tickers.add(fn);
  return () => tickers.delete(fn);
}
setInterval(() => {
  const t = clock();
  for (const el of document.querySelectorAll("[data-ends]")) {
    const ends = Number(el.dataset.ends);
    const dur = Number(el.dataset.dur) || 1;
    const left = Math.max(0, ends - t);
    el.style.setProperty("--f", clamp(left / dur, 0, 1).toFixed(4));
    const s = Math.ceil(left / 1000);
    const num = el.querySelector(".t-num");
    if (num) {
      const txt = el.classList.contains("clock") && s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : String(s);
      if (num.textContent !== txt) num.textContent = txt;
    }
    el.classList.toggle("low", left < 10000 && left > 0);
    el.classList.toggle("done", left <= 0);
  }
  for (const fn of tickers) fn(t);
}, 100);

export function timerBar(g, { cls = "" } = {}) {
  if (!g || g.endsAt == null) return h("div", { class: "tbar idle" });
  return h(
    "div",
    { class: `tbar clock ${cls}`, dataset: { ends: g.endsAt, dur: g.dur } },
    h("span", { class: "tbar-track" }, h("span", { class: "tbar-fill" })),
    h("span", { class: "t-num" }),
  );
}

export function timerRing(g, { size = 96, cls = "" } = {}) {
  if (!g || g.endsAt == null) return h("div", { class: "tring idle" });
  const r = 42;
  const c = 2 * Math.PI * r;
  return h(
    "div",
    { class: `tring clock ${cls}`, style: { "--c": c.toFixed(2), width: size + "px", height: size + "px" }, dataset: { ends: g.endsAt, dur: g.dur } },
    h("span", {
      class: "tring-svg",
      svg: `<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="tr-bg" cx="50" cy="50" r="${r}"/><circle class="tr-fg" cx="50" cy="50" r="${r}"/></svg>`,
    }),
    h("span", { class: "t-num" }),
  );
}

// ---------- pieces ----------
export function avatar(p, { size = "m", label = false, cls = "", style = null } = {}) {
  const el = h(
    "span",
    {
      class: `av av-${size}${p && p.on === false ? " off" : ""}${p && p.left ? " gone" : ""} ${cls}`,
      style: { "--c": (p && p.color) || "#8a8478", ...(style || {}) },
      title: p ? p.name : "",
    },
    h("span", { class: "av-e", text: (p && p.emoji) || "?" }),
  );
  if (!label) return el;
  return h("span", { class: `avl avl-${size} ${cls}` }, el, h("span", { class: "avl-n", text: p ? p.name : "?" }));
}

let toastTimer = null;
export function toast(msg, { ms = 2600 } = {}) {
  let el = document.getElementById("toast");
  if (!el) {
    el = h("div", { id: "toast", class: "toast", role: "status", "aria-live": "polite" });
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("on"), ms);
}

// The masthead: two inks, slightly out of register, like a real riso print.
export function logoEl(cls = "") {
  const word = (t, i) => h("span", { class: `lg-w lg-${i}`, dataset: { t } }, h("span", { class: "lg-k", text: t }));
  return h("h1", { class: `logo ${cls}`, "aria-label": "Fresh Prints" }, h("span", { class: "lg-in", "aria-hidden": "true" }, word("FRESH", 1), word("PRINTS", 2)));
}

export const ICONS = {
  brush: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 4.5l5 5-8.8 8.8a3 3 0 0 1-2.1.9H5.2a.7.7 0 0 1-.6-1.1l.6-.9a4 4 0 0 0 .6-2.1 3 3 0 0 1 .9-2.1z"/><path d="M12.5 6.5l5 5"/></svg>`,
  eraser: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 20H20"/><path d="M4.4 14.6l9.5-9.5a2 2 0 0 1 2.8 0l3 3a2 2 0 0 1 0 2.8L12 18.6a2 2 0 0 1-1.4.6H8.3a2 2 0 0 1-1.4-.6l-2.5-2.5a1 1 0 0 1 0-1.5z"/><path d="M9 10l5.5 5.5"/></svg>`,
  bucket: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11.5L11.5 5l7 7-5.5 5.5a2 2 0 0 1-2.8 0L5 12.3"/><path d="M5 11.5h13.5"/><path d="M8.5 2.5l3 2.5"/><path d="M20.5 15.5s1.5 2 1.5 3a1.5 1.5 0 0 1-3 0c0-1 1.5-3 1.5-3z"/></svg>`,
  undo: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>`,
  shirt: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3.5c.6 1.3 1.6 2 3 2s2.4-.7 3-2l5.5 2.6-1.8 4.2-2.2-.9V20.5h-9V9.4l-2.2.9-1.8-4.2z"/></svg>`,
  dice: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="8.5" cy="15.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/></svg>`,
  bulb: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.8.6 1.1 1.4 1.1 2.2h5c0-.8.3-1.6 1.1-2.2A6 6 0 0 0 12 3z"/></svg>`,
  check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.5l5 5L19.5 7"/></svg>`,
  tag: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12.2V4.8a1.3 1.3 0 0 1 1.3-1.3h7.4l8.3 8.3a1.3 1.3 0 0 1 0 1.8l-7.4 7.4a1.3 1.3 0 0 1-1.8 0z"/><circle cx="8.3" cy="8.3" r="1.6"/></svg>`,
  save: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5"/><path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/></svg>`,
  share: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7.5 7.5L12 3l4.5 4.5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>`,
  qr: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM18 18h3v3h-3zM14 20h2M20 14v2"/></svg>`,
  dots: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>`,
  x: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  crown: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/></svg>`,
  sound: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>`,
  mute: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 5M22 9l-5 5"/></svg>`,
  voice: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12c0-4.4 3.6-8 8-8s8 3.6 8 8-3.6 8-8 8H4l2.3-2.6A8 8 0 0 1 4 12z"/><path d="M9 10.5h6M9 13.5h4"/></svg>`,
  full: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>`,
  tv: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4.5" width="19" height="13" rx="2"/><path d="M8 21h8M12 17.5V21"/></svg>`,
  pen: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1.2-4.4L15.6 5.2a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.4 18.8z"/><path d="M13.5 7.3l3.2 3.2"/></svg>`,
  press: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 16h18"/><path d="M6 16V9h12v7"/><path d="M9 9V5h6v4"/><path d="M5 20h14"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
};

export function icon(name, cls = "") {
  return h("span", { class: `ico ${cls}`, svg: ICONS[name] || "" });
}

export const HOW = [
  ["brush", "Draw", "Doodle a design for a t‑shirt. Anything at all."],
  ["pen", "Write", "Type a few slogans, blind. You won't know what they'll land on."],
  ["press", "Print", "The press slaps every drawing together with someone else's slogan, at random."],
  ["tag", "Shop", "Tag the shirts you'd actually buy. Every sale pays the artist and the writer."],
];

export function howTo(cls = "") {
  return h(
    "ol",
    { class: `how ${cls}` },
    HOW.map(([ic, t, d], i) => h("li", { style: { "--i": i } }, h("span", { class: "how-n", text: i + 1 }), icon(ic, "how-i"), h("div", null, h("b", { text: t }), h("span", { text: d })))),
  );
}

// ---------- QR (qrcode-generator is loaded as a classic script) ----------
export function qrSvg(text, { dark = "#1f1b24", light = "transparent", margin = 2 } = {}) {
  if (typeof window.qrcode !== "function") return h("div", { class: "qr-missing" });
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
  const s = n + margin * 2;
  return h("span", {
    class: "qr",
    svg: `<svg viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges" role="img" aria-label="QR code to join"><rect width="${s}" height="${s}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`,
  });
}

export function vibrate(p) {
  try {
    // Chrome logs an error for buzzing before the first tap, so wait for one.
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    if (navigator.vibrate) navigator.vibrate(p);
  } catch {}
}

// A rubber-stamp label ("SOLD", "BEST SELLER").
export function stamp(text, cls = "") {
  return h("span", { class: `stamp ${cls}`, text });
}

export const REACTS = [
  ["lol", "😂"],
  ["fire", "🔥"],
  ["love", "😍"],
  ["huh", "🤔"],
  ["dead", "💀"],
];
export const REACT_EMOJI = Object.fromEntries(REACTS);
