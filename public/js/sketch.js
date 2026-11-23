// The drawing editor: a square of shirt with a brush, an eraser, a bucket,
// twelve inks, four sizes, undo and clear. Drawings are recorded as ops (see
// palette.js) so they can be sent to the server and replayed anywhere.

import { h, icon, vibrate, toast } from "./ui.js";
import { COORD, INKS, SHIRTS, SIZES, LIMITS, OP } from "./palette.js";
import { RASTER, replay, drawStroke } from "./art.js";

const MIN_STEP = 3.2; // grid units between samples

export function createSketch({ art = null, ink = 0, size = 1, onChange = () => {}, readonly = false } = {}) {
  const state = {
    bg: art && Number.isInteger(art.bg) ? art.bg : Math.floor(Math.random() * SHIRTS.length),
    ops: art && Array.isArray(art.ops) ? art.ops.map((o) => o.slice()) : [],
    undo: [],
    tool: "brush",
    ink,
    size,
    cur: null, // stroke in progress
    pid: null,
  };
  state.undo = state.ops.map(() => ({ type: "op" }));

  const canvas = h("canvas", { class: "sk-canvas", width: RASTER, height: RASTER, "aria-label": "Drawing area" });
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const pre = document.createElement("canvas");
  pre.width = RASTER;
  pre.height = RASTER;
  const preCtx = pre.getContext("2d");
  const shirtToggle = h(
    "button",
    {
      class: "sk-shirt-toggle",
      type: "button",
      "aria-label": "Shirt colour",
      title: "Shirt colour",
      onclick: (e) => {
        e.stopPropagation();
        shirts.classList.toggle("open");
        vibrate(5);
      },
    },
    icon("shirt"),
    h("span", { text: "Shirt" }),
  );
  const stage = h("div", { class: "sk-stage" }, h("div", { class: "sk-print" }), canvas, h("div", { class: "sk-empty", text: "Draw anything" }), shirtToggle);
  const holder = h("div", { class: "sk-holder" }, stage);

  function total() {
    let n = 0;
    for (const o of state.ops) n += o.length - 3;
    return n;
  }
  function redraw() {
    ctx.clearRect(0, 0, RASTER, RASTER);
    replay(ctx, state.ops, RASTER);
    paintState();
  }
  function paintState() {
    stage.style.setProperty("--shirt", SHIRTS[state.bg].hex);
    stage.classList.toggle("dark", SHIRTS[state.bg].dark);
    stage.classList.toggle("blank", !hasInk());
    undoBtn.disabled = !state.undo.length;
    clearBtn.disabled = !state.ops.length;
    for (const b of toolBtns) b.classList.toggle("on", b.dataset.tool === state.tool);
    for (const b of sizeBtns) b.classList.toggle("on", Number(b.dataset.size) === state.size);
    for (const b of inkBtns) b.classList.toggle("on", Number(b.dataset.ink) === state.ink);
    for (const b of shirtBtns) b.classList.toggle("on", Number(b.dataset.bg) === state.bg);
    sizeRow.classList.toggle("dim", state.tool === "fill");
    root.dataset.tool = state.tool;
  }
  function hasInk() {
    return state.ops.some((o) => o[0] !== OP.ERASE);
  }
  function changed() {
    onChange(api.art);
  }

  // ---------- pointer ----------
  function pt(e) {
    const r = canvas.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return null; // not laid out yet
    const x = ((e.clientX - r.left) / r.width) * COORD;
    const y = ((e.clientY - r.top) / r.height) * COORD;
    return [Math.max(0, Math.min(COORD - 1, Math.round(x))), Math.max(0, Math.min(COORD - 1, Math.round(y)))];
  }
  function full() {
    if (state.ops.length >= LIMITS.ops || total() >= LIMITS.coords - 8) {
      toast("This design is full. Press Done, or undo a bit.");
      return true;
    }
    return false;
  }
  function begin(e) {
    if (readonly || state.pid != null) return;
    if (e.button != null && e.button > 0) return;
    const p = pt(e);
    if (!p || full()) return;
    e.preventDefault();
    const [x, y] = p;
    if (state.tool === "fill") {
      state.ops.push([OP.FILL, state.ink, 0, x, y]);
      state.undo.push({ type: "op" });
      replay(ctx, state.ops, RASTER, state.ops.length - 1);
      vibrate(6);
      paintState();
      changed();
      return;
    }
    state.pid = e.pointerId;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
    preCtx.clearRect(0, 0, RASTER, RASTER);
    preCtx.drawImage(canvas, 0, 0);
    state.cur = [state.tool === "eraser" ? OP.ERASE : OP.BRUSH, state.ink, state.size, x, y];
    paintCur();
  }
  function paintCur() {
    ctx.clearRect(0, 0, RASTER, RASTER);
    ctx.drawImage(pre, 0, 0);
    drawStroke(ctx, state.cur, RASTER);
  }
  function move(e) {
    if (state.pid !== e.pointerId || !state.cur) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    let moved = false;
    for (const ev of evs.length ? evs : [e]) {
      const p = pt(ev);
      if (!p) continue;
      const [x, y] = p;
      const c = state.cur;
      const lx = c[c.length - 2];
      const ly = c[c.length - 1];
      if (Math.hypot(x - lx, y - ly) < MIN_STEP) continue;
      if (c.length - 3 >= LIMITS.stroke - 2 || total() + (c.length - 3) >= LIMITS.coords - 4) {
        // long stroke: bank it and carry on with a fresh one from here
        commit();
        if (full()) {
          state.pid = null;
          return;
        }
        preCtx.clearRect(0, 0, RASTER, RASTER);
        preCtx.drawImage(canvas, 0, 0);
        state.cur = [c[0], c[1], c[2], lx, ly];
      }
      state.cur.push(x, y);
      moved = true;
    }
    if (moved) paintCur();
  }
  function commit() {
    if (!state.cur) return;
    state.ops.push(state.cur);
    state.undo.push({ type: "op" });
    state.cur = null;
  }
  function end(e) {
    if (state.pid !== e.pointerId) return;
    state.pid = null;
    if (!state.cur) return;
    commit();
    paintState();
    changed();
  }
  canvas.addEventListener("pointerdown", begin);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("lostpointercapture", end);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // ---------- tools ----------
  const tool = (name, ic, label) =>
    h(
      "button",
      {
        class: "sk-tool",
        type: "button",
        "aria-label": label,
        title: label,
        dataset: { tool: name },
        onclick: () => {
          state.tool = name;
          vibrate(5);
          paintState();
        },
      },
      icon(ic),
    );
  const toolBtns = [tool("brush", "brush", "Brush"), tool("eraser", "eraser", "Eraser"), tool("fill", "bucket", "Fill")];
  const sizeBtns = SIZES.map((w, i) =>
    h(
      "button",
      {
        class: "sk-size",
        type: "button",
        "aria-label": `Brush size ${i + 1}`,
        dataset: { size: i },
        style: { "--d": `${Math.round(5 + i * 4.5)}px` },
        onclick: () => {
          state.size = i;
          if (state.tool === "fill") state.tool = "brush";
          vibrate(5);
          paintState();
        },
      },
      h("i"),
    ),
  );
  const sizeRow = h("div", { class: "sk-sizes" }, sizeBtns);
  const undoBtn = h(
    "button",
    {
      class: "sk-tool",
      type: "button",
      "aria-label": "Undo",
      title: "Undo",
      onclick: () => {
        const last = state.undo.pop();
        if (!last) return;
        if (last.type === "clear") state.ops = last.ops;
        else state.ops.pop();
        redraw();
        changed();
      },
    },
    icon("undo"),
  );
  const clearBtn = h(
    "button",
    {
      class: "sk-tool",
      type: "button",
      "aria-label": "Clear",
      title: "Clear (undo brings it back)",
      onclick: () => {
        if (!state.ops.length) return;
        state.undo.push({ type: "clear", ops: state.ops });
        state.ops = [];
        redraw();
        vibrate([8, 30, 8]);
        changed();
      },
    },
    icon("trash"),
  );
  const inkBtns = INKS.map((ink, i) =>
    h(
      "button",
      {
        class: "sk-ink",
        type: "button",
        "aria-label": ink.name,
        title: ink.name,
        dataset: { ink: i },
        style: { "--c": ink.hex },
        onclick: () => {
          state.ink = i;
          if (state.tool === "eraser") state.tool = "brush";
          vibrate(5);
          paintState();
        },
      },
      h("i"),
    ),
  );
  const shirtBtns = SHIRTS.map((s, i) =>
    h(
      "button",
      {
        class: "sk-shirt",
        type: "button",
        "aria-label": `${s.name} shirt`,
        title: `${s.name} shirt`,
        dataset: { bg: i },
        style: { "--c": s.hex },
        onclick: () => {
          state.bg = i;
          vibrate(5);
          paintState();
          changed();
          setTimeout(() => shirts.classList.remove("open"), 160);
        },
      },
      icon("shirt"),
    ),
  );

  const tools = h("div", { class: "sk-tools" }, h("div", { class: "sk-group" }, toolBtns), sizeRow, h("div", { class: "sk-group" }, undoBtn, clearBtn));
  const inks = h("div", { class: "sk-inks", role: "group", "aria-label": "Ink colour" }, inkBtns);
  const shirts = h("div", { class: "sk-shirts", role: "group", "aria-label": "Shirt colour" }, h("span", { class: "sk-shirts-l", text: "Pick the shirt" }), h("div", { class: "sk-shirts-row" }, shirtBtns));
  holder.append(shirts);
  const root = h("div", { class: `sketch${readonly ? " readonly" : ""}` }, holder, tools, inks);

  // The stage is kept square and as big as the space allows by CSS
  // (container query units on .sk-holder), so there's nothing to measure here.
  const api = {
    el: root,
    get art() {
      return { bg: state.bg, ops: state.ops };
    },
    get ink() {
      return state.ink;
    },
    get size() {
      return state.size;
    },
    hasInk,
    destroy() {},
  };
  redraw();
  return api;
}
