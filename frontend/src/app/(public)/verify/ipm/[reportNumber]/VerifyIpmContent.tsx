"use client";
/**
 * P23-02 (P19-06 § 9) — the public verification of an IPM report. The report's QR encodes
 * `<base>/verify/ipm/<number>?t=<token>`; this page asks the PUBLIC endpoint
 * `GET /api/v1/ipm/verify/:number?token=` (no auth, rate-limited) and shows the verdict:
 *
 *  - a status band — issued, superseded (naming the newer report and its date, never its token) or
 *    voided (its date, never its reason) — the WORD with an icon, never colour alone;
 *  - the identity, the signatures each "valid" or "does not match this content", the scheme and hash;
 *  - **the hash recomputed IN THE BROWSER** from the served document (`canonicalIpmReportPayload` +
 *    `crypto.subtle`), so a reader need not trust the server's own `integrity.state`;
 *  - "Download the PDF", rendered here from the same document with the dashboard's renderer.
 *
 * Every refusal (unknown number, missing or wrong token) is ONE neutral "not found". The token is
 * read from `?t=` and sent to the API only: it never appears in a link, a history entry or the page.
 * The contracts module (with its schema library), the renderer, jsPDF and the font are loaded on
 * demand — the first load stays inside the `/verify/*` budget.
 */
import React, { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { CircleAlert, CircleCheck, CircleHelp, CircleX, Download, FileText } from "@/components/icons/static";
import { useI18n } from "@/i18n/MessagesProvider";
import { minutesFrom } from "@/i18n/apiErrors";
import type { Messages } from "@/i18n";
import type { components } from "@/api/typed";

type Verification = components["schemas"]["IpmVerification"];
type Recomputed = "pending" | "match" | "mismatch" | "unavailable";

/** SHA-256 hex of a text in the browser. */
export const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

/** The served document's hash, recomputed here; null when it cannot be (a preview, no WebCrypto). */
export const recomputeHash = async (doc: Verification["document"]): Promise<string | null> => {
  const { canonicalIpmReportPayload, ipmReportPayloadOfDocument } = await import("@callibrator/contracts/ipmReport");
  const payload = ipmReportPayloadOfDocument(doc as unknown as Parameters<typeof ipmReportPayloadOfDocument>[0]);
  if (!payload || typeof crypto === "undefined" || !crypto.subtle) return null;
  return sha256Hex(canonicalIpmReportPayload(payload));
};

const BAND: Record<Verification["status"] | "notFound", { color: string; Icon: typeof CircleCheck }> = {
  issued: { color: "var(--pub-success)", Icon: CircleCheck },
  superseded: { color: "var(--pub-warning)", Icon: CircleAlert },
  voided: { color: "var(--pub-danger)", Icon: CircleX },
  notFound: { color: "var(--pub-neutral)", Icon: CircleHelp },
};

function Row({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-1 border-b border-pub-border py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm text-pub-subtle">{label}</dt>
      <dd className={`min-w-0 text-[0.9375rem] text-pub-text ${mono ? "pub-mono break-all" : "break-words"}`}>{value}</dd>
    </div>
  );
}

export function VerifyIpmContent({ pdfMessages = {} }: { pdfMessages?: Partial<Messages> }) {
  const { t, locale } = useI18n();
  const params = useParams();
  const reportNumber = decodeURIComponent(String(params.reportNumber ?? ""));
  const token = useSearchParams().get("t") ?? "";
  const [data, setData] = useState<Verification | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [recomputed, setRecomputed] = useState<Recomputed>("pending");
  const [busy, setBusy] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch(`/api/v1/ipm/verify/${encodeURIComponent(reportNumber)}?token=${encodeURIComponent(token)}`);
        const json = (await res.json().catch(() => null)) as { data?: Verification; retryAfter?: number } | null;
        if (!active) return;
        if (res.status === 404) setNotFound(true);
        else if (res.status === 429) {
          const after = Number(json?.retryAfter ?? res.headers.get("retry-after"));
          setError(t("verifyIpm.error.rateLimited", { minutes: minutesFrom(Number.isFinite(after) ? after : null) }));
        } else if (!res.ok || !json?.data) setError(t("verifyIpm.error.generic"));
        else {
          const verdict = json.data;
          setData(verdict);
          try {
            const hash = await recomputeHash(verdict.document);
            if (active) setRecomputed(hash === null ? "unavailable" : hash === verdict.integrity.hash ? "match" : "mismatch");
          } catch {
            if (active) setRecomputed("unavailable");
          }
        }
      } catch {
        if (active) setError(t("verifyIpm.error.network"));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [reportNumber, token, t]);

  const tag = locale === "id" ? "id-ID" : "en-GB";
  const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(tag, { year: "numeric", month: "short", day: "numeric" }) : "—");

  const download = async () => {
    if (!data) return;
    setBusy(true);
    setDownloadFailed(false);
    try {
      const { downloadIpmReportPdf } = await import("@/lib/ipmReportDownload");
      await downloadIpmReportPdf(data.document, { messages: pdfMessages, language: locale === "id" ? "id" : "en", readerName: t("verifyIpm.reader") });
    } catch {
      setDownloadFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const status = notFound ? "notFound" : data?.status;
  const band = status ? BAND[status] : null;
  const lead = !data
    ? t("verifyIpm.lead.notFound")
    : data.status === "issued"
      ? t("verifyIpm.lead.issued", { issuer: data.issuer.name ?? "—" })
      : data.status === "superseded"
        ? t("verifyIpm.lead.superseded", { number: data.supersededBy?.reportNumber ?? "—", date: day(data.supersededBy?.at) })
        : t("verifyIpm.lead.voided", { date: day(data.voidedAt) });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="pub-eyebrow">{t("verifyIpm.eyebrow")}</h1>
      <p className="pub-mono mt-2 break-all text-lg text-pub-text">{reportNumber}</p>

      <div role="status" aria-live="polite" className="mt-6">
        {loading ? (
          <p className="text-pub-muted">{t("verifyIpm.loading")}</p>
        ) : error ? (
          <div className="pub-alert">{error}</div>
        ) : band && status ? (
          <div className="rounded-xl border-2 bg-pub-raised p-6 sm:p-8" style={{ borderColor: band.color }}>
            <p className="flex items-center gap-4">
              <band.Icon className="h-10 w-10 shrink-0 sm:h-12 sm:w-12" style={{ color: band.color }} aria-hidden="true" />
              <span className="pub-display pub-display-l" style={{ color: band.color }}>
                {t(`verifyIpm.status.${status}` as keyof Messages)}
              </span>
            </p>
            <p className="pub-body-l mt-4 text-pub-text">{lead}</p>
          </div>
        ) : null}
      </div>

      {data && (
        <div className="mt-6 space-y-6">
          <section aria-labelledby="verify-ipm-details" className="pub-card p-5">
            <h2 id="verify-ipm-details" className="text-base font-semibold text-pub-text">
              {t("verifyIpm.details")}
            </h2>
            <dl className="mt-2">
              <Row label={t("verifyIpm.field.number")} value={data.reportNumber} mono />
              <Row label={t("verifyIpm.field.issuer")} value={data.issuer.name ?? "—"} />
              <Row label={t("verifyIpm.field.facility")} value={data.facility.name} />
              <Row
                label={t("verifyIpm.field.device")}
                value={[data.device["name"], data.device["manufacturer"], data.device["model"], data.device["serialNumber"] ? `SN ${String(data.device["serialNumber"])}` : null, data.device["qrCode"]]
                  .filter(Boolean)
                  .join(" · ")}
              />
              <Row label={t("verifyIpm.field.visit")} value={data.visitNumber === null ? "—" : String(data.visitNumber).padStart(3, "0")} />
              <Row label={t("verifyIpm.field.performedAt")} value={day(data.performedAt)} />
              <Row label={t("verifyIpm.field.issuedAt")} value={day(data.issuedAt)} />
              <Row label={t("verifyIpm.field.recommendation")} value={data.recommendation ? t(`ipmReport.rec.${data.recommendation}` as keyof Messages) : "—"} />
              <Row label={t("verifyIpm.integrity", { scheme: data.integrity.scheme })} value={<span className="text-xs text-pub-muted">{data.integrity.hash}</span>} mono />
            </dl>
            <p className="pt-3 text-sm text-pub-text">{t(`verifyIpm.recomputed.${recomputed}` as keyof Messages)}</p>
          </section>

          <section aria-labelledby="verify-ipm-signatures" className="pub-card p-5">
            <h2 id="verify-ipm-signatures" className="text-base font-semibold text-pub-text">
              {t("verifyIpm.signatures")}
            </h2>
            {data.signatures.length === 0 ? (
              <p className="mt-2 text-sm text-pub-muted">{t("verifyIpm.signature.none")}</p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm text-pub-text">
                {data.signatures.map((sig) => (
                  <li key={sig.kind}>
                    <span className="font-semibold">{t(sig.kind === "performer" ? "ipmReport.sig.performer" : "ipmReport.sig.countersign")}</span>: {sig.name}
                    {sig.role ? ` (${sig.role})` : ""} · {day(sig.signedAt)} · {sig.valid ? t("verifyIpm.signature.valid") : t("verifyIpm.signature.invalid")}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="verify-ipm-document" className="pub-card p-5">
            <h2 id="verify-ipm-document" className="inline-flex items-center gap-2 text-base font-semibold text-pub-text">
              <FileText className="h-4 w-4" aria-hidden="true" /> {t("verifyIpm.document")}
            </h2>
            <button type="button" onClick={() => void download()} disabled={busy} aria-busy={busy} className="pub-btn pub-btn-secondary mt-3">
              <Download className="h-4 w-4" aria-hidden="true" />
              {t("verifyIpm.download")}
            </button>
            {downloadFailed && (
              <p role="alert" className="pub-field-error">
                {t("verifyIpm.downloadFailed")}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export default VerifyIpmContent;
