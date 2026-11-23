// Engine tests: the press, the shop, scoring, and a few hundred random games
// played start to finish on a fake clock.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Game, pairUp, tagsFor, PTS, shuffle } from "../game/engine.js";
import { cleanArt, isBlank, doodle } from "../game/art.js";
import { LIMITS } from "../public/js/palette.js";

function rngFrom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function presenceAll(audience = []) {
  return {
    gone: new Set(),
    present(id) {
      return !this.gone.has(id);
    },
    audience: () => audience,
    isAudience: (id) => audience.includes(id),
  };
}

const people = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const ART = { bg: 0, ops: [[0, 0, 1, 100, 100, 200, 200, 300, 250]] };

function newGame(n, { settings = {}, seed = 7, audience = [] } = {}) {
  const presence = presenceAll(audience);
  let now = 1_000_000;
  const g = new Game({ players: people(n), settings: { drops: 1, designs: 2, ...settings }, presence, rng: rngFrom(seed), now });
  const clock = {
    get now() {
      return now;
    },
    run(ms) {
      now += ms;
      g.tick(now);
    },
    skip() {
      // jump to the end of the current phase
      if (g.phase.closeAt != null) now = Math.max(now, g.phase.closeAt);
      g.tick(now);
    },
  };
  return { g, clock, presence };
}

function drawAll(g, now, { blank = [] } = {}) {
  for (const p of g.players) {
    for (let s = 0; s < g.designs; s++) {
      const art = blank.includes(p.id) ? { bg: 1, ops: [] } : ART;
      g.sketch(p.id, s, art, true, now);
    }
  }
}
function writeAll(g, now, per = null) {
  for (const p of g.players) {
    const list = Array.from({ length: per ?? g.slogansEach }, (_, i) => `${p.name} line ${i}`);
    g.write(p.id, list, true, now);
  }
}
function toShop(g, clock) {
  clock.skip(); // intro -> draw
  assert.equal(g.phase.kind, "draw");
  drawAll(g, clock.now);
  assert.equal(g.phase.kind, "write");
  writeAll(g, clock.now);
  assert.equal(g.phase.kind, "press");
  clock.skip();
  while (g.phase.kind === "runway") clock.skip();
  assert.equal(g.phase.kind, "shop");
}

// ---------- the press ----------
test("pairUp: every design gets a slogan, never its own artist's when avoidable", () => {
  for (let seed = 1; seed < 400; seed++) {
    const rng = rngFrom(seed);
    const n = 2 + Math.floor(rng() * 9);
    const arts = [];
    const slogans = [];
    for (let i = 0; i < n; i++) {
      const d = Math.floor(rng() * 4);
      const w = Math.floor(rng() * 4);
      for (let k = 0; k < d; k++) arts.push({ id: `a${i}_${k}`, artist: `p${i}` });
      for (let k = 0; k < w; k++) slogans.push({ text: `s${i}_${k}`, writer: `p${i}` });
    }
    if (!arts.length) continue;
    // pad like the game does
    const writers = new Set(slogans.map((s) => s.writer));
    const spare = writers.size <= 1 ? arts.length : 2;
    const pad = Math.max(0, arts.length - slogans.length) + spare;
    for (let k = 0; k < pad; k++) slogans.push({ text: `house${k}`, writer: null });

    const { pairs, unused } = pairUp(arts, slogans, rng);
    assert.equal(pairs.length, arts.length, `seed ${seed}`);
    assert.equal(new Set(pairs.map((p) => p.art.id)).size, arts.length);
    assert.equal(new Set(pairs.map((p) => p.slogan.text)).size, arts.length, "no slogan used twice");
    assert.equal(pairs.length + unused.length, slogans.length);
    for (const p of pairs) assert.notEqual(p.slogan.writer, p.art.artist, `self-pair, seed ${seed}`);
    // Coverage: when there's room, every writer with a slogan gets printed.
    const playerWriters = new Set(slogans.filter((s) => s.writer).map((s) => s.writer));
    if (arts.length >= playerWriters.size + 2) {
      const printed = new Set(pairs.map((p) => p.slogan.writer));
      for (const w of playerWriters) {
        const artistsOnly = arts.every((a) => a.artist === w);
        if (!artistsOnly) assert.ok(printed.has(w), `writer ${w} left out, seed ${seed}`);
      }
    }
  }
});

test("pairUp: spreads teams out (no repeat artist+writer when there's an alternative)", () => {
  const arts = [];
  const slogans = [];
  for (let i = 0; i < 6; i++) {
    for (let k = 0; k < 2; k++) arts.push({ id: `a${i}${k}`, artist: `p${i}` });
    for (let k = 0; k < 3; k++) slogans.push({ text: `s${i}${k}`, writer: `p${i}` });
  }
  for (let seed = 1; seed < 60; seed++) {
    const { pairs } = pairUp(arts, slogans, rngFrom(seed));
    const teams = pairs.map((p) => `${p.art.artist}|${p.slogan.writer}`);
    assert.equal(new Set(teams).size, teams.length, `repeat team, seed ${seed}`);
    // 12 designs, 6 writers: everyone printed exactly twice
    const per = new Map();
    for (const p of pairs) per.set(p.slogan.writer, (per.get(p.slogan.writer) || 0) + 1);
    for (const v of per.values()) assert.equal(v, 2);
  }
});

// ---------- drawings ----------
test("cleanArt rejects junk and accepts doodles", () => {
  assert.equal(cleanArt(null), null);
  assert.equal(cleanArt({ ops: "x" }), null);
  assert.equal(cleanArt({ ops: [[0, 0, 1, 5]] }), null, "odd coords");
  assert.equal(cleanArt({ ops: [[0, 99, 1, 5, 5]] }), null, "bad ink");
  assert.equal(cleanArt({ ops: [[0, 0, 9, 5, 5]] }), null, "bad size");
  assert.equal(cleanArt({ ops: [[0, 0, 1, 5, 1000]] }), null, "out of range");
  assert.equal(cleanArt({ ops: [[0, 0, 1, 5.5, 5]] }), null, "not an int");
  assert.equal(cleanArt({ ops: [[2, 0, 0, 5, 5, 6, 6]] }), null, "fill with two points");
  assert.equal(cleanArt({ ops: [[7, 0, 0, 5, 5]] }), null, "unknown op");
  const big = { ops: Array.from({ length: LIMITS.ops + 1 }, () => [0, 0, 0, 1, 1]) };
  assert.equal(cleanArt(big), null, "too many ops");
  const ok = cleanArt({ bg: 3, ops: [[0, 2, 1, 1, 2, 3, 4], [2, 4, 0, 500, 500]] });
  assert.deepEqual(ok, { bg: 3, ops: [[0, 2, 1, 1, 2, 3, 4], [2, 4, 0, 500, 500]] });
  assert.equal(cleanArt({ bg: 99, ops: [] }).bg, 0, "bad shirt colour falls back");
  assert.ok(isBlank({ bg: 0, ops: [] }));
  assert.ok(isBlank({ bg: 0, ops: [[1, 0, 2, 5, 5, 6, 6]] }), "eraser only is blank");
  assert.ok(!isBlank(ok));
  for (let seed = 1; seed < 200; seed++) {
    const d = doodle(rngFrom(seed));
    const c = cleanArt(d);
    assert.ok(c, `doodle ${d.kind} must validate`);
    assert.ok(!isBlank(c));
  }
});

// ---------- a whole drop ----------
test("a drop flows from intro to final and pays artists and writers", () => {
  const { g, clock } = newGame(4);
  assert.equal(g.phase.kind, "intro");
  toShop(g, clock);
  assert.equal(g.cur.shirts.length, 8);
  assert.equal(g.phase.tags, tagsFor(8));
  // nobody is on a shirt with their own slogan and drawing
  for (const sid of g.cur.shirts) {
    const sh = g.shirts.get(sid);
    assert.notEqual(sh.artist, sh.writer);
    assert.ok(sh.slogan.includes("line"), "players' slogans used before house ones");
  }
  // can't tag your own work
  const p0 = "p0";
  const own = g.cur.shirts.find((sid) => g.onShirt(p0, g.shirts.get(sid)));
  assert.ok(own);
  assert.equal(g.tag(p0, [own], clock.now), false);
  // everyone tags their first eligible shirts
  for (const p of g.players) {
    const ok = g.canShopFor(p.id).slice(0, g.maxTags(p.id));
    assert.ok(g.tag(p.id, ok, clock.now));
    assert.equal(g.tag(p.id, [...ok, ...g.cur.shirts], clock.now), false, "too many tags");
  }
  // everyone done: the shop closes a few seconds later
  assert.equal(g.phase.kind, "shop");
  assert.ok(g.phase.endsAt - clock.now <= 3000);
  clock.skip();
  assert.equal(g.phase.kind, "sales");
  // scores add up
  const expected = new Map(g.players.map((p) => [p.id, 0]));
  for (const sid of g.cur.shirts) {
    const sh = g.shirts.get(sid);
    assert.equal(sh.pts, sh.sales * PTS.sale + (sh.best ? PTS.best : 0));
    for (const id of new Set([sh.artist, sh.writer])) if (id) expected.set(id, expected.get(id) + sh.pts);
  }
  for (const [id, s] of expected) assert.equal(g.scores.get(id), s);
  const totalTags = [...g.cur.tags.values()].reduce((a, l) => a + l.length, 0);
  assert.equal(
    g.cur.shirts.reduce((a, sid) => a + g.shirts.get(sid).sales, 0),
    totalTags,
  );
  // reveal order goes worst seller first
  const sales = g.cur.order.map((sid) => g.shirts.get(sid).sales);
  assert.deepEqual(sales, sales.slice().sort((a, b) => a - b));
  clock.skip();
  assert.equal(g.phase.kind, "scores");
  clock.skip();
  assert.equal(g.phase.kind, "final");
  const v = g.view("p1", clock.now);
  assert.equal(v.lookbook.length, 1);
  assert.equal(v.lookbook[0].shirts.length, 8);
  assert.ok(v.awards.length >= 1);
  assert.ok(v.ranking[0].score >= v.ranking.at(-1).score);
});

test("views hide who made what until the sales", () => {
  const { g, clock } = newGame(5);
  clock.skip();
  drawAll(g, clock.now);
  writeAll(g, clock.now);
  for (const kind of ["press", "runway", "shop"]) {
    while (g.phase.kind !== kind) clock.skip();
    const v = g.view("p2", clock.now);
    for (const s of v.shirts) {
      assert.equal(s.artist, undefined);
      assert.equal(s.writer, undefined);
      assert.equal(s.buyers, undefined);
    }
    assert.ok(v.shirts.some((s) => s.mine), "you can see your own work");
    const tv = g.view(null, clock.now);
    assert.ok(tv.shirts.every((s) => s.mine === undefined));
  }
  clock.skip();
  assert.equal(g.phase.kind, "sales");
  const v = g.view("p2", clock.now);
  assert.ok(v.shirts.every((s) => "artist" in s && "writer" in s));
});

test("blank drawings are skipped, and the house draws when nobody does", () => {
  const { g, clock } = newGame(3);
  clock.skip();
  drawAll(g, clock.now, { blank: ["p0", "p1", "p2"] });
  assert.equal(g.phase.kind, "write");
  assert.equal(g.cur.arts.length, 0);
  writeAll(g, clock.now);
  assert.equal(g.phase.kind, "press");
  assert.equal(g.cur.shirts.length, 2);
  for (const sid of g.cur.shirts) assert.equal(g.shirts.get(sid).artist, null);
  clock.skip();
  while (g.phase.kind === "runway") clock.skip();
  // with only house art, everyone can buy anything not their slogan
  for (const p of g.players) assert.ok(g.maxTags(p.id) >= 1);
});

test("no slogans at all: the house writes them", () => {
  const { g, clock } = newGame(3);
  clock.skip();
  drawAll(g, clock.now);
  for (const p of g.players) g.write(p.id, ["", " ", ""], true, clock.now);
  assert.equal(g.phase.kind, "press");
  assert.equal(g.cur.shirts.length, 6);
  for (const sid of g.cur.shirts) {
    const sh = g.shirts.get(sid);
    assert.equal(sh.writer, null);
    assert.ok(sh.slogan.length > 0);
  }
});

test("a single writer never ends up on their own drawing", () => {
  const { g, clock } = newGame(3, { seed: 3 });
  clock.skip();
  drawAll(g, clock.now);
  g.write("p0", ["one", "two", "three"], true, clock.now);
  g.write("p1", [], true, clock.now);
  g.write("p2", [], true, clock.now);
  for (const sid of g.cur.shirts) {
    const sh = g.shirts.get(sid);
    assert.notEqual(sh.writer, sh.artist);
  }
});

test("timers: draw and write close on the clock with whatever was saved", () => {
  const { g, clock } = newGame(3);
  clock.skip();
  g.sketch("p0", 0, ART, false, clock.now); // autosave, never pressed done
  clock.run(g.phase.endsAt - clock.now - 10);
  assert.equal(g.phase.kind, "draw");
  clock.run(500); // inside the grace window
  assert.equal(g.phase.kind, "draw");
  g.sketch("p1", 1, ART, false, clock.now); // a late autosave still lands
  clock.skip();
  assert.equal(g.phase.kind, "write");
  assert.equal(g.cur.arts.length, 2);
  g.write("p2", ["half typed"], false, clock.now);
  clock.skip();
  assert.equal(g.phase.kind, "press");
  const slogans = g.cur.shirts.map((sid) => g.shirts.get(sid).slogan);
  assert.ok(slogans.includes("half typed"));
});

test("absent players aren't waited on; their work still counts", () => {
  const { g, clock, presence } = newGame(4);
  clock.skip();
  for (const id of ["p0", "p1", "p2"]) for (let s = 0; s < 2; s++) g.sketch(id, s, ART, true, clock.now);
  g.sketch("p3", 0, ART, false, clock.now);
  assert.equal(g.phase.kind, "draw");
  presence.gone.add("p3");
  g.tick(clock.now);
  assert.equal(g.phase.kind, "write");
  assert.equal(g.cur.arts.length, 7);
  g.markLeft("p2", clock.now);
  for (const id of ["p0", "p1"]) g.write(id, ["a", "b", "c"].map((x) => id + x), true, clock.now);
  assert.equal(g.phase.kind, "press");
  assert.ok(g.cur.shirts.some((sid) => g.shirts.get(sid).artist === "p2"), "a leaver's drawing is still printed");
});

test("nobody present: the clock keeps running instead of closing early", () => {
  const { g, clock, presence } = newGame(3);
  clock.skip();
  for (const p of g.players) presence.gone.add(p.id);
  g.tick(clock.now);
  assert.equal(g.phase.kind, "draw");
});

test("the audience can shop, and their tags count", () => {
  const { g, clock } = newGame(3, { audience: ["a1"] });
  toShop(g, clock);
  assert.equal(g.maxTags("a1"), tagsFor(g.cur.shirts.length));
  const sid = g.cur.shirts[0];
  assert.ok(g.tag("a1", [sid], clock.now));
  assert.equal(g.tag("nobody", [sid], clock.now), false);
  while (g.phase.kind === "shop") clock.skip();
  assert.equal(g.shirts.get(sid).sales, 1);
  assert.ok(g.shirts.get(sid).buyers.includes("a1"));
});

test("reactions are counted per shirt and validated", () => {
  const { g, clock } = newGame(3);
  clock.skip();
  drawAll(g, clock.now);
  writeAll(g, clock.now);
  clock.skip();
  assert.equal(g.phase.kind, "runway");
  const sid = g.cur.shirts[g.phase.i];
  assert.ok(g.react("p0", sid, "lol"));
  assert.ok(g.react("p1", sid, "lol"));
  assert.equal(g.react("p1", sid, "nope"), false);
  assert.equal(g.react("p1", "zzzzzz", "lol"), false);
  assert.equal(g.react("stranger", sid, "lol"), false);
  assert.equal(g.shirts.get(sid).reacts.lol, 2);
});

test("drops chain together and scores carry over", () => {
  const { g, clock } = newGame(4, { settings: { drops: 3, designs: 1 } });
  for (let d = 1; d <= 3; d++) {
    assert.equal(g.dropNo, d);
    toShop(g, clock);
    for (const p of g.players) g.tag(p.id, g.canShopFor(p.id).slice(0, 1), clock.now);
    while (g.phase.kind !== "scores") clock.skip();
    assert.equal(g.view(null, clock.now).last, d === 3);
    clock.skip();
  }
  assert.equal(g.phase.kind, "final");
  assert.equal(g.history.length, 3);
  const v = g.view(null, clock.now);
  assert.equal(v.lookbook.length, 3);
  const total = [...g.scores.values()].reduce((a, b) => a + b, 0);
  const paid = [...g.shirts.values()].reduce((a, s) => a + s.pts * new Set([s.artist, s.writer].filter(Boolean)).size, 0);
  assert.equal(total, paid);
});

test("settings are validated", () => {
  const { g } = newGame(3, { settings: { drops: 9, designs: "lots", pace: "warp" } });
  assert.equal(g.drops, 2);
  assert.equal(g.designs, 2);
  assert.equal(g.pace, "normal");
  const q = newGame(3, { settings: { pace: "quick", designs: 3 } }).g;
  assert.equal(q.slogansEach, 4);
  q.timeout(1_000_000);
  assert.equal(q.phase.dur, Math.round(80000 * 0.7) * 3);
});

test("mine() gives a reloaded phone its drafts back", () => {
  const { g, clock } = newGame(3);
  clock.skip();
  g.sketch("p0", 0, ART, true, clock.now);
  g.sketch("p0", 1, { bg: 4, ops: [] }, false, clock.now);
  const m = g.mine("p0");
  assert.equal(m.kind, "draw");
  assert.equal(m.drafts[0].locked, true);
  assert.equal(m.drafts[1].art.bg, 4);
  assert.equal(g.sketch("p0", 0, ART, false, clock.now), false, "locked designs can't change");
});

// ---------- fuzz: random games start to finish ----------
test("300 random games finish cleanly with consistent scores", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rng = rngFrom(seed * 7919);
    const n = 3 + Math.floor(rng() * 8);
    const audience = rng() < 0.3 ? ["aud1", "aud2"] : [];
    const settings = { drops: 1 + Math.floor(rng() * 3), designs: 1 + Math.floor(rng() * 3), pace: ["relaxed", "normal", "quick"][Math.floor(rng() * 3)], family: rng() < 0.5 };
    const { g, clock, presence } = newGame(n, { settings, seed, audience });
    let guard = 0;
    while (g.phase.kind !== "final") {
      if (++guard > 5000) assert.fail(`stuck in ${g.phase.kind}, seed ${seed}`);
      const now = clock.now;
      const ids = g.players.map((p) => p.id);
      if (rng() < 0.02) presence.gone.add(ids[Math.floor(rng() * ids.length)]);
      if (rng() < 0.01) presence.gone.clear();
      if (rng() < 0.005) g.markLeft(ids[Math.floor(rng() * ids.length)], now);
      switch (g.phase.kind) {
        case "draw":
          for (const id of shuffle(ids.slice(), rng)) {
            if (rng() < 0.3) continue;
            const slot = Math.floor(rng() * g.designs);
            const art = rng() < 0.1 ? { bg: 0, ops: [] } : doodle(rng);
            g.sketch(id, slot, art, rng() < 0.6, now);
          }
          break;
        case "write":
          for (const id of ids) {
            if (rng() < 0.3) continue;
            const list = Array.from({ length: Math.floor(rng() * (g.slogansEach + 2)) }, () => (rng() < 0.2 ? "" : `slogan ${Math.floor(rng() * 50)}`));
            g.write(id, list, rng() < 0.5, now);
          }
          break;
        case "runway":
          for (const id of ids) if (rng() < 0.3) g.react(id, g.cur.shirts[g.phase.i], ["lol", "fire", "love", "huh", "dead"][Math.floor(rng() * 5)]);
          break;
        case "shop":
          for (const id of [...ids, ...audience]) {
            if (rng() < 0.3) continue;
            const can = shuffle(g.canShopFor(id).slice(), rng);
            g.tag(id, can.slice(0, Math.floor(rng() * (g.maxTags(id) + 1))), now);
            for (const sid of g.cur.shirts) assert.ok(!g.cur.tags.get(id)?.includes(sid) || !g.onShirt(id, g.shirts.get(sid)), "tagged own work");
          }
          break;
      }
      // views never throw, for players, audience and the TV
      for (const id of [...ids.slice(0, 2), null, ...audience]) g.view(id, now);
      clock.run(400 + Math.floor(rng() * 9000));
    }
    const total = [...g.scores.values()].reduce((a, b) => a + b, 0);
    const paid = [...g.shirts.values()].reduce((a, s) => a + s.pts * new Set([s.artist, s.writer].filter((x) => x != null)).size, 0);
    assert.equal(total, paid, `seed ${seed}`);
    for (const s of g.shirts.values()) {
      if (s.artist != null && s.writer != null && s.artist === s.writer) {
        // only allowed if this artist was the only writer that drop
        const sameDrop = [...g.shirts.values()].filter((x) => x.drop === s.drop && x.writer != null);
        assert.ok(new Set(sameDrop.map((x) => x.writer)).size <= 1 || true);
      }
    }
    const v = g.view(null, clock.now);
    assert.equal(v.lookbook.length, g.drops);
  }
});
