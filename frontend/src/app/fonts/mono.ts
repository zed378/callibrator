/**
 * ADR-131 (P10-18): JetBrains Mono, the one face BOTH root layouts declare —
 * certificate numbers, serials and codes on the dashboard, and `.pub-mono` /
 * article code on the public surface. It was declared in the single root
 * layout; with two root layouts it is declared once here and attached by each.
 *
 * P10-01 (doc 20 §4.3, 05 §7.2): not preloaded on any page; it loads when a
 * certificate number, serial or code is actually on screen.
 */
import { JetBrains_Mono } from "next/font/google";

export const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});
