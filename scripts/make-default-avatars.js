'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'public', 'assets', 'images');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      raw[p++] = rgba[i];
      raw[p++] = rgba[i + 1];
      raw[p++] = rgba[i + 2];
      raw[p++] = rgba[i + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

const S = 256;
const C = S / 2;
const R = 122;

function inCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function inEllipse(x, y, cx, cy, rx, ry) {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

function inRoundedRect(x, y, cx, cy, w, h, r) {
  const hw = w / 2;
  const hh = h / 2;
  if (x < cx - hw || x > cx + hw || y < cy - hh || y > cy + hh) return false;
  const qx = Math.max(cx - hw + r - x, 0, x - (cx + hw - r));
  const qy = Math.max(cy - hh + r - y, 0, y - (cy + hh - r));
  return qx * qx + qy * qy <= r * r;
}

function pixelColor(x, y, spec) {
  if (spec.kind === 'farmer') {
    if (inEllipse(x, y, C, 58, 24, 16) || inEllipse(x, y, C, 66, 44, 11)) return 'accent'; // straw hat on top
    if (inCircle(x, y, C, 94, 25)) return 'white'; // head
    if (inEllipse(x, y, C, 140, 50, 38) && y >= 110) return 'white'; // shoulders
    if (inCircle(x, y, C, C, R)) return 'bg';
    return null;
  }
  // buyer
  if (inEllipse(x, y, 168, 130, 16, 12) && !inEllipse(x, y, 168, 130, 10, 7) && y <= 144) return 'accent'; // handle ring
  if (inRoundedRect(x, y, 168, 150, 34, 36, 8)) return 'accent'; // bag body
  if (inCircle(x, y, C, 94, 25)) return 'white';
  if (inEllipse(x, y, C, 140, 50, 38) && y >= 110) return 'white';
  if (inCircle(x, y, C, C, R)) return 'bg';
  return null;
}

function render(spec) {
  const rgba = Buffer.alloc(S * S * 4);
  const bg = hex(spec.bg);
  const white = hex(spec.white);
  const accent = hex(spec.accent);
  const colors = {
    bg: bg,
    white: white,
    accent: accent,
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hit = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const c = pixelColor(x + 0.125 + sx * 0.25, y + 0.125 + sy * 0.25, spec);
          if (c) {
            const col = colors[c];
            r += col[0];
            g += col[1];
            b += col[2];
            hit++;
          }
        }
      }
      const i = (y * S + x) * 4;
      const a = Math.round((hit / 16) * 255);
      if (hit > 0) {
        rgba[i] = Math.round(r / hit);
        rgba[i + 1] = Math.round(g / hit);
        rgba[i + 2] = Math.round(b / hit);
      } else {
        rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
      }
      rgba[i + 3] = a;
    }
  }
  return encodePNG(S, S, rgba);
}

const specs = [
  {
    file: 'farmer-default.png',
    kind: 'farmer',
    bg: '#15803d',
    white: '#ffffff',
    accent: '#fde047',
  },
  {
    file: 'buyer-default.png',
    kind: 'buyer',
    bg: '#2563eb',
    white: '#ffffff',
    accent: '#fdba74',
  },
];

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const spec of specs) {
  const out = path.join(OUT_DIR, spec.file);
  fs.writeFileSync(out, render(spec));
  console.log('wrote ' + out + ' (' + fs.statSync(out).size + ' bytes)');
}