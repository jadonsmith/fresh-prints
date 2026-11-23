# Fresh Prints

A t-shirt party game for 3 to 10 phones, with an optional big screen.
Everyone draws designs and writes slogans. The press slaps every drawing
together with someone else's slogan, at random. Then the room shops the
rack, and every tee a shirt sells pays the artist and the writer.

Live at **https://play.jadon.me/prints/** · big screen at **/prints/?tv**

## A drop

A game is one to three drops (the host picks). Each drop goes:

| Phase | What happens |
| --- | --- |
| **Draw** | Everyone draws one to three t-shirt designs on their phone: brush, eraser, bucket fill, 12 inks, 4 sizes, undo, and a shirt colour to draw on. Stuck? Tap the idea strip for a prompt. |
| **Write** | Everyone writes one more slogan than they drew designs, blind. The dice drops in a starter like "World's okayest ___". |
| **The press** | Every drawing gets one slogan, never its artist's own when that can be avoided. Everyone who wrote something gets printed before anyone gets printed twice, and the same artist and writer don't team up twice in a drop. Each shirt comes off the press in one of eight print styles. |
| **The runway** | The tees walk one at a time. The big screen reads each slogan aloud; phones react. |
| **The shop** | Everyone gets 1 to 3 tags (by rack size) to put on the tees they'd actually buy. You can't tag a shirt with your own work on it. |
| **Sales** | Tags are revealed worst seller first, then the top three. Each tag pays 100 to the artist and 100 to the writer; the drop's best seller pays both of them 250 more. |

The night ends with a podium, awards (Best Seller, Top Designer, Top
Copywriter, Crowd Favourite, Cult Classic, Dream Team), the slogans that
never got printed, and a lookbook where any tee can be saved as an image.

- **Settings:** drops 1–3, designs each 1–3, pace (relaxed, normal, quick), family filter for slogans.
- **The audience:** anyone who joins mid-game, or after ten players, shops too and their tags count. They get a seat next game.
- **Short on content?** Blank drawings are skipped, the house draws if nobody does, and house slogans fill any gap.

## The big screen (`?tv`)

Open `/prints/?tv` on a TV or laptop for the room code and QR code, the
studio while people draw and write, the runway (with a rail of tees that
already walked), the rack, the sales reveal and the finale. It plays a
synthesised lo-fi loop and print-shop sound effects, and reads slogans with
the browser's speech voice. Sound and voice toggle in the top corner.

## Running it

```
npm install
npm start              # http://localhost:3170
```

`PORT` and `HOST` come from the environment. The client opens its WebSocket
at its own directory, so it works under a sub-path like `/prints/`.

## Code

- `game/engine.js`: all the rules, pure and clock-injected, including the pairing (`pairUp`).
- `game/art.js`: validates drawings from phones and doodles the house/bot designs.
- `game/content.js`, `public/js/words.js`: house slogans, drawing ideas, slogan starters, awards.
- `public/js/palette.js`: inks, shirt colours, brush sizes and limits, shared by server and clients.
- `server.js`: static files, rooms, reconnects, host hand-off, rate and byte limits, dev bots, and a personalised view per client. Drawings travel separately: clients ask for the ids they're missing.
- `public/js/sketch.js` (the editor), `art.js` (replay + bucket fill), `shirt.js` (the tee, slogan fitting, PNG export), `phone.js`, `tv.js`.

Drawings are vector ops on a 1000×1000 grid (`[kind, ink, size, x0, y0, …]`),
replayed onto a fixed 720px raster everywhere so a bucket fill lands the same on
every screen.

## Testing

```
npm test                   # engine tests (300 random games) + headless WebSocket sim
node test/bots.js CODE 3   # drop 3 scripted phones into a real room
```

With `?dev` in the URL, the host gets an "Add a bot" button in the lobby.
