// The phone: join a room, draw designs, write slogans, react on the runway,
// shop the rack, see the sales. Every screen is rebuilt only when its key
// changes; otherwise it gets update(v), so a half-drawn design or a half-typed
// slogan survives other players' progress pinging in.

import { Net } from "./net.js";
import { h, fill, avatar, timerBar, fmt, toast, store, setClock, now, onTick, qrSvg, logoEl, howTo, icon, ordinal, vibrate, stamp, REACTS, REACT_EMOJI, plural } from "./ui.js";
import { audio } from "./audio.js";
import { confetti } from "./confetti.js";
import { createSketch } from "./sketch.js";
import { shirtEl, saveShirt, preloadFonts } from "./shirt.js";
import { addArt, want, setArtRequester, retryMissing, renderArt } from "./art.js";
import { SHIRTS } from "./palette.js";
import { SPARKS, STARTERS } from "./words.js";

const EMOJIS = ["😎", "🤡", "🐸", "🦊", "🐙", "👽", "🤠", "🧛", "🦄", "🐔", "🌮", "🥔", "🐧", "🦖", "👻", "🤖", "🐵", "🦉", "🍕", "🧀", "🦝", "🐌", "🦩", "🎩"];
const SLOGAN_MAX = 60;
const TIPS = [
  "Every tag a shirt gets pays its artist and its writer 100.",
  "The best seller of each drop earns both of them 250 more.",
  "You can't tag a shirt with your own work on it.",
  "Pick your shirt colour while you draw. The slogan prints in a colour that reads on it.",
  "The bucket fills any closed shape. Tap an empty canvas to fill the background.",
  "Slogans are written blind. The press decides where they land.",
  "Big screen? Open the game with ?tv on a TV or laptop for the runway show.",
];

const params = new URLSearchParams(location.search);
const DEV = params.has("dev");
const st = store(params.get("ns") || "");

if (!EMOJIS.includes(st.get("emoji"))) st.set("emoji", EMOJIS[Math.floor(Math.random() * EMOJIS.length)]);

const S = {
  v: null,
  you: null,
  key: null,
  scr: null,
  busy: false,
  resuming: false,
  notice: null,
  urlRoom: (params.get("room") || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4),
  name: st.get("name") || "",
  emoji: st.get("emoji"),
  sound: st.get("sound") !== false,
  showQr: false,
  draft: null, // { drop, slots: [art|null], done: [bool] }
  slog: null, // { drop, list: [text], done }
  mine: null, // the server's copy of my unfinished work, after a reload
  tagsAt: 0,
};

let net;
let main;
let top;

// ---------- helpers ----------
const P = (id) => (S.v && id ? S.v.players.find((p) => p.id === id) || S.v.audience.find((p) => p.id === id) : null);
const nameOf = (id) => (id == null ? "the house" : P(id)?.name || "Someone");
const meP = () => (S.v ? P(S.v.you) : null);
const isHost = () => !!S.v && S.v.host === S.v.you;
const base = () => location.pathname.replace(/[^/]*$/, "");
const inviteUrl = (code) => `${location.origin}${base()}?room=${code}`;
const shortHost = () => `${location.host}${base()}`.replace(/\/$/, "");
const phoneSfx = () => S.v && !S.v.tv;
const sfx = (name) => {
  if (phoneSfx()) audio.play(name);
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const dropName = (g) => (g.drops === 1 ? "One drop only" : g.drop === g.drops ? "Final drop" : g.drop === 1 ? "First drop" : "Second drop");

function send(m) {
  net.send(m);
}

function sheet(title, body, actions = [], { cls = "" } = {}) {
  const close = () => {
    wrap.classList.remove("on");
    setTimeout(() => wrap.remove(), 220);
  };
  const wrap = h(
    "div",
    { class: `sheet-wrap ${cls}`, onclick: (e) => e.target === wrap && close() },
    h(
      "div",
      { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title },
      h("div", { class: "sheet-grab" }),
      title ? h("h3", { class: "sheet-h", text: title }) : null,
      body,
      actions.length
        ? h(
            "div",
            { class: "sheet-actions" },
            actions.map(([label, kind, fn]) =>
              h("button", {
                class: `btn ${kind}`,
                type: "button",
                text: label,
                onclick: () => {
                  if (fn && fn() === false) return;
                  close();
                },
              }),
            ),
          )
        : null,
    ),
  );
  document.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add("on"));
  return close;
}

function confirmSheet(title, text, yes, fn) {
  sheet(title, h("p", { class: "sheet-p", text }), [
    [yes, "primary", fn],
    ["Cancel", "ghost", null],
  ]);
}

function floatReact(e, from = null) {
  const ch = REACT_EMOJI[e];
  if (!ch) return;
  const r = from ? from.getBoundingClientRect() : { left: innerWidth * (0.2 + Math.random() * 0.6), top: innerHeight - 120, width: 0 };
  const el = h("span", { class: "float-react", text: ch, style: { left: `${r.left + r.width / 2}px`, top: `${r.top}px`, "--dx": `${(Math.random() - 0.5) * 80}px` } });
  document.body.append(el);
  setTimeout(() => el.remove(), 1600);
}

function reactBar(getShirt) {
  return h(
    "div",
    { class: "react-bar", role: "group", "aria-label": "React" },
    REACTS.map(([k, ch]) =>
      h(
        "button",
        {
          class: "react-btn",
          type: "button",
          "aria-label": k,
          onclick: (ev) => {
            const s = getShirt();
            if (!s) return;
            send({ t: "react", e: k, s });
            floatReact(k, ev.currentTarget);
            vibrate(8);
          },
        },
        ch,
      ),
    ),
  );
}

function kicker(text, extra = null) {
  return h("div", { class: "kick" }, h("span", { class: "kick-t", text }), extra);
}

function dropPill(g) {
  return h("span", { class: "drop-pill" }, g.drops > 1 ? `Drop ${g.drop} of ${g.drops}` : "The drop");
}

function progressRow(prog, { label = "Still working", unit = null } = {}) {
  const waiting = (prog || []).filter((x) => x.done < x.of);
  const done = (prog || []).filter((x) => x.done >= x.of);
  return h(
    "div",
    { class: "prog" },
    h("p", { class: "prog-l", text: waiting.length ? `${label}:` : "Everyone's done!" }),
    h(
      "div",
      { class: "prog-avs" },
      waiting.map((x) => h("span", { class: "prog-one wait" }, avatar(P(x.id), { size: "s" }), h("span", { text: P(x.id)?.name || "?" }), unit && x.of > 1 ? h("i", { text: `${x.done}/${x.of}` }) : null)),
      done.map((x) => h("span", { class: "prog-one ok", title: P(x.id)?.name || "" }, avatar(P(x.id), { size: "s" }))),
    ),
  );
}

function credits(s, { you = S.v && S.v.you } = {}) {
  const who = (id, ic, role) =>
    h(
      "span",
      { class: `cr-one${id && id === you ? " me" : ""}` },
      icon(ic, "cr-i"),
      id ? avatar(P(id), { size: "xs" }) : h("span", { class: "cr-house", text: "🏠" }),
      h("span", { class: "cr-n", text: id ? nameOf(id) : role }),
    );
  return h("div", { class: "credits" }, who(s.artist, "brush", "House art"), who(s.writer, "pen", "House slogan"));
}

function mineRibbon(m) {
  if (!m) return null;
  const t = m === "both" ? "All yours" : m === "art" ? "Your drawing" : "Your slogan";
  return h("span", { class: `mine-rib m-${m}`, text: t });
}

function zoomShirt(s, { tagBtn = null, extra = null } = {}) {
  sheet(
    "",
    h("div", { class: "zoom" }, shirtEl(s, { cls: "zoom-tee" }), mineRibbon(s.mine), extra),
    [tagBtn, ["Close", "ghost", null]].filter(Boolean),
    { cls: "zoom-sheet" },
  );
}

// ---------- screens ----------
function scrLoading() {
  return { el: h("section", { class: "scr center" }, h("div", { class: "spinner" }), h("p", { class: "muted", text: "Opening the shop…" })) };
}

function scrHome() {
  const notice = S.notice;
  S.notice = null;
  const joinMode = !!S.urlRoom;
  const nameIn = h("input", {
    class: "in name-in",
    id: "in-name",
    maxlength: 12,
    placeholder: "Your name",
    value: S.name,
    autocomplete: "nickname",
    enterkeyhint: "go",
    spellcheck: "false",
    "aria-label": "Your name",
  });
  const codeIn = h("input", {
    class: "in code-in",
    maxlength: 4,
    placeholder: "CODE",
    value: S.urlRoom,
    autocapitalize: "characters",
    autocomplete: "off",
    spellcheck: "false",
    enterkeyhint: "go",
    "aria-label": "Room code",
  });
  const emojiBtn = h(
    "button",
    { class: "av-pick", type: "button", "aria-label": "Change your avatar" },
    h("span", { class: "av-pick-e", text: S.emoji }),
    h("span", { class: "av-pick-hint", text: "tap" }),
  );
  emojiBtn.onclick = () => {
    audio.unlock();
    const i = EMOJIS.indexOf(S.emoji);
    S.emoji = EMOJIS[(i + 1) % EMOJIS.length];
    st.set("emoji", S.emoji);
    emojiBtn.firstChild.textContent = S.emoji;
    emojiBtn.classList.remove("bump");
    void emojiBtn.offsetWidth;
    emojiBtn.classList.add("bump");
  };
  const getName = () => {
    const n = nameIn.value.trim();
    if (!n) {
      toast("Pick a name first.");
      nameIn.focus();
      return null;
    }
    S.name = n;
    st.set("name", n);
    return n;
  };
  const create = () => {
    audio.unlock();
    const name = getName();
    if (!name || S.busy) return;
    S.busy = true;
    send({ t: "create", name, emoji: S.emoji });
  };
  const join = () => {
    audio.unlock();
    const name = getName();
    if (!name || S.busy) return;
    const code = codeIn.value.toUpperCase().replace(/[^A-Z]/g, "");
    if (code.length !== 4) {
      toast("Room codes are four letters.");
      codeIn.focus();
      return;
    }
    S.busy = true;
    send({ t: "join", code, name, emoji: S.emoji });
  };
  codeIn.addEventListener("input", () => {
    codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  });
  codeIn.addEventListener("keydown", (e) => e.key === "Enter" && join());
  nameIn.addEventListener("keydown", (e) => e.key === "Enter" && (joinMode || codeIn.value.length === 4 ? join() : create()));

  const el = h(
    "section",
    { class: "scr home" },
    h("div", { class: "home-mast" }, logoEl(), h("p", { class: "tagline", text: "Draw a tee. Write a slogan. The press mixes them up. Shop the best." })),
    notice ? h("p", { class: "notice", text: notice }) : null,
    h("div", { class: "card-paper you-card" }, h("div", { class: "you-row" }, emojiBtn, nameIn)),
    joinMode
      ? h(
          "div",
          { class: "card-paper join-card" },
          h("p", { class: "label", text: "Joining room" }),
          h("p", { class: "big-code", text: S.urlRoom }),
          h("button", { class: "btn primary big", type: "button", onclick: join }, "Join the shop", icon("arrow")),
          h("button", {
            class: "link-btn",
            type: "button",
            text: "or start your own room",
            onclick: () => {
              S.urlRoom = "";
              render(true);
            },
          }),
        )
      : h(
          "div",
          { class: "card-paper join-card" },
          h("button", { class: "btn primary big", type: "button", onclick: create }, "Start a room", icon("arrow")),
          h("div", { class: "or" }, h("span", { text: "or join one" })),
          h("div", { class: "join-row" }, codeIn, h("button", { class: "btn dark", type: "button", onclick: join, text: "Join" })),
        ),
    h("a", { class: "tv-hint", href: `${base()}?tv` }, icon("tv"), h("span", null, "Got a TV or laptop? ", h("b", { text: "Open the big screen" }), " for the runway show.")),
    h("div", { class: "how-wrap" }, h("h2", { class: "sec-h", text: "How it works" }), howTo()),
    h("p", { class: "fine", text: "3 to 10 players, each on their own phone. Anyone extra can shop from the audience." }),
  );
  return { el, mounted: () => !S.name && nameIn.focus({ preventScroll: true }) };
}

function estimate(v) {
  const s = v.settings;
  const pace = { relaxed: 1.4, normal: 1, quick: 0.7 }[s.pace] || 1;
  const n = Math.max(3, v.players.filter((p) => !p.left).length);
  const shirts = n * s.designs;
  const per = (6.5 * pace * (shirts > 8 ? Math.sqrt(8 / shirts) : 1)) | 0;
  const drop = 7 + 80 * s.designs * pace + 25 * (s.designs + 1) * pace + 6 + Math.max(4.2, per) * shirts + 60 * pace * 0.6 + 15 + 8.5;
  return Math.max(4, Math.round((drop * s.drops) / 60));
}

function segmented(label, options, value, onPick, { disabled = false } = {}) {
  return h(
    "div",
    { class: "seg-row" },
    h("span", { class: "seg-l", text: label }),
    h(
      "div",
      { class: `seg${disabled ? " ro" : ""}`, role: "radiogroup", "aria-label": label },
      options.map(([val, text]) =>
        h("button", {
          class: `seg-b${val === value ? " on" : ""}`,
          type: "button",
          role: "radio",
          "aria-checked": String(val === value),
          disabled: disabled && val !== value,
          text,
          onclick: () => {
            if (disabled || val === value) return;
            vibrate(5);
            onPick(val);
          },
        }),
      ),
    ),
  );
}

function scrLobby(v) {
  const el = h("section", { class: "scr lobby" });
  function build(v) {
    const host = isHost();
    const players = v.players.filter((p) => !p.left);
    const enough = players.length >= v.min;
    const setS = (patch) => send({ t: "settings", settings: { ...v.settings, ...patch } });
    const hostP = P(v.host);
    const qr = S.showQr ? h("div", { class: "qr-box" }, qrSvg(inviteUrl(v.code))) : null;
    fill(
      el,
      h(
        "div",
        { class: "card-paper code-card" },
        h("p", { class: "label", text: "Room code" }),
        h("p", { class: "big-code", text: v.code }),
        h("p", { class: "code-sub" }, "Join at ", h("b", { text: shortHost() })),
        h(
          "div",
          { class: "code-actions" },
          h("button", { class: "btn small", type: "button", onclick: () => copyInvite(v.code) }, icon("share"), "Invite"),
          h(
            "button",
            {
              class: `btn small${S.showQr ? " on" : ""}`,
              type: "button",
              onclick: () => {
                S.showQr = !S.showQr;
                build(S.v);
              },
            },
            icon("qr"),
            S.showQr ? "Hide QR" : "QR code",
          ),
        ),
        qr,
      ),
      h(
        "div",
        { class: "card-paper roster" },
        h("div", { class: "roster-h" }, h("h2", { class: "sec-h", text: "In the shop" }), h("span", { class: "count", text: `${players.length}/${v.max}` })),
        h(
          "div",
          { class: "roster-grid" },
          players.map((p, i) =>
            h(
              "button",
              {
                class: `roster-one${p.id === v.you ? " me" : ""}`,
                type: "button",
                style: { "--i": i },
                disabled: !host || p.id === v.you,
                onclick: () => host && p.id !== v.you && confirmSheet(`Remove ${p.name}?`, p.bot ? "Send this bot home." : "They can rejoin with the room code.", "Remove", () => send({ t: "kick", id: p.id })),
              },
              avatar(p, { size: "l" }),
              h("span", { class: "ro-n", text: p.name }),
              p.id === v.host ? h("span", { class: "ro-host", title: "Host" }, icon("crown")) : null,
            ),
          ),
          players.length < v.min ? Array.from({ length: v.min - players.length }, () => h("span", { class: "roster-one empty" }, h("span", { class: "av av-l ghost" }), h("span", { class: "ro-n", text: "waiting…" }))) : null,
        ),
        v.audience.length ? h("p", { class: "aud-line", text: `+ ${plural(v.audience.length, "shopper")} in the audience` }) : null,
        host && DEV && players.length < v.max ? h("button", { class: "btn small ghost", type: "button", onclick: () => send({ t: "addBot" }) }, "🤖 Add a bot") : null,
      ),
      h(
        "div",
        { class: "card-paper settings" },
        h("h2", { class: "sec-h", text: host ? "House rules" : "House rules (host picks)" }),
        segmented(
          "Drops",
          [
            [1, "1"],
            [2, "2"],
            [3, "3"],
          ],
          v.settings.drops,
          (x) => setS({ drops: x }),
          { disabled: !host },
        ),
        segmented(
          "Designs each",
          [
            [1, "1"],
            [2, "2"],
            [3, "3"],
          ],
          v.settings.designs,
          (x) => setS({ designs: x }),
          { disabled: !host },
        ),
        segmented(
          "Pace",
          [
            ["relaxed", "Relaxed"],
            ["normal", "Normal"],
            ["quick", "Quick"],
          ],
          v.settings.pace,
          (x) => setS({ pace: x }),
          { disabled: !host },
        ),
        h(
          "label",
          { class: `toggle-row${host ? "" : " ro"}` },
          h("span", null, h("b", { text: "Family filter" }), h("small", { text: "Bleeps swearing in slogans" })),
          h("input", {
            type: "checkbox",
            class: "toggle",
            checked: v.settings.family,
            disabled: !host,
            onchange: (e) => setS({ family: e.target.checked }),
          }),
        ),
        h("p", { class: "est", text: `${v.settings.designs} design${v.settings.designs > 1 ? "s" : ""} and ${v.settings.designs + 1} slogans each, per drop. About ${estimate(v)} minutes.` }),
      ),
      v.last ? h("p", { class: "last-win" }, "Last game's top seller: ", h("b", { text: `${v.last.emoji} ${v.last.name}` }), ` (${fmt(v.last.score)})`) : null,
      h(
        "div",
        { class: "start-bar" },
        host
          ? h(
              "button",
              {
                class: "btn primary big",
                type: "button",
                disabled: !enough,
                onclick: () => {
                  audio.unlock();
                  send({ t: "start" });
                },
              },
              enough ? "Open the shop" : `Need ${v.min - players.length} more`,
              enough ? icon("arrow") : null,
            )
          : h("p", { class: "wait-host" }, h("span", { class: "dots" }), `Waiting for ${hostP ? hostP.name : "the host"} to start`),
        !v.tv ? h("p", { class: "fine", text: `Tip: open ${shortHost()}/?tv on a TV for the runway show.` }) : null,
      ),
    );
  }
  build(v);
  return { el, update: build };
}

function scrIntro(v) {
  const g = v.game;
  const el = h(
    "section",
    { class: "scr intro" },
    h("div", { class: "intro-mast" }, h("span", { class: "intro-k", text: dropName(g) }), h("h2", { class: "intro-big riso", dataset: { t: g.drops > 1 ? `DROP ${g.drop}` : "DROP" } }, g.drops > 1 ? `DROP ${g.drop}` : "DROP")),
    howTo("compact"),
    h("p", { class: "intro-sub", text: `${plural(g.designs, "design")} and ${plural(g.slogansEach, "slogan")} each. Then everyone shops.` }),
    timerBar(g, { cls: "calm" }),
  );
  sfx("whoosh");
  return { el };
}

// --- drawing ---
function ensureDraft(g) {
  if (!S.draft || S.draft.drop !== g.drop) S.draft = { drop: g.drop, slots: Array(g.designs).fill(null), done: Array(g.designs).fill(false) };
  return S.draft;
}

function scrDraw(v) {
  const g0 = v.game;
  const D = ensureDraft(g0);
  let g = g0;
  let slot = -1;
  let sk = null;
  let saveTimer = null;
  let lastSaved = "";
  let sending = false;
  let lateSaved = false;
  let spark = pick(SPARKS);

  const title = h("div", { class: "dr-title" });
  const timer = h("div", { class: "dr-timer" }, timerBar(g));
  const ideaT = h("span", { class: "idea-t", text: spark });
  const idea = h(
    "button",
    {
      class: "idea",
      type: "button",
      "aria-label": "Another idea",
      onclick: () => {
        let n = pick(SPARKS);
        while (n === spark) n = pick(SPARKS);
        spark = n;
        ideaT.textContent = n;
        idea.classList.remove("spin");
        void idea.offsetWidth;
        idea.classList.add("spin");
        vibrate(5);
      },
    },
    icon("bulb", "idea-i"),
    h("span", { class: "idea-l", text: "Idea:" }),
    ideaT,
    icon("dice", "idea-d"),
  );
  const slotDots = h("div", { class: "slot-dots" });
  const skWrap = h("div", { class: "sk-wrap" });
  const doneBtn = h("button", { class: "btn primary big done-btn", type: "button" });
  const el = h("section", { class: "scr draw" }, h("div", { class: "dr-head" }, h("div", { class: "dr-hl" }, title, slotDots), timer), idea, skWrap, doneBtn);

  function artKey(a) {
    return a ? `${a.bg}:${a.ops.length}:${a.ops.length ? a.ops[a.ops.length - 1].length : 0}` : "";
  }
  function save(done = false) {
    if (!sk || slot < 0) return;
    const art = sk.art;
    D.slots[slot] = { bg: art.bg, ops: art.ops };
    const k = artKey(art);
    if (!done && k === lastSaved) return;
    lastSaved = k;
    send({ t: "sketch", slot, art, done });
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(false), 1100);
  }
  function locked(i) {
    return D.done[i] || !!(g.me && g.me.locked && g.me.locked[i]);
  }
  function paintHead() {
    fill(title, h("b", { text: `Design ${slot + 1}` }), h("span", { text: ` of ${g.designs}` }));
    fill(
      slotDots,
      Array.from({ length: g.designs }, (_, i) => h("i", { class: `${locked(i) ? "ok" : ""}${i === slot ? " cur" : ""}` })),
    );
    const last = slot === g.designs - 1 || Array.from({ length: g.designs }, (_, i) => i).every((i) => i === slot || locked(i));
    fill(doneBtn, sending ? "Sending…" : last ? "Done, send it" : "Done, next design", icon(sending ? "press" : last ? "check" : "arrow"));
    doneBtn.disabled = sending || !sk || !sk.hasInk();
  }
  function keepTools() {
    if (!sk) return;
    S.ink = sk.ink;
    S.size = sk.size;
    sk.destroy();
  }
  function openSlot(i) {
    keepTools();
    slot = i;
    lastSaved = "";
    lateSaved = false;
    sk = createSketch({
      art: D.slots[i],
      ink: S.ink ?? 0,
      size: S.size ?? 1,
      onChange: () => {
        paintHead();
        scheduleSave();
      },
    });
    fill(skWrap, sk.el);
    el.classList.remove("swap");
    void el.offsetWidth;
    el.classList.add("swap");
    paintHead();
  }
  function nextOpen() {
    for (let i = 0; i < g.designs; i++) if (!locked(i)) return i;
    return -1;
  }
  doneBtn.onclick = () => {
    if (!sk || !sk.hasInk() || sending) return;
    clearTimeout(saveTimer);
    save(true);
    D.done[slot] = true;
    vibrate([10, 40, 10]);
    sfx("tag");
    const n = nextOpen();
    if (n >= 0) openSlot(n);
    else {
      sending = true;
      paintHead();
    }
  };
  const stopTick = onTick((t) => {
    if (!lateSaved && g.endsAt && t > g.endsAt - 1600) {
      lateSaved = true;
      clearTimeout(saveTimer);
      save(false);
    }
  });
  openSlot(Math.max(0, nextOpen()));
  return {
    el,
    update(v) {
      g = v.game;
      fill(timer, timerBar(g));
      if (slot >= 0 && locked(slot) && !sending) {
        const n = nextOpen();
        if (n >= 0) openSlot(n);
      }
      paintHead();
    },
    restore(m) {
      // the server's drafts, after a reload: fill in anything we don't have
      if (!m || m.kind !== "draw" || !Array.isArray(m.drafts)) return;
      let changed = false;
      m.drafts.forEach((d, i) => {
        if (d.locked) D.done[i] = true;
        if (d.art && !D.slots[i]) {
          D.slots[i] = d.art;
          changed = true;
        }
      });
      const n = nextOpen();
      if (n < 0) {
        sending = true;
        paintHead();
      } else if (changed || n !== slot) openSlot(n);
    },
    nack(what, m) {
      if (what !== "sketch") return;
      // the server turned a design down: open that one again so Done can be pressed again
      const s = m && Number.isInteger(m.slot) ? m.slot : slot;
      sending = false;
      D.done[s] = false;
      toast("That design didn't save. Press Done again.");
      if (s !== slot) openSlot(s);
      else paintHead();
    },
    destroy() {
      stopTick();
      clearTimeout(saveTimer);
      keepTools();
    },
  };
}

function myDesignTiles(g) {
  const D = S.draft && S.draft.drop === g.drop ? S.draft : null;
  if (!D) return null;
  const tiles = D.slots
    .map((a) => {
      if (!a || !a.ops.length) return null;
      const c = renderArt(a, 240);
      c.className = "tile-c";
      return h("span", { class: "tile", style: { "--shirt": SHIRTS[a.bg]?.hex || "#eee" } }, c);
    })
    .filter(Boolean);
  return tiles.length ? h("div", { class: "tiles" }, tiles) : null;
}

function scrDrawWait(v) {
  const g = v.game;
  const prog = h("div");
  const timer = h("div");
  const el = h(
    "section",
    { class: "scr wait" },
    kicker("Designs in", dropPill(g)),
    h("h2", { class: "wait-h", text: "Hot off your pen." }),
    myDesignTiles(g),
    h("p", { class: "wait-p", text: "Next up: slogans. You'll write them blind, and the press decides which drawing they land on." }),
    prog,
    timer,
    h("p", { class: "tip", text: pick(TIPS) }),
  );
  const up = (v) => {
    fill(prog, progressRow(v.game.prog, { label: "Still drawing", unit: true }));
    fill(timer, timerBar(v.game));
  };
  up(v);
  return { el, update: up };
}

// --- slogans ---
function ensureSlog(g) {
  if (!S.slog || S.slog.drop !== g.drop) S.slog = { drop: g.drop, list: Array(g.slogansEach).fill(""), done: false };
  return S.slog;
}

function scrWrite(v) {
  let g = v.game;
  const L = ensureSlog(g);
  let syncTimer = null;
  let lastSent = "";
  let lateSent = false;
  const sendList = (done = false) => {
    const k = JSON.stringify(L.list);
    if (!done && k === lastSent) return;
    lastSent = k;
    send({ t: "write", list: L.list, done });
  };
  const schedule = () => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => sendList(false), 450);
  };
  const timer = h("div", { class: "wr-timer" }, timerBar(g));
  const sendBtn = h("button", { class: "btn primary big", type: "button" });
  const paintSend = () => {
    const n = L.list.filter((x) => x.trim()).length;
    fill(sendBtn, n ? `Send ${plural(n, "slogan")}` : "Write at least one", n ? icon("check") : null);
    sendBtn.disabled = !n;
  };
  const inputs = L.list.map((text, i) => {
    const ta = h("textarea", {
      class: "slogan-ta",
      rows: 2,
      maxlength: SLOGAN_MAX,
      placeholder: ["Something a shirt would say…", "Another one…", "One more, go weird…", "Last one…"][i] || "Another one…",
      enterkeyhint: i === L.list.length - 1 ? "done" : "next",
      autocapitalize: "sentences",
      "aria-label": `Slogan ${i + 1}`,
    });
    ta.value = text;
    const count = h("span", { class: "ta-count", text: `${SLOGAN_MAX - text.length}` });
    const dice = h(
      "button",
      {
        class: "ta-dice",
        type: "button",
        "aria-label": "Starter",
        title: "Give me a starter",
        onclick: () => {
          const s = pick(STARTERS);
          ta.value = s;
          L.list[i] = s;
          const at = s.indexOf("___");
          ta.focus();
          if (at >= 0) ta.setSelectionRange(at, at + 3);
          count.textContent = `${SLOGAN_MAX - s.length}`;
          dice.classList.remove("spin");
          void dice.offsetWidth;
          dice.classList.add("spin");
          paintSend();
          schedule();
        },
      },
      icon("dice"),
    );
    ta.addEventListener("input", () => {
      if (ta.value.includes("\n")) ta.value = ta.value.replace(/\n/g, " ");
      L.list[i] = ta.value;
      count.textContent = `${SLOGAN_MAX - ta.value.length}`;
      paintSend();
      schedule();
    });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const next = wrapEls[i + 1];
        if (next) next.querySelector("textarea").focus();
        else ta.blur();
      }
    });
    return h("label", { class: "slogan-in", style: { "--i": i } }, h("span", { class: "si-n", text: i + 1 }), ta, h("span", { class: "si-side" }, dice, count));
  });
  const wrapEls = inputs;
  sendBtn.onclick = () => {
    if (!L.list.some((x) => x.trim())) return;
    clearTimeout(syncTimer);
    L.done = true;
    sendList(true);
    vibrate([10, 40, 10]);
    sfx("tag");
    sendBtn.disabled = true;
    fill(sendBtn, "Sending…");
  };
  const el = h(
    "section",
    { class: "scr write" },
    h("div", { class: "wr-head" }, kicker("Slogans", dropPill(g)), timer),
    h("h2", { class: "wr-h", text: "Now write some slogans." }),
    h("p", { class: "wr-p", text: "Any drawing could end up wearing them, so make them good on their own. Stuck? Roll the dice for a starter." }),
    h("div", { class: "slogans" }, inputs),
    sendBtn,
  );
  paintSend();
  const stopTick = onTick((t) => {
    if (!lateSent && g.endsAt && t > g.endsAt - 1300) {
      lateSent = true;
      clearTimeout(syncTimer);
      sendList(false);
    }
  });
  return {
    el,
    update(v) {
      g = v.game;
      fill(timer, timerBar(g));
    },
    restore(m) {
      if (!m || m.kind !== "write" || !Array.isArray(m.slogans)) return;
      let any = false;
      m.slogans.forEach((t, i) => {
        if (t && !L.list[i] && wrapEls[i]) {
          L.list[i] = t;
          wrapEls[i].querySelector("textarea").value = t;
          any = true;
        }
      });
      if (any) paintSend();
    },
    destroy() {
      stopTick();
      clearTimeout(syncTimer);
    },
  };
}

function scrWriteWait(v) {
  const g = v.game;
  const prog = h("div");
  const timer = h("div");
  const L = S.slog && S.slog.drop === g.drop ? S.slog.list.filter((x) => x.trim()) : [];
  const el = h(
    "section",
    { class: "scr wait" },
    kicker("Slogans in", dropPill(g)),
    h("h2", { class: "wait-h", text: "Off to the press." }),
    L.length ? h("ul", { class: "my-slogans" }, L.map((t) => h("li", { text: t }))) : null,
    prog,
    timer,
    h("p", { class: "tip", text: pick(TIPS) }),
  );
  const up = (v) => {
    fill(prog, progressRow(v.game.prog, { label: "Still writing" }));
    fill(timer, timerBar(v.game));
  };
  up(v);
  return { el, update: up };
}

function scrAudienceWait(v) {
  const g = v.game;
  const prog = h("div");
  const el = h(
    "section",
    { class: "scr wait aud" },
    kicker("You're in the audience", dropPill(g)),
    h("h2", { class: "wait-h", text: g.kind === "draw" ? "The designers are drawing." : "The writers are writing." }),
    h("p", { class: "wait-p", text: "When the shop opens you get tags to spend like everyone else, and your sales count. You'll be in the next game." }),
    prog,
  );
  const up = (v) => fill(prog, progressRow(v.game.prog, { label: v.game.kind === "draw" ? "Still drawing" : "Still writing" }), timerBar(v.game));
  up(v);
  return { el, update: up };
}

// --- the press ---
function scrPress(v) {
  const g = v.game;
  const el = h(
    "section",
    { class: "scr press" },
    kicker("The press", dropPill(g)),
    h(
      "div",
      { class: "press-rig", "aria-hidden": "true" },
      h("div", { class: "press-screen" }, h("div", { class: "press-mesh" }), h("div", { class: "press-ink" }), h("div", { class: "press-squeegee" })),
      h("div", { class: "press-shirt" }),
    ),
    h("h2", { class: "press-h", text: `Pulling ${g.n} prints…` }),
    h("p", { class: "press-p", text: "Every drawing gets someone else's slogan, at random. No take-backs." }),
  );
  sfx("squeegee");
  setTimeout(() => sfx("squeegee"), 2100);
  return { el };
}

// --- the runway ---
function scrRunway(v) {
  let g = v.game;
  let shown = -1;
  let cur = null;
  const count = h("div", { class: "rw-count" });
  const stage = h("div", { class: "rw-stage" });
  const timer = h("div", { class: "rw-timer" });
  const el = h(
    "section",
    { class: "scr runway" },
    h("div", { class: "rw-head" }, kicker("The runway", dropPill(g)), count),
    stage,
    timer,
    h("p", { class: "rw-hint", text: v.tv ? "Eyes on the big screen. React from here." : "React to every tee. The shop opens after the last one." }),
    reactBar(() => cur),
  );
  function show(v) {
    g = v.game;
    fill(timer, timerBar(g));
    if (g.i === shown) return;
    shown = g.i;
    const s = g.shirts[g.i];
    if (!s) return;
    cur = s.id;
    fill(count, h("b", { text: `No. ${g.i + 1}` }), h("span", { text: ` of ${g.n}` }));
    const old = stage.querySelector(".rw-card:not(.out)");
    if (old) {
      old.classList.add("out");
      setTimeout(() => old.remove(), 600);
    }
    stage.append(h("div", { class: "rw-card" }, shirtEl(s, { cls: "rw-tee" }), mineRibbon(s.mine)));
    sfx("hanger");
    if (s.mine) vibrate(20);
  }
  show(v);
  return { el, update: show };
}

// --- the shop ---
function scrShop(v) {
  let g = v.game;
  const max = g.me.max;
  const picks = new Set(g.me.tags);
  const cards = new Map();
  let lastLocal = 0;
  const pips = h("div", { class: "pips" });
  const status = h("p", { class: "shop-status" });
  const timer = h("div", { class: "shop-timer" });
  const grid = h("div", { class: "rack" });

  function canTag(s) {
    return !s.mine && max > 0;
  }
  function toggle(s) {
    if (!canTag(s)) {
      if (s.mine) toast("That one has your work on it. No buying your own merch.");
      return;
    }
    if (picks.has(s.id)) picks.delete(s.id);
    else {
      if (max === 1) picks.clear();
      else if (picks.size >= max) {
        toast(`You've used all ${max} tags. Tap a tagged tee to take one back.`);
        return;
      }
      picks.add(s.id);
      vibrate(12);
      sfx("tag");
    }
    lastLocal = Date.now();
    send({ t: "tag", list: [...picks] });
    paint();
  }
  function paint() {
    fill(
      pips,
      Array.from({ length: max }, (_, i) => h("span", { class: `pip${i < picks.size ? " used" : ""}` }, icon("tag"))),
    );
    const left = max - picks.size;
    status.textContent = max === 0 ? "Everything on this rack has your work on it. Sit back and watch the sales." : left > 0 ? `${plural(left, "tag")} left. Tap the tees you'd actually buy.` : "All tagged. You can swap until the shop shuts.";
    for (const [id, c] of cards) {
      const on = picks.has(id);
      c.el.classList.toggle("tagged", on);
      c.btn.replaceChildren(icon(on ? "check" : "tag"), document.createTextNode(c.s.mine ? "Yours" : on ? "Tagged" : "Tag it"));
      c.btn.setAttribute("aria-pressed", String(on));
    }
  }
  g.shirts.forEach((s, k) => {
    const btn = h("button", { class: "tag-btn", type: "button", disabled: !canTag(s), onclick: () => toggle(s) });
    const tee = shirtEl(s, { cls: "rack-tee" });
    tee.addEventListener("click", () =>
      zoomShirt(s, {
        tagBtn: canTag(s) ? [picks.has(s.id) ? "Untag" : "Tag it", "primary", () => toggle(s)] : null,
      }),
    );
    const card = h("div", { class: `rack-card${s.mine ? " own" : ""}`, style: { "--i": k } }, h("span", { class: "rack-no", text: k + 1 }), tee, mineRibbon(s.mine), h("p", { class: "rack-cap", text: `“${s.slogan}”` }), btn);
    cards.set(s.id, { el: card, btn, s });
    grid.append(card);
  });
  const el = h(
    "section",
    { class: "scr shop" },
    h("div", { class: "shop-head" }, kicker("The shop is open", dropPill(g)), h("div", { class: "shop-title" }, h("h2", { class: "shop-h", text: "Which tees would you buy?" }), pips)),
    status,
    timer,
    grid,
  );
  fill(timer, timerBar(g));
  paint();
  sfx("kaching");
  return {
    el,
    update(v) {
      g = v.game;
      fill(timer, timerBar(g));
      // Take the server's word unless we just changed something ourselves.
      if (Date.now() - lastLocal > 1500) {
        const server = new Set(g.me.tags);
        const same = server.size === picks.size && [...server].every((x) => picks.has(x));
        if (!same) {
          picks.clear();
          for (const x of server) picks.add(x);
          paint();
        }
      }
    },
    nack() {
      lastLocal = 0;
    },
  };
}

// --- the sales ---
function scrSales(v) {
  const g = v.game;
  const you = v.you;
  const list = g.shirts; // worst seller first
  const spots = Math.min(g.spots || 0, list.length);
  const rest = list.slice(0, list.length - spots);
  const top = list.slice(list.length - spots); // ascending: 3rd, 2nd, 1st
  const myShirts = list.filter((s) => s.artist === you || s.writer === you);
  const mySold = myShirts.reduce((a, s) => a + s.sales, 0);
  const myPts = (g.deltas && g.deltas[you]) || 0;
  const t0 = g.startedAt;
  const TILL = 1500;
  const REST_END = 6500;
  const STEP = Math.max(1, (g.dur - REST_END) / Math.max(1, spots));

  const spot = h("div", { class: "spot" });
  const rows = h("ol", { class: "sold-list" });
  const mine = h("div", { class: "my-sales" });
  const el = h("section", { class: "scr sales" }, kicker("Sales are in", dropPill(g)), spot, mine, h("h3", { class: "sec-h", text: "The whole rack" }), rows);

  const row = (s) =>
    h(
      "li",
      { class: `sold-row${s.best ? " best" : ""}${s.artist === you || s.writer === you ? " me" : ""}` },
      shirtEl(s, { cls: "mini-tee" }),
      h("div", { class: "sold-mid" }, h("p", { class: "sold-slogan", text: `“${s.slogan}”` }), credits(s)),
      h("div", { class: "sold-n" }, h("b", { text: s.sales }), h("span", { text: "sold" })),
    );
  let shownRest = 0;
  let shownTop = 0;
  let mineShown = false;
  function step(t) {
    const e = t - t0;
    const wantRest = e < TILL ? 0 : Math.min(rest.length, Math.ceil(((e - TILL) / Math.max(1, REST_END - TILL)) * rest.length));
    while (shownRest < wantRest) {
      rows.prepend(row(rest[shownRest]));
      shownRest++;
      if (phoneSfx()) audio.play("tick");
    }
    const wantTop = e < REST_END ? 0 : Math.min(spots, 1 + Math.floor((e - REST_END) / STEP));
    while (shownTop < wantTop) {
      const s = top[shownTop];
      const place = spots - shownTop; // 3, 2, 1
      const isFirst = shownTop === spots - 1;
      const rank = 1 + list.filter((x) => x.sales > s.sales).length; // ties share a place
      fill(
        spot,
        h(
          "div",
          { class: `spot-card place-${place}` },
          h("span", { class: "spot-place", text: isFirst ? "Top of the rack" : s.best ? "Joint best seller" : `${ordinal(rank)} best seller` }),
          shirtEl(s, { cls: "spot-tee" }),
          s.best ? stamp("BEST SELLER", "best") : null,
          h("p", { class: "spot-sold" }, h("b", { text: s.sales }), ` ${s.sales === 1 ? "sale" : "sales"}`),
          credits(s),
        ),
      );
      rows.prepend(row(s));
      shownTop++;
      if (isFirst) {
        if (phoneSfx()) audio.play("fanfare");
        if (s.artist === you || s.writer === you) {
          confetti({ count: 140 });
          vibrate([20, 60, 20, 60, 40]);
        }
      } else if (phoneSfx()) audio.play("kaching");
    }
    if (!mineShown && e > REST_END) {
      mineShown = true;
      if (myShirts.length)
        fill(
          mine,
          h("p", { class: "my-sales-t" }, "Your work sold ", h("b", { text: plural(mySold, "tee") }), " this drop", myPts ? h("span", { class: "pts-pop", text: `+${fmt(myPts)}` }) : null),
        );
      else if (v.role === "audience") fill(mine, h("p", { class: "my-sales-t", text: "Thanks for shopping. Your tags counted." }));
    }
  }
  if (rest.length === 0 && spots === 0) fill(spot, h("p", { class: "muted", text: "Nothing sold this time." }));
  else fill(spot, h("div", { class: "till" }, h("span", { class: "till-i", text: "🧾" }), h("p", { text: "Counting the till…" })));
  if (phoneSfx()) audio.play("drum");
  const stop = onTick(step);
  step(now());
  return { el, destroy: stop };
}

function rankList(rows, { you, deltas = null } = {}) {
  return h(
    "ol",
    { class: "ranks" },
    rows.map((r, i) => {
      const p = P(r.id);
      const d = deltas ? deltas[r.id] || 0 : 0;
      return h(
        "li",
        { class: `rank${r.id === you ? " me" : ""}${r.left ? " gone" : ""}`, style: { "--i": i } },
        h("span", { class: "rk-n", text: r.place }),
        avatar(p, { size: "s" }),
        h("span", { class: "rk-name", text: p ? p.name : "?" }),
        d ? h("span", { class: "rk-d", text: `+${fmt(d)}` }) : null,
        h("b", { class: "rk-s", text: fmt(r.score) }),
      );
    }),
  );
}

function scrScores(v) {
  const g = v.game;
  const me = g.ranking.find((r) => r.id === v.you);
  const el = h(
    "section",
    { class: "scr scores" },
    kicker(g.last ? "Final count coming up" : "After this drop", dropPill(g)),
    h("h2", { class: "sc-h", text: me ? `You're ${ordinal(me.place)}` : "Leaderboard" }),
    rankList(g.ranking, { you: v.you, deltas: g.deltas }),
    h("p", { class: "muted center-t", text: g.last ? "And the night's best seller is…" : "Next drop starts in a moment. New designs, new slogans." }),
    timerBar(g, { cls: "calm" }),
  );
  return { el };
}

function awardCard(a, g) {
  const AWARD_ICON = { best: "🏆", artist: "🎨", writer: "✍️", crowd: "😂", cult: "🗝️", team: "🤝" };
  const sh = a.shirt ? [...g.lookbook.flatMap((d) => d.shirts)].find((s) => s.id === a.shirt) : null;
  return h(
    "div",
    { class: `award a-${a.key}` },
    h("span", { class: "award-i", text: AWARD_ICON[a.key] || "⭐" }),
    h(
      "div",
      { class: "award-b" },
      h("b", { class: "award-t", text: a.title }),
      h("span", { class: "award-who", text: a.ids.map((id) => `${P(id)?.emoji || ""} ${nameOf(id)}`).join(" + ") || "the house" }),
      h("small", { text: a.blurb }),
    ),
    sh ? shirtEl(sh, { cls: "award-tee" }) : null,
  );
}

function scrFinal(v) {
  const g = v.game;
  const you = v.you;
  const me = g.ranking.find((r) => r.id === you);
  const podium = g.ranking.slice(0, 3);
  const all = g.lookbook.flatMap((d) => d.shirts);
  let onlyMine = false;
  const grid = h("div", { class: "look" });
  const meta = (s) => ({
    title: `“${s.slogan}”`,
    credit: `Art: ${nameOf(s.artist)} · Slogan: ${nameOf(s.writer)} · ${plural(s.sales || 0, "sale")}`,
  });
  function paintLook() {
    const list = all.filter((s) => !onlyMine || s.artist === you || s.writer === you);
    fill(
      grid,
      list.length
        ? list.map((s, k) =>
            h(
              "button",
              {
                class: `look-card${s.best ? " best" : ""}`,
                type: "button",
                style: { "--i": k },
                onclick: () =>
                  zoomShirt(s, {
                    extra: h("div", { class: "zoom-meta" }, h("p", { class: "zoom-sold", text: `${plural(s.sales, "sale")}${s.best ? " · best seller" : ""}` }), credits(s)),
                    tagBtn: [
                      "Save image",
                      "primary",
                      () => {
                        saveShirt(s, meta(s)).catch(() => toast("Couldn't save that one."));
                        return true;
                      },
                    ],
                  }),
              },
              shirtEl(s, { cls: "look-tee" }),
              s.best ? stamp("BEST", "mini") : null,
              h("span", { class: "look-sold", text: `${s.sales} sold` }),
            ),
          )
        : h("p", { class: "muted", text: "None of yours this time." }),
    );
  }
  const filterBtn = h("button", { class: "btn small", type: "button" });
  const paintFilter = () => fill(filterBtn, onlyMine ? "Show all" : "Just mine");
  filterBtn.onclick = () => {
    onlyMine = !onlyMine;
    paintFilter();
    paintLook();
  };
  paintFilter();
  paintLook();
  const host = isHost();
  const el = h(
    "section",
    { class: "scr final" },
    h("div", { class: "final-mast" }, h("span", { class: "intro-k", text: "Closing time" }), h("h2", { class: "final-h riso", dataset: { t: "SOLD OUT" } }, "SOLD OUT")),
    h(
      "div",
      { class: "podium" },
      [1, 0, 2].map((i) => {
        const r = podium[i];
        if (!r) return h("div", { class: "pod empty" });
        const p = P(r.id);
        return h(
          "div",
          { class: `pod pod-${r.place}${r.id === you ? " me" : ""}`, style: { "--i": i } },
          avatar(p, { size: "l" }),
          h("span", { class: "pod-n", text: p ? p.name : "?" }),
          h("b", { class: "pod-s", text: fmt(r.score) }),
          h("div", { class: "pod-block" }, h("span", { text: r.place })),
        );
      }),
    ),
    me && me.place > 3 ? h("p", { class: "me-place", text: `You finished ${ordinal(me.place)} with ${fmt(me.score)}.` }) : null,
    g.awards.length ? h("div", { class: "awards" }, h("h3", { class: "sec-h", text: "Awards" }), g.awards.map((a) => awardCard(a, g))) : null,
    h("div", { class: "look-head" }, h("h3", { class: "sec-h", text: "The lookbook" }), filterBtn),
    h("p", { class: "fine", text: "Tap any tee to see it big and save it as an image." }),
    grid,
    g.cut && g.cut.length ? h("div", { class: "cut" }, h("h3", { class: "sec-h", text: "Never printed" }), h("ul", null, g.cut.map((t) => h("li", { text: `“${t}”` })))) : null,
    h("div", { class: "start-bar" }, host ? h("button", { class: "btn primary big", type: "button", onclick: () => send({ t: "endGame" }) }, "Back to the lobby", icon("arrow")) : h("p", { class: "wait-host" }, h("span", { class: "dots" }), "The host can start another round")),
  );
  if (me && me.place === 1) setTimeout(() => confetti({ count: 200 }), 400);
  if (phoneSfx()) audio.play("fanfare");
  return { el };
}

// ---------- chrome ----------
function renderTop(v) {
  const me = v ? meP() : null;
  const g = v && v.game;
  fill(
    top,
    v ? h("button", { class: "code-chip", type: "button", title: "Copy invite link", onclick: () => copyInvite(v.code) }, h("span", { class: "cc-l", text: "Room" }), h("b", { text: v.code })) : h("span", { class: "top-brand", text: "Fresh Prints" }),
    h(
      "div",
      { class: "top-right" },
      v && v.role === "audience" ? h("span", { class: "chip alt", text: "shopper" }) : null,
      me ? h("span", { class: "me-chip" }, avatar(me, { size: "s" }), h("span", { class: "me-n", text: me.name }), g && me.score != null ? h("b", { class: "me-s", text: fmt(me.score) }) : null) : null,
      v ? h("button", { class: "icon-btn menu-btn", type: "button", "aria-label": "Menu", onclick: openMenu }, icon("dots")) : null,
    ),
  );
}

async function copyInvite(code) {
  const url = inviteUrl(code);
  try {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      await navigator.share({ title: "Fresh Prints", text: `Join my Fresh Prints room: ${code}`, url });
      return;
    }
  } catch (e) {
    if (e && e.name === "AbortError") return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("Invite link copied.");
  } catch {
    toast(url, { ms: 5000 });
  }
}

function openMenu() {
  const v = S.v;
  const soundBtn = h("button", {
    class: "btn ghost",
    type: "button",
    text: S.sound ? "Sound: on" : "Sound: off",
    onclick: () => {
      S.sound = !S.sound;
      st.set("sound", S.sound);
      audio.setMuted(!S.sound);
      soundBtn.textContent = S.sound ? "Sound: on" : "Sound: off";
      if (S.sound) audio.play("tap");
    },
  });
  sheet(
    "Menu",
    h(
      "div",
      { class: "menu" },
      soundBtn,
      h("p", { class: "fine", text: v && v.tv ? "A big screen is connected, so it plays the sound." : "Phones play the sound when there's no big screen." }),
      h("button", { class: "btn ghost", type: "button", text: "How to play", onclick: () => sheet("How it works", howTo(), [["Got it", "primary", null]]) }),
      v && v.game && isHost() ? h("button", { class: "btn ghost", type: "button", text: "End this game", onclick: () => confirmSheet("End the game?", "Everyone goes back to the lobby. Scores are lost.", "End it", () => send({ t: "endGame" })) }) : null,
      h("button", { class: "btn danger", type: "button", text: "Leave room", onclick: () => confirmSheet("Leave the room?", v && v.game ? "Your drawings and slogans stay in this game." : "You can rejoin with the code.", "Leave", () => send({ t: "leave" })) }),
    ),
    [["Close", "ghost", null]],
  );
}

function screenFor(v) {
  if (!v) return S.resuming ? ["loading", scrLoading] : ["home", scrHome];
  if (!v.game) return ["lobby", scrLobby];
  const g = v.game;
  const playing = v.role === "player" && v.players.some((p) => p.id === v.you && !p.left) && g.scores[v.you] != null;
  switch (g.kind) {
    case "intro":
      return [`intro:${g.drop}`, scrIntro];
    case "draw": {
      if (!playing) return [`aw:draw:${g.drop}`, scrAudienceWait];
      const allLocked = g.me && g.me.locked && g.me.locked.every(Boolean);
      return allLocked ? [`dw:${g.drop}`, scrDrawWait] : [`draw:${g.drop}`, scrDraw];
    }
    case "write":
      if (!playing) return [`aw:write:${g.drop}`, scrAudienceWait];
      return g.me && g.me.done ? [`ww:${g.drop}`, scrWriteWait] : [`write:${g.drop}`, scrWrite];
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
  return ["loading", scrLoading];
}

function render(force = false) {
  const v = S.v;
  const [key, make] = screenFor(v);
  if (key !== S.key || force) {
    if (S.scr && S.scr.destroy) S.scr.destroy();
    S.key = key;
    S.scr = make(v);
    fill(main, S.scr.el);
    document.body.dataset.screen = key.split(":")[0];
    window.scrollTo(0, 0);
    if (S.scr.mounted) S.scr.mounted();
    if (S.mine && S.scr.restore) S.scr.restore(S.mine);
  } else if (S.scr && S.scr.update) S.scr.update(v);
  renderTop(v);
}

function artIds(g) {
  const ids = [];
  if (!g) return ids;
  if (g.shirts) for (const s of g.shirts) ids.push(s.art);
  if (g.lookbook) for (const d of g.lookbook) for (const s of d.shirts) ids.push(s.art);
  return ids;
}

function onMsg(m) {
  switch (m.t) {
    case "joined":
      S.you = m.you;
      S.resuming = false;
      S.busy = false;
      if (m.token) st.set("session", { code: m.code, token: m.token });
      if (S.urlRoom || params.has("room")) {
        S.urlRoom = "";
        const u = new URL(location.href);
        u.searchParams.delete("room");
        history.replaceState(null, "", u.pathname + u.search);
      }
      send({ t: "mine" });
      retryMissing();
      break;
    case "state": {
      const prev = S.v;
      S.v = m;
      S.busy = false;
      if (m.game) want(artIds(m.game));
      if (prev && prev.game && m.game && prev.game.kind !== m.game.kind) S.mine = null;
      if (!prev || !prev.game || !m.game) S.mine = null;
      if (prev && !prev.game && m.game) audio.unlock();
      render();
      break;
    }
    case "mine":
      S.mine = m;
      if (S.scr && S.scr.restore) S.scr.restore(m);
      break;
    case "art":
      addArt(m.id, m.art);
      break;
    case "resumeFail":
      st.del("session");
      S.resuming = false;
      S.v = null;
      render();
      break;
    case "error":
      S.busy = false;
      toast(m.msg || "Something went wrong.");
      if (m.code === "noroom" && !S.v) S.urlRoom = "";
      render(m.code === "noroom" && !S.v);
      break;
    case "nack":
      if (m.what !== "tag" && m.what !== "sketch") toast("That didn't go through. Try again.");
      if (S.scr && S.scr.nack) S.scr.nack(m.what, m);
      break;
    case "kicked":
      st.del("session");
      S.v = null;
      S.notice = "The host removed you from the room.";
      render();
      break;
    case "left":
      st.del("session");
      S.v = null;
      S.key = null;
      render();
      break;
    case "gone":
      st.del("session");
      S.v = null;
      S.notice = "That room has closed. Start a new one?";
      render();
      break;
    case "react":
      if (S.v && !S.v.tv && m.id !== S.v.you) floatReact(m.e);
      break;
  }
}

export function startPhone() {
  document.body.classList.add("phone");
  const app = document.getElementById("app");
  top = h("header", { class: "p-top" });
  main = h("main", { class: "p-main", id: "main" });
  fill(app, h("div", { class: "paper", "aria-hidden": "true" }), top, main);
  audio.setMuted(!S.sound);
  preloadFonts();
  net = new Net({
    onMsg,
    onOpen() {
      const sess = st.get("session");
      if (sess && sess.code && (!S.urlRoom || S.urlRoom === sess.code)) {
        S.resuming = true;
        net.send({ t: "resume", code: sess.code, token: sess.token });
      }
      document.body.classList.remove("offline");
      render();
    },
    onClose() {
      document.body.classList.add("offline");
    },
  });
  setArtRequester((ids) => net.send({ t: "getArt", ids }));
  setClock(() => net.serverNow());
  if (st.get("session") && (!S.urlRoom || S.urlRoom === st.get("session").code)) S.resuming = true;
  net.connect();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) net.kick();
  });
  window.addEventListener("pointerdown", () => audio.unlock(), { passive: true });
  render();
  if (DEV) window.__fp = { S, net, render };
}
