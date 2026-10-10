/** @jest-environment node */
/**
 * P22-10b guards (P19-08 § 4.1, § 5, § 6):
 *  - **the scope namespace** (`fieldRouteNamespace`): the worker's scope `/field` is a PREFIX match,
 *    so no app route other than the field app itself may start with `/field` (a future `/fieldwork`
 *    would be controlled by the worker);
 *  - **the manifest**: id, scope and start URL in `/field`, standalone, Indonesian; its colours ARE
 *    the light theme's tokens (one source); every icon exists, with the maskable one;
 *  - **the headers**: the worker gets its own CSP and is always revalidated; only the scanning pages
 *    get the camera; nothing registers the worker but the field app.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { CAMERA_PAGES } from "@/lib/securityHeaders";

const FRONTEND = path.join(__dirname, "../../../..");
const APP = path.join(FRONTEND, "src/app");

/** Every route segment path under app/ (route groups `(x)` dropped). */
const routes = (dir: string, prefix = ""): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (!statSync(full).isDirectory() || name.startsWith("_") || name === "__tests__" || name.startsWith("@")) return [];
    const segment = /^\(.*\)$/.test(name) ? "" : `/${name}`;
    return [`${prefix}${segment}`, ...routes(full, `${prefix}${segment}`)];
  });

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

describe("P22-10b — the field install's guards", () => {
  it("no route but /field itself starts with /field", () => {
    const offenders = [...new Set(routes(APP))].filter((r) => r.startsWith("/field") && r !== "/field" && !r.startsWith("/field/"));
    expect(offenders).toEqual([]);
  });

  it("the manifest: in /field, standalone, Indonesian; colours from the light tokens; every icon present", () => {
    const manifest = JSON.parse(readFileSync(path.join(FRONTEND, "public/manifest.webmanifest"), "utf8")) as Record<string, unknown> & { icons: { src: string; sizes: string; purpose?: string }[] };
    expect(manifest).toMatchObject({ id: "/field", scope: "/field", start_url: "/field?view=home", display: "standalone", lang: "id" });
    const css = readFileSync(path.join(FRONTEND, "src/app/globals.css"), "utf8");
    const token = (name: string) => new RegExp(`^\\s*--${name}:\\s*(#[0-9a-fA-F]{6})`, "m").exec(css)?.[1]?.toLowerCase();
    expect(manifest["background_color"]).toBe(token("background"));
    expect(manifest["theme_color"]).toBe(token("foreground"));
    for (const icon of manifest.icons) expect(existsSync(path.join(FRONTEND, "public", icon.src))).toBe(true);
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
    expect(manifest.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  });

  it("the worker's own headers; the camera only where QR codes are scanned", () => {
    const config = readFileSync(path.join(FRONTEND, "next.config.ts"), "utf8");
    expect(config).toContain(`source: "/sw.js"`);
    expect(config).toContain("default-src 'none'; connect-src 'self'; script-src 'self'");
    expect(config).toContain("no-cache, max-age=0");
    expect(CAMERA_PAGES).toEqual(["/dashboard/ipm/new", "/field"]);
  });

  it("only the field code registers a service worker", () => {
    const registering = walk(path.join(FRONTEND, "src"))
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/__tests__|\.test\./.test(f))
      .filter((f) => /serviceWorker\.register\(|\.register\(\s*WORKER_URL/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(FRONTEND, f).replace(/\\/g, "/"));
    expect(registering).toEqual(["src/field/platform/serviceWorker.ts"]);
  });
});
