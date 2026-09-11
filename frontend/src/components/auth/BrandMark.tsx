import React from "react";
import { BrandIcon } from "@/components/brand/BrandIcon";

const BOX = { sm: "h-10 w-10", md: "h-12 w-12", lg: "h-16 w-16" } as const;

/**
 * The auth brand mark: renders a deploy-provided tenant logo when present, else
 * the product mark. The tenant logo can be any host/format (a
 * deploy asset), so it's a plain <img> — this intentionally sidesteps the
 * next/image `remotePatterns` restriction with no config change.
 */
export function BrandMark({
  logoUrl,
  name,
  size = "md",
}: {
  logoUrl: string | null;
  name: string;
  size?: "sm" | "md" | "lg";
}) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- arbitrary deploy-provided logo; avoids next.config remotePatterns
      <img
        src={logoUrl}
        alt={name}
        className={`${BOX[size]} rounded-2xl bg-white object-contain p-1.5 shadow-sm ring-1 ring-black/5`}
      />
    );
  }
  // No tenant logo: fall back to the product's own mark rather than a generic
  // glyph. This renders on the login page before sign-in, so it must not
  // depend on anything fetched.
  return (
    <BrandIcon
      className={`${BOX[size]} text-[#001250] dark:text-white`}
      title={name}
    />
  );
}

export default BrandMark;
