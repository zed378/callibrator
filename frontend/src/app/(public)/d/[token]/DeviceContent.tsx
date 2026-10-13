// P22-08 (ADR-138 § 7; spec MEMORY/specs/P19-07-public-device-page.md § 10) — the body of the public
// device page: the backend's answer for the token, rendered on the server. A server component (no
// "use client"): it reads the request (params, headers) inside the page's Suspense boundary.
import React from "react";
import { headers } from "next/headers";
import { CircleAlert, CircleCheck, CircleHelp, CircleX, ExternalLink } from "@/components/icons/static";
import type { MessageKey, Translate } from "@/i18n";
import type { Locale } from "@/i18n/config";
import { readPublicDevice, type PublicDevice } from "@/lib/publicDevice.server";

type Status = PublicDevice["calibration"]["status"];

const BAND: Record<Status, { color: string; Icon: typeof CircleCheck }> = {
  current: { color: "var(--pub-success)", Icon: CircleCheck },
  due_soon: { color: "var(--pub-warning)", Icon: CircleAlert },
  overdue: { color: "var(--pub-danger)", Icon: CircleX },
  retired: { color: "var(--pub-neutral)", Icon: CircleX },
  not_scheduled: { color: "var(--pub-neutral)", Icon: CircleHelp },
};

/** A calendar day (`YYYY-MM-DD`) in the page's language, never shifted by a time zone. */
export const formatDay = (value: string | null, locale: Locale, none: string): string => {
  const day = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  if (!day) return none;
  return new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]))),
  );
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-1 border-b border-pub-border py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm text-pub-subtle">{label}</dt>
      <dd className="min-w-0 break-words text-[0.9375rem] text-pub-text">{value}</dd>
    </div>
  );
}

function Message({ title, body, t }: { title: MessageKey; body: MessageKey; t: Translate }) {
  return (
    <>
      <p className="pub-eyebrow">{t("publicDevice.eyebrow")}</p>
      <h1 className="pub-display pub-display-m mt-2 text-pub-text">{t(title)}</h1>
      <p className="mt-4 text-pub-muted">{t(body)}</p>
    </>
  );
}

/** The device, read in the request (params and headers are request data: inside the Suspense boundary). */
export async function DeviceContent({ params, locale, t }: { params: Promise<{ token: string }>; locale: Locale; t: Translate }) {
  const { token } = await params;
  const outcome = await readPublicDevice(token, await headers());
  if (outcome.kind === "not_found") return <Message title="publicDevice.notFound.title" body="publicDevice.notFound.body" t={t} />;
  if (outcome.kind === "rate_limited") return <Message title="publicDevice.rateLimited.title" body="publicDevice.rateLimited.body" t={t} />;
  if (outcome.kind === "failed") return <Message title="publicDevice.failed.title" body="publicDevice.failed.body" t={t} />;

  const { device, facility, calibration, lastIpmDate, report } = outcome.device;
  const none = t("publicDevice.notRecorded");
  const band = BAND[calibration.status];
  const note = calibration.status === "retired" ? "publicDevice.retiredNote" : calibration.status === "overdue" ? "publicDevice.overdueNote" : null;
  return (
    <>
      <p className="pub-eyebrow">{t("publicDevice.eyebrow")}</p>
      <h1 className="pub-display pub-display-m mt-2 break-words text-pub-text">{device.name}</h1>
      <p className="mt-6 flex items-center gap-3 rounded-lg border border-pub-border px-4 py-3 text-pub-text" style={{ borderLeft: `4px solid ${band.color}` }}>
        <band.Icon className="h-6 w-6 shrink-0" style={{ color: band.color }} aria-hidden="true" />
        <span className="font-semibold">{t(`publicDevice.status.${calibration.status}` as MessageKey)}</span>
      </p>
      {note && <p className="mt-3 font-medium text-pub-text">{t(note)}</p>}
      <dl className="mt-6 border-t border-pub-border">
        <Row label={t("publicDevice.field.type")} value={device.type ?? none} />
        <Row label={t("publicDevice.field.manufacturer")} value={device.manufacturer ?? none} />
        <Row label={t("publicDevice.field.model")} value={device.model ?? none} />
        <Row label={t("publicDevice.field.facility")} value={facility.name} />
        <Row label={t("publicDevice.field.calibration")} value={t(`publicDevice.status.${calibration.status}` as MessageKey)} />
        {calibration.status !== "retired" && <Row label={t("publicDevice.field.nextDue")} value={formatDay(calibration.nextDueDate, locale, none)} />}
        <Row label={t("publicDevice.field.lastIpm")} value={formatDay(lastIpmDate, locale, none)} />
      </dl>
      {report && (
        <p className="mt-6">
          <a href={report.verifyUrl} rel="noreferrer" className="pub-link inline-flex items-center gap-2">
            {t("publicDevice.report")} <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        </p>
      )}
      <p className="mt-8 text-sm text-pub-muted">{t("publicDevice.readAt")}</p>
    </>
  );
}
