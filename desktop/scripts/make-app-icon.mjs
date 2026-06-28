#!/usr/bin/env node
/**
 * Generate a 1024x1024 source icon for Recowork.
 *
 * Theme: agentic work — concentric "thinking" arcs with a faint orbital ring,
 * a glowing core, and a soft chromatic gradient. Pure pixel art, written
 * directly to PNG with no image library so this works offline. Output goes
 * to src-tauri/icons/source-1024.png; from there `npx @tauri-apps/cli icon`
 * generates all required sizes.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "..", "src-tauri", "icons");
mkdirSync(outDir, { recursive: true });

const SIZE = 1024;

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(pixels, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // raw with filter byte per row
  const rowLen = 1 + size * 4;
  const raw = Buffer.alloc(rowLen * size);
  for (let y = 0; y < size; y++) {
    raw[y * rowLen] = 0;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const o = y * rowLen + 1 + x * 4;
      raw[o] = pixels[i];
      raw[o + 1] = pixels[i + 1];
      raw[o + 2] = pixels[i + 2];
      raw[o + 3] = pixels[i + 3];
    }
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerpColor(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}
function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Macos icon-style rounded square mask.
function maskAt(x, y, size) {
  const r = size * 0.225; // corner radius matches macOS Big Sur curve
  const cx = size / 2, cy = size / 2;
  const dx = Math.abs(x - cx) - (size / 2 - r);
  const dy = Math.abs(y - cy) - (size / 2 - r);
  const inside =
    (dx <= 0 && dy <= 0) ||
    (dx > 0 && dy <= 0 && dx <= r) ||
    (dx <= 0 && dy > 0 && dy <= r) ||
    (dx > 0 && dy > 0 && Math.hypot(dx, dy) <= r);
  if (!inside) {
    const d = dx > 0 && dy > 0 ? Math.hypot(dx, dy) - r : Math.max(dx, dy);
    return 1 - smoothstep(0, 2, d); // soft edge
  }
  // Inside: distance to edge for inner falloff
  return 1;
}

const buf = Buffer.alloc(SIZE * SIZE * 4);

// Linen palette — warm, neutral, premium. Works against most macOS wallpapers.
const BG_TOP    = [250, 246, 241];  // linen cream
const BG_BOTTOM = [221, 207, 184];  // deeper sand
const ACCENT_A  = [138, 111, 71];   // warm umber
const ACCENT_B  = [169, 136, 99];   // gilded
const ACCENT_C  = [255, 244, 220];  // warm light at core

const cx = SIZE / 2, cy = SIZE / 2;

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const idx = (y * SIZE + x) * 4;

    // Background diagonal gradient.
    const tg = (x + y) / (SIZE * 2);
    let [r, g, b] = lerpColor(BG_TOP, BG_BOTTOM, tg);

    // Polar coords centered.
    const dx = x - cx, dy = y - cy;
    const dist = Math.hypot(dx, dy);
    const theta = Math.atan2(dy, dx);

    // Soft radial vignette glow.
    const glow = Math.exp(-Math.pow(dist / (SIZE * 0.38), 2));
    [r, g, b] = lerpColor([r, g, b], ACCENT_C, glow * 0.12);

    // Concentric arc bands — thinking/orbit rings.
    const ringTargets = [SIZE * 0.18, SIZE * 0.28, SIZE * 0.38];
    for (let i = 0; i < ringTargets.length; i++) {
      const rr = ringTargets[i];
      const thickness = SIZE * (0.012 - i * 0.001);
      const band = Math.abs(dist - rr);
      const ring = Math.exp(-Math.pow(band / thickness, 2));
      // Each arc only paints over part of the circle, with a phase offset.
      const phase = i * 0.6;
      const arcMask = (Math.cos(theta * 1 + phase) + 1) * 0.5; // 0..1
      const arc = Math.pow(arcMask, 2.4);
      const tint = i === 0 ? ACCENT_A : i === 1 ? ACCENT_B : ACCENT_A;
      [r, g, b] = lerpColor([r, g, b], tint, ring * arc * 0.85);
    }

    // Central core: bright disc with soft halo.
    const coreR = SIZE * 0.062;
    const coreSoft = smoothstep(coreR * 1.2, coreR * 0.85, dist);
    [r, g, b] = lerpColor([r, g, b], ACCENT_C, coreSoft);
    const halo = Math.exp(-Math.pow((dist - coreR) / (SIZE * 0.07), 2));
    if (dist > coreR) {
      [r, g, b] = lerpColor([r, g, b], ACCENT_C, halo * 0.35);
    }

    // Spark dots along the outermost arc (decorative).
    const spark = SIZE * 0.38;
    const sparks = [0.2, 1.1, 2.0, 3.5, 4.3, 5.1];
    for (const sa of sparks) {
      const sx = cx + Math.cos(sa) * spark;
      const sy = cy + Math.sin(sa) * spark;
      const sd = Math.hypot(x - sx, y - sy);
      const sg = Math.exp(-Math.pow(sd / (SIZE * 0.008), 2));
      [r, g, b] = lerpColor([r, g, b], [255, 255, 255], sg * 0.95);
    }

    // Subtle vignette to anchor edges into the rounded square mask.
    const vig = 1 - smoothstep(SIZE * 0.50, SIZE * 0.30, dist);
    [r, g, b] = lerpColor([r, g, b], BG_TOP, vig * 0.18);

    // Apply icon-style rounded-square mask as alpha.
    const a = clamp(Math.round(255 * maskAt(x, y, SIZE)), 0, 255);

    buf[idx + 0] = clamp(Math.round(r), 0, 255);
    buf[idx + 1] = clamp(Math.round(g), 0, 255);
    buf[idx + 2] = clamp(Math.round(b), 0, 255);
    buf[idx + 3] = a;
  }
}

const png = encodePng(buf, SIZE);
const outPath = resolve(outDir, "source-1024.png");
writeFileSync(outPath, png);
console.log(`wrote ${outPath} (${(png.length / 1024).toFixed(1)} KB)`);
console.log("next: npx @tauri-apps/cli icon src-tauri/icons/source-1024.png");
