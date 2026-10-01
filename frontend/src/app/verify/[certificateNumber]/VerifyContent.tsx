"use client";
// ------------------------------------------------------------------
// Public certificate-validation content.
//
// A calibration certificate's QR encodes <CERT_VERIFY_BASE_URL>/<number>?t=<token>,
// which lands here. We call the PUBLIC backend endpoint
// GET /api/v1/certificates/verify/:number?token=<token> (no auth) and render the
// verdict, every field an assessor needs, and — for a signed certificate — its
// PDF, rendered here from the published document data (M-11, ADR-095). A PDF
// the backend stored before that change is still shown in a frame.
//
// A-293 (ADR-100): certificate numbers are sequential, so without the
// certificate's own token (an old QR code, a typed number) the backend answers
// the MINIMAL verdict — status, issuer, dates and hashes, no device, signer or
// document — and this page says the full details come with the QR code.
//
// P10-08 (ADR-098, doc 20 §10): restyled on the public surface. 14 § The
// Verification Page stays in force: verdict first at display size, the WORD
// carries the message (with an icon, never colour alone), not-found styled
// exactly like any other refusal, ZERO motion, nothing consequential below the
// fold. The accent never appears inside the verdict card (doc 20 §4.2: the
// accent and "success" differ only in hue). The verdict and the loading state
// are announced (role="status"). The internal status is never printed (05 V4).
// ------------------------------------------------------------------
import React, { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { CircleCheck, CircleX, CircleAlert, CircleHelp, FileText, ExternalLink, Download } from "@/components/icons/static";
import { toSameOriginApiPath } from "@/lib/uploadUrl";
import type { CertificateDocument, CertificateIntegrity } from "@/api/services/calibration.service";
import { useI18n } from "@/i18n/MessagesProvider";
import { minutesFrom } from "@/i18n/apiErrors";
import type { MessageKey } from "@/i18n";

interface VerifyData {
  found: boolean;
  /** A-293: "full" with the certificate's token, "minimal" without it. */
  disclosure?: "full" | "minimal";
  valid: boolean;
  status?: string;
  revoked?: boolean;
  expired?: boolean;
  /**
   * A-130 (F-11): the issuer deleted the certificate. The backend still
   * reports it (never as valid, and without its document) rather than
   * answering "not found", which would read as a forgery.
   */
  withdrawn?: boolean;
  certificateNumber?: string;
  type?: string;
  standard?: string | null;
  issuedTo?: string | null;
  device?: { name: string; serialNumber: string } | null;
  issueDate?: string | null;
  validUntil?: string | null;
  signedBy?: string | null;
  signedAt?: string | null;
  /** v1 — the hash printed on PDFs the backend rendered before M-11. */
  integrityHash?: string;
  /** v2 — the hash every PDF rendered since M-11 prints (ADR-095). */
  integrity?: CertificateIntegrity;
  verifyUrl?: string;
  /** A signed certificate's printed fields; null otherwise. */
  document?: CertificateDocument | null;
  /** A PDF the backend stored before M-11, behind a short-lived capability. */
  documentUrl?: string | null;
  message?: string;
}

type Verdict = "valid" | "revoked" | "withdrawn" | "expired" | "notFound" | "notYetValid";

/** The six verdicts the page computes (doc 20 §10, ADR-098 §10). */
export const verdictOf = (data: VerifyData): Verdict => {
  if (!data.found) return "notFound";
  if (data.valid) return "valid";
  if (data.revoked) return "revoked";
  if (data.withdrawn) return "withdrawn";
  if (data.expired) return "expired";
  return "notYetValid";
};

const VERDICT_STYLE: Record<Verdict, { color: string; Icon: typeof CircleCheck; word: MessageKey; lead: MessageKey }> = {
  valid: { color: "var(--pub-success)", Icon: CircleCheck, word: "verify.valid", lead: "verify.validLead" },
  expired: { color: "var(--pub-warning)", Icon: CircleAlert, word: "verify.expired", lead: "verify.expiredLead" },
  notYetValid: { color: "var(--pub-warning)", Icon: CircleAlert, word: "verify.notYetValid", lead: "verify.notYetValidLead" },
  revoked: { color: "var(--pub-danger)", Icon: CircleX, word: "verify.revoked", lead: "verify.revokedLead" },
  withdrawn: { color: "var(--pub-danger)", Icon: CircleX, word: "verify.withdrawn", lead: "verify.withdrawnLead" },
  // Not found is a neutral verdict, not styled as an accusation: a mistyped
  // number and a forged one must look the same (14 § The Verification Page).
  notFound: { color: "var(--pub-neutral)", Icon: CircleHelp, word: "verify.notFound", lead: "verify.notFoundLead" },
};

function VerdictCard({ verdict }: { verdict: Verdict }) {
  const { t } = useI18n();
  const { color, Icon, word, lead } = VERDICT_STYLE[verdict];
  return (
    <div className="rounded-xl border-2 bg-pub-raised p-6 sm:p-8" style={{ borderColor: color }}>
      <p className="flex items-center gap-4">
        <Icon className="h-10 w-10 shrink-0 sm:h-12 sm:w-12" style={{ color }} aria-hidden="true" />
        <span className="pub-display pub-display-l" style={{ color }}>
          {t(word)}
        </span>
      </p>
      <p className="pub-body-l mt-4 text-pub-text">{t(lead)}</p>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-1 border-b border-pub-border py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm text-pub-subtle">{label}</dt>
      <dd className={`min-w-0 text-[0.9375rem] text-pub-text ${mono ? "pub-mono break-all" : "break-words"}`}>{value}</dd>
    </div>
  );
}

/** Render the published document to a PDF, in the browser, and download it. */
function DownloadCertificate({ document: doc }: { document: CertificateDocument }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const onClick = async () => {
    setBusy(true);
    setFailed(false);
    try {
      // P10-13: loaded on the click, not with the page — the renderer (and the
      // jspdf and qrcode it pulls in) is needed only by someone who downloads.
      const { downloadCertificatePdf } = await import("@/lib/certificatePdf");
      await downloadCertificatePdf(doc);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="verify-document" className="pub-card p-5">
      <h2 id="verify-document" className="inline-flex items-center gap-2 text-base font-semibold text-pub-text">
        <FileText className="h-4 w-4" aria-hidden="true" /> {t("verify.document")}
      </h2>
      <p className="mb-4 mt-1 text-sm text-pub-muted">{t("verify.documentLead")}</p>
      <button type="button" onClick={onClick} disabled={busy} aria-busy={busy} className="pub-btn pub-btn-secondary">
        <Download className="h-4 w-4" aria-hidden="true" />
        {t("verify.download")}
      </button>
      {failed && (
        <p role="alert" className="pub-field-error">
          {t("verify.downloadFailed")}
        </p>
      )}
    </section>
  );
}

export function VerifyContent() {
  const { t, locale } = useI18n();
  const params = useParams();
  const certificateNumber = decodeURIComponent(String(params.certificateNumber ?? ""));
  // A-293: the verification token the certificate's QR code carries.
  const token = useSearchParams().get("t") ?? "";

  const [data, setData] = useState<VerifyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // Same-origin proxy forwards to the public backend endpoint (no auth).
        const query = token ? `?token=${encodeURIComponent(token)}` : "";
        const res = await fetch(`/api/v1/certificates/verify/${encodeURIComponent(certificateNumber)}${query}`);
        const json = await res.json().catch(() => null);
        if (!active) return;
        if (!res.ok || !json?.data) {
          // Never the backend's English message on a public page (doc 20 §5.7).
          if (res.status === 429) {
            const after = Number(json?.retryAfter ?? res.headers.get("retry-after"));
            setError(t("verify.error.rateLimited", { minutes: minutesFrom(Number.isFinite(after) ? after : null) }));
          } else {
            setError(t("verify.error.generic"));
          }
        } else {
          setData(json.data as VerifyData);
        }
      } catch {
        if (active) setError(t("verify.error.network"));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [certificateNumber, token, t]);

  const fmtDate = (d?: string | null) =>
    d
      ? new Date(d).toLocaleDateString(locale === "id" ? "id-ID" : "en-GB", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "—";

  // F-11: the document link is a same-origin `/api/v1/...` path, served by
  // the Next proxy — never prefixed with the backend origin, which the
  // auditor's browser cannot reach on the documented deployment.
  const pdfUrl = toSameOriginApiPath(data?.documentUrl);
  const minimal = data?.disclosure === "minimal";
  // The minimal verdict carries the v1 hash only inside `integrity`.
  const legacyHash = data?.integrityHash ?? data?.integrity?.legacyHash;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="pub-eyebrow">{t("verify.eyebrow")}</h1>
      <p className="pub-mono mt-2 break-all text-lg text-pub-text">{certificateNumber}</p>

      <div role="status" aria-live="polite" className="mt-6">
        {loading ? (
          <p className="text-pub-muted">{t("verify.loading")}</p>
        ) : error ? (
          <div className="pub-alert">{error}</div>
        ) : data ? (
          <VerdictCard verdict={verdictOf(data)} />
        ) : null}
      </div>

      {!loading && !error && data ? (
        <div className="mt-6 space-y-6">
          <p className="text-sm text-pub-muted">{t("verify.crossCheck")}</p>

          {data.found && (
            <>
              <section aria-labelledby="verify-details" className="pub-card p-5">
                <h2 id="verify-details" className="text-base font-semibold text-pub-text">
                  {t("verify.details")}
                </h2>
                <dl className="mt-2">
                  <Row label={t("verify.field.number")} value={data.certificateNumber} mono />
                  <Row label={t("verify.field.type")} value={<span className="capitalize">{data.type}</span>} />
                  {!minimal && <Row label={t("verify.field.standard")} value={data.standard || "—"} />}
                  <Row label={t("verify.field.issuedTo")} value={data.issuedTo || "—"} />
                  {!minimal && (
                    <Row
                      label={t("verify.field.device")}
                      value={data.device ? `${data.device.name} · SN ${data.device.serialNumber}` : "—"}
                    />
                  )}
                  <Row label={t("verify.field.issueDate")} value={fmtDate(data.issueDate)} />
                  <Row label={t("verify.field.validUntil")} value={fmtDate(data.validUntil)} />
                  {!minimal && (
                    <>
                      <Row label={t("verify.field.signedBy")} value={data.signedBy || "—"} />
                      <Row label={t("verify.field.signedAt")} value={fmtDate(data.signedAt)} />
                    </>
                  )}
                  {data.integrity && (
                    <Row
                      label={t("verify.field.integrity", { scheme: data.integrity.scheme })}
                      value={<span className="text-xs text-pub-muted">{data.integrity.hash}</span>}
                      mono
                    />
                  )}
                  {legacyHash ? (
                    <Row
                      label={data.integrity ? t("verify.field.integrityLegacy") : t("verify.field.integrityPlain")}
                      value={<span className="text-xs text-pub-muted">{legacyHash}</span>}
                      mono
                    />
                  ) : null}
                </dl>
                {minimal && <p className="pt-4 text-sm text-pub-muted">{t("verify.minimalNote")}</p>}
              </section>

              {data.document && <DownloadCertificate document={data.document} />}

              {/* A PDF the backend stored before M-11. */}
              {pdfUrl && (
                <section aria-labelledby="verify-stored" className="pub-card p-5">
                  <div className="mb-3 flex items-center justify-between gap-4">
                    <h2 id="verify-stored" className="inline-flex items-center gap-2 text-base font-semibold text-pub-text">
                      <FileText className="h-4 w-4" aria-hidden="true" /> {t("verify.stored")}
                    </h2>
                    <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="pub-link inline-flex items-center gap-1.5 text-sm">
                      {t("verify.openPdf")} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  </div>
                  <iframe
                    src={pdfUrl}
                    title={`Certificate ${data.certificateNumber}`}
                    className="h-[70vh] w-full rounded-md border border-pub-border bg-pub-raised"
                  />
                </section>
              )}
            </>
          )}

          <p className="text-center text-xs text-pub-subtle">{t("verify.realtime")}</p>
        </div>
      ) : null}
    </div>
  );
}

export default VerifyContent;
