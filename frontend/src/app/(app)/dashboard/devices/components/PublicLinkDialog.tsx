"use client";

/**
 * P22-08 (ADR-138 § 1, Am. 1 § 6; spec MEMORY/specs/P19-07-public-device-page.md § 10) — a device's
 * public link, for unbound staff with `calibration` write (the register offers this panel to no one
 * else; the server refuses a facility account and the platform operator anyway).
 *
 *  - The state: active or not (issued when, by whom), the last revocation, and what the tenant's page
 *    setting shows (`minimal_with_report` says that the report link discloses the serial, the QR
 *    number and the signers' names).
 *  - Issue (no active link), Replace and Revoke (an active one). Replace and Revoke ask first: the
 *    printed sticker stops working.
 *  - After an issue or a replacement, the STICKER: the link's QR rendered in the browser (`qrcode`,
 *    loaded on demand), the link itself, Print (a print stylesheet shows only the sticker) and
 *    Download (a PNG made in the browser). Nothing is stored (owner rule): closing the dialog loses
 *    the link, and the dialog says so.
 *  - P27-03 (ADR-138 Am. 4): the sticker is the final 60 × 40 mm label (`StickerLabel`,
 *    `stickerLayout.ts`): Print lays exactly that label on a page of its size, and Download is the
 *    label drawn at 300 dpi (the plain QR when the browser has no canvas). The re-stickering policy
 *    is stated in the dialog (when to replace, and when not to).
 *
 * Loading, failed and loaded are three states; a failed read is never "no link".
 */
import React, { useCallback, useEffect, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { Download, Printer, RefreshCw } from "lucide-react";
import { Alert, Button, ConfirmDialog, Dialog } from "@/components/ui";
import { describeApiError } from "@/api/client";
import { publicDeviceService, type IssuedPublicLink, type PublicLinkState } from "@/api/services/publicDevice.service";
import type { RegisterDevice } from "@/api/services/deviceRegister.service";
import type { MessageKey } from "@/i18n";
import { deferEffect } from "@/lib/deferEffect";
import { useDeviceText } from "./shared";
import { StickerLabel } from "./StickerLabel";
import { issueDay, stickerPng, type StickerText } from "./stickerLayout";

interface Props {
  device: RegisterDevice;
  onClose: () => void;
}

/** The QR of a link as a PNG data URL, made in the browser; null when it cannot be. */
export const qrDataUrl = async (url: string): Promise<string | null> => {
  try {
    const QRCode = (await import("qrcode")).default;
    return await QRCode.toDataURL(url, { margin: 2, width: 512, errorCorrectionLevel: "M" });
  } catch {
    return null;
  }
};

/** The body class the print stylesheet keys on (globals.css: only `.sticker-print-root` prints). */
export const PRINT_CLASS = "sticker-print";

export function PublicLinkDialog({ device, onClose }: Props) {
  const { t, date } = useDeviceText();
  const [state, setState] = useState<PublicLinkState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [issued, setIssued] = useState<IssuedPublicLink | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [labelPng, setLabelPng] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"rotate" | "revoke" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      setState(await publicDeviceService.state(device.id));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [device.id]);

  useEffect(() => deferEffect(load), [load]);

  const act = async (action: "issue" | "rotate" | "revoke") => {
    setConfirm(null);
    setBusy(true);
    setError(null);
    try {
      if (action === "revoke") {
        await publicDeviceService.revoke(device.id);
        setIssued(null);
        setQr(null);
        setLabelPng(null);
      } else {
        const link = action === "issue" ? await publicDeviceService.issue(device.id) : await publicDeviceService.rotate(device.id);
        setIssued(link);
        setQr(await qrDataUrl(link.url));
        setLabelPng(await stickerPng(link.url, stickerText(link)));
      }
      await load();
    } catch (err) {
      setError(describeApiError(err).message || t("devices.publicLink.failed"));
    } finally {
      setBusy(false);
    }
  };

  const stickerText = (link: IssuedPublicLink): StickerText => ({ name: device.name, qrNumber: device.qrCode ?? null, issued: issueDay(link.issuedAt) });

  // The label is rendered into <body> (outside the dialog) only while printing, so the print
  // stylesheet can lay it alone on a page the size of the label.
  const print = () => {
    flushSync(() => setPrinting(true));
    document.body.classList.add(PRINT_CLASS);
    try {
      window.print();
    } finally {
      document.body.classList.remove(PRINT_CLASS);
      setPrinting(false);
    }
  };

  const stateLine = (s: PublicLinkState): string => {
    if (!s.active) return t("devices.publicLink.none");
    const when = date(s.issuedAt);
    return s.issuedBy?.name ? t("devices.publicLink.activeBy", { date: when, name: s.issuedBy.name }) : t("devices.publicLink.active", { date: when });
  };

  return (
    <>
      <Dialog isOpen onClose={onClose} title={t("devices.publicLink.title", { name: device.name })} size="lg">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("devices.publicLink.lead")}</p>

          <div role="status" aria-live="polite">
            {loading && !state ? (
              <p className="text-sm text-muted-foreground">{t("devices.publicLink.loading")}</p>
            ) : loadFailed ? (
              <Alert variant="error" title={t("devices.publicLink.loadFailed")}>
                <Button size="sm" variant="outline" leftIcon={<RefreshCw className="h-4 w-4" aria-hidden="true" />} onClick={() => void load()}>
                  {t("devices.publicLink.retry")}
                </Button>
              </Alert>
            ) : state ? (
              <div className="space-y-2 text-sm">
                <p className="font-medium text-foreground">{stateLine(state)}</p>
                {state.lastRevokedAt && <p className="text-muted-foreground">{t("devices.publicLink.lastRevoked", { date: date(state.lastRevokedAt) })}</p>}
                <p className="text-muted-foreground">{t(`devices.publicLink.setting.${state.setting}` as MessageKey)}</p>
              </div>
            ) : null}
          </div>

          {error && (
            <div role="alert">
              <Alert variant="error" title={t("devices.publicLink.failed")}>
                <p>{error}</p>
              </Alert>
            </div>
          )}

          {state && !loadFailed && (
            <div className="flex flex-wrap gap-2">
              {state.active ? (
                <>
                  <Button variant="outline" disabled={busy} onClick={() => setConfirm("rotate")}>
                    {t("devices.publicLink.rotate")}
                  </Button>
                  <Button variant="danger" disabled={busy} onClick={() => setConfirm("revoke")}>
                    {t("devices.publicLink.revoke")}
                  </Button>
                </>
              ) : (
                <Button isLoading={busy} disabled={busy} onClick={() => void act("issue")}>
                  {t("devices.publicLink.issue")}
                </Button>
              )}
            </div>
          )}

          {issued && (
            <section aria-labelledby="public-link-sticker" className="space-y-3 rounded-lg border border-border p-4">
              <h3 id="public-link-sticker" className="text-sm font-semibold">
                {t("devices.publicLink.sticker")}
              </h3>
              <p className="text-sm text-muted-foreground print:hidden">{t("devices.publicLink.stickerLead")}</p>
              <div className="space-y-3">
                {qr ? (
                  <div className="max-w-full overflow-x-auto">
                    <StickerLabel qr={qr} qrAlt={t("devices.publicLink.qrAlt", { name: device.name })} text={stickerText(issued)} />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("devices.publicLink.qrFailed")}</p>
                )}
                <p className="break-all font-mono text-xs text-foreground">{issued.url}</p>
              </div>
              <div className="flex flex-wrap gap-2 print:hidden">
                <Button size="sm" variant="outline" leftIcon={<Printer className="h-4 w-4" aria-hidden="true" />} onClick={print}>
                  {t("devices.publicLink.print")}
                </Button>
                {qr && (
                  <a
                    href={labelPng ?? qr}
                    download={`sticker-${device.name.replace(/[^\w-]+/g, "_")}.png`}
                    className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-sm text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    {t("devices.publicLink.download")}
                  </a>
                )}
              </div>
            </section>
          )}

          <details className="rounded-lg border border-border p-3 text-sm">
            <summary className="cursor-pointer font-medium text-foreground">{t("devices.sticker.policy.title")}</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>{t("devices.sticker.policy.replace")}</li>
              <li>{t("devices.sticker.policy.keep")}</li>
              <li>{t("devices.sticker.policy.retired")}</li>
              <li>{t("devices.sticker.policy.deleted")}</li>
              <li>{t("devices.sticker.policy.remove")}</li>
              <li>{t("devices.sticker.policy.legacy")}</li>
            </ul>
          </details>

          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose}>
              {t("devices.publicLink.close")}
            </Button>
          </div>
        </div>
      </Dialog>
      <ConfirmDialog
        isOpen={confirm !== null}
        title={confirm === "revoke" ? t("devices.publicLink.revokeTitle") : t("devices.publicLink.rotateTitle")}
        description={confirm === "revoke" ? t("devices.publicLink.revokeBody", { name: device.name }) : t("devices.publicLink.rotateBody", { name: device.name })}
        confirmLabel={confirm === "revoke" ? t("devices.publicLink.revoke") : t("devices.publicLink.rotate")}
        cancelLabel={t("devices.cancel")}
        variant="danger"
        isLoading={busy}
        onConfirm={() => confirm && void act(confirm)}
        onCancel={() => setConfirm(null)}
      />
      {printing &&
        issued &&
        qr &&
        createPortal(
          <div className="sticker-print-root" aria-hidden="true">
            <StickerLabel qr={qr} qrAlt="" text={stickerText(issued)} />
          </div>,
          document.body,
        )}
    </>
  );
}
