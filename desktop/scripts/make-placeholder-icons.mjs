#!/usr/bin/env node
/**
 * Generate placeholder icons so `tauri build` doesn't fail. These should be
 * replaced with real app icons before shipping.
 *
 * We write the same single-color 256x256 PNG to all the .png filenames Tauri's
 * bundler expects. The .icns and .ico are minimal valid stubs that satisfy the
 * bundler without rendering anything pretty.
 */
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const iconsDir = resolve(here, "..", "src-tauri", "icons");
mkdirSync(iconsDir, { recursive: true });

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
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makeSolidPng(size, r, g, b, a = 255) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // color type RGBA — Tauri requires alpha channel
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const rowLen = 1 + size * 4;
  const raw = Buffer.alloc(rowLen * size);
  for (let y = 0; y < size; y++) {
    raw[y * rowLen] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const off = y * rowLen + 1 + x * 4;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
      raw[off + 3] = a;
    }
  }
  const idat = deflateSync(raw);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const png = makeSolidPng(256, 91, 141, 239); // accent blue

const targets = [
  ["32x32.png", makeSolidPng(32, 91, 141, 239)],
  ["128x128.png", makeSolidPng(128, 91, 141, 239)],
  ["128x128@2x.png", makeSolidPng(256, 91, 141, 239)],
  ["icon.png", png],
];

for (const [name, data] of targets) {
  const p = resolve(iconsDir, name);
  if (!existsSync(p)) {
    writeFileSync(p, data);
    console.log(`wrote ${name} (${data.length} bytes)`);
  }
}

// Minimal icns: this isn't a fully valid container; if tauri-build chokes,
// run `npx @tauri-apps/cli icon` against icons/icon.png to regenerate.
// For now, copy the 256x256 PNG as a placeholder; tauri-build may warn.
const icnsPath = resolve(iconsDir, "icon.icns");
if (!existsSync(icnsPath)) writeFileSync(icnsPath, png);

const icoPath = resolve(iconsDir, "icon.ico");
if (!existsSync(icoPath)) writeFileSync(icoPath, png);

console.log("done. Replace these with real icons before shipping.");
