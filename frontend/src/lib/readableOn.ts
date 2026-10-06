/**
 * ADR-122 (P11-04, spec P11-00 D6): the ink for text drawn on a USER-CHOSEN
 * colour (a kanban project's or label's colour). The colour is data, so the
 * theme cannot know it; the text is whichever of the palette's charcoal and
 * paper reads better on it — never a fixed `text-white`, which was 2.56:1 on
 * the default label grey.
 */
import { contrastRatio, parseHex, type Rgb } from "./brandColor";

/** Charcoal (--foreground, light) and paper (--card, light): the palette's own ends. */
export const INK_DARK = "#1f1b17";
export const INK_LIGHT = "#fffdf9";

/** The ink with the higher contrast on `background` (`#RRGGBB`); charcoal when it cannot be read. */
export const readableOn = (background: string | null | undefined): string => {
  const bg = parseHex(background);
  if (!bg) return INK_DARK;
  const dark = contrastRatio(parseHex(INK_DARK) as Rgb, bg);
  const light = contrastRatio(parseHex(INK_LIGHT) as Rgb, bg);
  return light > dark ? INK_LIGHT : INK_DARK;
};
