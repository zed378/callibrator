"use client";

/**
 * P22-06 — the exports (/dashboard/exports; F-65 … F-69; ADR-126 § 8: rendered IN THE BROWSER from
 * paged API reads, PDF and XLSX alike; no backend file, no batch job, nothing stored):
 *
 *  - **the inventory list** — PDF (provider variant: A3, technician, inventory date, optional photo
 *    thumbnails, two signature blocks; facility variant: A4, device columns) or XLSX (13 columns,
 *    the latest calibration date and the inventory date apart). A PDF is ONE facility's (09 § 3.3):
 *    provider staff choose it; a facility-bound reader's is its own (the server scopes the reads);
 *  - **the calibration recaps** — XLSX by calibration date or input date over a day or a range, or the
 *    latest record per device (F-68, F-69); optionally one facility (provider staff).
 *
 * Every read is the caller's own, page by page (`lib/export/pagedRead`): the facility scope applies
 * to each page, and a facility filter only narrows. `calibration` read gates the page (both lists'
 * routes). Bilingual (the `exports.` namespace).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FileDown, Shield } from "lucide-react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent } from "@/components/ui";
import { calibrationDatesService } from "@/api/services/calibrationDates.service";
import { clientFacilityService, type ClientFacilityOption } from "@/api/services/clientFacility.service";
import { deviceRegisterService, type RegisterDevice } from "@/api/services/deviceRegister.service";
import { usePermissions } from "@/hooks/usePermissions";
import { deferEffect } from "@/lib/deferEffect";
import { useI18n } from "@/i18n/MessagesProvider";
import type { MessageKey } from "@/i18n";
import {
  byQr,
  inventoryFileName,
  inventoryRow,
  inventorySheet,
  recapFileName,
  recapSheet,
  type ColumnKey,
  type ExportLabels,
  type RecapChoice,
} from "@/lib/export/documents";
import { downloadBytes, measure, readAll, type FetchPage } from "@/lib/export/pagedRead";
import { XLSX_MIME, buildXlsx } from "@/lib/export/xlsx";
import { ExportJob, type ExportPlan } from "./components/ExportJob";

/** Above this many devices a PDF is built without photos (09 § 5.4; to be re-measured on the dry-run data, P23-03). */
export const PHOTO_ROW_LIMIT = 1000;
const FIELD =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Today (`YYYY-MM-DD`) in the browser's zone — a file name's date. */
export const todayText = (now: Date = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

export function ExportsClient({ languageForm }: { languageForm?: React.ReactNode }) {
  const { t, locale } = useI18n();
  const permissions = usePermissions();

  if (!permissions.loaded) {
    return (
      <DashboardLayout>
        <div lang={locale}>
          <h1 className="sr-only">{t("exports.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("exports.loading")}</p>
        </div>
      </DashboardLayout>
    );
  }
  if (!permissions.canRead("calibration")) {
    return (
      <DashboardLayout>
        <div className="max-w-xl mx-auto py-20 text-center" lang={locale}>
          <Shield className="w-12 h-12 mx-auto mb-4 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-xl font-semibold text-foreground mb-2">{t("exports.title")}</h1>
          <p className="text-muted-foreground">{t("exports.restricted")}</p>
        </div>
      </DashboardLayout>
    );
  }
  return (
    <DashboardLayout>
      <div lang={locale}>
        <Exports bound={permissions.facilityBound} languageForm={languageForm} />
      </div>
    </DashboardLayout>
  );
}

function Exports({ bound, languageForm }: { bound: boolean; languageForm?: React.ReactNode }) {
  const { t, locale } = useI18n();
  const [facilities, setFacilities] = useState<ClientFacilityOption[] | null>(bound ? [] : null);

  useEffect(() => {
    if (bound) return undefined;
    return deferEffect(async () => {
      try {
        setFacilities(await clientFacilityService.options());
      } catch {
        setFacilities([]);
      }
    });
  }, [bound]);

  const labels: ExportLabels = useMemo(
    () => ({
      col: (key: ColumnKey) => t(`exports.col.${key}` as MessageKey),
      condition: (value) => t(`exports.condition.${value ?? "unset"}` as MessageKey),
      redacted: t("exports.redacted"),
    }),
    [t],
  );
  const stamp = useMemo(() => new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", { dateStyle: "medium", timeStyle: "short" }), [locale]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileDown className="w-6 h-6 text-primary" aria-hidden="true" />
            {t("exports.title")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-3xl">{t("exports.lead")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{languageForm}</div>
      </div>
      <InventoryExport bound={bound} facilities={facilities} labels={labels} stamp={stamp} />
      <RecapExport bound={bound} facilities={facilities} labels={labels} />
    </div>
  );
}

interface SectionProps {
  bound: boolean;
  facilities: ClientFacilityOption[] | null;
  labels: ExportLabels;
}

function FacilitySelect({ id, facilities, value, onChange, allLabel }: { id: string; facilities: ClientFacilityOption[] | null; value: string; onChange: (v: string) => void; allLabel: string }) {
  const { t } = useI18n();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold">
        {t("exports.facility")}
      </label>
      <select id={id} className={FIELD} value={value} disabled={facilities === null} onChange={(e) => onChange(e.target.value)}>
        <option value="">{facilities === null ? t("exports.loading") : allLabel}</option>
        {(facilities ?? []).map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function InventoryExport({ bound, facilities, labels, stamp }: SectionProps & { stamp: Intl.DateTimeFormat }) {
  const { t } = useI18n();
  const [format, setFormat] = useState<"pdf" | "xlsx">("pdf");
  const [variant, setVariant] = useState<"provider" | "facility">("provider");
  const [withPhotos, setWithPhotos] = useState(false);
  const [facilityId, setFacilityId] = useState("");

  const facilityName = (facilities ?? []).find((f) => f.id === facilityId)?.name ?? null;
  const pageOf: FetchPage<RegisterDevice> = useCallback(
    (page, limit) => deviceRegisterService.list({ page, limit, sort: "id", ...(facilityId ? { clientFacilityId: facilityId } : {}) }),
    [facilityId],
  );
  const blocked = format === "pdf" && !bound && !facilityId ? t("exports.inventory.chooseFacility") : null;

  const plan: ExportPlan = {
    bytesPerRow: format === "xlsx" ? 140 : withPhotos && variant === "provider" ? 4200 : 160,
    measure: () => measure(pageOf),
    note: (rows) => (format === "pdf" && variant === "provider" && withPhotos && rows > PHOTO_ROW_LIMIT ? t("exports.inventory.photosOff", { limit: PHOTO_ROW_LIMIT }) : null),
    build: async (signal, progress) => {
      const devices = await readAll(pageOf, { signal, onProgress: (done, total) => progress({ stage: "rows", done, total }) });
      const rows = devices.map((d) => inventoryRow(d, labels));
      const today = new Date();
      const name = facilityName ?? (bound ? (rows[0]?.facility ?? null) : null);
      if (format === "xlsx") {
        progress({ stage: "building" });
        downloadBytes(buildXlsx(inventorySheet(rows, labels, t("exports.inventory.sheet"))), inventoryFileName(name, todayText(today), "xlsx"), XLSX_MIME);
        return;
      }
      let photos: Map<string, string> | null = null;
      if (variant === "provider" && withPhotos && rows.length <= PHOTO_ROW_LIMIT) {
        const { loadThumbnails } = await import("@/lib/export/photoThumbs");
        const ids = rows.flatMap((r) => [r.frontPhotoId, r.platePhotoId]).filter((v): v is string => v !== null);
        photos = await loadThumbnails(ids, { signal, onDone: (done, total) => progress({ stage: "photos", done, total }) });
      }
      progress({ stage: "building" });
      const { renderInventoryPdf } = await import("@/lib/export/inventoryPdf");
      const columns: ColumnKey[] =
        variant === "provider"
          ? ["no", "facility", "device", "make", "type", "qr", "serial", "room", "floor", "condition", "technician", "inventoryDate", "frontPhoto", "platePhoto"]
          : ["no", "device", "make", "type", "qr", "serial", "room", "floor", "condition"];
      const bytes = await renderInventoryPdf({
        variant,
        facilityName: name,
        rows: [...rows].sort(byQr),
        photos,
        generatedAt: stamp.format(today),
        labels: {
          title: t("exports.inventory.pdfTitle"),
          columns: columns.map(labels.col),
          generated: t("exports.pdf.generated"),
          page: t("exports.pdf.page"),
          performer: t("exports.pdf.performer"),
          facilitySide: t("exports.pdf.facilitySide"),
          none: "-",
        },
      });
      downloadBytes(bytes, inventoryFileName(name, todayText(today), "pdf"), "application/pdf");
    },
  };

  return (
    <Card className="border-border">
      <CardContent className="pt-6 space-y-4">
        <h2 className="text-lg font-semibold">{t("exports.inventory.heading")}</h2>
        <p className="text-sm text-muted-foreground">{t("exports.inventory.lead")}</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-semibold">{t("exports.format")}</legend>
            {(["pdf", "xlsx"] as const).map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm">
                <input type="radio" name="inventory-format" value={f} checked={format === f} onChange={() => setFormat(f)} />
                {t(`exports.format.${f}` as MessageKey)}
              </label>
            ))}
          </fieldset>
          {format === "pdf" && (
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-semibold">{t("exports.inventory.variant")}</legend>
              {(["provider", "facility"] as const).map((v) => (
                <label key={v} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="inventory-variant" value={v} checked={variant === v} onChange={() => setVariant(v)} />
                  {t(`exports.inventory.variant.${v}` as MessageKey)}
                </label>
              ))}
              {variant === "provider" && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={withPhotos} onChange={(e) => setWithPhotos(e.target.checked)} />
                  {t("exports.inventory.photos")}
                </label>
              )}
            </fieldset>
          )}
          {!bound && (
            <FacilitySelect
              id="inventory-facility"
              facilities={facilities}
              value={facilityId}
              onChange={setFacilityId}
              allLabel={format === "pdf" ? t("exports.chooseFacility") : t("exports.allFacilities")}
            />
          )}
        </div>
        <ExportJob id="inventory" plan={plan} blocked={blocked} planKey={`${format}|${variant}|${String(withPhotos)}|${facilityId}`} />
      </CardContent>
    </Card>
  );
}

/** Why the recap's choice cannot run yet, or null. */
export const recapProblem = (c: RecapChoice): "days" | "order" | null => {
  if (c.latestOnly) return null;
  if (!DAY.test(c.fromDay) || !DAY.test(c.toDay)) return "days";
  return c.fromDay > c.toDay ? "order" : null;
};

function RecapExport({ bound, facilities, labels }: SectionProps) {
  const { t } = useI18n();
  const today = todayText();
  const [choice, setChoice] = useState<RecapChoice>({ dateField: "calibration", fromDay: today, toDay: today, latestOnly: false });
  const [facilityId, setFacilityId] = useState("");
  const set = (patch: Partial<RecapChoice>) => setChoice((c) => ({ ...c, ...patch }));

  const pageOf: FetchPage<Awaited<ReturnType<typeof calibrationDatesService.listRecords>>["rows"][number]> = useCallback(
    (page, limit) =>
      calibrationDatesService.listRecords({
        page,
        limit,
        sort: choice.dateField === "created" ? "createdAt" : "calibrationDate",
        ...(choice.latestOnly ? { latestOnly: true } : { dateField: choice.dateField, fromDay: choice.fromDay, toDay: choice.toDay }),
        ...(facilityId ? { clientFacilityId: facilityId } : {}),
      }),
    [choice, facilityId],
  );
  const problem = recapProblem(choice);

  const plan: ExportPlan = {
    bytesPerRow: 150,
    measure: () => measure(pageOf),
    build: async (signal, progress) => {
      const records = await readAll(pageOf, { signal, onProgress: (done, total) => progress({ stage: "rows", done, total }) });
      progress({ stage: "building" });
      downloadBytes(buildXlsx(recapSheet(records, choice, labels, t("exports.recap.sheet"))), recapFileName(choice, todayText()), XLSX_MIME);
    },
  };

  return (
    <Card className="border-border">
      <CardContent className="pt-6 space-y-4">
        <h2 className="text-lg font-semibold">{t("exports.recap.heading")}</h2>
        <p className="text-sm text-muted-foreground">{t("exports.recap.lead")}</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={choice.latestOnly} onChange={(e) => set({ latestOnly: e.target.checked })} />
          {t("exports.recap.latestOnly")}
        </label>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {!choice.latestOnly && (
            <>
              <div className="space-y-1.5">
                <label htmlFor="recap-date-field" className="block text-sm font-semibold">
                  {t("exports.recap.dateField")}
                </label>
                <select id="recap-date-field" className={FIELD} value={choice.dateField} onChange={(e) => set({ dateField: e.target.value as RecapChoice["dateField"] })}>
                  <option value="calibration">{t("exports.recap.dateField.calibration")}</option>
                  <option value="created">{t("exports.recap.dateField.created")}</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="recap-from" className="block text-sm font-semibold">
                  {t("exports.recap.from")}
                </label>
                <input id="recap-from" type="date" className={FIELD} value={choice.fromDay} onChange={(e) => set({ fromDay: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="recap-to" className="block text-sm font-semibold">
                  {t("exports.recap.to")}
                </label>
                <input id="recap-to" type="date" className={FIELD} value={choice.toDay} onChange={(e) => set({ toDay: e.target.value })} />
              </div>
            </>
          )}
          {!bound && <FacilitySelect id="recap-facility" facilities={facilities} value={facilityId} onChange={setFacilityId} allLabel={t("exports.allFacilities")} />}
        </div>
        <ExportJob
          id="recap"
          plan={plan}
          blocked={problem ? t(`exports.recap.problem.${problem}` as MessageKey) : null}
          planKey={`${choice.dateField}|${choice.fromDay}|${choice.toDay}|${String(choice.latestOnly)}|${facilityId}`}
        />
      </CardContent>
    </Card>
  );
}
