/**
 * P22-10c2 (P19-08 § 4.4, FT-84, FT-89) — the `/field` document holds NO tenant data.
 *
 * The service worker keeps the last online `/field` response as THE offline shell and replays it.
 * That is safe only while the server renders nothing of the tenant into it: every device, room,
 * catalogue entry and capture is read in the browser, from the encrypted store or the API. This
 * guard keeps it so:
 *
 *  - the field route's server files (`page.tsx`, `layout.tsx`) import only the dictionary, React,
 *    Next's types, the namespaces list and the client island — no API service, no `fetch`, no
 *    `next/headers` read beyond the dictionary's own;
 *  - the island and everything under `src/field/ui` is client code (`"use client"` on every
 *    component) and calls no server-only module;
 *  - the server render of the app is the bare shell: it shows "opening the field app" and no
 *    store read has happened (the boot runs in an effect, after hydration).
 *
 * Fail-before: a `page.tsx` that awaited `typedApi.GET("/api/v1/calibration-devices")` to pre-render
 * the device list would fail the first test (its import) and put tenant rows into the cached shell.
 */
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToString } from "react-dom/server";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";
import { FieldApp } from "@/field/ui/FieldApp";
import type { StoreDeps } from "@/field/ui/fieldStore";

const SRC = path.resolve(__dirname, "../..");
const ROUTE = path.join(SRC, "app/(app)/field");
const UI = path.join(SRC, "field/ui");

const importsOf = (file: string): string[] => [...fs.readFileSync(file, "utf8").matchAll(/^import[^"']*["']([^"']+)["']/gm)].map((m) => m[1] as string);
const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "__tests__" ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));

const SERVER_FILES = ["page.tsx", "layout.tsx"];
const SERVER_ALLOWED = ["react", "next", "@/i18n/server", "@/i18n", "@/i18n/MessagesProvider", "@/field/ui/namespaces", "./FieldClient"];

describe("fieldShellNoTenantData", () => {
  it("the route's server files import only the dictionary, React, Next's types and the client island", () => {
    for (const file of SERVER_FILES) {
      const offenders = importsOf(path.join(ROUTE, file)).filter((spec) => !SERVER_ALLOWED.includes(spec));
      expect({ file, offenders }).toEqual({ file, offenders: [] });
      const text = fs.readFileSync(path.join(ROUTE, file), "utf8");
      expect(text).not.toMatch(/\bfetch\(|typedApi|apiClient|next\/headers|cookies\(\)/);
    }
  });

  it("the route holds exactly the page, the layout and the client island", () => {
    expect(fs.readdirSync(ROUTE).sort()).toEqual(["FieldClient.tsx", "layout.tsx", "page.tsx"]);
    expect(fs.readFileSync(path.join(ROUTE, "FieldClient.tsx"), "utf8")).toMatch(/^"use client";/);
  });

  it("every field UI component is client code and none reaches a server-only module", () => {
    const files = walk(UI).filter((f) => /\.(ts|tsx)$/.test(f));
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      if (file.endsWith(".tsx")) expect({ file, client: text.startsWith('"use client";') }).toEqual({ file, client: true });
      expect({ file, server: /next\/headers|server-only|@\/i18n\/server/.test(text) }).toEqual({ file, server: false });
    }
  });

  it("the server render is the bare shell: no store read before hydration", () => {
    const touched: string[] = [];
    const trap = new Proxy({}, { get: (_t, key) => (touched.push(String(key)), undefined) });
    const deps = (): StoreDeps => trap as unknown as StoreDeps;
    const html = renderToString(
      <MessagesProvider locale="en" messages={en}>
        <FieldApp deps={deps} />
      </MessagesProvider>,
    );
    expect(html).toContain(en["field.loading"]);
    expect(html).toContain("<main");
    expect(html.match(/<main/g)).toHaveLength(1);
    expect(html.match(/<h1/g)).toHaveLength(1);
    // Building the store reads no dependency: everything is read by `boot`, in an effect.
    expect(touched).toEqual([]);
  });
});
