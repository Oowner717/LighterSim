// Generates the PWA icons (a flame on a dark ground) with no dependencies:
// raw RGBA pixels encoded as PNG by hand via node:zlib.
//   node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let crcTable;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function png(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function render(S) {
  const px = Buffer.alloc(S * S * 4);
  const cx = S * 0.5;
  const yb = S * 0.74; // flame base
  const yt = S * 0.2;  // flame tip
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let r = 12 + 8 * (y / S);
      let g = 13 + 8 * (y / S);
      let b = 17 + 10 * (y / S);
      const dgx = (x - cx) / S;
      const dgy = (y - S * 0.55) / S;
      const glow = Math.exp(-(dgx * dgx + dgy * dgy) * 9);
      r += 60 * glow;
      g += 28 * glow;
      b += 6 * glow;
      const t = (yb - y) / (yb - yt);
      if (t > 0 && t < 1) {
        const hw = S * 0.19 * Math.pow(Math.sin(Math.PI * (t * 0.95 + 0.05)), 0.7);
        const d = Math.abs(x - cx) / Math.max(1e-6, hw);
        if (d < 1.06) {
          const edge = Math.max(0, Math.min(1, ((1.06 - d) * hw) / 1.8));
          const inner = Math.max(0, 1 - Math.max(d * 1.15, t * 0.9));
          const fr = 255;
          const fg = 122 + 120 * inner;
          const fb = 26 + (190 * Math.max(0, inner - 0.35)) / 0.65;
          r = r * (1 - edge) + fr * edge;
          g = g * (1 - edge) + fg * edge;
          b = b * (1 - edge) + fb * edge;
        }
      }
      const i = (y * S + x) * 4;
      px[i] = Math.min(255, Math.round(r));
      px[i + 1] = Math.min(255, Math.round(g));
      px[i + 2] = Math.min(255, Math.round(b));
      px[i + 3] = 255;
    }
  }
  return png(S, S, px);
}

mkdirSync(join(root, 'icons'), { recursive: true });
writeFileSync(join(root, 'icons/icon-512.png'), render(512));
writeFileSync(join(root, 'icons/icon-192.png'), render(192));
writeFileSync(join(root, 'icons/apple-touch-icon.png'), render(180));
console.log('icons written');
