// Makes the two sounds that ship with the extension, so they carry no licence but our own.
// Run with `npm run sounds`; the results are committed in media/.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RATE = 44_100;

/** A soft bell-like note: a few harmonics, each fading at its own speed, with a short attack. */
function note(samples, start, frequency, { length, decay, gain }) {
  const partials = [
    [1, 1, 1],
    [2, 0.32, 1.8],
    [3, 0.1, 2.6],
    [4.16, 0.04, 4],
  ];
  const first = Math.round(start * RATE);
  const count = Math.round(length * RATE);
  for (let i = 0; i < count && first + i < samples.length; i++) {
    const t = i / RATE;
    const attack = Math.min(1, t / 0.006);
    let value = 0;
    for (const [ratio, level, speed] of partials) {
      value += level * Math.exp((-t * speed) / decay) * Math.sin(2 * Math.PI * frequency * ratio * t);
    }
    samples[first + i] += gain * attack * value;
  }
}

function render(length, notes) {
  const samples = new Float64Array(Math.round(length * RATE));
  for (const [start, frequency, options] of notes) note(samples, start, frequency, options);
  // Fade out the last 30 ms so the end never clicks, then scale to a peak of 0.8.
  const fade = Math.round(0.03 * RATE);
  for (let i = 0; i < fade; i++) samples[samples.length - 1 - i] *= i / fade;
  const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  return samples.map((value) => (value / peak) * 0.8);
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((value, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32_767), i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const media = (name) => fileURLToPath(new URL(`../media/${name}`, import.meta.url));

// Finished: two notes rising a fifth, E5 then B5, left to ring.
const ring = { length: 1.3, decay: 0.45, gain: 1 };
writeFileSync(media('chime.wav'), wav(render(1.45, [[0, 659.25, ring], [0.13, 987.77, ring]])));

// Needs you: two quick, brighter taps on C6, which ask for attention without alarm.
const tap = { length: 0.45, decay: 0.12, gain: 1 };
writeFileSync(media('knock.wav'), wav(render(0.62, [[0, 1046.5, tap], [0.16, 1046.5, tap]])));

console.log('Wrote media/chime.wav and media/knock.wav');
