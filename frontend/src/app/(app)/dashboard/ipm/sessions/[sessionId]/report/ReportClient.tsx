"use client";

/**
 * P23-02 (P19-06 § 11, § 12) — the IPM report on screen: the ACCESSIBLE version of the report (the
 * PDF is not a tagged PDF). Drawn from the served data document: one `<main>`, one `<h1>`, the body in
 * an `<article>` whose language is the page's, each section a `<section aria-labelledby>`, tables
 * with captions and header scopes, results through the status-tone registry (text first), theme
 * tokens only.
 *
 * Actions (each named after its object):
 *  - **Download PDF** in the language chosen: a FRESH document read with `render=pdf` (the server
 *    audits it before answering, G-R10), rendered in the browser — never the copy on screen;
 *  - **Sign** — offered while the issued report is the visit's current record and has no performer
 *    signature, to an `esignature` writer who is not the platform operator; the server decides
 *    who the performer is (403 explained);
 *  - **Countersign** — offered once the performer signed, when the tenant's countersignature is
 *    on and none exists; the IPSRS rules are the server's (403 / 409 explained).
 */
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Download, PenLine, Shield } from "lucide-react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Alert, Button, Card, CardContent, StatusBadge } from "@/components/ui";
import { describeApiError } from "@/api/client";
import { ipmReportService, type IpmReportDocument } from "@/api/services/ipmReport.service";
import { usePermissions } from "@/hooks/usePermissions";
import { deferEffect } from "@/lib/deferEffect";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import { useI18n } from "@/i18n/MessagesProvider";
import type { Messages } from "@/i18n";
import { resultCells, zonedText } from "@/lib/ipmReportPdf";
import { SignReportDialog } from "../../../components/SignReportDialog";
import { FIELD } from "../../../components/shared";

/** The document's status as a badge state of the registry (`ipmSession`). */
const badgeState = (status: IpmReportDocument["status"]): string => (status === "submitted" ? "effective" : status);

export interface ReportClientProps {
  sessionId: string;
  /** The renderer's dictionaries, both languages (the PDF's language is chosen at download). */
  pdfMessages: { id: Partial<Messages>; en: Partial<Messages> };
  languageForm?: React.ReactNode;
}

export function ReportClient(props: ReportClientProps) {
  const { t, locale } = useI18n();
  const permissions = usePermissions();
  if (!permissions.loaded) {
    return (
      <DashboardLayout>
        <div lang={locale}>
          <h1 className="sr-only">{t("ipmReport.page.metaTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("ipmReport.page.loading")}</p>
        </div>
      </DashboardLayout>
    );
  }
  if (!permissions.canRead("ipm")) {
    return (
      <DashboardLayout>
        <div className="max-w-xl mx-auto py-20 text-center" lang={locale}>
          <Shield className="w-12 h-12 mx-auto mb-4 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-xl font-semibold text-foreground mb-2">{t("ipmReport.page.metaTitle")}</h1>
          <p className="text-muted-foreground">{t("ipmReport.page.restricted")}</p>
        </div>
      </DashboardLayout>
    );
  }
  return (
    <DashboardLayout>
      <div lang={locale}>
        <Report {...props} canSign={permissions.canWrite("esignature") && !permissions.superAdmin} />
      </div>
    </DashboardLayout>
  );
}

function Report({ sessionId, pdfMessages, languageForm, canSign }: ReportClientProps & { canSign: boolean }) {
  const { t, locale } = useI18n();
  const tag = locale === "id" ? "id-ID" : "en-GB";
  const user = useAuthStore((s) => s.user);
  const addToast = useToastStore((s) => s.addToast);
  const [doc, setDoc] = useState<IpmReportDocument | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [generation, setGeneration] = useState(0);
  const [pdfLanguage, setPdfLanguage] = useState<"id" | "en">(locale === "id" ? "id" : "en");
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState<string | null>(null);
  const [signing, setSigning] = useState<"performer" | "countersign" | null>(null);

  useEffect(
    () =>
      deferEffect(async () => {
        setError(null);
        try {
          setDoc(await ipmReportService.document(sessionId));
        } catch (err) {
          setError(err);
        }
      }),
    [sessionId, generation],
  );

  if (error !== null) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">{t("ipmReport.page.metaTitle")}</h1>
        <div role="alert">
          <Alert variant="error" title={t("ipmReport.page.failed")}>
            <p>{describeApiError(error).message}</p>
          </Alert>
        </div>
        <Link href="/dashboard/ipm" className="text-primary underline underline-offset-2">
          {t("ipmReport.page.history")}
        </Link>
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="mx-auto max-w-4xl">
        <h1 className="sr-only">{t("ipmReport.page.metaTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("ipmReport.page.loading")}</p>
      </div>
    );
  }

  const number = doc.reportNumber ?? "";
  const performer = doc.signatures.find((s) => s.kind === "performer");
  const countersign = doc.signatures.find((s) => s.kind === "countersign");
  const current = doc.kind === "issued" && doc.status === "submitted";
  const offerSign = canSign && current && !performer;
  const offerCountersign = canSign && current && Boolean(performer) && doc.countersignEnabled && !countersign;
  const translate = (key: string, values?: Record<string, string | number>) => t(key as keyof Messages, values);
  const readerName = user ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username : "—";

  const download = async () => {
    setDownloading(true);
    setDownloadFailed(null);
    try {
      const fresh = await ipmReportService.document(sessionId, { lang: pdfLanguage });
      const { downloadIpmReportPdf } = await import("@/lib/ipmReportDownload");
      await downloadIpmReportPdf(fresh, { messages: pdfMessages[pdfLanguage], language: pdfLanguage, readerName });
    } catch (err) {
      setDownloadFailed(describeApiError(err).message || t("ipmReport.page.downloadFailed"));
    } finally {
      setDownloading(false);
    }
  };

  const identity: [string, string][] = [
    [t("ipmReport.field.facility"), doc.facility.name],
    [t("ipmReport.field.performedAt"), zonedText(doc.performedAt, doc.timeZone, tag)],
    [t("ipmReport.field.room"), [doc.room, doc.floor].filter(Boolean).join(" · ") || "—"],
    [t("ipmReport.field.qr"), doc.device["qrCode"] ?? "—"],
    [t("ipmReport.field.make"), doc.device["manufacturer"] ?? "—"],
    [t("ipmReport.field.serial"), doc.device["serialNumber"] ?? "—"],
    [t("ipmReport.field.model"), [doc.device["model"], doc.device["deviceTypeName"]].filter(Boolean).join(" · ") || "—"],
    [t("ipmReport.field.lastCalibration"), doc.device["lastCalibrationDate"] ?? "—"],
    [t("ipmReport.field.nextCalibration"), doc.device["nextCalibrationDate"] ?? "—"],
    [t("ipmReport.field.reportNumber"), doc.reportNumber ?? "—"],
    [t("ipmReport.field.visit"), doc.visitNumber === null ? "—" : String(doc.visitNumber).padStart(3, "0")],
  ];
  const lineage = [
    doc.lineage.supersedesReportNumber ? t("ipmReport.lineage.supersedes", { number: doc.lineage.supersedesReportNumber }) : null,
    doc.lineage.supersededByReportNumber
      ? t("ipmReport.lineage.supersededBy", { number: doc.lineage.supersededByReportNumber, date: zonedText(doc.lineage.supersededAt, doc.timeZone, tag, false) })
      : null,
    doc.lineage.voidedAt ? t("ipmReport.lineage.voided", { date: zonedText(doc.lineage.voidedAt, doc.timeZone, tag, false) }) : null,
    doc.flags.imported ? t("ipmReport.lineage.imported") : null,
  ].filter((l): l is string => l !== null);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{doc.reportNumber ? t("ipmReport.page.title", { number }) : t("ipmReport.page.titlePreview")}</h1>
          <p className="text-sm text-muted-foreground">{doc.device["name"] ?? "—"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{languageForm}</div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge domain="ipmSession" state={badgeState(doc.status)}>
          {t(`ipmReport.page.status.${doc.status}` as keyof Messages)}
        </StatusBadge>
        {lineage.map((l) => (
          <span key={l} className="text-sm">
            {l}
          </span>
        ))}
      </div>

      <Card className="border-border">
        <CardContent className="pt-6 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label htmlFor="report-pdf-language" className="block text-sm font-semibold">
                {t("ipmReport.page.pdfLanguage")}
              </label>
              <select id="report-pdf-language" className={`${FIELD} min-h-11`} value={pdfLanguage} onChange={(e) => setPdfLanguage(e.target.value as "id" | "en")}>
                <option value="id" lang="id">
                  Bahasa Indonesia
                </option>
                <option value="en" lang="en">
                  English
                </option>
              </select>
            </div>
            <Button className="min-h-11" isLoading={downloading} leftIcon={<Download className="h-4 w-4" aria-hidden="true" />} onClick={() => void download()}>
              {doc.reportNumber ? t("ipmReport.page.download", { number }) : t("ipmReport.page.downloadPreview")}
            </Button>
            {offerSign && (
              <Button variant="outline" className="min-h-11" leftIcon={<PenLine className="h-4 w-4" aria-hidden="true" />} onClick={() => setSigning("performer")}>
                {t("ipmReport.page.sign", { number })}
              </Button>
            )}
            {offerCountersign && (
              <Button variant="outline" className="min-h-11" leftIcon={<PenLine className="h-4 w-4" aria-hidden="true" />} onClick={() => setSigning("countersign")}>
                {t("ipmReport.page.countersign", { number })}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t("ipmReport.page.notTagged")}</p>
          {downloadFailed && (
            <div role="alert">
              <Alert variant="error" title={t("ipmReport.page.downloadFailed")}>
                <p>{downloadFailed}</p>
              </Alert>
            </div>
          )}
        </CardContent>
      </Card>

      <article lang={locale} className="space-y-5">
        <section aria-labelledby="report-identity" className="space-y-2">
          <h2 id="report-identity" className="text-lg font-semibold">
            {t("ipmReport.page.identity")}
          </h2>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {identity.map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {doc.sections.map(({ section, items }) => (
          <section key={section} aria-labelledby={`report-${section}`} className="overflow-x-auto">
            <h2 id={`report-${section}`} className="text-base font-semibold">
              {t(`ipmCatalogue.section.${section}` as keyof Messages)}
            </h2>
            <table className="mt-1 w-full text-sm">
              <caption className="sr-only">{t(`ipmCatalogue.section.${section}` as keyof Messages)}</caption>
              <thead className="text-left">
                <tr className="border-b border-border">
                  <th scope="col" className="px-2 py-1 font-medium">
                    {t("ipmReport.col.item")}
                  </th>
                  <th scope="col" className="px-2 py-1 font-medium">
                    {t("ipmReport.col.result")}
                  </th>
                  <th scope="col" className="px-2 py-1 font-medium">
                    {t("ipmReport.col.value")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => {
                  const cells = resultCells(item, translate);
                  const outcome = typeof item["outcome"] === "string" ? item["outcome"] : null;
                  return (
                    <tr key={`${section}-${String(i)}`} className="border-b border-border last:border-0 align-top">
                      <th scope="row" className="px-2 py-1 text-left font-normal">
                        {String(item["label"] ?? "—")}
                      </th>
                      <td className="px-2 py-1">
                        {outcome === "fail" || outcome === "major_damage" || outcome === "not_done" || outcome === "empty" ? (
                          <StatusBadge domain="ipmRecommendation" state="needs_repair" size="sm">
                            {cells.result}
                          </StatusBadge>
                        ) : (
                          cells.result
                        )}
                      </td>
                      <td className="px-2 py-1">{cells.value || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}

        <section aria-labelledby="report-outcomes" className="space-y-2">
          <h2 id="report-outcomes" className="text-lg font-semibold">
            {t("ipmReport.page.outcomes")}
          </h2>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">{t("ipmReport.inspectionOutcome")}</dt>
              <dd>{doc.inspectionOutcome ? t(`ipmReport.overall.${doc.inspectionOutcome}` as keyof Messages) : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("ipmReport.maintenanceOutcome")}</dt>
              <dd>{doc.maintenanceOutcome ? t(`ipmReport.overall.${doc.maintenanceOutcome}` as keyof Messages) : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("ipmReport.recommendation")}</dt>
              <dd>
                {doc.recommendation ? (
                  <StatusBadge domain="ipmRecommendation" state={doc.recommendation}>
                    {t(`ipmReport.rec.${doc.recommendation}` as keyof Messages)}
                  </StatusBadge>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>
          <div className="text-sm">
            <p className="text-muted-foreground">{t("ipmReport.notes")}</p>
            <p className="whitespace-pre-wrap">{doc.notes ?? "-"}</p>
          </div>
        </section>

        <section aria-labelledby="report-signatures" className="space-y-2">
          <h2 id="report-signatures" className="text-lg font-semibold">
            {t("ipmReport.page.signatures")}
          </h2>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            {(["performer", "countersign"] as const).map((side) => {
              const sig = side === "performer" ? performer : countersign;
              return (
                <div key={side} className="rounded-md border border-border p-3">
                  <dt className="font-semibold">{t(side === "performer" ? "ipmReport.sig.performer" : "ipmReport.sig.countersign")}</dt>
                  <dd className="mt-1">
                    {sig ? (
                      <>
                        {t("ipmReport.sig.signed", {
                          name: sig.name,
                          role: [sig.role, sig.organisation].filter(Boolean).join(", ") || "—",
                          at: zonedText(sig.signedAt, doc.timeZone, tag),
                          meaning: t(`ipmReport.sig.meaning.${sig.meaning}` as keyof Messages),
                          hash: doc.integrity?.hash.slice(0, 12) ?? "",
                        })}
                        <span className="mt-1 block">
                          {sig.valid ? (
                            <StatusBadge domain="ipmSession" state="effective" size="sm">
                              {t("ipmReport.page.signedStatus")}
                            </StatusBadge>
                          ) : (
                            <span className="text-destructive">{t("ipmReport.sig.invalid")}</span>
                          )}
                        </span>
                      </>
                    ) : side === "performer" ? (
                      t("ipmReport.sig.notSigned", { name: doc.performer.name })
                    ) : doc.countersignEnabled ? (
                      t("ipmReport.sig.awaiting")
                    ) : (
                      t("ipmReport.page.noSignature")
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>

        {doc.integrity && (
          <section aria-labelledby="report-integrity" className="space-y-1">
            <h2 id="report-integrity" className="text-lg font-semibold">
              {t("ipmReport.page.integrity")}
            </h2>
            <p className={`break-all font-mono text-xs ${doc.integrity.state === "mismatch" ? "text-destructive" : ""}`}>
              {doc.integrity.state === "match"
                ? t("ipmReport.page.integrityMatch", { scheme: doc.integrity.scheme, hash: doc.integrity.hash })
                : t("ipmReport.page.integrityMismatch", { scheme: doc.integrity.scheme, hash: doc.integrity.hash })}
            </p>
          </section>
        )}
      </article>

      <Link href="/dashboard/ipm" className="inline-block text-primary underline underline-offset-2">
        {t("ipmReport.page.history")}
      </Link>

      {signing && doc.reportNumber && (
        <SignReportDialog
          sessionId={sessionId}
          reportNumber={doc.reportNumber}
          kind={signing}
          onClose={(signed) => {
            setSigning(null);
            if (signed) {
              addToast({ type: "success", title: t("ipmReport.sign.done") });
              setGeneration((g) => g + 1);
            }
          }}
        />
      )}
    </div>
  );
}
