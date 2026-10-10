"use client";

/**
 * P22-03 (F-35) — scan a device's QR sticker with the camera: the rear camera (`getUserMedia`,
 * `facingMode: environment`) read by the browser's own `BarcodeDetector` (QR only), a few times a
 * second, until a code is found or the dialog is closed — then the camera is released. Nothing is
 * recorded or sent but the code read. The page's Permissions-Policy allows the camera on this page
 * only (ADR-127 Am. 2).
 *
 * A browser without `BarcodeDetector` (or without a camera) is told so and keeps the typed field,
 * which a handheld scanner also fills (it types the code and Enter). No JavaScript decoder is
 * shipped: the budget and the CSP stay as they are (ADR-127 Am. 2).
 */
import React, { useEffect, useRef, useState } from "react";
import { Alert, Button, Dialog } from "@/components/ui";
import { useIpmText } from "./shared";

interface Detected {
  rawValue: string;
}
interface Detector {
  detect: (source: HTMLVideoElement) => Promise<Detected[]>;
}
type DetectorClass = new (options: { formats: string[] }) => Detector;

/** The browser's QR detector, when it has one. */
export const detectorClass = (): DetectorClass | null => {
  const candidate = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  return typeof candidate === "function" ? candidate : null;
};

/** Whether this browser can scan with the camera at all. */
export const canScan = (): boolean =>
  detectorClass() !== null && typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";

/** The sticker's code from what the camera read: the code itself, or the last segment of a URL printed on it. */
export const codeFromScan = (raw: string): string => {
  const value = raw.trim();
  if (/^https?:\/\//i.test(value)) {
    try {
      const segments = new URL(value).pathname.split("/").filter(Boolean);
      return decodeURIComponent(segments[segments.length - 1] ?? value);
    } catch {
      return value;
    }
  }
  return value;
};

/** How often a frame is read (ms). */
export const SCAN_EVERY_MS = 300;

export function QrScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const { t } = useIpmText();
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    const Detector = detectorClass();
    const stop = () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
    void (async () => {
      try {
        if (!Detector) throw new Error("unsupported");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (stopped) {
          stop();
          return;
        }
        const element = video.current;
        if (!element) return;
        element.srcObject = stream;
        await element.play().catch(() => undefined);
        const detector = new Detector({ formats: ["qr_code"] });
        timer = setInterval(() => {
          void detector
            .detect(element)
            .then((found) => {
              const first = found[0];
              if (first && !stopped) {
                stop();
                onCode(codeFromScan(first.rawValue));
              }
            })
            .catch(() => undefined);
        }, SCAN_EVERY_MS);
      } catch (err) {
        stop();
        setFailed(err instanceof Error && err.message === "unsupported" ? t("ipm.scan.unsupported") : t("ipm.scan.denied"));
      }
    })();
    return stop;
  }, [onCode, t]);

  return (
    <Dialog isOpen onClose={onClose} title={t("ipm.scan.title")} size="md">
      <div className="space-y-3">
        {failed ? (
          <div role="alert">
            <Alert variant="warning" title={t("ipm.scan.failedTitle")}>
              <p>{failed}</p>
            </Alert>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t("ipm.scan.lead")}</p>
            <video ref={video} className="w-full rounded-md bg-muted" muted playsInline aria-label={t("ipm.scan.video")} />
          </>
        )}
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            {t("ipm.close")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
