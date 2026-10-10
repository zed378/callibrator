"use client";

/**
 * P22-02 — a device photo's thumbnail (or display copy) through a short-lived signed link
 * (`POST /attachments/:id/signed-url { variant }`; P19-03 § 7.2: no permanent URL anywhere). The
 * link is asked for once per photo and variant while it is fresh (links last minutes; a cached one
 * is kept for `LINK_REUSE_MS`). A photo whose link cannot be had shows a named placeholder, never a
 * broken image.
 */
import React, { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { deviceRegisterService } from "@/api/services/deviceRegister.service";
import { deferEffect } from "@/lib/deferEffect";

/** How long a minted link is reused (well inside the server's shortest TTL). */
export const LINK_REUSE_MS = 4 * 60 * 1000;

const links = new Map<string, { url: string; at: number }>();

/** Forget every cached link (a test's isolation; a photo replaced gets a new id anyway). */
export const clearPhotoLinks = (): void => links.clear();

const linkFor = async (attachmentId: string, variant: "thumb" | "display"): Promise<string> => {
  const key = `${attachmentId}~${variant}`;
  const cached = links.get(key);
  if (cached && Date.now() - cached.at < LINK_REUSE_MS) return cached.url;
  const url = await deviceRegisterService.photoLink(attachmentId, variant);
  links.set(key, { url, at: Date.now() });
  return url;
};

interface Props {
  attachmentId: string;
  alt: string;
  variant?: "thumb" | "display";
  className?: string;
  /** Shown (and named) when the link cannot be had. */
  unavailable: string;
}

export function PhotoThumb({ attachmentId, alt, variant = "thumb", className = "h-12 w-12", unavailable }: Props) {
  const [state, setState] = useState<{ id: string; url: string | null; failed: boolean }>({ id: "", url: null, failed: false });

  useEffect(
    () =>
      deferEffect(async () => {
        try {
          const url = await linkFor(attachmentId, variant);
          setState({ id: attachmentId, url, failed: false });
        } catch {
          setState({ id: attachmentId, url: null, failed: true });
        }
      }),
    [attachmentId, variant],
  );

  const current = state.id === attachmentId;
  if (current && state.failed) {
    return (
      <span role="img" aria-label={unavailable} className={`${className} inline-flex items-center justify-center rounded-md border border-border bg-muted text-muted-foreground`}>
        <ImageOff className="h-4 w-4" aria-hidden="true" />
      </span>
    );
  }
  if (!current || state.url === null) {
    return <span aria-hidden="true" className={`${className} inline-block animate-pulse rounded-md bg-muted`} />;
  }
  return (
    // A signed, same-origin link to a server-made derivative: next/image's optimiser would fetch and
    // cache it server-side, outliving the link's purpose; a plain <img> loads it once.
    // eslint-disable-next-line @next/next/no-img-element -- see above
    <img src={state.url} alt={alt} loading="lazy" decoding="async" className={`${className} rounded-md border border-border object-cover`} />
  );
}
