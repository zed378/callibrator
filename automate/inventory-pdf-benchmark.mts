#!/usr/bin/env node
/** P23-03 synthetic inventory PDF benchmark. No application login or real data.
 * Runs the actual frontend thumbnail loader/codec and PDF renderer in Chromium.
 * The local fixture server substitutes signed-link and thumbnail HTTP responses;
 * it does not test authorization, real storage latency or production facility size.
 * node automate/inventory-pdf-benchmark.mts
 * Env: CHROME_PATH, PDF_BENCH_ROWS=100,500,1000, PDF_BENCH_ARTIFACTS=<directory>.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(process.env["PDF_BENCH_ARTIFACTS"] ?? path.join(os.tmpdir(), "callibrator-inventory-pdf-benchmark"), new Date().toISOString().replace(/[:.]/g, "-"));
const sizes = (process.env["PDF_BENCH_ROWS"] ?? "100,500,1000").split(",").map(Number);
assert(sizes.every((n) => Number.isInteger(n) && n > 0 && n <= 5000), "PDF_BENCH_ROWS must be integers 1..5000");
const chrome = [process.env["CHROME_PATH"], "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
assert(chrome, "Set CHROME_PATH to Chrome/Chromium");
await fs.mkdir(artifacts, { recursive: true });

// Bundle the real source modules, without modifying the application or exposing a benchmark route.
const built = await build({
  stdin: { contents: `
import { renderInventoryPdf } from "./frontend/src/lib/export/inventoryPdf";
import { loadThumbnails } from "./frontend/src/lib/export/photoThumbs";
const heap = () => performance.memory?.usedJSHeapSize ?? null;
window.runInventoryBenchmark = async (count, withPhotos, fileName) => {
  const observedHeap = [heap()];
  let maxTimerGapMs = 0, previous = performance.now();
  const timer = setInterval(() => { const now = performance.now(); maxTimerGapMs = Math.max(maxTimerGapMs, now - previous); previous = now; observedHeap.push(heap()); }, 50);
  const rows = Array.from({length: count}, (_, i) => ({
    id: "synthetic-device-" + i, facility: "Synthetic Facility", name: "Synthetic device " + i,
    make: "Synthetic maker", type: "Synthetic model", qrCode: "QR" + String(i).padStart(8, "0"),
    serial: "SYNTHETIC-SERIAL-" + i, room: "Room " + i % 20, floor: String(i % 5),
    condition: "Good", technician: "Synthetic technician", inventoryDate: "2026-11-25", calibrationDate: null,
    frontPhotoId: "synthetic-photo-" + i * 2, platePhotoId: "synthetic-photo-" + (i * 2 + 1),
  }));
  const started = performance.now();
  const photos = withPhotos ? await loadThumbnails(rows.flatMap(row => [row.frontPhotoId, row.platePhotoId]), {onDone: () => observedHeap.push(heap())}) : null;
  if (photos && photos.size !== count * 2) throw new Error("A synthetic thumbnail failed: " + photos.size + "/" + count * 2);
  const photosDone = performance.now();
  observedHeap.push(heap());
  const jpegBytes = photos ? [...photos.values()].reduce((sum, value) => sum + Math.floor((value.split(",")[1]?.length ?? 0) * 3 / 4), 0) : 0;
  const bytes = await renderInventoryPdf({ variant: "provider", facilityName: "Synthetic Facility", rows, photos,
    generatedAt: "2026-11-25", labels: { title: "Synthetic inventory benchmark", columns: ["No", "Facility", "Device", "Make", "Type", "QR", "Serial", "Room", "Floor", "Condition", "Technician", "Inventory date", "Front photo", "Serial photo"], generated: "Generated", page: "Page {page} of {pages}", performer: "Technical performer", facilitySide: "Facility", none: "-" }
  });
  const rendered = performance.now();
  observedHeap.push(heap());
  const blob = new Blob([bytes], {type: "application/pdf"});
  const url = URL.createObjectURL(blob);
  const response = await fetch(url);
  if (!response.ok || (await response.arrayBuffer()).byteLength !== bytes.byteLength) throw new Error("Object URL download failed");
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = fileName; document.body.append(anchor); anchor.click(); anchor.remove();
  await new Promise(resolve => setTimeout(resolve, 100));
  clearInterval(timer); URL.revokeObjectURL(url);
  const samples = observedHeap.filter(value => value !== null);
  return { rows: count, withPhotos, thumbnailCount: photos?.size ?? 0, jpegBytesApprox: jpegBytes,
    photoLoadMs: photosDone - started, renderMs: rendered - photosDone, buildMs: rendered - started,
    pdfBytes: bytes.byteLength, maxTimerGapMs, jsHeapBefore: observedHeap[0], jsHeapAfter: heap(),
    observedJsHeapMax: samples.length ? Math.max(...samples) : null, objectUrlVerified: true, fileName };
};`, resolveDir: root, sourcefile: "inventory-benchmark-entry.ts", loader: "ts" },
  bundle: true, write: false, format: "iife", platform: "browser", target: "chrome120",
  tsconfig: path.join(root, "frontend/tsconfig.json"), define: { "process.env": "{}" },
});
const bundle = built.outputFiles[0]?.contents;
assert(bundle, "No benchmark bundle produced");
let stats = { linkRequests: 0, photoRequests: 0, sourceJpegBytes: 0, activePhotos: 0, maxActivePhotos: 0, fontRequests: 0 };
const server = http.createServer((request, response) => {
  void (async () => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname === "/") { response.setHeader("content-type", "text/html"); response.end('<!doctype html><html><head><meta charset="utf-8"><title>Synthetic PDF benchmark</title></head><body><script src="/benchmark.js"></script></body></html>'); return; }
    if (pathname === "/benchmark.js") { response.setHeader("content-type", "application/javascript"); response.end(bundle); return; }
    const font = /^\/fonts\/(NotoSans-(?:Regular|Bold)-LGC\.ttf)$/.exec(pathname);
    if (font?.[1]) { stats.fontRequests++; response.setHeader("content-type", "font/ttf"); response.end(await fs.readFile(path.join(root, "frontend/public/fonts", font[1]))); return; }
    const link = /^\/api\/v1\/attachments\/(synthetic-photo-\d+)\/signed-url$/.exec(pathname);
    if (request.method === "POST" && link?.[1]) {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
      assert.equal((JSON.parse(Buffer.concat(chunks).toString()) as { variant: string }).variant, "thumb");
      stats.linkRequests++; response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ success: true, status: 200, data: { url: `/synthetic-thumbs/${link[1]}.jpg` } })); return;
    }
    const photo = /^\/synthetic-thumbs\/synthetic-photo-(\d+)\.jpg$/.exec(pathname);
    if (photo?.[1]) {
      stats.photoRequests++; stats.activePhotos++; stats.maxActivePhotos = Math.max(stats.maxActivePhotos, stats.activePhotos);
      try {
        // Independent deterministic texture per image prevents jsPDF's identical-image deduplication.
        const raw = Buffer.alloc(320 * 320 * 3); let state = Number(photo[1]) + 1;
        for (let i = 0; i < raw.length; i++) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; raw[i] = state >>> 24; }
        const jpeg = await sharp(raw, { raw: { width: 320, height: 320, channels: 3 } }).jpeg({ quality: 70 }).toBuffer();
        stats.sourceJpegBytes += jpeg.byteLength; response.setHeader("content-type", "image/jpeg"); response.setHeader("cache-control", "no-store"); response.end(jpeg);
      } finally { stats.activePhotos--; }
      return;
    }
    response.statusCode = 404; response.end("Missing synthetic route");
  })().catch((error: unknown) => { response.statusCode = 500; response.end(error instanceof Error ? error.message : String(error)); });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address(); assert(address && typeof address !== "string");
const origin = `http://127.0.0.1:${String(address.port)}`;
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, timeout: 30_000,
  args: ["--no-first-run", "--no-default-browser-check", "--enable-precise-memory-info"] });
const results: Record<string, unknown>[] = [];
try {
  for (const rows of sizes) for (const withPhotos of [false, true]) {
    stats = { linkRequests: 0, photoRequests: 0, sourceJpegBytes: 0, activePhotos: 0, maxActivePhotos: 0, fontRequests: 0 };
    const context = await browser.createBrowserContext();
    try {
      const page = await context.newPage();
      const session = await page.createCDPSession();
      const directory = path.join(artifacts, `${String(rows)}-${withPhotos ? "photos" : "plain"}`);
      await fs.mkdir(directory, { recursive: true });
      await session.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: directory });
      await page.goto(origin, { waitUntil: "networkidle0" });
      const fileName = `synthetic-${String(rows)}-${withPhotos ? "photos" : "plain"}.pdf`;
      const result = await page.evaluate(async (count, photos, file) => {
        const runner = (window as unknown as { runInventoryBenchmark: (count: number, photos: boolean, file: string) => Promise<Record<string, unknown>> }).runInventoryBenchmark;
        return runner(count, photos, file);
      }, rows, withPhotos, fileName);
      const file = path.join(directory, fileName);
      const deadline = Date.now() + 30_000;
      while (!(await fs.stat(file).catch(() => null)) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
      const pdf = await fs.readFile(file);
      assert.equal(pdf.subarray(0, 5).toString(), "%PDF-"); assert.equal(pdf.byteLength, result["pdfBytes"]);
      const imageCount = (pdf.toString("latin1").match(/\/Subtype \/Image\b/g) ?? []).length;
      assert.equal(imageCount, withPhotos ? rows * 2 : 0, "Every distinct synthetic photo must be embedded");
      assert.equal(stats.linkRequests, withPhotos ? rows * 2 : 0); assert.equal(stats.photoRequests, withPhotos ? rows * 2 : 0);
      assert.equal(stats.fontRequests, 2, "Real self-hosted font must load, not fallback");
      const measured = { ...result, ...stats, imageCount, downloadedFile: file };
      results.push(measured); console.log(JSON.stringify(measured));
    } finally { await context.close(); }
  }
  const report = { recordedAt: new Date().toISOString(), chromium: await browser.version(), node: process.version,
    platform: `${process.platform}/${process.arch}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, ramBytes: os.totalmem(),
    methodology: "Cold isolated browser context per case; two unique deterministic 320px JPEG q70 textures per row; actual signed-link client, PHOTO_CONCURRENCY=4, 80px browser codec, real NotoSans fonts and provider A3 PDF renderer. Local synthetic HTTP only. Heap maximum is sampled at thumbnail callbacks and render boundaries, not a true peak. Timer gap exposes main-thread stalls. One run per case; no production-size threshold decision.", results };
  await fs.writeFile(path.join(artifacts, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report: ${path.join(artifacts, "report.json")}`);
} finally { await browser.close(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
