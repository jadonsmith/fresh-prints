// Fill a real room with scripted phones, for testing on your own:
//   node test/bots.js CODE 3                      (local server on :3170)
//   node test/bots.js CODE 3 wss://play.jadon.me/prints/

import { botPhone } from "./botclient.js";

const [code, n = "3", url = "ws://127.0.0.1:3170/"] = process.argv.slice(2);
if (!code) {
  console.log("usage: node test/bots.js CODE [count] [ws-url]");
  process.exit(1);
}
const NAMES = ["Botley", "Stitch", "Hemline", "Bobbin", "Sprocket", "Widget", "Rusty", "Beep", "Sir Seams"];
const bots = [];
for (let i = 0; i < Math.min(9, Number(n) || 3); i++) {
  bots.push(
    botPhone(url, {
      code: code.toUpperCase(),
      name: NAMES[i],
      pace: 6, // human-ish speed
      onMsg: (m) => {
        if (m.t === "error") console.log(`${NAMES[i]}: ${m.msg}`);
        if (m.t === "joined") console.log(`${NAMES[i]} joined ${m.code}`);
      },
    }),
  );
}
process.on("SIGINT", () => {
  for (const b of bots) b.drop();
  process.exit(0);
});
