import React from "react";

/**
 * Immersive ambient backdrop — layered, token-tinted aurora blobs drifting over
 * a faint blueprint grid, finished with a soft vignette. Pure CSS (no canvas /
 * WebGL), theme-aware (colours derive from --primary/--accent/--info/--success
 * so tenant branding recolours it), and calm under prefers-reduced-motion (the
 * drift classes freeze via globals.css). Reused across the hero and auth pages
 * so the whole product breathes one continuous atmosphere.
 */
export default function AuroraBackground({
  className = "",
  grid = true,
}: {
  className?: string;
  grid?: boolean;
}) {
  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden bg-background ${className}`}
      aria-hidden="true"
    >
      {/* Drifting aurora blobs */}
      <div className="absolute -top-1/4 left-1/2 h-[65vw] w-[65vw] -translate-x-1/2 rounded-full bg-primary/25 blur-[120px] animate-orb-float-1" />
      <div className="absolute top-1/4 -right-32 h-[48vw] w-[48vw] rounded-full bg-accent/25 blur-[120px] animate-orb-float-2" />
      <div className="absolute -bottom-1/4 -left-32 h-[48vw] w-[48vw] rounded-full bg-info/20 blur-[120px] animate-orb-float-1-reverse" />
      <div className="absolute bottom-0 right-1/4 h-[32vw] w-[32vw] rounded-full bg-success/15 blur-[120px] animate-float" />

      {/* Faint blueprint grid — the "calibration" texture, masked to fade out */}
      {grid && (
        <div
          className="absolute inset-0 opacity-60 dark:opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_78%)]"
          style={{
            backgroundImage:
              "linear-gradient(to right, color-mix(in oklab, var(--foreground) 7%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--foreground) 7%, transparent) 1px, transparent 1px)",
            backgroundSize: "46px 46px",
          }}
        />
      )}

      {/* Soft vignette so content stays legible over the colour */}
      <div className="absolute inset-0 bg-linear-to-b from-background/20 via-transparent to-background" />
    </div>
  );
}
