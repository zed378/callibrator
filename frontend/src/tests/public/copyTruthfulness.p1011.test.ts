/**
 * P10-11 (ADR-098, doc 20 §3 principle 4, §11, §12) — the copy-truthfulness
 * guard. The fabricated proof shipped because nothing stopped it; this makes
 * the rule a build failure.
 *
 *  1. No banned term (copyRules.BANNED_TERMS) in EITHER dictionary or in the
 *     public page sources — alt text, metadata and aria labels included, since
 *     a claim moved into an attribute is still a claim.
 *  2. No numeric marketing figure (12,000+ · 40% · 3x) outside the reviewed
 *     allow-list, in either dictionary or the sources.
 *  3. No stock-face / stock-photo host URL anywhere public.
 *  4. Every claim-bearing dictionary key appears in doc 20 §11 with a
 *     non-empty source, and its Indonesian and English text there equals the
 *     dictionary's (the doc table is parsed).
 *  5. Every file under public/marketing/ and public/brand/ has a row in the
 *     asset register, doc 20 §12.
 *
 * Mutation checks (recorded in MEMORY/records/2026-09-30-P10-11-copy-guard.md):
 * "HIPAA-ready" added to one string and "12,000+" to another each fail this file.
 */
import fs from "node:fs";
import path from "node:path";
import { id } from "@/i18n/messages/id";
import { en } from "@/i18n/messages/en";
import {
  ALLOWED_PHRASES,
  BANNED_TERMS,
  BANNED_URLS,
  CLAIM_KEY_PREFIXES,
  NOT_A_CLAIM,
  NUMERIC_ALLOW_LIST,
  NUMERIC_CLAIM,
} from "./copyRules";

const frontend = path.resolve(__dirname, "../../..");
const doc = fs.readFileSync(path.join(frontend, "../docs/UI-UX/20-LANDING-AUTH-REVAMP.md"), "utf8");

/** The public page sources: every non-test file a public route renders. */
const PUBLIC_SOURCE_ROOTS = [
  "src/app/page.tsx",
  "src/app/layout.tsx",
  "src/components/public",
  "src/app/login",
  "src/app/request-access",
  "src/app/forgot-password",
  "src/app/invitation",
  "src/app/verify",
  // P10-13: blog and news render on the public surface too (their chrome; the
  // posts themselves are authored content from the CMS, not source files).
  "src/app/blog",
  "src/app/news",
  "src/components/blog",
  "src/app/public-surface.css",
];

const walk = (p: string): string[] => {
  const abs = path.join(frontend, p);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return [abs];
  return fs.readdirSync(abs).flatMap((name) => walk(path.join(p, name)));
};

const sources = PUBLIC_SOURCE_ROOTS.flatMap(walk).filter(
  (f) => /\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes(`${path.sep}__tests__${path.sep}`),
);

/** Code with comments removed: a comment may name a banned term to explain why it is gone. */
const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const allow = (text: string) => ALLOWED_PHRASES.reduce((s, a) => s.split(a.phrase).join(""), text);

const bannedIn = (text: string) => BANNED_TERMS.filter((b) => b.pattern.test(allow(text))).map((b) => String(b.pattern));

type Dict = Record<string, string>;
const DICTS: Array<[string, Dict]> = [
  ["id", id as Dict],
  ["en", en as Dict],
];

describe("P10-11: copy-truthfulness guard", () => {
  it("found the public sources it guards", () => {
    expect(sources.length).toBeGreaterThanOrEqual(20);
    expect(sources.some((f) => f.endsWith(path.join("src", "app", "page.tsx")))).toBe(true);
  });

  it.each(DICTS)("the %s dictionary holds no banned term", (_locale, dict) => {
    const hits = Object.entries(dict).flatMap(([key, text]) => bannedIn(text).map((p) => `${key}: ${p}`));
    expect(hits).toEqual([]);
  });

  it.each(DICTS)("the %s dictionary holds no unsourced marketing figure", (_locale, dict) => {
    const hits = Object.entries(dict)
      .filter(([key, text]) => NUMERIC_CLAIM.test(text) && !NUMERIC_ALLOW_LIST[key])
      .map(([key, text]) => `${key}: ${text}`);
    expect(hits).toEqual([]);
  });

  it("the numeric allow-list has a source for every entry and names real keys", () => {
    for (const [key, source] of Object.entries(NUMERIC_ALLOW_LIST)) {
      expect([key, key in id, source.trim().length > 10]).toEqual([key, true, true]);
    }
  });

  it("the public page sources hold no banned term, figure or stock-photo URL (attributes included)", () => {
    const hits: string[] = [];
    for (const file of sources) {
      const code = stripComments(fs.readFileSync(file, "utf8"));
      const rel = path.relative(frontend, file);
      // String literals and JSX text: everything between quotes/backticks or between > and <.
      const texts = [
        ...code.matchAll(/"([^"\n]{3,})"|'([^'\n]{3,})'|`([^`]{3,})`|>([^<>{}\n]{3,})</g),
      ].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4] ?? "");
      for (const text of texts) {
        for (const p of bannedIn(text)) hits.push(`${rel}: ${p} in "${text.slice(0, 60)}"`);
        if (BANNED_URLS.test(text)) hits.push(`${rel}: stock URL "${text.slice(0, 60)}"`);
        // A figure in visible copy (not a class name, path, size or CSS value).
        if (/^[^-_/.#:=]*[A-Za-z]{3,}[^-_/.#:=]*$/.test(text) && / /.test(text) && NUMERIC_CLAIM.test(text)) {
          hits.push(`${rel}: figure in "${text.slice(0, 60)}"`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("no stock-photo URL anywhere in the dictionaries", () => {
    for (const [, dict] of DICTS) for (const text of Object.values(dict)) expect(BANNED_URLS.test(text)).toBe(false);
  });

  describe("doc 20 §11: every claim-bearing key has a source", () => {
    const section = doc.slice(doc.indexOf("## 11. Copy Deck"), doc.indexOf("## 12. Asset Register"));
    const rows = new Map<string, { idText: string; enText: string; source: string }>();
    for (const m of section.matchAll(/^\| `([A-Za-z0-9.*]+)` \| (.*)$/gm)) {
      const cells = m[2].split(" | ").map((c) => c.replace(/\s*\|\s*$/, "").trim());
      rows.set(m[1], { idText: cells[0] ?? "", enText: cells[1] ?? "", source: cells[2] ?? "" });
    }

    const claimKeys = Object.keys(id).filter(
      (k) => CLAIM_KEY_PREFIXES.some((p) => k.startsWith(p)) && !NOT_A_CLAIM.includes(k),
    );

    const rowFor = (key: string) =>
      rows.get(key) ?? [...rows.entries()].find(([k]) => k.endsWith(".*") && key.startsWith(k.slice(0, -1)))?.[1];

    it("parsed the table and found the claim keys", () => {
      expect(rows.size).toBeGreaterThanOrEqual(40);
      expect(claimKeys.length).toBeGreaterThanOrEqual(30);
    });

    it.each(Object.keys(id).filter((k) => CLAIM_KEY_PREFIXES.some((p) => k.startsWith(p)) && !NOT_A_CLAIM.includes(k)))(
      "%s has a row with a non-empty source",
      (key) => {
        const row = rowFor(key);
        expect([key, Boolean(row)]).toEqual([key, true]);
        expect([key, (row?.source ?? "").replace(/[—-]/g, "").trim().length > 0]).toEqual([key, true]);
      },
    );

    it("where §11 gives the exact text of a claim key, the dictionaries say exactly that", () => {
      const norm = (s: string) => s.replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
      const diffs: string[] = [];
      for (const key of claimKeys) {
        const row = rows.get(key);
        if (!row) continue;
        if (norm(row.idText) !== norm(id[key as keyof typeof id])) diffs.push(`${key} (id)`);
        if (norm(row.enText) !== norm(en[key as keyof typeof en])) diffs.push(`${key} (en)`);
      }
      expect(diffs).toEqual([]);
    });
  });

  describe("doc 20 §12: every public asset is registered", () => {
    const register = doc.slice(doc.indexOf("## 12. Asset Register"), doc.indexOf("## 13."));
    const files = ["public/marketing", "public/brand"].flatMap((dir) => walk(dir)).filter((f) => !f.endsWith(".md"));

    it.each(files.map((f) => path.relative(frontend, f).split(path.sep).join("/")))("%s has a register row", (rel) => {
      const name = path.posix.basename(rel);
      const dir = path.posix.dirname(rel);
      const listed = register.includes(name) || register.includes(`frontend/${dir}/\``) || register.includes(`frontend/${dir}/)`);
      expect([rel, listed]).toEqual([rel, true]);
    });
  });
});
