#!/usr/bin/env node
/**
 * P22-10b (P19-08 § 6) — the field app's install icons, rasterised (density 5: the mark's viewBox is ~15,000 units wide, so about 1,050 px before the resize) from the brand mark
 * (`public/brand/app-icon.svg`, ADR-118 Am. 2) with sharp: `icon-192.png`, `icon-512.png`, and
 * `icon-maskable-512.png` (the mark at 80 % on its own tile colour, inside the maskable safe zone).
 *
 *   node scripts/gen-field-icons.mjs     # after the brand mark changes
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const brand = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "brand");
const svg = path.join(brand, "app-icon.svg");
const TILE = "#241E19";

for (const size of [192, 512]) {
  await sharp(svg, { density: 5 }).resize(size, size).png().toFile(path.join(brand, `icon-${size}.png`));
}
const inner = await sharp(svg, { density: 5 }).resize(410, 410).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: TILE } })
  .composite([{ input: inner, gravity: "center" }])
  .png()
  .toFile(path.join(brand, "icon-maskable-512.png"));
console.log("public/brand/icon-192.png, icon-512.png, icon-maskable-512.png written");
