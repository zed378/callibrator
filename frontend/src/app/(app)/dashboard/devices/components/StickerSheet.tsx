"use client";

import React, { useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { Button } from "@/components/ui";
import { StickerLabel } from "./StickerLabel";
import type { StickerText } from "./stickerLayout";
import { useDeviceText } from "./shared";

export interface SheetSticker {
  deviceId: string;
  qr: string;
  text: StickerText;
}

export const SHEET_LABELS = 18;
export const putSticker = (labels: SheetSticker[], label: SheetSticker): SheetSticker[] =>
  [...labels.filter((existing) => existing.deviceId !== label.deviceId), label];

export function StickerSheet({ labels, onRemove, onClear }: {
  labels: SheetSticker[];
  onRemove: (deviceId: string) => void;
  onClear: () => void;
}) {
  const { t } = useDeviceText();
  const [printing, setPrinting] = useState(false);
  if (!labels.length) return null;
  const print = () => {
    flushSync(() => setPrinting(true));
    document.body.classList.add("sticker-sheet-print");
    try { window.print(); } finally {
      document.body.classList.remove("sticker-sheet-print");
      setPrinting(false);
    }
  };
  return <>
    <section aria-labelledby="sticker-sheet-title" className="space-y-3 rounded-lg border border-border p-4">
      <h2 id="sticker-sheet-title" className="font-semibold">{t("devices.sticker.sheet.title", { count: labels.length })}</h2>
      <p className="text-sm text-muted-foreground">{t("devices.sticker.sheet.lead")}</p>
      <ul className="space-y-1">
        {labels.map((label) => <li key={label.deviceId} className="flex items-center justify-between gap-3 text-sm">
          <span>{label.text.name}</span>
          <Button size="sm" variant="outline" onClick={() => onRemove(label.deviceId)} aria-label={t("devices.sticker.sheet.remove", { name: label.text.name })}>{t("devices.sticker.sheet.remove", { name: label.text.name })}</Button>
        </li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={print}>{t("devices.sticker.sheet.print")}</Button>
        <Button variant="outline" onClick={onClear}>{t("devices.sticker.sheet.clear")}</Button>
      </div>
    </section>
    {printing && createPortal(<div className="sticker-sheet-print-root">
      {Array.from({ length: Math.ceil(labels.length / SHEET_LABELS) }, (_, page) => <div className="sticker-sheet-page" key={page}>
        {labels.slice(page * SHEET_LABELS, (page + 1) * SHEET_LABELS).map((label) => <StickerLabel key={label.deviceId} qr={label.qr} qrAlt={t("devices.publicLink.qrAlt", { name: label.text.name })} text={label.text} />)}
      </div>)}
    </div>, document.body)}
  </>;
}
