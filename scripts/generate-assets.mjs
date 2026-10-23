import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';

const root = dirname(fileURLToPath(import.meta.url));
const assets = join(root, '..', 'assets');
await mkdir(assets, { recursive: true });

const width = 22050;
const seconds = 2.05;
const samples = Math.floor(width * seconds);
const wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + samples * 2, 4); wav.write('WAVE', 8);
wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22); wav.writeUInt32LE(width, 24); wav.writeUInt32LE(width * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);

const tones = [
  [0.02, 0.19, 740], [0.23, 0.40, 622],
  [0.76, 0.93, 740], [0.97, 1.14, 622],
];
for (let index = 0; index < samples; index += 1) {
  const t = index / width;
  let value = 0;
  for (const [start, end, hz] of tones) {
    if (t < start || t > end) continue;
    const phase = Math.min(t - start, end - t);
    const envelope = Math.min(1, phase / 0.012);
    value += Math.sin(2 * Math.PI * hz * t) * envelope * 0.25;
  }
  const sample = Math.max(-1, Math.min(1, value));
  wav.writeInt16LE(Math.round(sample * 32767), 44 + index * 2);
}
await writeFile(join(assets, 'ring.wav'), wav);
// In the monorepo the web app serves the same ringtone; the standalone mirror has no web app.
const webPublic = join(root, '..', '..', 'web', 'public');
if (existsSync(webPublic)) await writeFile(join(webPublic, 'desktop-ring.wav'), wav);

const pngCrcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = pngCrcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const type = Buffer.from(name);
  const body = Buffer.concat([type, data]);
  const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}
function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if (((a[1] > y) !== (b[1] > y)) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function iconPng(dotColor) {
  const size = 32;
  const data = Buffer.alloc((size * 4 + 1) * size);
  const handset = [[7, 5], [11, 6], [13, 10], [11, 13], [13, 16], [16, 19], [19, 20], [22, 17], [26, 19], [27, 23], [25, 26], [22, 27], [18, 25], [14, 22], [10, 18], [7, 14], [5, 10], [5, 7]];
  const dot = dotColor;
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1); data[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5, py = y + 0.5;
      let rgba = [0, 0, 0, 0];
      if (insidePolygon(px, py, handset)) rgba = [255, 255, 255, 255];
      const d2 = (px - 25) ** 2 + (py - 25) ** 2;
      if (d2 <= 25) rgba = [18, 24, 38, 255];
      if (d2 <= 16) rgba = dot;
      const offset = row + 1 + x * 4;
      data[offset] = rgba[0]; data[offset + 1] = rgba[1]; data[offset + 2] = rgba[2]; data[offset + 3] = rgba[3];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(data)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Avoid a native image tool: the tray icons are tiny, original RGBA PNGs generated from a polygon.
for (const [status, color] of Object.entries({ connected: [49, 191, 113, 255], offline: [238, 166, 56, 255], 'signed-out': [145, 153, 171, 255] })) {
  await writeFile(join(assets, `tray-${status}.png`), iconPng(color));
}
