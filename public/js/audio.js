// All the sound is synthesised with Web Audio: a lazy lo-fi loop for the
// studio, and print-shop effects (squeegee, till, stamp, hangers).

let ctx = null;
let master = null;
let musicBus = null;
let sfxBus = null;
let muted = false;
let musicOn = false;
let musicTimer = null;
let nextBar = 0;
let bar = 0;
let noiseBuf = null;
let ducked = false;

function ac() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 3;
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.9;
  musicBus = ctx.createGain();
  musicBus.gain.value = 0.32;
  sfxBus = ctx.createGain();
  sfxBus.gain.value = 0.75;
  musicBus.connect(master);
  sfxBus.connect(master);
  master.connect(comp);
  comp.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

function noise(t, dur, { type = "bandpass", f = 1200, f2 = null, q = 1, gain = 0.4, bus = sfxBus, attack = 0.004 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const flt = ctx.createBiquadFilter();
  flt.type = type;
  flt.frequency.setValueAtTime(f, t);
  if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t + dur);
  flt.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(flt);
  flt.connect(g);
  g.connect(bus);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.05);
}

function tone(t, freq, dur, { type = "sine", gain = 0.2, bus = sfxBus, attack = 0.006, slide = null, detune = 0 } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  o.detune.value = detune;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(bus);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// ---------- the loop: 84 bpm, four chords, soft keys, a dusty beat ----------
const BPM = 84;
const BEAT = 60 / BPM;
const CHORDS = [
  [57, 60, 64, 67, 71], // Am9-ish
  [53, 57, 60, 64, 67], // Fmaj9
  [55, 59, 62, 65, 69], // G9
  [52, 55, 59, 62, 67], // Em7
];
const BASS = [45, 41, 43, 40];
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

function keys(t, notes, dur) {
  notes.forEach((m, i) => {
    const at = t + i * 0.012;
    tone(at, mtof(m), dur, { type: "triangle", gain: 0.045, bus: musicBus, attack: 0.02 });
    tone(at, mtof(m + 12), dur * 0.6, { type: "sine", gain: 0.018, bus: musicBus, attack: 0.01, detune: 6 });
  });
}

function scheduleBar(t, n) {
  const c = n % 4;
  keys(t, CHORDS[c], BEAT * 3.6);
  if (n % 2 === 1) keys(t + BEAT * 2.5, CHORDS[c].slice(1, 4), BEAT * 1.2);
  tone(t, mtof(BASS[c]), BEAT * 1.8, { type: "sine", gain: 0.16, bus: musicBus, attack: 0.02 });
  tone(t + BEAT * 2.5, mtof(BASS[c] + 7), BEAT * 0.9, { type: "sine", gain: 0.1, bus: musicBus, attack: 0.02 });
  for (let b = 0; b < 4; b++) {
    const bt = t + b * BEAT;
    if (b === 0 || b === 2) tone(bt, 110, 0.28, { gain: 0.22, bus: musicBus, slide: 42, attack: 0.003 });
    if (b === 1 || b === 3) noise(bt, 0.16, { f: 1800, q: 0.8, gain: 0.07, bus: musicBus });
    noise(bt + BEAT * 0.5 + (b % 2) * 0.03, 0.05, { type: "highpass", f: 7000, gain: 0.03, bus: musicBus });
    noise(bt, 0.04, { type: "highpass", f: 8000, gain: 0.025, bus: musicBus });
  }
  // vinyl dust
  for (let k = 0; k < 6; k++) noise(t + Math.random() * BEAT * 4, 0.01, { type: "highpass", f: 3000, gain: 0.03 * Math.random(), bus: musicBus, attack: 0.001 });
}

function musicTick() {
  if (!musicOn || !ctx) return;
  while (nextBar < ctx.currentTime + 0.6) {
    scheduleBar(nextBar, bar++);
    nextBar += BEAT * 4;
  }
}

export const audio = {
  unlock() {
    const c = ac();
    if (c && c.state === "suspended") c.resume().catch(() => {});
  },
  get ready() {
    return !!ctx && ctx.state === "running";
  },
  setMuted(m) {
    muted = !!m;
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.05);
  },
  get muted() {
    return muted;
  },
  music(on) {
    if (on === musicOn) return;
    musicOn = on;
    if (!ac()) return;
    if (on) {
      nextBar = ctx.currentTime + 0.1;
      musicBus.gain.cancelScheduledValues(ctx.currentTime);
      musicBus.gain.setValueAtTime(0.0001, ctx.currentTime);
      musicBus.gain.exponentialRampToValueAtTime(ducked ? 0.12 : 0.32, ctx.currentTime + 1.2);
      clearInterval(musicTimer);
      musicTimer = setInterval(musicTick, 150);
      musicTick();
    } else {
      musicBus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
      setTimeout(() => {
        if (!musicOn) clearInterval(musicTimer);
      }, 1500);
    }
  },
  duck(on) {
    ducked = on;
    if (!ctx || !musicOn) return;
    musicBus.gain.setTargetAtTime(on ? 0.12 : 0.32, ctx.currentTime, 0.2);
  },
  play(name) {
    if (!ac() || muted || ctx.state !== "running") return;
    const t = ctx.currentTime + 0.01;
    switch (name) {
      case "tap":
        tone(t, 880, 0.05, { type: "triangle", gain: 0.08 });
        break;
      case "join":
        tone(t, 660, 0.09, { type: "triangle", gain: 0.12 });
        tone(t + 0.07, 990, 0.12, { type: "triangle", gain: 0.1 });
        break;
      case "squeegee": // a pull across the screen
        noise(t, 0.75, { f: 500, f2: 2600, q: 2.5, gain: 0.32, attack: 0.08 });
        noise(t + 0.05, 0.6, { type: "lowpass", f: 300, gain: 0.14, attack: 0.1 });
        break;
      case "whoosh":
        noise(t, 0.45, { f: 300, f2: 1800, q: 1.2, gain: 0.18, attack: 0.12 });
        break;
      case "hanger": // a hanger sliding on the rail
        noise(t, 0.3, { type: "highpass", f: 2500, gain: 0.08, attack: 0.05 });
        tone(t + 0.22, 1760, 0.18, { type: "sine", gain: 0.05 });
        tone(t + 0.24, 2349, 0.14, { type: "sine", gain: 0.03 });
        break;
      case "tag":
        tone(t, 1320, 0.07, { type: "square", gain: 0.04 });
        tone(t + 0.06, 1760, 0.12, { type: "triangle", gain: 0.08 });
        break;
      case "kaching": // the till
        noise(t, 0.08, { type: "highpass", f: 3000, gain: 0.2 });
        [2093, 2637, 3136].forEach((f, i) => tone(t + 0.05 + i * 0.015, f, 0.9, { type: "sine", gain: 0.1 - i * 0.02 }));
        tone(t + 0.05, 4186, 0.4, { type: "sine", gain: 0.03 });
        break;
      case "stamp":
        tone(t, 140, 0.22, { gain: 0.35, slide: 50, attack: 0.002 });
        noise(t, 0.12, { type: "lowpass", f: 900, gain: 0.35, attack: 0.002 });
        break;
      case "pop":
        tone(t, 520, 0.08, { type: "sine", gain: 0.1, slide: 980 });
        break;
      case "tick":
        tone(t, 1500, 0.03, { type: "square", gain: 0.03 });
        break;
      case "bell": // time's up
        [1046, 1568].forEach((f) => tone(t, f, 1.2, { type: "sine", gain: 0.12 }));
        break;
      case "fanfare":
        [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.12, f, 0.5 + (i === 3 ? 0.7 : 0), { type: "triangle", gain: 0.12 }));
        [1047, 1319, 1568].forEach((f) => tone(t + 0.48, f, 1.4, { type: "sine", gain: 0.05 }));
        noise(t + 0.48, 1.2, { type: "highpass", f: 6000, gain: 0.04, attack: 0.05 });
        break;
      case "drum": // a little roll before the big reveal
        for (let i = 0; i < 14; i++) noise(t + i * 0.06, 0.07, { f: 260 + i * 12, q: 0.9, gain: 0.08 + i * 0.012 });
        break;
      case "sad":
        tone(t, 392, 0.3, { type: "triangle", gain: 0.08, slide: 370 });
        tone(t + 0.28, 330, 0.5, { type: "triangle", gain: 0.08, slide: 300 });
        break;
    }
  },
};
