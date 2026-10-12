"use client";
/**
 * P22-10c2 — Scan (P19-08 § 8.2): the camera (the browser's `BarcodeDetector`, ADR-127 Am. 2: no
 * JavaScript decoder), a typed code (always there: a broken camera, a damaged sticker, a handheld
 * scanner) and a search by name or serial. Offline the decrypted working set answers; online, a
 * code it does not hold is asked of the server (`by-qr`, the same 404 everywhere).
 */
import React, { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import { canScan } from "../canScan";
import type { FieldDevice } from "../../app/fieldApi";
import { ScreenTitle } from "../FieldApp";
import { useField, useFieldStoreApi, useFieldText } from "../context";
import { FIELD_INPUT, ScreenLink } from "./common";

/** The camera scanner (its dialog and the detector loop) loads when the camera is asked for. */
const QrScanner = React.lazy(() => import("@/app/(app)/dashboard/ipm/components/QrScanner").then((m) => ({ default: m.QrScanner })));

export function ScanScreen() {
  const { t } = useFieldText();
  const api = useFieldStoreApi();
  const online = useField((s) => s.online);
  const index = useField((s) => s.index);
  const [code, setCode] = useState("");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<FieldDevice[] | null>(null);
  const [scanning, setScanning] = useState(false);

  const lookup = useCallback(
    async (value: string) => {
      setFound(await api.getState().lookupQr(value));
    },
    [api],
  );
  const onCode = useCallback(
    (value: string) => {
      setScanning(false);
      setCode(value);
      void lookup(value);
    },
    [lookup],
  );
  const searching = query.trim() !== "";
  const results = searching ? index.search(query).slice(0, 50) : (found ?? []);

  return (
    <section className="space-y-4">
      <ScreenTitle>{t("field.scan.title")}</ScreenTitle>
      {canScan() ? <Button onClick={() => setScanning(true)}>{t("field.scan.camera")}</Button> : <p className="text-sm text-muted-foreground">{t("field.scan.noCamera")}</p>}
      {scanning && (
        <React.Suspense fallback={null}>
          <QrScanner onCode={onCode} onClose={() => setScanning(false)} />
        </React.Suspense>
      )}
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery("");
          void lookup(code);
        }}
      >
        <label htmlFor="field-scan-code" className="block text-sm font-semibold">
          {t("field.scan.codeLabel")}
        </label>
        <div className="flex gap-2">
          <input id="field-scan-code" className={FIELD_INPUT} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
          <Button type="submit" disabled={code.trim() === ""}>
            {t("field.scan.find")}
          </Button>
        </div>
      </form>
      <div className="space-y-2">
        <label htmlFor="field-scan-search" className="block text-sm font-semibold">
          {t("field.scan.searchLabel")}
        </label>
        <input id="field-scan-search" type="search" className={FIELD_INPUT} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {(found !== null || searching) &&
        (results.length === 0 ? (
          <p role="status" className="text-sm">
            {online ? t("field.scan.notFound") : t("field.scan.notOffline")}{" "}
            <ScreenLink view="register" className="underline">
              {t("field.home.register")}
            </ScreenLink>
          </p>
        ) : (
          <ul aria-label={t("field.scan.results")} className="divide-y divide-border rounded-md border border-border">
            {results.map((d) => (
              <li key={d.id}>
                <ScreenLink view="device" id={d.id} className="block min-h-11 px-3 py-2 text-sm hover:bg-muted">
                  <span className="font-medium">{d.name}</span>
                  <span className="block text-xs text-muted-foreground">{[d.qrCode, d.serialNumber, d.manufacturer, d.model].filter(Boolean).join(" · ")}</span>
                </ScreenLink>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}
