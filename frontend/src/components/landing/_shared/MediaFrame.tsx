import React from "react";
import Image from "next/image";

/**
 * Editorial image frame: a rounded, ringed, softly-shadowed photo with a
 * fixed aspect ratio (via inline `aspect-ratio` so any value works). Uses
 * `next/image` with `fill` + `sizes`. `children` render on top of the frame
 * (relative figure) for overlapping annotation chips; `caption` renders below.
 */
export function MediaFrame({
  src,
  alt,
  aspect = "4 / 3",
  sizes = "(max-width: 1024px) 100vw, 50vw",
  preload = false,
  unoptimized = false,
  caption,
  className = "",
  frameClassName = "",
  imageClassName = "object-cover transition-transform duration-1000 ease-out group-hover:scale-105",
  children,
}: {
  src: string;
  alt: string;
  aspect?: string;
  sizes?: string;
  preload?: boolean;
  // Bypass the Next image optimizer. The `/_next/image` endpoint can fail to
  // (re)load after a client-side navigation; for a hero-critical image that
  // must never break, serve the original file directly.
  unoptimized?: boolean;
  caption?: React.ReactNode;
  className?: string;
  frameClassName?: string;
  imageClassName?: string;
  children?: React.ReactNode;
}) {
  return (
    <figure className={`group relative ${className}`}>
      <div
        className={`relative overflow-hidden rounded-2xl bg-muted ring-1 ring-border shadow-xl ${frameClassName}`}
        style={{ aspectRatio: aspect }}
      >
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          preload={preload}
          unoptimized={unoptimized}
          loading={preload ? "eager" : "lazy"}
          className={imageClassName}
        />
      </div>
      {children}
      {caption ? (
        <figcaption className="mt-3 text-xs text-muted-foreground">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

export default MediaFrame;
