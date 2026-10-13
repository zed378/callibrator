"use client";

/**
 * P27-03 (ADR-138 Am. 4) — the device sticker as it prints: 60 × 40 mm, the QR on the left, the
 * bilingual caption, the device's name, its QR number and the issue day on the right (the layout and
 * its reasons: `stickerLayout.ts`). Paper and ink are the `label-*` tokens, which do not flip with the
 * theme: this is a picture of the physical label, in either theme.
 */
import React from "react";
import { STICKER_CAPTION, footerLine, type StickerText } from "./stickerLayout";

interface Props {
  /** The QR of the public link (a PNG data URL made in the browser). */
  qr: string;
  qrAlt: string;
  text: StickerText;
  className?: string;
}

export function StickerLabel({ qr, qrAlt, text, className = "" }: Props) {
  const footer = footerLine(text);
  return (
    <div
      data-testid="sticker-label"
      className={`sticker-label flex h-[40mm] w-[60mm] shrink-0 items-center gap-[2mm] overflow-hidden rounded-sm border border-border bg-label-paper px-[2.5mm] text-label-ink ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL made in the browser; next/image adds nothing here */}
      <img src={qr} alt={qrAlt} className="h-[33mm] w-[33mm] shrink-0" />
      <div className="flex h-[35mm] min-w-0 flex-1 flex-col">
        <p lang="id" className="text-[2.6mm] font-bold leading-tight">
          {STICKER_CAPTION.id}
        </p>
        <p lang="en" className="mt-[0.4mm] text-[2.3mm] leading-tight">
          {STICKER_CAPTION.en}
        </p>
        <p className="mt-[1.6mm] line-clamp-3 break-words text-[3.2mm] font-bold leading-tight">{text.name}</p>
        {footer && <p className="mt-auto truncate font-mono text-[2.3mm] leading-tight">{footer}</p>}
      </div>
    </div>
  );
}
