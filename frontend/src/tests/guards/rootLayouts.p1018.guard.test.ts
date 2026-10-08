/**
 * P10-18 (ADR-131): two root layouts, kept in step by one helper.
 *
 * app/(public)/layout.tsx and app/(app)/layout.tsx each own <html>/<body>, and
 * app/global-not-found.tsx renders a third document for a URL no route
 * matches. What all three must keep — the CSP nonce on the theme script, the
 * per-request rendering, `lang`, the metadata, no client providers — lives in
 * app/rootDocument.tsx. This guard holds them to it:
 *
 *  - every page lives in one of the two groups (no page outside a root layout);
 *  - each document renders through RootDocument with ROOT_METADATA and declares
 *    `instant = false` (segment config is read from the file itself);
 *  - each imports its own group's sheet and never the other's;
 *  - the dashboard's faces are declared only in the (app) layout;
 *  - RootDocument puts the request's nonce on the theme script and the
 *    request's language on <html>.
 *
 * Fail-before: on the single-root tree there was no app/(public) or app/(app)
 * and app/layout.tsx imported globals.css for every page.
 */
import fs from "node:fs";
import path from "node:path";
import React from "react";

const APP = path.resolve(__dirname, "../../app");
const FRONTEND = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(APP, rel), "utf8");

const mockHeaders = new Map<string, string>();
jest.mock("next/headers", () => ({
  headers: async () => ({ get: (name: string) => mockHeaders.get(name) ?? null }),
  cookies: async () => ({ get: () => undefined }),
}));
jest.mock("@/i18n/server", () => ({ getLocale: async () => "id" }));

import { NONCE_HEADER, PATHNAME_HEADER } from "@/lib/securityHeaders";
import { ROOT_METADATA, RootDocument, readRootRequest } from "@/app/rootDocument";
import { ThemeInitScript } from "@/components/ThemeInitScript";
import { THEME_INIT_SCRIPT } from "@/lib/themeInitScript";

const DOCUMENTS = ["(public)/layout.tsx", "(app)/layout.tsx", "global-not-found.tsx"] as const;

/** Every page.tsx under app/, as a path relative to app/. */
const pages = (dir = APP): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" ? [] : pages(p);
    return e.name === "page.tsx" ? [path.relative(APP, p).split(path.sep).join("/")] : [];
  });

describe("ADR-131: the two root layouts", () => {
  it("every page lives under app/(public) or app/(app); app/ itself has no root layout", () => {
    const all = pages();
    expect(all.length).toBeGreaterThan(60);
    expect(all.filter((p) => !/^\((public|app)\)\//.test(p))).toEqual([]);
    expect(fs.existsSync(path.join(APP, "layout.tsx"))).toBe(false);
    expect(fs.existsSync(path.join(APP, "not-found.tsx"))).toBe(false);
  });

  it("the public group holds the public surface, the app group the signed-in application", () => {
    const all = pages();
    for (const p of ["(public)/page.tsx", "(public)/login/page.tsx", "(public)/request-access/page.tsx", "(public)/forgot-password/page.tsx", "(public)/invitation/page.tsx", "(public)/verify/[certificateNumber]/page.tsx", "(public)/blog/page.tsx", "(public)/news/page.tsx"]) {
      expect([p, all.includes(p)]).toEqual([p, true]);
    }
    for (const p of ["(app)/dashboard/page.tsx", "(app)/activation/page.tsx", "(app)/sso-callback/page.tsx", "(app)/oauth/consent/page.tsx"]) {
      expect([p, all.includes(p)]).toEqual([p, true]);
    }
  });

  it.each(DOCUMENTS)("%s renders through RootDocument, with the site metadata, per request", (file) => {
    const src = read(file);
    expect(src).toMatch(/import \{[^}]*\bRootDocument\b[^}]*\} from "\.{1,2}\/rootDocument"/);
    expect(src).toMatch(/<RootDocument\b/);
    expect(src).toMatch(/^export const instant = false;$/m);
    expect(src).toMatch(/ROOT_METADATA/);
    // The document is the helper's: no hand-written <html> that could miss the nonce.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/<html\b/);
  });

  it("each document imports its own group's sheet and never the other's", () => {
    const sheetsOf = (file: string) => [...read(file).matchAll(/^import "([^"]+\.css)";$/gm)].map((m) => m[1]);
    expect(sheetsOf("(public)/layout.tsx")).toEqual(["../public.css"]);
    expect(sheetsOf("global-not-found.tsx")).toEqual(["./public.css"]);
    expect(sheetsOf("(app)/layout.tsx")).toEqual(["../globals.css"]);
    expect(sheetsOf("rootDocument.tsx")).toEqual([]);
  });

  it("the dashboard's faces (Inter, Space Grotesk) are declared only in the (app) layout", () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === "__tests__" ? [] : walk(p);
        return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
      });
    const declaring = walk(APP)
      .filter((f) => /\b(Inter|Space_Grotesk)\(\{/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(APP, f).split(path.sep).join("/"));
    expect(declaring).toEqual(["(app)/layout.tsx"]);
  });

  it("next.config enables the global 404 the two root layouts need", () => {
    const config = fs.readFileSync(path.join(FRONTEND, "next.config.ts"), "utf8");
    expect(config).toMatch(/experimental:\s*\{[^}]*globalNotFound:\s*true/);
  });

  it("the shared metadata names the product and its icons", () => {
    expect(ROOT_METADATA.title).toBe("Device Calibrator");
    expect(JSON.stringify(ROOT_METADATA.icons)).toContain("/brand/app-icon.svg");
  });
});

describe("ADR-131: RootDocument", () => {
  beforeEach(() => mockHeaders.clear());

  it("reads the request's nonce, and the locale's language on a public path", async () => {
    mockHeaders.set(NONCE_HEADER, "n0nce-abc");
    mockHeaders.set(PATHNAME_HEADER, "/login");
    await expect(readRootRequest()).resolves.toEqual({ nonce: "n0nce-abc", lang: "id" });
  });

  it("the dashboard stays English (P10-02), and a missing nonce stays undefined", async () => {
    mockHeaders.set(PATHNAME_HEADER, "/dashboard/devices");
    await expect(readRootRequest()).resolves.toEqual({ nonce: undefined, lang: "en" });
  });

  it("puts the nonce on the theme script, the language and fonts on <html>, the classes on <body>", async () => {
    mockHeaders.set(NONCE_HEADER, "n0nce-xyz");
    mockHeaders.set(PATHNAME_HEADER, "/");
    const html = (await RootDocument({
      fontVariables: "font-a font-b",
      bodyClassName: "min-h-full flex",
      children: React.createElement("main", null, "page"),
    })) as React.ReactElement<{ lang: string; className: string; suppressHydrationWarning: boolean; children: React.ReactNode[] }>;

    expect(html.type).toBe("html");
    expect(html.props.lang).toBe("id");
    expect(html.props.className).toBe("font-a font-b h-full antialiased");
    expect(html.props.suppressHydrationWarning).toBe(true);

    const body = React.Children.toArray(html.props.children).find(
      (c): c is React.ReactElement<{ className: string; children: React.ReactNode }> => React.isValidElement(c) && c.type === "body",
    );
    expect(body?.props.className).toBe("min-h-full flex");
    const [script, page] = React.Children.toArray(body?.props.children) as React.ReactElement<Record<string, unknown>>[];
    expect(script.type).toBe(ThemeInitScript);
    expect(script.props).toEqual({ script: THEME_INIT_SCRIPT, nonce: "n0nce-xyz" });
    expect(page.type).toBe("main");
  });
});
