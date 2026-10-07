/**
 * P10-17 perf addendum (doc 20 AC-5/AC-6, MEMORY/records/2026-10-05-landing-warm-redesign.md):
 * the CSS facts the public pages' first paint depends on, pinned so a later
 * edit cannot quietly undo them.
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";

const FRONTEND = path.resolve(__dirname, "../../../..");
const read = (rel: string) => fs.readFileSync(path.join(FRONTEND, rel), "utf8");

/** The declarations inside the first `[data-surface="public"] {` block. */
const surfaceBlock = (css: string): string => {
  const start = css.indexOf('[data-surface="public"] {');
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n}", start));
};

describe("public surface CSS (P10-17 perf addendum)", () => {
  const surface = surfaceBlock(read("src/app/public-surface.css"));

  it("inlines the grain texture, byte for byte the committed SVG", () => {
    const m = surface.match(/background-image:\s*url\("data:image\/svg\+xml,([^"]+)"\)/);
    expect(m).not.toBeNull();
    const inlined = decodeURIComponent((m as RegExpMatchArray)[1]);
    const file = read("public/textures/grain-warm.svg").trim().replace(/"/g, "'");
    expect(inlined).toBe(file);
    // No request for it remains.
    expect(surface).not.toMatch(/url\("?\/textures\//);
  });

  it("does not inherit the dashboard's Inter character variants", () => {
    expect(surface).toMatch(/font-feature-settings:\s*normal;/);
  });

  it.each(fs.readdirSync(path.join(FRONTEND, "src/app/fonts")).filter((f) => f.endsWith(".woff2")))(
    "%s has no cv02/cv03/cv04/cv11, so `normal` draws the same glyphs",
    (file) => {
      // A woff2 file is a header and table directory, then one Brotli stream
      // holding the sfnt tables; GSUB/GPOS are stored untransformed, so their
      // 4-byte feature tags are plain ASCII once decompressed. The directory's
      // length varies, so find where the stream starts by trying each offset.
      const buf = fs.readFileSync(path.join(FRONTEND, "src/app/fonts", file));
      let tables: Buffer | null = null;
      for (let off = 48; off < Math.min(buf.length, 2048) && !tables; off += 1) {
        try {
          const out = zlib.brotliDecompressSync(buf.subarray(off));
          if (out.length > 1024) tables = out;
        } catch {
          // not the start of the stream
        }
      }
      expect(tables).not.toBeNull();
      const ascii = (tables as Buffer).toString("latin1");
      expect(ascii).toContain("kern"); // the decode found the feature list
      for (const tag of ["cv02", "cv03", "cv04", "cv11"]) expect(ascii).not.toContain(tag);
    },
  );
});

describe("landing CSS (P10-17 perf addendum)", () => {
  const landing = read("src/components/public/landing/landing.css");

  it("lets every section after the hero skip layout until it nears the viewport", () => {
    const rule = landing.match(
      /\[data-surface="public"\] #konten > \.lp-section ~ \.lp-section \{([^}]*)\}/,
    );
    expect(rule).not.toBeNull();
    const body = (rule as RegExpMatchArray)[1];
    expect(body).toMatch(/content-visibility:\s*auto;/);
    // `auto`: the real height is remembered once rendered, so nothing jumps on the way back up.
    expect(body).toMatch(/contain-intrinsic-size:\s*auto \d+px;/);
  });

  it("never applies it to the hero (the LCP section is the first .lp-section)", () => {
    // The bare section rule (which matches the hero too) stays without it…
    expect(landing).not.toMatch(/\[data-surface="public"\] \.lp-section\s*\{[^}]*content-visibility/);
    // …and so does every hero rule.
    expect(landing).not.toMatch(/\.lp-hero[^{]*\{[^}]*content-visibility/);
  });
});
