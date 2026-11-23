// Fresh Prints game rules.
//
// Pure logic: no sockets and no timers. The server calls tick(now) a few times
// a second and the action methods with its own clock, so tests can play whole
// games on a fake one. Who is connected comes from a `presence` object the
// server supplies.
//
// A game is one or more drops. Each drop:
//   intro    title card
//   draw     everyone draws `designs` shirt designs
//   write    everyone writes `designs + 1` slogans, blind
//   press    the press pairs every design with someone else's slogan, at random
//   runway   the shirts are shown one at a time; people react
//   shop     everyone tags the shirts they'd buy (never their own work)
//   sales    sales are revealed; every tag pays the artist and the writer
//   scores   leaderboard
// After the last drop: final (podium, awards, the lookbook).

import { HOUSE_SLOGANS, STYLES, AWARDS } from "./content.js";
import { cleanText } from "./filter.js";
import { cleanArt, isBlank, doodle } from "./art.js";

// Durations at normal pace (ms). PACED ones stretch or shrink with the pace setting.
export const T = {
  intro: 7000,
  drawPer: 80000, // per design
  writePer: 25000, // per slogan
  grace: 1200, // autosaves still in flight when the clock hits zero
  press: 6000,
  runwayPer: 6500, // per shirt
  runwayMin: 4200,
  shop: 60000,
  shopGrace: 3000, // once everyone has tagged, the shop shuts this much later
  salesBase: 6500,
  salesStep: 2800, // per spotlight (top three)
  scores: 8500,
};
const PACED = new Set(["drawPer", "writePer", "runwayPer", "shop"]);
export const PACE = { relaxed: 1.4, normal: 1, quick: 0.7 };

export const PTS = {
  sale: 100, // every tag, to the artist and to the writer
  best: 250, // best seller of the drop, to both again
};

export const SLOGAN_MAX = 60;
export const OPTIONS = { drops: [1, 2, 3], designs: [1, 2, 3], pace: ["relaxed", "normal", "quick"] };
export const REACT_KINDS = ["lol", "fire", "love", "huh", "dead"];
const REACTS = new Set(REACT_KINDS);

// How many tags each shopper gets for a rack of n shirts.
export function tagsFor(n) {
  return n <= 6 ? 1 : n <= 14 ? 2 : 3;
}

// ---------- helpers ----------
export function shuffle(a, rng = Math.random) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// The press. Every design gets one slogan. Rules, most important first:
//   1. never your own slogan on your own drawing, if it can be helped
//   2. players' slogans before house slogans
//   3. spread the printing out: nobody printed twice while a writer with
//      slogans left has been printed less
//   4. the same artist and writer don't team up twice in one drop
//   5. otherwise it's random
// Each pass is greedy over a random order; a few passes, keep the cheapest.
// Slogans with writer null are house slogans.
export function pairUp(arts, slogans, rng = Math.random) {
  if (!arts.length) return { pairs: [], unused: slogans.slice() };
  let best = null;
  let bestCost = Infinity;
  for (let k = 0; k < 40 && bestCost > 0; k++) {
    const pool = shuffle(slogans.slice(), rng);
    const order = shuffle(arts.slice(), rng);
    const used = new Array(pool.length).fill(false);
    const printed = new Map(); // writer -> times printed this pass
    const teams = new Set();
    const pairs = [];
    let cost = 0;
    for (const a of order) {
      let pick = -1;
      let pickKey = Infinity;
      for (let i = 0; i < pool.length; i++) {
        if (used[i]) continue;
        const s = pool[i];
        let key;
        if (s.writer == null) key = 1e7;
        else if (s.writer === a.artist) key = 1e8;
        else key = (printed.get(s.writer) || 0) * 1e4 + (a.artist != null && teams.has(`${a.artist}|${s.writer}`) ? 5e3 : 0);
        if (key < pickKey) {
          pickKey = key;
          pick = i;
        }
      }
      if (pick < 0) break; // out of slogans altogether (callers pad, so this shouldn't happen)
      used[pick] = true;
      const s = pool[pick];
      if (pickKey >= 1e8) cost += 1000;
      else if (pickKey % 1e4 >= 5e3) cost += 1;
      if (s.writer != null) printed.set(s.writer, (printed.get(s.writer) || 0) + 1);
      if (s.writer != null && a.artist != null) teams.add(`${a.artist}|${s.writer}`);
      pairs.push({ art: a, slogan: s });
    }
    if (pairs.length < arts.length) cost += 1e6;
    // Unfair spreads: a writer with slogans to spare printed 2+ times fewer than someone else.
    const spareBy = new Map();
    pool.forEach((s, i) => {
      if (!used[i] && s.writer != null) spareBy.set(s.writer, true);
    });
    const most = Math.max(0, ...printed.values());
    for (const w of spareBy.keys()) if ((printed.get(w) || 0) < most - 1) cost += 10;
    // House slogans printed while players' slogans sat unused.
    const house = pairs.filter((p) => p.slogan.writer == null).length;
    if (house && spareBy.size) cost += 5 * house;
    if (cost < bestCost) {
      bestCost = cost;
      best = { pairs, unused: pool.filter((_, i) => !used[i]) };
    }
  }
  return best;
}

// Runway order: shuffled, and nobody's drawing twice in a row if it can be helped.
function runwayOrder(shirts, rng) {
  let best = null;
  let bestBad = Infinity;
  for (let k = 0; k < 24 && bestBad > 0; k++) {
    const o = shuffle(shirts.slice(), rng);
    let bad = 0;
    for (let i = 1; i < o.length; i++) {
      const p = o[i - 1];
      const q = o[i];
      if (p.artist != null && p.artist === q.artist) bad += 2;
      if (p.writer != null && p.writer === q.writer) bad += 1;
    }
    if (bad < bestBad) {
      best = o;
      bestBad = bad;
    }
  }
  return best || shirts.slice();
}

function newId(rng, taken) {
  for (;;) {
    const id = Math.floor(rng() * 36 ** 6)
      .toString(36)
      .padStart(6, "0");
    if (!taken.has(id)) return id;
  }
}

// ---------- the game ----------
export class Game {
  constructor({ players, settings = {}, presence, rng = Math.random, timeScale = 1, now = Date.now() }) {
    this.rng = rng;
    this.ts = timeScale;
    this.presence = presence || { present: () => true, audience: () => [], isAudience: () => false };
    this.drops = OPTIONS.drops.includes(settings.drops) ? settings.drops : 2;
    this.designs = OPTIONS.designs.includes(settings.designs) ? settings.designs : 2;
    this.slogansEach = this.designs + 1;
    this.pace = PACE[settings.pace] ? settings.pace : "normal";
    this.family = !!settings.family;

    this.players = players.map((p) => ({ id: p.id, name: p.name }));
    this.byId = new Map(this.players.map((p) => [p.id, p]));
    this.left = new Set();
    this.scores = new Map(this.players.map((p) => [p.id, 0]));
    this.stats = new Map(this.players.map((p) => [p.id, { art: 0, slogan: 0, best: 0, made: 0, wrote: 0, printed: 0 }]));

    this.arts = new Map(); // id -> { id, artist, drop, bg, ops, json }
    this.shirts = new Map(); // id -> shirt
    this.history = []; // one entry per finished drop
    this.cut = []; // players' slogans the press never used
    this.styleBag = [];
    this.houseBag = [];
    this.dropNo = 0;
    this.cur = null;
    this.final = null;
    this.phase = null;
    this.startDrop(now);
  }

  // ---------- plumbing ----------
  dur(key) {
    let d = T[key];
    if (PACED.has(key)) d *= PACE[this.pace];
    return Math.round(d * this.ts);
  }

  setPhase(kind, dur, now, data = {}) {
    const endsAt = dur == null ? null : now + dur;
    this.phase = { kind, drop: this.dropNo, startedAt: now, dur: dur ?? null, endsAt, closeAt: endsAt, ...data };
  }

  activeIds() {
    return this.players.filter((p) => !this.left.has(p.id)).map((p) => p.id);
  }
  isPlayer(id) {
    return this.byId.has(id) && !this.left.has(id);
  }
  present(id, now) {
    return this.presence.present(id, now);
  }
  isAudience(id) {
    return !this.byId.has(id) && this.presence.isAudience(id);
  }

  markLeft(id, now) {
    if (!this.byId.has(id)) return;
    this.left.add(id);
    this.checkEarly(now);
  }

  nextStyle() {
    if (!this.styleBag.length) this.styleBag = shuffle(STYLES.slice(), this.rng);
    return this.styleBag.pop();
  }
  houseSlogan() {
    if (!this.houseBag.length) this.houseBag = shuffle(HOUSE_SLOGANS.slice(), this.rng);
    return this.houseBag.pop();
  }

  addArt(artist, art) {
    const id = newId(this.rng, this.arts);
    const rec = { id, artist, drop: this.dropNo, bg: art.bg, ops: art.ops };
    rec.json = JSON.stringify({ bg: rec.bg, ops: rec.ops });
    this.arts.set(id, rec);
    return id;
  }

  // ---------- the clock ----------
  tick(now) {
    const ph = this.phase;
    if (ph.closeAt != null && now >= ph.closeAt) {
      this.timeout(now);
      return true;
    }
    return this.checkEarly(now);
  }

  timeout(now) {
    switch (this.phase.kind) {
      case "intro":
        return this.beginDraw(now);
      case "draw":
        return this.closeDraw(now);
      case "write":
        return this.closeWrite(now);
      case "press":
        return this.beginRunway(now);
      case "runway":
        return this.nextRunway(now);
      case "shop":
        return this.closeShop(now);
      case "sales":
        return this.goScores(now);
      case "scores":
        return this.dropNo < this.drops ? this.startDrop(now) : this.finish(now);
    }
  }

  // Stop waiting once every present player is done. (If nobody is present at
  // all, keep the clock running: phones that went to sleep come back.)
  checkEarly(now) {
    const ph = this.phase;
    const here = this.activeIds().filter((id) => this.present(id, now));
    if (!here.length) return false;
    if (ph.kind === "draw") {
      if (here.every((id) => !this.cur.drafts.get(id)?.some((s) => !s.locked))) {
        this.closeDraw(now);
        return true;
      }
    } else if (ph.kind === "write") {
      if (here.every((id) => this.cur.wrote.has(id))) {
        this.closeWrite(now);
        return true;
      }
    } else if (ph.kind === "shop" && !this.cur.graced) {
      if (here.every((id) => this.tagsLeft(id) <= 0)) {
        this.cur.graced = true;
        const at = Math.min(ph.endsAt, now + Math.round(T.shopGrace * this.ts));
        if (at < ph.endsAt) {
          ph.endsAt = at;
          ph.closeAt = at;
          return true;
        }
      }
    }
    return false;
  }

  // ---------- a drop ----------
  startDrop(now) {
    this.dropNo++;
    const drafts = new Map();
    for (const id of this.activeIds()) drafts.set(id, Array.from({ length: this.designs }, () => ({ art: null, locked: false })));
    this.cur = {
      no: this.dropNo,
      drafts, // id -> [{ art, locked }]
      arts: [], // art ids drawn this drop
      slogans: new Map(), // id -> [text]
      wrote: new Set(), // finished writing
      shirts: [], // shirt ids, in runway order
      tags: new Map(), // shopper -> [shirt ids]
      graced: false,
      deltas: new Map(),
      order: [],
    };
    this.setPhase("intro", this.dur("intro"), now);
  }

  beginDraw(now) {
    this.setPhase("draw", this.dur("drawPer") * this.designs, now);
    this.phase.closeAt += Math.round(T.grace * this.ts);
  }

  // Autosaves and the final "done" both come through here.
  sketch(id, slot, input, done, now) {
    if (this.phase.kind !== "draw" || !this.isPlayer(id)) return false;
    const slots = this.cur.drafts.get(id);
    if (!slots || !Number.isInteger(slot) || slot < 0 || slot >= slots.length) return false;
    const s = slots[slot];
    if (s.locked) return false;
    const art = cleanArt(input);
    if (!art) return false;
    s.art = art;
    if (done) {
      s.locked = true;
      this.checkEarly(now);
    }
    return true;
  }

  closeDraw(now) {
    for (const [id, slots] of this.cur.drafts) {
      for (const s of slots) {
        if (!s.art || isBlank(s.art)) continue;
        this.cur.arts.push(this.addArt(id, s.art));
        const st = this.stats.get(id);
        if (st) st.made++;
      }
    }
    this.cur.mine = new Map(); // drafts are gone; remember who drew how many
    for (const aid of this.cur.arts) {
      const a = this.arts.get(aid).artist;
      this.cur.mine.set(a, (this.cur.mine.get(a) || 0) + 1);
    }
    this.cur.drafts = null;
    for (const id of this.activeIds()) this.cur.slogans.set(id, []);
    this.setPhase("write", this.dur("writePer") * this.slogansEach, now);
    this.phase.closeAt += Math.round(T.grace * this.ts);
  }

  // Drafts sync as people type; done locks them in.
  write(id, list, done, now) {
    if (this.phase.kind !== "write" || !this.isPlayer(id) || this.cur.wrote.has(id)) return false;
    if (!Array.isArray(list)) return false;
    const clean = list.slice(0, this.slogansEach).map((x) => (typeof x === "string" ? cleanText(x, { max: SLOGAN_MAX, family: this.family }) : ""));
    this.cur.slogans.set(id, clean);
    if (done) {
      this.cur.wrote.add(id);
      this.checkEarly(now);
    }
    return true;
  }

  closeWrite(now) {
    const arts = this.cur.arts.map((aid) => ({ id: aid, artist: this.arts.get(aid).artist }));
    // Always at least two shirts on the rack: the house draws the rest.
    while (arts.length < 2) arts.push({ id: this.addArt(null, doodle(this.rng)), artist: null });
    const slogans = [];
    for (const [id, list] of this.cur.slogans) {
      const seen = new Set();
      for (const text of list) {
        if (!text || seen.has(text.toLowerCase())) continue;
        seen.add(text.toLowerCase());
        slogans.push({ text, writer: id });
        const st = this.stats.get(id);
        if (st) st.wrote++;
      }
    }
    // House slogans fill any gap, plus a couple spare so the pairing has room.
    const writers = new Set(slogans.map((s) => s.writer));
    const short = arts.length - slogans.length;
    const spare = writers.size <= 1 ? arts.length : 2;
    for (let i = 0; i < Math.max(0, short) + spare; i++) slogans.push({ text: this.houseSlogan(), writer: null });

    const { pairs, unused } = pairUp(arts, slogans, this.rng);
    const made = [];
    for (const p of pairs) {
      const id = newId(this.rng, this.shirts);
      const art = this.arts.get(p.art.id);
      const sh = {
        id,
        drop: this.dropNo,
        art: art.id,
        bg: art.bg,
        artist: p.art.artist,
        slogan: p.slogan.text,
        writer: p.slogan.writer,
        style: this.nextStyle(),
        sales: 0,
        buyers: [],
        reacts: {},
        best: false,
        pts: 0,
      };
      this.shirts.set(id, sh);
      made.push(sh);
      if (sh.writer != null && this.stats.has(sh.writer)) this.stats.get(sh.writer).printed++;
    }
    this.cur.shirts = runwayOrder(made, this.rng).map((s) => s.id);
    // Players' slogans that never made it onto a shirt get a moment at the end.
    for (const s of unused) if (s.writer != null) this.cut.push(s.text);
    this.setPhase("press", this.dur("press"), now, { n: this.cur.shirts.length });
  }

  runwayPer() {
    const n = this.cur.shirts.length;
    let per = this.dur("runwayPer");
    if (n > 8) per = Math.max(Math.round(T.runwayMin * this.ts), Math.round(per * Math.sqrt(8 / n)));
    return per;
  }

  beginRunway(now) {
    this.setPhase("runway", this.runwayPer(), now, { i: 0, n: this.cur.shirts.length });
  }

  nextRunway(now) {
    const i = this.phase.i + 1;
    if (i < this.cur.shirts.length) this.setPhase("runway", this.runwayPer(), now, { i, n: this.cur.shirts.length });
    else this.beginShop(now);
  }

  // Reactions are just for fun (and the Crowd Favourite award).
  react(id, shirtId, kind) {
    if (!REACTS.has(kind)) return false;
    if (!["runway", "shop", "sales"].includes(this.phase.kind)) return false;
    const sh = this.shirts.get(shirtId);
    if (!sh || sh.drop !== this.dropNo) return false;
    if (!this.isPlayer(id) && !this.isAudience(id)) return false;
    sh.reacts[kind] = (sh.reacts[kind] || 0) + 1;
    return true;
  }

  // ---------- the shop ----------
  beginShop(now) {
    this.cur.tags = new Map();
    this.cur.graced = false;
    this.setPhase("shop", this.dur("shop"), now, { tags: tagsFor(this.cur.shirts.length) });
  }

  onShirt(id, sh) {
    return id != null && (sh.artist === id || sh.writer === id);
  }
  canShopFor(id) {
    return this.cur.shirts.filter((sid) => !this.onShirt(id, this.shirts.get(sid)));
  }
  maxTags(id) {
    if (!this.isPlayer(id) && !this.isAudience(id)) return 0;
    return Math.min(tagsFor(this.cur.shirts.length), this.canShopFor(id).length);
  }
  tagsLeft(id) {
    return this.maxTags(id) - (this.cur.tags.get(id)?.length || 0);
  }

  // `list` is the whole set of shirts this shopper has tagged right now.
  tag(id, list, now) {
    if (this.phase.kind !== "shop" || !Array.isArray(list)) return false;
    const max = this.maxTags(id);
    if (!max) return false;
    const uniq = [...new Set(list)];
    if (uniq.length > max) return false;
    const ok = new Set(this.canShopFor(id));
    if (!uniq.every((sid) => typeof sid === "string" && ok.has(sid))) return false;
    this.cur.tags.set(id, uniq);
    this.checkEarly(now);
    return true;
  }

  closeShop(now) {
    const deltas = new Map();
    const add = (id, pts) => {
      if (id == null || !this.scores.has(id) || !pts) return;
      this.scores.set(id, this.scores.get(id) + pts);
      deltas.set(id, (deltas.get(id) || 0) + pts);
    };
    const shirts = this.cur.shirts.map((sid) => this.shirts.get(sid));
    for (const [shopper, list] of this.cur.tags) {
      for (const sid of list) {
        const sh = this.shirts.get(sid);
        if (!sh) continue;
        sh.sales++;
        sh.buyers.push(shopper);
      }
    }
    const top = Math.max(0, ...shirts.map((s) => s.sales));
    for (const sh of shirts) {
      sh.best = top > 0 && sh.sales === top;
      sh.pts = sh.sales * PTS.sale + (sh.best ? PTS.best : 0);
      const team = sh.artist === sh.writer ? [sh.artist] : [sh.artist, sh.writer];
      for (const id of team) add(id, sh.pts);
      if (sh.artist != null && this.stats.has(sh.artist)) {
        this.stats.get(sh.artist).art += sh.sales;
        if (sh.best) this.stats.get(sh.artist).best++;
      }
      if (sh.writer != null && this.stats.has(sh.writer) && sh.writer !== sh.artist) {
        this.stats.get(sh.writer).slogan += sh.sales;
        if (sh.best) this.stats.get(sh.writer).best++;
      }
    }
    // Reveal order: worst seller first, best seller last.
    const fun = (s) => Object.values(s.reacts).reduce((a, b) => a + b, 0);
    this.cur.order = shirts
      .slice()
      .sort((a, b) => a.sales - b.sales || fun(a) - fun(b))
      .map((s) => s.id);
    this.cur.deltas = deltas;
    this.history.push({ no: this.dropNo, shirts: this.cur.shirts.slice(), best: shirts.filter((s) => s.best).map((s) => s.id) });
    const spots = Math.min(3, shirts.length);
    this.setPhase("sales", this.dur("salesBase") + spots * this.dur("salesStep"), now, { n: shirts.length, spots });
  }

  goScores(now) {
    this.setPhase("scores", this.dur("scores"), now, { last: this.dropNo >= this.drops });
  }

  finish(now) {
    this.final = { ranking: this.ranking(), awards: this.awards(), cut: shuffle(this.cut.slice(), this.rng).slice(0, 6) };
    this.setPhase("final", null, now);
  }

  // ---------- results ----------
  ranking() {
    const sold = (id) => {
      const s = this.stats.get(id);
      return s ? s.art + s.slogan : 0;
    };
    const order = this.players.map((p, i) => ({ id: p.id, i }));
    order.sort((a, b) => this.scores.get(b.id) - this.scores.get(a.id) || sold(b.id) - sold(a.id) || a.i - b.i);
    let place = 0;
    let prev = null;
    return order.map((o, idx) => {
      const score = this.scores.get(o.id);
      if (score !== prev) place = idx + 1;
      prev = score;
      return { id: o.id, score, place, sold: sold(o.id), left: this.left.has(o.id) };
    });
  }

  awards() {
    const out = [];
    const all = [...this.shirts.values()];
    const fun = (s) => Object.values(s.reacts).reduce((a, b) => a + b, 0);
    const lol = (s) => (s.reacts.lol || 0) + (s.reacts.dead || 0);
    const bestOf = (list, score) => {
      let top = null;
      for (const x of list) if (score(x) > 0 && (!top || score(x) > score(top))) top = x;
      return top;
    };
    const best = bestOf(all, (s) => (s.sales > 0 ? s.sales * 1000 + fun(s) : 0));
    if (best) out.push({ key: "best", ...AWARDS.best, shirt: best.id, ids: [best.artist, best.writer].filter((x) => x != null) });

    const players = this.players.map((p) => p.id);
    const statTop = (field) => {
      let top = null;
      for (const id of players) {
        const v = this.stats.get(id)[field];
        if (v > 0 && (!top || v > this.stats.get(top)[field])) top = id;
      }
      return top;
    };
    const artist = statTop("art");
    if (artist) out.push({ key: "artist", ...AWARDS.artist, ids: [artist], n: this.stats.get(artist).art });
    const writer = statTop("slogan");
    if (writer) out.push({ key: "writer", ...AWARDS.writer, ids: [writer], n: this.stats.get(writer).slogan });

    const crowd = bestOf(
      all.filter((s) => s !== best),
      (s) => (fun(s) >= 3 ? fun(s) : 0),
    );
    if (crowd) out.push({ key: "crowd", ...AWARDS.crowd, shirt: crowd.id, ids: [crowd.artist, crowd.writer].filter((x) => x != null), n: fun(crowd) });

    const cult = bestOf(
      all.filter((s) => s.sales <= 1 && s !== crowd && s !== best),
      (s) => (lol(s) >= 2 ? lol(s) : 0),
    );
    if (cult) out.push({ key: "cult", ...AWARDS.cult, shirt: cult.id, ids: [cult.artist, cult.writer].filter((x) => x != null) });

    // Dream Team: the artist + writer pair that sold the most together.
    const teams = new Map();
    for (const s of all) {
      if (s.artist == null || s.writer == null || s.artist === s.writer || !s.sales) continue;
      const k = `${s.artist}|${s.writer}`;
      teams.set(k, (teams.get(k) || 0) + s.sales);
    }
    let team = null;
    for (const [k, v] of teams) if (!team || v > team[1]) team = [k, v];
    if (team && team[1] >= 2 && out.length < 6) {
      const ids = team[0].split("|");
      const sameAsBest = best && best.artist === ids[0] && best.writer === ids[1];
      if (!sameAsBest) out.push({ key: "team", ...AWARDS.team, ids, n: team[1] });
    }
    return out;
  }

  // ---------- what each client sees ----------
  shirtView(sh, pid, reveal) {
    const v = { id: sh.id, art: sh.art, bg: sh.bg, slogan: sh.slogan, style: sh.style, drop: sh.drop };
    if (pid != null) {
      const a = sh.artist === pid;
      const w = sh.writer === pid;
      v.mine = a && w ? "both" : a ? "art" : w ? "slogan" : null;
    }
    if (reveal) {
      v.artist = sh.artist;
      v.writer = sh.writer;
      v.sales = sh.sales;
      v.buyers = sh.buyers;
      v.best = sh.best;
      v.pts = sh.pts;
      v.reacts = sh.reacts;
    }
    return v;
  }

  view(pid, now) {
    const ph = this.phase;
    const v = {
      kind: ph.kind,
      drop: this.dropNo,
      drops: this.drops,
      designs: this.designs,
      slogansEach: this.slogansEach,
      pace: this.pace,
      startedAt: ph.startedAt,
      endsAt: ph.endsAt,
      dur: ph.dur,
      scores: Object.fromEntries(this.scores),
    };
    const isPl = this.isPlayer(pid);
    const shirts = (reveal) => this.cur.shirts.map((sid) => this.shirtView(this.shirts.get(sid), pid, reveal));
    switch (ph.kind) {
      case "draw":
        v.prog = this.activeIds().map((id) => ({ id, done: this.cur.drafts.get(id)?.filter((s) => s.locked).length || 0, of: this.designs }));
        if (isPl && this.cur.drafts.has(pid)) v.me = { locked: this.cur.drafts.get(pid).map((s) => s.locked) };
        break;
      case "write":
        v.prog = this.activeIds().map((id) => ({ id, done: this.cur.wrote.has(id) ? 1 : 0, of: 1, n: (this.cur.slogans.get(id) || []).filter(Boolean).length }));
        if (isPl) v.me = { done: this.cur.wrote.has(pid), drew: this.cur.mine.get(pid) || 0 };
        break;
      case "press":
        v.n = this.cur.shirts.length;
        v.shirts = shirts(false);
        break;
      case "runway":
        v.i = ph.i;
        v.n = ph.n;
        v.shirts = shirts(false);
        break;
      case "shop": {
        v.shirts = shirts(false);
        v.tags = ph.tags;
        v.me = { tags: this.cur.tags.get(pid) || [], max: pid != null ? this.maxTags(pid) : 0 };
        const shoppers = this.activeIds().filter((id) => this.maxTags(id) > 0);
        v.shoppers = shoppers;
        v.done = shoppers.filter((id) => this.tagsLeft(id) <= 0);
        v.audienceTags = [...this.cur.tags.keys()].filter((id) => !this.byId.has(id)).length;
        break;
      }
      case "sales":
        v.order = this.cur.order;
        v.shirts = this.cur.order.map((sid) => this.shirtView(this.shirts.get(sid), pid, true));
        v.deltas = Object.fromEntries(this.cur.deltas);
        v.spots = ph.spots;
        break;
      case "scores":
        v.ranking = this.ranking();
        v.deltas = Object.fromEntries(this.cur.deltas);
        v.last = ph.last;
        break;
      case "final": {
        v.ranking = this.final.ranking;
        v.awards = this.final.awards;
        v.lookbook = this.history.map((h) => ({ no: h.no, shirts: h.shirts.map((sid) => this.shirtView(this.shirts.get(sid), pid, true)) }));
        v.cut = this.final.cut;
        break;
      }
    }
    return v;
  }

  // A reloaded phone asks for its own unfinished work back.
  mine(pid) {
    const ph = this.phase;
    if (ph.kind === "draw" && this.cur.drafts.has(pid)) return { kind: "draw", drafts: this.cur.drafts.get(pid).map((s) => ({ art: s.art, locked: s.locked })) };
    if (ph.kind === "write" && this.cur.slogans.has(pid)) return { kind: "write", slogans: this.cur.slogans.get(pid), done: this.cur.wrote.has(pid) };
    return { kind: ph.kind };
  }

  // Every art id a view refers to, so the server can make sure the client has it.
  static artIds(view) {
    const ids = new Set();
    const take = (list) => {
      if (list) for (const s of list) ids.add(s.art);
    };
    take(view.shirts);
    if (view.lookbook) for (const d of view.lookbook) take(d.shirts);
    return ids;
  }
}
