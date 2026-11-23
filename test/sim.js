// Headless end-to-end run: starts the real server (sped up), puts four scripted
// phones and a big screen in a room, plays a two-drop game to the final, and
// checks what everyone saw along the way.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { botPhone } from "./botclient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3900 + Math.floor(Math.random() * 90);
const URL = `ws://127.0.0.1:${PORT}/`;

const server = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
  env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", TIME_SCALE: "0.05" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverErr = "";
server.stderr.on("data", (d) => (serverErr += d));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 20000, what = "condition") {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return;
    await wait(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function fail(e) {
  console.error("sim FAILED:", e && e.stack ? e.stack : e);
  if (serverErr) console.error("server stderr:\n" + serverErr);
  server.kill();
  process.exit(1);
}

async function main() {
  await new Promise((res, rej) => {
    server.stdout.on("data", (d) => String(d).includes("Fresh Prints on") && res());
    server.on("exit", (c) => rej(new Error("server exited " + c)));
    setTimeout(() => rej(new Error("server didn't start")), 8000);
  });

  // static files + health
  const page = await fetch(`http://127.0.0.1:${PORT}/`);
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes("Fresh Prints"));
  assert.ok(page.headers.get("content-security-policy").includes("default-src 'self'"));
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/vendor/qrcode.js`)).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/../server.js`)).status, 404);
  assert.match(await (await fetch(`http://127.0.0.1:${PORT}/healthz`)).text(), /^ok/);

  const kinds = new Set();
  const host = botPhone(URL, { name: "Hosty", create: true, onState: (m) => m.game && kinds.add(m.game.kind) });
  await until(() => host.code, 5000, "room code");
  const others = ["Ana", "Bo", "Cy"].map((name) => botPhone(URL, { code: host.code, name }));
  await until(() => host.state && host.state.players.length === 4, 5000, "four players");

  // a big screen watching the room
  const tvStates = [];
  const tvArts = new Map();
  const tv = new WebSocket(URL);
  tv.on("open", () => tv.send(JSON.stringify({ t: "watch", code: host.code })));
  tv.on("message", (d) => {
    const m = JSON.parse(d.toString());
    if (m.t === "state") {
      tvStates.push(m);
      const ids = [];
      if (m.game && m.game.shirts) for (const s of m.game.shirts) if (!tvArts.has(s.art)) ids.push(s.art);
      if (ids.length) tv.send(JSON.stringify({ t: "getArt", ids }));
    }
    if (m.t === "art") tvArts.set(m.id, m.art);
  });
  await until(() => tvStates.length > 0, 5000, "tv state");
  assert.equal(tvStates.at(-1).role, "display");

  // only the host can change settings or start
  others[0].send({ t: "settings", settings: { drops: 3 } });
  host.send({ t: "settings", settings: { drops: 2, designs: 2, pace: "quick", family: true } });
  await until(() => host.state.settings.pace === "quick", 3000, "settings");
  assert.equal(host.state.settings.drops, 2);
  others[0].send({ t: "start" });
  await wait(150);
  assert.equal(host.state.game, null, "non-host can't start");

  // one player drops mid-draw and comes back with their token
  let dropped = false;
  const cy = others[2];
  host.send({ t: "start" });
  await until(() => host.state.game && host.state.game.kind === "draw", 5000, "draw phase");
  cy.drop();
  dropped = true;
  await wait(200);
  cy.reconnect();
  await until(() => cy.mine && cy.mine.kind === "draw", 5000, "drafts back after resume");

  await until(() => host.state.game && host.state.game.kind === "final", 60000, "final");
  assert.ok(dropped);
  for (const k of ["intro", "draw", "write", "press", "runway", "shop", "sales", "scores", "final"]) assert.ok(kinds.has(k), `host saw ${k}`);

  const g = host.state.game;
  assert.equal(g.lookbook.length, 2);
  for (const d of g.lookbook) {
    assert.equal(d.shirts.length, 8, "4 players x 2 designs");
    for (const s of d.shirts) {
      assert.notEqual(s.artist, s.writer, "nobody prints their own slogan on their own drawing");
      assert.ok(typeof s.slogan === "string" && s.slogan.length);
      assert.ok(Number.isInteger(s.sales));
    }
  }
  const paid = g.lookbook.flatMap((d) => d.shirts).reduce((a, s) => a + s.pts * 2, 0);
  const total = Object.values(g.scores).reduce((a, b) => a + b, 0);
  assert.equal(total, paid, "scores add up to what the shirts paid");
  assert.ok(g.ranking.length === 4 && g.ranking[0].score >= g.ranking[3].score);

  // the TV saw shirts and fetched their drawings
  const tvShirts = new Set(tvStates.flatMap((m) => (m.game && m.game.shirts ? m.game.shirts.map((s) => s.art) : [])));
  await until(() => [...tvShirts].every((id) => tvArts.has(id)), 5000, "tv arts");
  for (const a of tvArts.values()) assert.ok(Array.isArray(a.ops) && Number.isInteger(a.bg));
  // and never saw who made what before the sales
  for (const m of tvStates) {
    const gg = m.game;
    if (gg && ["press", "runway", "shop"].includes(gg.kind)) for (const s of gg.shirts) assert.equal(s.artist, undefined);
  }

  // back to the lobby, everyone still seated
  host.send({ t: "endGame" });
  await until(() => host.state.game === null, 3000, "lobby");
  assert.equal(host.state.players.length, 4);
  assert.ok(host.state.last && host.state.last.name);

  // junk is ignored, not fatal
  host.ws.send("not json");
  host.send({ t: "sketch", slot: 0, art: { ops: [[9, 9, 9]] }, done: true });
  host.send({ t: "getArt", ids: "nope" });
  await wait(100);
  assert.equal(server.exitCode, null, "server still up");

  console.log(`sim ok: room ${host.code}, ${tvArts.size} drawings, phases ${[...kinds].join(" > ")}`);
  for (const b of [host, ...others]) b.drop();
  tv.terminate();
  server.kill();
  process.exit(0);
}

main().catch(fail);
