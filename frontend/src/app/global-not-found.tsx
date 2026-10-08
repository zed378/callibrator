/**
 * ADR-131 (P10-18) decision 4: with two root layouts there is no single layout
 * to compose a 404 from, so a URL that matches no route renders this document
 * (Next 16 `global-not-found`, `experimental.globalNotFound` in next.config.ts).
 * It is on the PUBLIC sheet — most mistyped URLs are public links — through the
 * same RootDocument as both root layouts: the nonce on the theme script, `lang`,
 * the metadata, no client providers. A `notFound()` inside a group renders that
 * group's own not-found.tsx instead.
 */
import type { Metadata } from "next";
import "./public.css";
import { PUBLIC_FONT_VARIABLES } from "./fonts/publicVariables";
import { ROOT_METADATA, RootDocument } from "./rootDocument";
import { PublicNotFound } from "@/components/public/PublicNotFound";

export const metadata: Metadata = {
  ...ROOT_METADATA,
  title: "404 · Out of range — Device Calibrator",
};

/**
 * P7-08, ADR-071: rendered per request like every page — the theme script's
 * nonce is this request's. Without it the 404 would be prerendered at build
 * time, and under `'strict-dynamic'` its script would never run.
 */
export const instant = false;

export default function GlobalNotFound() {
  return (
    <RootDocument fontVariables={PUBLIC_FONT_VARIABLES} bodyClassName="min-h-full flex flex-col">
      <PublicNotFound />
    </RootDocument>
  );
}
