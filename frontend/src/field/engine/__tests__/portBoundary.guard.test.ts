/** @jest-environment node */
/**
 * P22-10a guard (ADR-134 § A.11; `docs/SHARED/06-SYNC-ENGINE.md` § 11 case 1): the engine reaches
 * the platform ONLY through its ports, so P35-07 moves `src/field/engine/` into
 * `@callibrator/sync-engine` without a refactor. Fails on a platform global (window, document,
 * navigator, IndexedDB, WebCrypto, fetch, storage, timers, the wall clock) or an app import (React,
 * the API client, stores, i18n) in any engine source; `testing/` and tests are exempt. The only
 * package it may import is `@callibrator/contracts`.
 */
import { readdirSync, readFileSync } from "fs";
import path from "path";

const DIR = path.join(__dirname, "..");
const sources = readdirSync(DIR).filter((f) => f.endsWith(".ts"));

const FORBIDDEN: [RegExp, string][] = [
  [/\bwindow\b/, "window"],
  [/\bdocument\b\./, "document"],
  [/\bnavigator\b/, "navigator"],
  [/\bindexedDB\b|\bIDB[A-Z]\w*/, "IndexedDB"],
  [/\bcrypto\.(subtle|getRandomValues|randomUUID)/, "WebCrypto"],
  [/(?<![.\w])fetch\(/, "fetch"],
  [/\b(localStorage|sessionStorage)\b/, "storage"],
  // A call, not the Scheduler port's own method signature (`setTimeout(fn: …)` in ports.ts).
  [/(?<![.\w])(setTimeout|setInterval)\((?!fn:)/, "a timer (use the Scheduler port)"],
  [/\bDate\.now\(|\bperformance\.now\(/, "the wall clock (use the Clock port)"],
];

const imports = (text: string): string[] => [...text.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1] as string);

describe("P22-10a — the engine's port boundary", () => {
  it("finds the engine's sources", () => {
    expect(sources).toEqual(expect.arrayContaining(["engine.ts", "planner.ts", "classify.ts", "purge.ts", "registry.ts", "config.ts", "model.ts", "ports.ts"]));
  });

  it.each(sources)("%s uses no platform global", (file) => {
    const code = readFileSync(path.join(DIR, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const hits = FORBIDDEN.filter(([pattern]) => pattern.test(code)).map(([, name]) => name);
    expect(hits).toEqual([]);
  });

  it.each(sources)("%s imports only its siblings and the contracts", (file) => {
    const bad = imports(readFileSync(path.join(DIR, file), "utf8")).filter((m) => !m.startsWith("./") && !m.startsWith("@callibrator/contracts/"));
    expect(bad).toEqual([]);
  });
});
