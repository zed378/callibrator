// P21-15 (ADR-140; spec v2 § 5) — the body of the public e-signature verification: the backend's
// verdict for the link, rendered on the server. A server component (no "use client"): it reads the
// request (params, search params, headers) inside the page's Suspense boundary.
import React from "react";
import { headers } from "next/headers";
import { CircleAlert, CircleCheck, CircleX } from "@/components/icons/static";
import type { MessageKey, Translate } from "@/i18n";
import type { Locale } from "@/i18n/config";
import { readPublicEsignature, specimenDataUri, type PublicEsignature } from "@/lib/publicEsignature.server";
import { HashCheck } from "./HashCheck";

const BAND: Record<PublicEsignature["verdict"], { color: string; Icon: typeof CircleCheck }> = {
  valid: { color: "var(--pub-success)", Icon: CircleCheck },
  content_changed: { color: "var(--pub-warning)", Icon: CircleAlert },
  invalid: { color: "var(--pub-danger)", Icon: CircleX },
};

/** A calendar day (`YYYY-MM-DD` or an ISO instant) in the page's language, never shifted by a time zone. */
export const formatDay = (value: string | null, locale: Locale): string => {
  const day = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  if (!day) return "—";
  return new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]))),
  );
};

function Row({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-1 border-b border-pub-border py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm text-pub-subtle">{label}</dt>
      <dd className={`min-w-0 text-[0.9375rem] text-pub-text ${mono ? "pub-mono break-all" : "break-words"}`}>{value}</dd>
    </div>
  );
}

function Message({ title, body, t }: { title: MessageKey; body: MessageKey; t: Translate }) {
  return (
    <>
      <p className="pub-eyebrow">{t("publicEsig.eyebrow")}</p>
      <h1 className="pub-display pub-display-m mt-2 text-pub-text">{t(title)}</h1>
      <p className="mt-4 text-pub-muted">{t(body)}</p>
    </>
  );
}

/** The verdict, read in the request. */
export async function EsignatureContent({
  params,
  searchParams,
  locale,
  t,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string | string[] }>;
  locale: Locale;
  t: Translate;
}) {
  const { id } = await params;
  const raw = (await searchParams).t;
  const token = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
  const outcome = await readPublicEsignature(id, token, await headers());
  if (outcome.kind === "not_found") return <Message title="publicEsig.notFound.title" body="publicEsig.notFound.body" t={t} />;
  if (outcome.kind === "rate_limited") return <Message title="publicEsig.rateLimited.title" body="publicEsig.rateLimited.body" t={t} />;
  if (outcome.kind === "failed") return <Message title="publicEsig.failed.title" body="publicEsig.failed.body" t={t} />;

  const v = outcome.verdict;
  const band = BAND[v.verdict];
  const summary = v.summary;
  return (
    <>
      <p className="pub-eyebrow">{t("publicEsig.eyebrow")}</p>
      <div className="mt-4 rounded-xl border-2 bg-pub-raised p-6 sm:p-8" style={{ borderColor: band.color }}>
        <h1 className="flex items-center gap-4">
          <band.Icon className="h-10 w-10 shrink-0" style={{ color: band.color }} aria-hidden="true" />
          <span className="pub-display pub-display-m" style={{ color: band.color }}>
            {t(`publicEsig.verdict.${v.verdict}` as MessageKey)}
          </span>
        </h1>
        <p className="pub-body-l mt-4 text-pub-text">{locale === "id" ? v.explanation.id : v.explanation.en}</p>
        {v.esignatureState !== "active" && v.esignatureStateAt && (
          <p className="mt-3 text-sm text-pub-text">{t(`publicEsig.state.${v.esignatureState}` as MessageKey, { date: formatDay(v.esignatureStateAt, locale) })}</p>
        )}
        {v.documentState && v.documentState !== "current" && (
          <p className="mt-2 text-sm text-pub-text">{t(`publicEsig.doc.${v.documentState}` as MessageKey, { date: formatDay(v.documentStateAt, locale) })}</p>
        )}
      </div>

      <section aria-labelledby="esig-specimen" className="pub-card mt-6 p-5">
        <h2 id="esig-specimen" className="text-base font-semibold text-pub-text">
          {t("publicEsig.specimen")}
        </h2>
        {/* eslint-disable-next-line @next/next/no-img-element -- a data URI of the sanitised specimen; next/image does not take one, and an <img> never runs script */}
        <img src={specimenDataUri(v.specimenSvg)} alt={`${t("publicEsig.specimen")}: ${v.signer.name}`} className="mt-3 h-24 w-auto max-w-full rounded border border-pub-border bg-pub-raised p-2" />
      </section>

      <section aria-labelledby="esig-details" className="pub-card mt-6 p-5">
        <h2 id="esig-details" className="text-base font-semibold text-pub-text">
          {t("publicEsig.details")}
        </h2>
        <dl className="mt-2">
          <Row label={t("publicEsig.field.signer")} value={[v.signer.name, v.signer.role, v.signer.organisation].filter(Boolean).join(" · ")} />
          <Row label={t("publicEsig.field.meaning")} value={t(`publicEsig.meaning.${v.meaning}` as MessageKey)} />
          <Row label={t("publicEsig.field.signedAt")} value={formatDay(v.signedAt, locale)} />
          <Row label={t("publicEsig.field.organisation")} value={v.organisation.name ?? "—"} />
          <Row label={t("publicEsig.field.document")} value={`${t(`publicEsig.type.${v.documentType}` as MessageKey)} — ${v.documentTitle}`} />
          {summary && (
            <>
              <Row label={t("publicEsig.field.device")} value={[summary.deviceName, summary.brand, summary.model, summary.serialNumber ? `SN ${summary.serialNumber}` : null].filter(Boolean).join(" · ") || "—"} />
              <Row label={t("publicEsig.field.calibrationDate")} value={formatDay(summary.calibrationDate, locale)} />
              <Row label={t("publicEsig.field.dueDate")} value={formatDay(summary.dueDate, locale)} />
              <Row label={t("publicEsig.field.compliant")} value={summary.isCompliant === null ? "—" : t(summary.isCompliant ? "publicEsig.compliant.true" : "publicEsig.compliant.false")} />
            </>
          )}
          <Row label={t("publicEsig.field.fingerprint")} value={<span className="text-xs">{v.keyFingerprint}</span>} mono />
          <Row label={t("publicEsig.field.hash")} value={<span className="text-xs">{v.contentHash}</span>} mono />
        </dl>
        <p className="pt-3 text-sm text-pub-muted">{t("publicEsig.notCertificate")}</p>
      </section>

      <HashCheck
        scheme={v.contentScheme}
        contentHash={v.contentHash}
        canonicalContent={v.canonicalContent}
        labels={{
          title: t("publicEsig.check.title"),
          intro: v.documentType === "document" ? t("publicEsig.check.document") : t("publicEsig.check.record"),
          run: t("publicEsig.check.run"),
          file: t("publicEsig.check.file"),
          match: t("publicEsig.check.match"),
          mismatch: t("publicEsig.check.mismatch"),
          unavailable: t("publicEsig.check.unavailable"),
        }}
      />

      <details className="pub-card mt-6 p-5">
        <summary className="cursor-pointer text-sm font-semibold text-pub-text">{t("publicEsig.publicKey")}</summary>
        <pre className="pub-mono mt-3 overflow-x-auto whitespace-pre-wrap break-all text-xs text-pub-muted">{v.publicKeyPem}</pre>
      </details>
    </>
  );
}
