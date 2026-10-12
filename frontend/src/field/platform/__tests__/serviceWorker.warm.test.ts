/** @jest-environment node */
/**
 * P22-10c2 — the warm-up (P19-08 § 4.3): every `/_next/static` file the page loaded is fetched again
 * through the worker, once each; other URLs are left alone; a fetch that fails is skipped.
 */
import { warmStatic } from "../serviceWorker";

it("fetches each static file once, skips the rest and survives a failure", async () => {
  const fetched: string[] = [];
  const urls = [
    "https://x.test/_next/static/chunks/a.js",
    "https://x.test/_next/static/chunks/a.js",
    "/_next/static/css/b.css",
    "https://x.test/api/v1/devices",
    "https://x.test/_next/static/chunks/broken.js",
    "http://[bad",
  ];
  const n = await warmStatic(urls, async (url) => {
    if (url.includes("broken")) throw new Error("offline");
    fetched.push(url);
  });
  expect(n).toBe(2);
  expect(fetched).toEqual(["https://x.test/_next/static/chunks/a.js", "/_next/static/css/b.css"]);
});
