// The ad film's soundtrack (web/src/pages/AdFilm.tsx): the music from the owner's ElevenRoute showcase video,
// extended and fitted to the film.
//
// The source is the audio of ElevenRoute-showcase.mov (54.4 s, 110.02 BPM, C major), the owner's own file; its rights
// are the owner's, so it stays out of git (tools/ is gitignored). It is one four-bar loop (F, G, G, Am): a short
// swell, then the drums come in on a bar line at 2.996 s (a beat is 0.54535 s, a bar 2.1814 s), claps join on bar 5,
// a riser over bars 20–21 drops out for one beat before the final hit on bar 22 (50.99 s), then a short decay.
//
// The edit, on that bar grid:
//   - bars 0–19 as they are, then bars 12–19 again (8 bars = two loops, so the harmony carries on), then bars 20–22
//     and the decay: the riser and the final hit move 8 bars later, to bar 30, under the film's end card;
//   - the outage (film 33.5–40.1 s): the bar line stutters with the picture's glitch, then the music goes muffled
//     (a low-pass filter) while the provider is down and opens up again as the turn is answered, full by the time
//     ElevenAgent's scene starts.
//
//   node scripts/ad-music.mjs --source path/to/ElevenRoute-showcase.mov   (first run: keeps tools/ad-music-source.wav)
//   node scripts/ad-music.mjs [out.wav]                                   (default tools/ad-music.wav)
// Set FFMPEG if ffmpeg isn't on PATH.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const si = args.indexOf('--source');
const SOURCE = si >= 0 ? args[si + 1] : null;
const OUT = args.filter((_, i) => si < 0 || (i !== si && i !== si + 1))[0] ?? 'tools/ad-music.wav';
const KEEP = 'tools/ad-music-source.wav';
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const SR = 48000;

if (SOURCE) {
  mkdirSync(dirname(KEEP), { recursive: true });
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', SOURCE, '-vn', '-ac', '2', '-ar', String(SR), '-c:a', 'pcm_s16le', KEEP]);
  console.log(`kept the source audio in ${KEEP}`);
}
if (!existsSync(KEEP)) throw new Error(`no source audio yet: run once with --source <the showcase video or its audio>`);

// ---- the grid (film time = output time) ----
const BEAT = 0.54535;
const BAR = 4 * BEAT;
const FIRST_BEAT = 0.269;
const barAt = (m) => FIRST_BEAT + (5 + 4 * m) * BEAT; // bar 0 = the drums come in (beat 5)
/** FILM_SECONDS in AdFilm.tsx. */
const LENGTH = 71.8;
const JOIN = barAt(20); // output and source: the end of bar 19…
const FROM = barAt(12); // …continues with the source's bar 12 again
const XFADE = 0.02;

const raw = execFileSync(FFMPEG, ['-v', 'error', '-i', KEEP, '-ac', '2', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
const src = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
const srcFrames = src.length / 2;
const at = (sec) => Math.round(sec * SR);
const total = at(LENGTH);
const s = (i, ch) => (i >= 0 && i < srcFrames ? src[i * 2 + ch] : 0);

// 1. the extended arrangement
const join = at(JOIN);
const from = at(FROM);
const xf = at(XFADE);
const arr = new Float32Array(total * 2);
for (let n = 0; n < total; n++)
  for (let ch = 0; ch < 2; ch++) {
    let v;
    if (n < join - xf) v = s(n, ch);
    else if (n < join) {
      const p = (n - (join - xf)) / xf; // equal power, ending exactly on the bar line
      v = s(n, ch) * Math.cos((p * Math.PI) / 2) + s(from - (join - n), ch) * Math.sin((p * Math.PI) / 2);
    } else v = s(from + (n - join), ch);
    arr[n * 2 + ch] = v;
  }

// 2. the outage: stutters on the glitches (16th-note repeats of the bar line), then the low-pass dip
const SIXTEENTH = BEAT / 4;
const out = Float32Array.from(arr);
const stutter = (startSec, repeats) => {
  const a = at(startSec);
  const len = at(SIXTEENTH);
  const edge = at(0.003);
  for (let r = 0; r < repeats; r++)
    for (let i = 0; i < len; i++) {
      const g = (1 - 0.1 * r) * Math.min(1, i / edge, (len - i) / edge);
      for (let ch = 0; ch < 2; ch++) out[(a + r * len + i) * 2 + ch] = arr[(a + i) * 2 + ch] * g;
    }
};
const GLITCH = barAt(14); // story 30: the outage hits on a bar line
stutter(GLITCH, 4);
stutter(FIRST_BEAT + Math.round((barAt(14) + 1.854 - FIRST_BEAT) / SIXTEENTH) * SIXTEENTH, 2); // the second glitch, on the nearest 16th

const ANSWERED = barAt(14) + 2.42 * (BAR / 2); // story 32.42: the turn is answered by another vendor
const FULL = barAt(17); // story 36: ElevenAgent's scene
const LP_DOWN = GLITCH + BEAT; // after the stutter
const cutoff = (t) => {
  if (t < LP_DOWN) return 18000;
  if (t < LP_DOWN + 0.15) return 18000 * Math.pow(650 / 18000, (t - LP_DOWN) / 0.15);
  if (t < ANSWERED) return 650;
  if (t < FULL) return 650 * Math.pow(18000 / 650, Math.pow((t - ANSWERED) / (FULL - ANSWERED), 1.6));
  return 18000;
};
{
  const a = at(LP_DOWN - 0.05);
  const b = at(FULL + 0.05);
  const z = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  let c = null;
  for (let n = a; n < b; n++) {
    if ((n - a) % 32 === 0) {
      const w0 = (2 * Math.PI * cutoff(n / SR)) / SR;
      const alpha = Math.sin(w0) / (2 * 1.1);
      const cw = Math.cos(w0);
      const a0 = 1 + alpha;
      c = { b0: (1 - cw) / 2 / a0, b1: (1 - cw) / a0, b2: (1 - cw) / 2 / a0, a1: (-2 * cw) / a0, a2: (1 - alpha) / a0 };
    }
    const w = Math.min(1, (n - a) / at(0.02), (b - n) / at(0.02)); // blend in and out of the filter
    for (let ch = 0; ch < 2; ch++) {
      const x = out[n * 2 + ch];
      const st = z[ch];
      const y = c.b0 * x + c.b1 * st[0] + c.b2 * st[1] - c.a1 * st[2] - c.a2 * st[3];
      st[1] = st[0];
      st[0] = x;
      st[3] = st[2];
      st[2] = y;
      out[n * 2 + ch] = x * (1 - w) + y * w;
    }
  }
}

// 3. edges
for (let n = 0; n < total; n++) {
  const g = Math.min(1, n / at(0.01), (total - n) / at(0.3));
  out[n * 2] *= g;
  out[n * 2 + 1] *= g;
}

// 16-bit stereo WAV
const data = Buffer.alloc(total * 4);
for (let i = 0; i < total * 2; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, out[i])) * 32767), i * 2);
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(data.length, 40);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.concat([header, data]));
console.log(`wrote ${OUT}: ${LENGTH}s (bars 0–19, 12–19 again, 20–22 and the decay; the final hit at ${barAt(30).toFixed(2)}s)`);
