// A scripted phone: joins a room over a real WebSocket and plays every phase.
// Used by the headless sim and by bots.js (to fill a real room for testing).

import WebSocket from "ws";
import { doodle } from "../game/art.js";
import { HOUSE_SLOGANS } from "../game/content.js";

const pick = (a) => a[Math.floor(Math.random() * a.length)];

export function botPhone(url, { code = null, name = "Bot", create = false, pace = 1, onState = null, onMsg = null, react = true } = {}) {
  const bot = { ws: null, you: null, code, token: null, state: null, acted: new Set(), arts: new Map(), closed: false, mine: null };
  const send = (m) => {
    if (bot.ws && bot.ws.readyState === 1) bot.ws.send(JSON.stringify(m));
  };
  const later = (ms, fn) => setTimeout(fn, ms * pace);
  bot.send = send;

  function act(v) {
    const g = v.game;
    if (!g) return;
    const key = `${g.kind}:${g.drop}:${g.i ?? ""}`;
    if (bot.acted.has(key)) return;
    bot.acted.add(key);
    switch (g.kind) {
      case "draw":
        if (g.me)
          g.me.locked.forEach((locked, slot) => {
            if (!locked) later(400 + slot * 500 + Math.random() * 600, () => send({ t: "sketch", slot, art: doodle(), done: true }));
          });
        break;
      case "write":
        if (g.me && !g.me.done) later(500 + Math.random() * 800, () => send({ t: "write", list: Array.from({ length: g.slogansEach }, () => pick(HOUSE_SLOGANS)), done: true }));
        break;
      case "runway":
        if (react && Math.random() < 0.6) later(150 + Math.random() * 300, () => send({ t: "react", s: g.shirts[g.i].id, e: pick(["lol", "fire", "love", "huh", "dead"]) }));
        break;
      case "shop": {
        const can = g.shirts.filter((s) => !s.mine).map((s) => s.id);
        const n = g.me ? g.me.max : 0;
        if (n) later(300 + Math.random() * 700, () => send({ t: "tag", list: can.sort(() => Math.random() - 0.5).slice(0, n) }));
        break;
      }
    }
  }

  function connect() {
    const ws = new WebSocket(url);
    bot.ws = ws;
    ws.on("open", () => {
      if (bot.token) send({ t: "resume", code: bot.code, token: bot.token });
      else if (create) send({ t: "create", name });
      else send({ t: "join", code: bot.code, name });
    });
    ws.on("message", (data) => {
      let m;
      try {
        m = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (onMsg) onMsg(m, bot);
      if (m.t === "joined") {
        const resumed = !!bot.token;
        bot.you = m.you;
        bot.code = m.code;
        if (m.token) bot.token = m.token;
        if (resumed) send({ t: "mine" }); // like a reloaded phone, ask for unfinished work back
      } else if (m.t === "state") {
        bot.state = m;
        act(m);
        if (onState) onState(m, bot);
      } else if (m.t === "art") bot.arts.set(m.id, m.art);
      else if (m.t === "mine") bot.mine = m;
    });
    ws.on("close", () => {
      bot.closed = true;
    });
    ws.on("error", () => {});
  }
  bot.connect = connect;
  bot.drop = () => {
    try {
      bot.ws.terminate();
    } catch {}
  };
  bot.reconnect = () => {
    bot.closed = false;
    bot.acted.clear();
    connect();
  };
  connect();
  return bot;
}
