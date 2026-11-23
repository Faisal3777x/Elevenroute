// Synthesizes the game's sound effects as small WAV files in assets/sfx.
// Everything is made from plain tones and noise here, so the sounds are the project's own.
// Run: node scripts/make-sfx.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

const RATE = 22050;
const out = new URL('../assets/sfx/', import.meta.url);
mkdirSync(out, { recursive: true });

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767 * 0.8), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const sin = (p) => Math.sin(2 * Math.PI * p);
const tri = (p) => 1 - 4 * Math.abs(Math.round(p - 0.25) - (p - 0.25));
const sq = (p) => (p % 1 < 0.5 ? 0.6 : -0.6);

/** Render `secs` of sound from f(t) -> sample. */
const render = (secs, f) => Array.from({ length: Math.floor(secs * RATE) }, (_, i) => f(i / RATE));
/** A note with a quick attack and exponential decay; frequency may be a function of time. */
function note(t, start, len, freq, wave = sin, decay = 6) {
  const u = t - start;
  if (u < 0 || u > len) return 0;
  const env = Math.min(1, u / 0.005) * Math.exp(-decay * u);
  const f = typeof freq === 'function' ? freq(u) : freq;
  return wave(f * u) * env;
}
let seed = 7;
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

const sounds = {
  coin: render(0.28, (t) => 0.5 * note(t, 0, 0.08, 1320, sq, 25) + 0.5 * note(t, 0.07, 0.2, 1760, sq, 14)),
  ding: render(0.8, (t) => 0.6 * note(t, 0, 0.8, 1047, sin, 5) + 0.3 * note(t, 0, 0.8, 2094, sin, 8) + 0.15 * note(t, 0, 0.8, 3140, sin, 12)),
  place: render(0.16, (t) => 0.9 * note(t, 0, 0.15, (u) => 200 - u * 700, sin, 22) + 0.15 * noise() * Math.exp(-60 * t)),
  level: render(0.75, (t) => [523, 659, 784, 1047].reduce((acc, f, i) => acc + 0.45 * note(t, i * 0.1, 0.45, f, tri, 5), 0)),
  angry: render(0.3, (t) => 0.5 * note(t, 0, 0.3, (u) => 150 - u * 120, (p) => (p % 1) * 2 - 1, 7)),
  recruit: render(0.75, (t) => 0.7 * note(t, 0, 0.55, (u) => 190 - u * 110 + 9 * sin(6 * u), sin, 3) + 0.35 * note(t, 0.5, 0.25, 1568, tri, 12)),
  cook: render(0.45, (t) => 0.35 * noise() * Math.exp(-7 * t) * (0.6 + 0.4 * sin(31 * t))),
  sell: render(0.24, (t) => 0.5 * note(t, 0, 0.1, 988, sq, 20) + 0.5 * note(t, 0.09, 0.15, 740, sq, 16)),
  coffee: render(0.32, (t) => 0.25 * noise() * Math.exp(-10 * t) + 0.5 * note(t, 0.02, 0.3, (u) => 380 + u * 1400, sin, 8)),
  goal: render(0.6, (t) => 0.5 * note(t, 0, 0.18, 784, tri, 7) + 0.6 * note(t, 0.15, 0.45, 1047, tri, 5) + 0.2 * note(t, 0.15, 0.45, 1568, sin, 6)),
};

for (const [name, s] of Object.entries(sounds)) writeFileSync(new URL(`${name}.wav`, out), wav(s));
console.log(`Wrote ${Object.keys(sounds).length} sounds to assets/sfx`);
