/**
 * P11-04 (ADR-122, spec P11-00 D6): text on a user-chosen colour is chosen by
 * contrast. Fail-before (HEAD 4584df3): label chips and project tiles drew
 * `text-white` on whatever colour the user picked — 2.56:1 on the default
 * label grey #94a3b8.
 */
import { INK_DARK, INK_LIGHT, readableOn } from "./readableOn";
import { contrastRatio, parseHex, type Rgb } from "./brandColor";

const r = (a: string, b: string) => contrastRatio(parseHex(a) as Rgb, parseHex(b) as Rgb);

describe("readableOn (D6)", () => {
  it("the old fixed white failed on the default label grey", () => {
    expect(r("#ffffff", "#94a3b8")).toBeLessThan(3);
  });

  it.each(["#94a3b8", "#ef4444", "#4f46e5", "#facc15", "#000000", "#ffffff", "#22c55e", "#0ea5e9", "#9a4e22"])(
    "%s gets the more readable of charcoal and paper",
    (bg) => {
      const ink = readableOn(bg);
      const other = ink === INK_DARK ? INK_LIGHT : INK_DARK;
      expect(r(ink, bg)).toBeGreaterThanOrEqual(r(other, bg));
      // The better of the two is always at least 4.5:1 on these (and ≥ 3:1 on any colour).
      expect(r(ink, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("an unreadable or missing colour gets charcoal", () => {
    expect(readableOn(null)).toBe(INK_DARK);
    expect(readableOn("red")).toBe(INK_DARK);
  });
});
