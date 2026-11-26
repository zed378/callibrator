// Run from the repository root after frontend build: node --import tsx scripts/sticker-sheet-print.mts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import puppeteer from "puppeteer-core";
import QRCode from "qrcode";
import { StickerLabel } from "../frontend/src/app/(app)/dashboard/devices/components/StickerLabel.tsx";

const chunks = "frontend/.next/static/chunks";
const files = fs.readdirSync(chunks, { recursive: true }).filter((file) => String(file).endsWith(".css"));
assert.ok(files.length, "build the frontend first");
const css = files.map((file) => fs.readFileSync(path.join(chunks, String(file)), "utf8")).join("\n");
const qr = await QRCode.toDataURL("https://example.test/d/synthetic-print-capability", { margin: 2, width: 512 });
const labels = Array.from({ length: 19 }, (_, i) => renderToStaticMarkup(React.createElement(StickerLabel, {
  qr, qrAlt: `Synthetic ${i}`, text: { name: `Synthetic pump ${i}`, qrNumber: `QR${i}`, issued: "2026-11-26" },
})));
const pages = [labels.slice(0, 18), labels.slice(18)].map((group) => `<div class="sticker-sheet-page">${group.join("")}</div>`).join("");
const browser = await puppeteer.launch({
  executablePath: process.env["CHROME_PATH"] ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
try {
  const page = await browser.newPage();
  await page.setContent(`<html><head><style>${css}</style></head><body class="sticker-sheet-print"><main id="app">App must not print</main><div class="sticker-sheet-print-root">${pages}</div></body></html>`);
  await page.emulateMediaType("print");
  const geometry = await page.evaluate(() => ({
    app: getComputedStyle(document.querySelector("#app")!).display,
    counts: [...document.querySelectorAll(".sticker-sheet-page")].map((el) => el.querySelectorAll(".sticker-label").length),
    labels: [...document.querySelectorAll(".sticker-label")].map((el) => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })),
  }));
  assert.equal(geometry.app, "none");
  assert.deepEqual(geometry.counts, [18, 1]);
  for (const label of geometry.labels) {
    assert.ok(Math.abs(label.width - 60 * 96 / 25.4) < 0.2, "label width must be 60mm");
    assert.ok(Math.abs(label.height - 40 * 96 / 25.4) < 0.2, "label height must be 40mm");
  }
  const pdf = Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true })).toString("latin1");
  assert.equal((pdf.match(/\/Type \/Page\b/g) ?? []).length, 2, "19 labels must print on two pages");
  const boxes = [...pdf.matchAll(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/g)];
  assert.equal(boxes.length, 2);
  for (const box of boxes) {
    assert.ok(Math.abs(Number(box[1]) - 595.28) < 1, "page width must be A4");
    assert.ok(Math.abs(Number(box[2]) - 841.89) < 1, "page height must be A4");
  }
  console.log(JSON.stringify({ pass: true, labels: 19, pages: 2, labelMm: [60, 40] }));
} finally {
  await browser.close();
}
