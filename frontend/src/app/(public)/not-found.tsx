/**
 * ADR-131 (P10-18): `notFound()` inside the public root layout (a blog or news
 * post that does not exist) — the public 404, on the public sheet.
 */
import type { Metadata } from "next";
import { PublicNotFound } from "@/components/public/PublicNotFound";

export const metadata: Metadata = {
  title: "404 · Out of range — Device Calibrator",
};

export default function NotFound() {
  return <PublicNotFound />;
}
