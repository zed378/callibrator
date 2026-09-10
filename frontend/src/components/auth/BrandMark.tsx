import React from "react";
import { Shield } from "lucide-react";

const BOX = { sm: "h-10 w-10", md: "h-12 w-12", lg: "h-16 w-16" } as const;
const ICON = { sm: "h-5 w-5", md: "h-6 w-6", lg: "h-8 w-8" } as const;

/**
 * The auth brand mark: renders a deploy-provided tenant logo when present, else
 * the default Shield-in-gradient. The tenant logo can be any host/format (a
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
  return (
    <div
      className={`${BOX[size]} flex items-center justify-center rounded-2xl bg-linear-to-br from-primary to-accent shadow-lg shadow-primary/25`}
    >
      <Shield className={`${ICON[size]} text-white`} />
    </div>
  );
}

export default BrandMark;
