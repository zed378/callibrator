import React from "react";

/**
 * Seamless infinite marquee. Renders two identical groups inside a track that
 * slides by -50%, so the loop never jumps. Edges are feathered via a CSS mask
 * (`.marquee-mask`) and the track pauses on hover. Static under reduced motion
 * (see globals.css). Presentational — safe in server or client trees.
 */
export default function Marquee({
  children,
  durationSec = 32,
  className,
}: {
  children: React.ReactNode;
  durationSec?: number;
  className?: string;
}) {
  return (
    <div className={`marquee-mask ${className ?? ""}`}>
      <div
        className="marquee-track"
        style={{ "--marquee-duration": `${durationSec}s` } as React.CSSProperties}
      >
        <div className="marquee-group">{children}</div>
        <div className="marquee-group" aria-hidden="true">
          {children}
        </div>
      </div>
    </div>
  );
}
