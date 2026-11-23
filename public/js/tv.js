// The big screen (?tv): the room code and QR, the studio while everyone
// draws and writes, the runway show, the rack, the sales reveal and the
// lookbook. It plays the music and reads the slogans aloud.

import { Net } from "./net.js";
import { h, fill, avatar, timerRing, fmt, toast, setClock, now, onTick, qrSvg, logoEl, howTo, icon, ordinal, stamp, REACT_EMOJI, plural } from "./ui.js";
import { audio } from "./audio.js";
import { voice } from "./voice.js";
import { confetti } from "./confetti.js";
import { shirtEl, preloadFonts } from "./shirt.js";
import { addArt, want, setArtRequester, retryMissing } from "./art.js";

const params = new URLSearchParams(location.search);
const ss = {
  get(k) {
    try {
      return sessionStorage.getItem("fp:tv:" + k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      sessionStorage.setItem("fp:tv:" + k, v);
    } catch {}
  },
};
const ls = {
  get(k) {
    try {
      return localStorage.getItem("fp:tv:" + k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem("fp:tv:" + k, v);
    } catch {}
  },
};

const S = { v: null, key: null, scr: null, code: (params.get("room") || ss.get("code") || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4) };
let net;
let stage;
let unlockChip;

const P = (id) => (S.v && id ? S.v.players.find((p) => p.id === id) || S.v.audience.find((p) => p.id === id) : null);
const nameOf = (id) => (id == null ? "the house" : P(id)?.name || "Someone");
const base = () => location.pathname.replace(/[^/]*$/, "");
const joinUrl = (code) => `${location.origin}${base()}?room=${code}`;
const shortHost = () => `${location.host}${base()}`.replace(/\/$/, "");
const dropName = (g) => (g.drops === 1 ? "One drop only" : g.drop === g.drops ? "Final drop" : g.drop === 1 ? "First drop" : "Second drop");
const WORD = ["zero", "one", "two", "three", "four"];

function header(title, g, { sub = null, ring = true } = {}) {
  return h(
    "header",
    { class: "tv-head" },
    h("div", { class: "tv-head-l" }, g ? h("span", { class: "drop-pill big" }, g.drops > 1 ? `Drop ${g.drop} of ${g.drops}` : "The drop") : null, h("h2", { class: "tv-title", text: title }), sub ? h("p", { class: "tv-sub", text: sub }) : null),
    ring && g ? timerRing(g, { size: 120 }) : null,
    h("div", { class: "tv-code" }, h("span", { text: "Room" }), h("b", { text: S.v ? S.v.code : "" })),
  );
}

function credits(s) {
  const who = (id, ic, role) => h("span", { class: "cr-one" }, icon(ic, "cr-i"), id ? avatar(P(id), { size: "s" }) : h("span", { class: "cr-house", text: "🏠" }), h("span", { class: "cr-n", text: id ? nameOf(id) : role }));
  return h("div", { class: "credits big" }, who(s.artist, "brush", "House art"), who(s.writer, "pen", "House slogan"));
}

// ---------- screens ----------
function scrConnecting() {
  return { el: h("section", { class: "tv-scr center" }, logoEl("huge"), h("p", { class: "muted", text: "Setting up the shop…" })) };
}

function scrLobby(v) {
  const el = h("section", { class: "tv-scr tv-lobby" });
  function build(v) {
    const players = v.players.filter((p) => !p.left);
    const need = Math.max(0, v.min - players.length);
    const s = v.settings;
    fill(
      el,
      h(
        "div",
        { class: "tl-left" },
        logoEl("huge"),
        h("p", { class: "tl-tag", text: "Draw a tee. Write a slogan. The press mixes them up. Shop the best." }),
        h(
          "div",
          { class: "join-panel" },
          h("div", { class: "jp-qr" }, qrSvg(joinUrl(v.code))),
          h(
            "div",
            { class: "jp-text" },
            h("p", { class: "jp-l", text: "Join on your phone" }),
            h("p", { class: "jp-url", text: shortHost() }),
            h("p", { class: "jp-l", text: "Room code" }),
            h("p", { class: "jp-code", text: v.code }),
          ),
        ),
      ),
      h(
        "div",
        { class: "tl-right" },
        h("div", { class: "peg" }, h("h3", { class: "peg-h" }, "In the shop ", h("span", { text: `${players.length}/${v.max}` })), h(
          "div",
          { class: "peg-grid" },
          players.map((p, i) => h("div", { class: "name-tag", style: { "--i": i, "--c": p.color } }, h("span", { class: "nt-hole" }), avatar(p, { size: "l" }), h("span", { class: "nt-n", text: p.name }), p.id === v.host ? h("span", { class: "nt-host" }, icon("crown")) : null)),
          need ? Array.from({ length: need }, (_, i) => h("div", { class: "name-tag empty", style: { "--i": players.length + i } }, h("span", { class: "nt-hole" }), h("span", { class: "nt-n", text: "…" }))) : null,
        )),
        v.audience.length ? h("p", { class: "aud-line", text: `+ ${plural(v.audience.length, "shopper")} in the audience` }) : null,
        h("div", { class: "tl-rules" }, h("span", { text: `${plural(s.drops, "drop")}` }), h("i"), h("span", { text: `${plural(s.designs, "design")} each` }), h("i"), h("span", { text: `${s.pace} pace` }), s.family ? [h("i"), h("span", { text: "family filter" })] : null),
        h("p", { class: "tl-start", text: need ? `Waiting for ${need} more ${need === 1 ? "player" : "players"}…` : `${P(v.host)?.name || "The host"} starts the game from their phone.` }),
        v.last ? h("p", { class: "last-win" }, "Last game's top seller: ", h("b", { text: `${v.last.emoji} ${v.last.name}` })) : null,
      ),
    );
  }
  build(v);
  return { el, update: build, mounted: () => audio.music(false) };
}

function scrIntro(v) {
  const g = v.game;
  const el = h(
    "section",
    { class: "tv-scr tv-intro" },
    h("span", { class: "intro-k big", text: dropName(g) }),
    h("h2", { class: "intro-big riso huge", dataset: { t: g.drops > 1 ? `DROP ${g.drop}` : "DROP" } }, g.drops > 1 ? `DROP ${g.drop}` : "DROP"),
    howTo("tv-how"),
  );
  audio.play("whoosh");
  const n = WORD[g.designs] || g.designs;
  const m = WORD[g.slogansEach] || g.slogansEach;
  voice.say(g.drop === 1 ? `${g.drops > 1 ? "Drop one." : "Here we go."} Draw ${n} t-shirt design${g.designs > 1 ? "s" : ""}. Then write ${m} slogans. The press mixes them up.` : g.drop === g.drops ? "The final drop. Make it count." : `Drop ${WORD[g.drop] || g.drop}. Fresh designs, fresh slogans.`);
  return { el };
}

function studio(v, { kind }) {
  const el = h("section", { class: `tv-scr tv-studio k-${kind}` });
  function build(v) {
    const g = v.game;
    const prog = g.prog || [];
    const waiting = prog.filter((x) => x.done < x.of).length;
    fill(
      el,
      header(kind === "draw" ? "In the studio" : "At the copy desk", g, { sub: kind === "draw" ? `Everyone's drawing ${plural(g.designs, "t‑shirt design")} on their phone.` : `Everyone's writing ${plural(g.slogansEach, "slogan")}, blind. Any drawing could end up wearing them.` }),
      h(
        "div",
        { class: "benches" },
        prog.map((x, i) => {
          const p = P(x.id);
          const done = x.done >= x.of;
          return h(
            "div",
            { class: `bench${done ? " done" : ""}`, style: { "--i": i, "--c": p ? p.color : "#999" } },
            avatar(p, { size: "l" }),
            h("span", { class: "bench-n", text: p ? p.name : "?" }),
            kind === "draw"
              ? h("div", { class: "bench-slots" }, Array.from({ length: x.of }, (_, k) => h("span", { class: `bs${k < x.done ? " ok" : ""}` }, icon(k < x.done ? "check" : "brush"))))
              : h("div", { class: "bench-slots" }, done ? h("span", { class: "bs ok wide" }, icon("check"), "sent") : h("span", { class: "bs wide" }, icon("pen"), x.n ? `${x.n} written` : "thinking…")),
          );
        }),
      ),
      h("p", { class: "studio-foot", text: waiting ? `Waiting on ${plural(waiting, "player")}` : "That's everyone!" }),
    );
  }
  build(v);
  return {
    el,
    update: build,
    mounted() {
      audio.music(true);
      audio.play("whoosh");
      if (kind === "write") voice.say("Pens out. Write your slogans.");
    },
  };
}

function scrPress(v) {
  const g = v.game;
  const el = h(
    "section",
    { class: "tv-scr tv-press" },
    header("The press is running", g, { ring: false }),
    h(
      "div",
      { class: "press-rig big", "aria-hidden": "true" },
      h("div", { class: "press-screen" }, h("div", { class: "press-mesh" }), h("div", { class: "press-ink" }), h("div", { class: "press-squeegee" })),
      h("div", { class: "press-shirt" }),
    ),
    h("p", { class: "press-h big", text: `Pulling ${g.n} prints. Every drawing gets someone else's slogan, at random.` }),
  );
  audio.music(false);
  audio.play("squeegee");
  setTimeout(() => audio.play("squeegee"), 2100);
  voice.say("Stop the presses. Actually, start them. Every drawing gets someone else's slogan.");
  return { el };
}

function scrRunway(v) {
  let g = v.game;
  let shown = -1;
  const rail = h("div", { class: "rail-items" });
  const stageEl = h("div", { class: "rw-stage big" });
  const count = h("div", { class: "rw-count big" });
  const timer = h("div", { class: "rw-ring" });
  const el = h(
    "section",
    { class: "tv-scr tv-runway" },
    h("div", { class: "rail" }, h("div", { class: "rail-bar" }), rail),
    h("div", { class: "rw-side" }, h("span", { class: "drop-pill big", text: g.drops > 1 ? `Drop ${g.drop} of ${g.drops}` : "The drop" }), h("h2", { class: "tv-title", text: "The runway" }), count, timer, h("p", { class: "rw-help", text: "React on your phone. The shop opens after the last tee." })),
    stageEl,
    h("div", { class: "tv-code corner" }, h("span", { text: "Room" }), h("b", { text: v.code })),
  );
  function show(v) {
    g = v.game;
    if (g.i === shown) return;
    // tees that already walked go up on the rail
    for (let k = Math.max(0, shown); k < g.i; k++) {
      const s = g.shirts[k];
      if (s && !rail.querySelector(`[data-id="${s.id}"]`)) rail.append(h("div", { class: "rail-tee", dataset: { id: s.id } }, h("span", { class: "hanger" }), shirtEl(s, { cls: "tiny-tee" })));
    }
    shown = g.i;
    const s = g.shirts[g.i];
    if (!s) return;
    fill(count, h("b", { text: `No. ${g.i + 1}` }), h("span", { text: `of ${g.n}` }));
    fill(timer, timerRing(g, { size: 110 }));
    const old = stageEl.querySelector(".rw-card:not(.out)");
    if (old) {
      old.classList.add("out");
      setTimeout(() => old.remove(), 700);
    }
    stageEl.append(h("div", { class: "rw-card" }, h("span", { class: "hanger big" }), shirtEl(s, { cls: "rw-tee" })));
    audio.play("hanger");
    setTimeout(() => voice.say(s.slogan), 650);
  }
  show(v);
  return { el, update: show, mounted: () => audio.music(false), react: (m) => floatAt(stageEl, m.e) };
}

function floatAt(host, e) {
  const ch = REACT_EMOJI[e];
  if (!ch || !host) return;
  const r = host.getBoundingClientRect();
  const el = h("span", { class: "float-react big", text: ch, style: { left: `${r.left + r.width * (0.15 + Math.random() * 0.7)}px`, top: `${r.bottom - 60}px`, "--dx": `${(Math.random() - 0.5) * 140}px` } });
  document.body.append(el);
  setTimeout(() => el.remove(), 1800);
  audio.play("pop");
}

function rackGrid(shirts, { numbered = true, cls = "", maxCols = 8 } = {}) {
  const n = shirts.length;
  const cols = Math.min(maxCols, n <= 4 ? n : n <= 6 ? 3 : n <= 8 ? 4 : n <= 10 ? 5 : n <= 12 ? 6 : n <= 21 ? 7 : 8);
  const rows = Math.max(1, Math.ceil(n / cols));
  return h(
    "div",
    { class: `tv-rack ${cls}`, style: { "--cols": cols, "--rows": rows } },
    shirts.map((s, k) => h("div", { class: "tr-card", dataset: { id: s.id }, style: { "--i": k } }, numbered ? h("span", { class: "rack-no", text: k + 1 }) : null, shirtEl(s, { cls: "tv-rack-tee" }))),
  );
}

function scrShop(v) {
  const g = v.game;
  const rack = rackGrid(g.shirts);
  const shoppers = h("div", { class: "shoppers" });
  const el = h("section", { class: "tv-scr tv-shop" }, header("The shop is open", g, { sub: `Tag the tees you'd actually buy, on your phone. ${plural(g.tags, "tag")} each. No buying your own merch.` }), rack, shoppers);
  function up(v) {
    const g = v.game;
    const done = new Set(g.done || []);
    fill(
      shoppers,
      (g.shoppers || []).map((id) => h("span", { class: `shopper${done.has(id) ? " done" : ""}` }, avatar(P(id), { size: "m" }), done.has(id) ? icon("check", "sh-ok") : null)),
      g.audienceTags ? h("span", { class: "aud-tags", text: `+ ${g.audienceTags} from the audience` }) : null,
    );
  }
  up(v);
  return {
    el,
    update: up,
    mounted() {
      audio.play("kaching");
      voice.say(`The shop is open. Tag the tees you'd buy.`);
    },
  };
}

function scrSales(v) {
  const g = v.game;
  const list = g.shirts; // worst seller first
  const spots = Math.min(g.spots || 0, list.length);
  const rest = list.slice(0, list.length - spots);
  const top = list.slice(list.length - spots);
  const t0 = g.startedAt;
  const TILL = 1500;
  const REST_END = 6500;
  const STEP = Math.max(1, (g.dur - REST_END) / Math.max(1, spots));
  // the rack (in an order that gives nothing away) gets sales tags in reveal order
  const rackOrder = [...list].sort((a, b) => a.id.localeCompare(b.id));
  const rack = rackGrid(rackOrder, { numbered: false, cls: "sales-rack", maxCols: 5 });
  // place by sales, so ties share a place: 1 + how many sold strictly more
  const rankOf = (s) => 1 + list.filter((x) => x.sales > s.sales).length;
  const spot = h("div", { class: "tv-spot" });
  const msg = h("p", { class: "till-msg", text: "Counting the till…" });
  const el = h("section", { class: "tv-scr tv-sales" }, header("Sales are in", g, { ring: false }), h("div", { class: "sales-body" }, h("div", { class: "sales-left" }, msg, rack), spot));
  let shownRest = 0;
  let shownTop = 0;
  const tagCard = (s) => {
    const card = rack.querySelector(`.tr-card[data-id="${s.id}"]`);
    if (!card) return;
    card.classList.add("sold");
    card.append(h("span", { class: `sale-tag${s.sales ? "" : " zero"}` }, h("b", { text: s.sales }), h("span", { text: "sold" })));
  };
  function step(t) {
    const e = t - t0;
    const wantRest = e < TILL ? 0 : Math.min(rest.length, Math.ceil(((e - TILL) / (REST_END - TILL)) * rest.length));
    if (wantRest > 0) msg.textContent = "Tagging the rack, worst seller first…";
    while (shownRest < wantRest) {
      tagCard(rest[shownRest]);
      shownRest++;
      audio.play("tick");
    }
    const wantTop = e < REST_END ? 0 : Math.min(spots, 1 + Math.floor((e - REST_END) / STEP));
    while (shownTop < wantTop) {
      const s = top[shownTop];
      const place = spots - shownTop;
      const first = shownTop === spots - 1;
      const label = first ? "Top of the rack" : s.best ? "Joint best seller" : `${ordinal(rankOf(s))} best seller`;
      msg.textContent = first ? "And the best seller is…" : label;
      tagCard(s);
      for (const c of rack.querySelectorAll(".tr-card.lit")) c.classList.remove("lit");
      rack.querySelector(`.tr-card[data-id="${s.id}"]`)?.classList.add("lit");
      fill(
        spot,
        h(
          "div",
          { class: `spot-card big place-${place}` },
          h("span", { class: "spot-place", text: label }),
          shirtEl(s, { cls: "spot-tee" }),
          s.best ? stamp("BEST SELLER", "best") : null,
          h("p", { class: "spot-sold" }, h("b", { text: s.sales }), ` ${s.sales === 1 ? "sale" : "sales"}`, s.pts ? h("span", { class: "pts-pop", text: `+${fmt(s.pts)} each` }) : null),
          credits(s),
        ),
      );
      shownTop++;
      if (first) {
        audio.play("stamp");
        setTimeout(() => audio.play("fanfare"), 250);
        if (s.best) confetti({ count: 220 });
        voice.say(`The best seller. ${s.slogan}. Art by ${nameOf(s.artist)}. Slogan by ${nameOf(s.writer)}.`);
      } else {
        audio.play("kaching");
      }
    }
  }
  audio.play("drum");
  const stop = onTick(step);
  step(now());
  return { el, destroy: stop };
}

function scrScores(v) {
  const g = v.game;
  const max = Math.max(1, ...g.ranking.map((r) => r.score));
  const el = h(
    "section",
    { class: "tv-scr tv-scores" },
    header(g.last ? "Before the doors close" : "The charts", g, { ring: false }),
    h(
      "ol",
      { class: "bars" },
      g.ranking.map((r, i) => {
        const p = P(r.id);
        const d = (g.deltas && g.deltas[r.id]) || 0;
        return h(
          "li",
          { class: `bar-row${r.left ? " gone" : ""}`, style: { "--i": i, "--w": `${Math.max(3, (r.score / max) * 100)}%`, "--c": p ? p.color : "#999" } },
          h("span", { class: "br-place", text: r.place }),
          avatar(p, { size: "m" }),
          h("span", { class: "br-name", text: p ? p.name : "?" }),
          h("span", { class: "br-track" }, h("span", { class: "br-fill" })),
          d ? h("span", { class: "br-d", text: `+${fmt(d)}` }) : null,
          h("b", { class: "br-s", text: fmt(r.score) }),
        );
      }),
    ),
  );
  audio.play("whoosh");
  const lead = g.ranking[0] && P(g.ranking[0].id);
  if (lead) voice.say(g.last ? `${lead.name} is out in front. Let's see the final count.` : `${lead.name} is top of the charts. Next drop coming up.`);
  return { el };
}

function scrFinal(v) {
  const g = v.game;
  const podium = g.ranking.slice(0, 3);
  const all = g.lookbook.flatMap((d) => d.shirts);
  const best = all.slice().sort((a, b) => b.sales - a.sales);
  const AWARD_ICON = { best: "🏆", artist: "🎨", writer: "✍️", crowd: "😂", cult: "🗝️", team: "🤝" };
  const awardEl = (a) => {
    const sh = a.shirt ? all.find((s) => s.id === a.shirt) : null;
    return h(
      "div",
      { class: `award big a-${a.key}` },
      h("span", { class: "award-i", text: AWARD_ICON[a.key] || "⭐" }),
      h("div", { class: "award-b" }, h("b", { class: "award-t", text: a.title }), h("span", { class: "award-who", text: a.ids.map((id) => `${P(id)?.emoji || ""} ${nameOf(id)}`).join(" + ") || "the house" }), h("small", { text: a.blurb })),
      sh ? shirtEl(sh, { cls: "award-tee" }) : null,
    );
  };
  const reel = h("div", { class: "reel" }, h("div", { class: "reel-track" }, [...best, ...best].map((s) => h("div", { class: "reel-item" }, shirtEl(s, { cls: "reel-tee" }), h("span", { class: "reel-sold", text: `${s.sales} sold` })))));
  const el = h(
    "section",
    { class: "tv-scr tv-final" },
    h("div", { class: "final-top" }, h("h2", { class: "final-h riso huge", dataset: { t: "SOLD OUT" } }, "SOLD OUT"), h("p", { class: "tv-sub", text: "That's closing time at Fresh Prints." })),
    h(
      "div",
      { class: "final-body" },
      h(
        "div",
        { class: "podium big" },
        [1, 0, 2].map((i) => {
          const r = podium[i];
          if (!r) return h("div", { class: "pod empty" });
          const p = P(r.id);
          return h("div", { class: `pod pod-${r.place}`, style: { "--i": i } }, avatar(p, { size: "xl" }), h("span", { class: "pod-n", text: p ? p.name : "?" }), h("b", { class: "pod-s", text: fmt(r.score) }), h("div", { class: "pod-block" }, h("span", { text: r.place })));
        }),
      ),
      h("div", { class: "awards tv" }, g.awards.slice(0, 4).map(awardEl)),
    ),
    best.length > 2 ? reel : null,
    h("p", { class: "final-foot", text: "Save your favourite tees from the lookbook on your phone. The host can start another round." }),
  );
  audio.music(false);
  audio.play("fanfare");
  setTimeout(() => confetti({ count: 260, from: "sides" }), 300);
  const w = podium[0] && P(podium[0].id);
  if (w) voice.say(`Sold out! ${w.name} tops the charts with ${g.ranking[0].score} points.`);
  return { el };
}

// ---------- render ----------
function screenFor(v) {
  if (!v) return ["connecting", scrConnecting];
  if (!v.game) return ["lobby", scrLobby];
  const g = v.game;
  switch (g.kind) {
    case "intro":
      return [`intro:${g.drop}`, scrIntro];
    case "draw":
      return [`draw:${g.drop}`, (v) => studio(v, { kind: "draw" })];
    case "write":
      return [`write:${g.drop}`, (v) => studio(v, { kind: "write" })];
    case "press":
      return [`press:${g.drop}`, scrPress];
    case "runway":
      return [`rw:${g.drop}`, scrRunway];
    case "shop":
      return [`shop:${g.drop}`, scrShop];
    case "sales":
      return [`sales:${g.drop}`, scrSales];
    case "scores":
      return [`scores:${g.drop}`, scrScores];
    case "final":
      return ["final", scrFinal];
  }
  return ["connecting", scrConnecting];
}

function render() {
  const v = S.v;
  const [key, make] = screenFor(v);
  if (key !== S.key) {
    if (S.scr && S.scr.destroy) S.scr.destroy();
    S.key = key;
    S.scr = make(v);
    fill(stage, S.scr.el);
    document.body.dataset.screen = key.split(":")[0];
    if (S.scr.mounted) S.scr.mounted();
  } else if (S.scr && S.scr.update) S.scr.update(v);
}

function controls() {
  const sOn = () => !audio.muted;
  const soundBtn = h("button", { class: "tvc", type: "button", "aria-label": "Sound" });
  const voiceBtn = h("button", { class: "tvc", type: "button", "aria-label": "Host voice" });
  const fullBtn = h("button", { class: "tvc", type: "button", "aria-label": "Full screen", title: "Full screen" }, icon("full"));
  const paint = () => {
    fill(soundBtn, icon(sOn() ? "sound" : "mute"));
    soundBtn.title = sOn() ? "Sound on" : "Sound off";
    soundBtn.classList.toggle("off", !sOn());
    fill(voiceBtn, icon("voice"));
    voiceBtn.title = voice.on ? "Voice on" : "Voice off";
    voiceBtn.classList.toggle("off", !voice.on);
    voiceBtn.hidden = !voice.ok;
  };
  soundBtn.onclick = () => {
    audio.unlock();
    audio.setMuted(sOn());
    ls.set("sound", sOn() ? "1" : "0");
    paint();
  };
  voiceBtn.onclick = () => {
    voice.on = !voice.on;
    if (!voice.on) voice.stop();
    ls.set("voice", voice.on ? "1" : "0");
    paint();
  };
  fullBtn.onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  paint();
  return h("div", { class: "tv-controls" }, soundBtn, voiceBtn, fullBtn);
}

function onMsg(m) {
  switch (m.t) {
    case "joined":
      S.code = m.code;
      ss.set("code", m.code);
      if (params.has("room")) {
        const u = new URL(location.href);
        u.searchParams.delete("room");
        history.replaceState(null, "", u.pathname + u.search);
      }
      retryMissing();
      break;
    case "state":
      S.v = m;
      if (m.game) {
        const ids = [];
        if (m.game.shirts) for (const s of m.game.shirts) ids.push(s.art);
        if (m.game.lookbook) for (const d of m.game.lookbook) for (const s of d.shirts) ids.push(s.art);
        want(ids);
      }
      render();
      break;
    case "art":
      addArt(m.id, m.art);
      break;
    case "react":
      if (S.scr && S.scr.react) S.scr.react(m);
      else if (S.scr) floatAt(stage, m.e);
      break;
    case "error":
      if (m.code === "noroom") {
        S.code = "";
        ss.set("code", "");
        net.send({ t: "createTv" });
      } else toast(m.msg || "Something went wrong.");
      break;
    case "gone":
      S.v = null;
      S.key = null;
      S.code = "";
      ss.set("code", "");
      render();
      net.send({ t: "createTv" });
      break;
  }
}

export function startTv() {
  document.body.classList.add("tv");
  const app = document.getElementById("app");
  stage = h("main", { class: "tv-stage" });
  unlockChip = h(
    "button",
    {
      class: "unlock-chip",
      type: "button",
      onclick: () => {
        audio.unlock();
        unlockChip.remove();
      },
    },
    icon("sound"),
    "Click anywhere for sound",
  );
  fill(app, h("div", { class: "paper", "aria-hidden": "true" }), stage, controls(), unlockChip);
  document.querySelector(".hub-link")?.remove();
  if (ls.get("sound") === "0") audio.setMuted(true);
  if (ls.get("voice") === "0") voice.on = false;
  preloadFonts();
  const unlock = () => {
    audio.unlock();
    setTimeout(() => {
      if (audio.ready) unlockChip.remove();
    }, 200);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
  net = new Net({
    onMsg,
    onOpen() {
      document.body.classList.remove("offline");
      net.send(S.code ? { t: "watch", code: S.code } : { t: "createTv" });
    },
    onClose() {
      document.body.classList.add("offline");
    },
  });
  setArtRequester((ids) => net.send({ t: "getArt", ids }));
  setClock(() => net.serverNow());
  net.connect();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) net.kick();
  });
  render();
}
