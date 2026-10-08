/**
 * ADR-131 (P10-18): the font variables the public root document puts on
 * <html> — the three public faces (fonts/public.ts) and the shared mono face
 * (fonts/mono.ts). PublicSurface also sets the public three on its wrapper; on
 * <html> they reach the boundaries that render outside a page (the error and
 * not-found pages, app/global-not-found.tsx).
 */
import { jetbrainsMono } from "./mono";
import { publicBodyFont, publicDisplayFont, publicDisplayItalicFont } from "./public";

export const PUBLIC_FONT_VARIABLES = `${publicDisplayFont.variable} ${publicDisplayItalicFont.variable} ${publicBodyFont.variable} ${jetbrainsMono.variable}`;
