"use client";
// src/app/request-access/components/RequestAccessForm.tsx
//
// P10-06 (doc 20 §8, spec P10-05 § API): the request-access intake. One column,
// labels above fields, help below, a field error per field plus a role="alert"
// summary that takes focus. The backend answers the SAME neutral 202 for a new
// request, a duplicate, an over-cap address and a honeypot hit; this page
// therefore has exactly one success state and promises no response time.
//
// The honeypot (`website`) is off-screen, out of the tab order and hidden from
// assistive technology, so it can never trap a real user.
import React, { useRef, useState } from "react";
import Link from "next/link";
import Spinner from "@/components/auth/Spinner";
import type { AccessRequestInput } from "@/api/services/auth.service";
import { loadAuthService } from "@/components/public/authApi";
import { usePrefetchOnFirstInput } from "@/hooks/usePrefetchOnFirstInput";
import { useI18n } from "@/i18n/MessagesProvider";
import { minutesFrom, readApiFailure } from "@/i18n/apiErrors";
import type { MessageKey } from "@/i18n";

/**
 * The consent text shown is versioned; the version is stored with the request.
 * 2026-10-01 (Q-42, ADR-113): the consent names the published privacy notice
 * and links to it; the form is shown only once that notice exists.
 */
export const CONSENT_VERSION = "2026-10-01";

const FACILITIES = ["hospital", "clinic", "calibration_lab", "other"] as const;
const BANDS = ["lt_100", "100_499", "500_1999", "gte_2000", "unknown"] as const;

type Field =
  | "organisationName"
  | "facilityType"
  | "city"
  | "deviceCountBand"
  | "contactName"
  | "contactRole"
  | "workEmail"
  | "whatsapp"
  | "needs"
  | "consent";

interface Values {
  organisationName: string;
  facilityType: string;
  city: string;
  deviceCountBand: string;
  contactName: string;
  contactRole: string;
  workEmail: string;
  whatsapp: string;
  needs: string;
  consent: boolean;
  website: string;
}

const EMPTY: Values = {
  organisationName: "",
  facilityType: "",
  city: "",
  deviceCountBand: "",
  contactName: "",
  contactRole: "",
  workEmail: "",
  whatsapp: "",
  needs: "",
  consent: false,
  website: "",
};

type FieldError = { key: MessageKey; values?: Record<string, number> };

/** `0812…` → `+62812…`; spaces, dashes, dots and brackets dropped (the backend does the same). */
export const normaliseWhatsapp = (raw: string): string => {
  const compact = raw.replace(/[\s().-]/g, "");
  if (compact.startsWith("0")) return `+62${compact.slice(1)}`;
  if (compact.startsWith("62")) return `+${compact}`;
  return compact;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_RE = /^\+[1-9]\d{7,14}$/;

/** The same rules the backend's schema applies (spec P10-05 § API, doc 20 §8.1). */
export const validateAccessRequest = (v: Values): Partial<Record<Field, FieldError>> => {
  const errors: Partial<Record<Field, FieldError>> = {};
  const len = (field: Field, value: string, min: number, max: number) => {
    const n = value.trim().length;
    if (n === 0) errors[field] = { key: "access.error.required" };
    else if (n < min || n > max) errors[field] = { key: "access.error.length", values: { min, max } };
  };
  len("organisationName", v.organisationName, 2, 160);
  if (!v.facilityType) errors.facilityType = { key: "access.error.required" };
  len("city", v.city, 2, 80);
  if (!v.deviceCountBand) errors.deviceCountBand = { key: "access.error.required" };
  len("contactName", v.contactName, 2, 120);
  if (v.contactRole.trim().length > 80) errors.contactRole = { key: "access.error.max", values: { max: 80 } };
  const email = v.workEmail.trim();
  if (!email) errors.workEmail = { key: "access.error.required" };
  else if (email.length > 254 || !EMAIL_RE.test(email)) errors.workEmail = { key: "access.error.email" };
  if (!v.whatsapp.trim()) errors.whatsapp = { key: "access.error.required" };
  else if (!E164_RE.test(normaliseWhatsapp(v.whatsapp))) errors.whatsapp = { key: "access.error.whatsapp" };
  if (v.needs.length > 2000) errors.needs = { key: "access.error.max", values: { max: 2000 } };
  if (!v.consent) errors.consent = { key: "access.error.consent" };
  return errors;
};

const ORDER: readonly Field[] = [
  "organisationName",
  "facilityType",
  "city",
  "deviceCountBand",
  "contactName",
  "contactRole",
  "workEmail",
  "whatsapp",
  "needs",
  "consent",
];

/** The id of the control a field's error points back to. */
const controlId = (field: Field) => (field === "facilityType" ? "ra-facilityType-hospital" : `ra-${field}`);

/** Field names from a 400 body: `errors[].field` (validate()) or `details[].path`. */
const serverFields = (body: unknown): Field[] => {
  const b = body as { errors?: Array<{ field?: unknown; path?: unknown }>; details?: Array<{ field?: unknown; path?: unknown }> };
  const list = [...(b?.errors ?? []), ...(b?.details ?? [])];
  const names = list.map((e) => {
    const raw = e.field ?? e.path;
    return Array.isArray(raw) ? String(raw[raw.length - 1]) : String(raw ?? "");
  });
  return ORDER.filter((f) => names.includes(f));
};

export function RequestAccessForm({ privacyNoticeUrl }: { privacyNoticeUrl: string }) {
  const { t, locale } = useI18n();
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<Field, FieldError>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  // P10-17 (presentation only): which of the two sections the visitor is in.
  // Both stay on the page and in the one <form>; the payload is unchanged.
  const [section, setSection] = useState<1 | 2>(1);
  // The summary lists what the last SUBMIT found (still unresolved); a blur
  // never adds to it, so the form never jumps under the pointer.
  const [summaryFields, setSummaryFields] = useState<Field[]>([]);
  const summaryRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  // P10-19: the API layer is not in the first load; it arrives with the first
  // key press or tap in the form (and is awaited on submit in any case).
  usePrefetchOnFirstInput(loadAuthService);

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    // P10-17: editing a field clears its own error (inline validation).
    if (key !== "website") {
      setErrors((prev) => {
        if (!prev[key as Field]) return prev;
        const next = { ...prev };
        delete next[key as Field];
        return next;
      });
    }
  };

  const errorText = (field: Field) => {
    const e = errors[field];
    return e ? t(e.key, e.values) : null;
  };

  const describedBy = (field: Field, help?: string) =>
    [help, errors[field] ? `ra-${field}-error` : null].filter(Boolean).join(" ") || undefined;

  const focusSummary = () => requestAnimationFrame(() => summaryRef.current?.focus());

  /**
   * P10-17: inline validation on blur, with the same rules as submit
   * (validateAccessRequest). Blur only ever ADDS an error, and only for a field
   * the visitor typed into; an error clears while the field is being edited
   * (`set`). A blur therefore never removes a line between a mousedown and its
   * click — the control under the pointer does not move.
   */
  const checkOnBlur = (field: Field) => {
    const value = values[field as keyof Values];
    const typed = typeof value === "string" ? value.trim().length > 0 : Boolean(value);
    if (!typed) return;
    const found = validateAccessRequest(values)[field];
    if (found) setErrors((prev) => ({ ...prev, [field]: found }));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const found = validateAccessRequest(values);
    setErrors(found);
    setSummaryFields(ORDER.filter((f) => found[f]));
    if (Object.keys(found).length > 0) {
      focusSummary();
      return;
    }
    const input: AccessRequestInput = {
      organisationName: values.organisationName.trim(),
      facilityType: values.facilityType as AccessRequestInput["facilityType"],
      city: values.city.trim(),
      deviceCountBand: values.deviceCountBand as AccessRequestInput["deviceCountBand"],
      contactName: values.contactName.trim(),
      ...(values.contactRole.trim() ? { contactRole: values.contactRole.trim() } : {}),
      workEmail: values.workEmail.trim(),
      whatsapp: values.whatsapp.trim(),
      ...(values.needs.trim() ? { needs: values.needs.trim() } : {}),
      consent: true,
      consentVersion: CONSENT_VERSION,
      locale,
      website: values.website,
    };
    setSubmitting(true);
    try {
      const authService = await loadAuthService();
      await authService.requestAccess(input);
      setDone(true);
      requestAnimationFrame(() => successRef.current?.focus());
    } catch (err) {
      const failure = readApiFailure(err);
      if (failure.status === 400) {
        const fields = serverFields(failure.body);
        if (fields.length > 0) {
          setErrors(Object.fromEntries(fields.map((f) => [f, { key: "access.error.invalid" as MessageKey }])));
          setSummaryFields(fields);
        } else {
          // Production 400s carry no field list (response.util): say "check the form".
          setFormError(t("access.error.check"));
        }
      } else if (failure.status === 429) {
        setFormError(t("access.error.rateLimited", { minutes: minutesFrom(failure.retryAfterSeconds) }));
      } else if (failure.status === null) {
        setFormError(t("access.error.network"));
      } else {
        setFormError(t("access.error.server"));
      }
      focusSummary();
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div role="status" className="auth-step">
        <h1 ref={successRef} tabIndex={-1} className="pub-display pub-display-m text-pub-text outline-none">
          {t("access.success.title")}
        </h1>
        <p className="pub-body-l mt-4 text-pub-muted">
          {t("access.success.summary", { name: values.contactName.trim(), organisation: values.organisationName.trim() })}{" "}
          {t("access.success.body")}
        </p>
        {/* Honest next steps — the same three as the landing; no time, price or SLA. */}
        <h2 className="mt-10 text-sm font-semibold uppercase tracking-[0.08em] text-pub-subtle">{t("access.success.nextTitle")}</h2>
        <ol className="mt-4 space-y-5 border-l border-pub-gold pl-5">
          {(
            [
              ["landing.work.step1", "landing.work.step1Text"],
              ["landing.work.step2", "landing.work.step2Text"],
              ["landing.work.step3", "landing.work.step3Text"],
            ] as const
          ).map(([title, text], i) => (
            <li key={title}>
              <p className="font-semibold text-pub-text">
                {i + 1}. {t(title)}
              </p>
              <p className="mt-1 text-[0.9375rem] text-pub-muted">{t(text)}</p>
            </li>
          ))}
        </ol>
        <p className="mt-10">
          <Link href="/" className="pub-link">
            {t("access.success.home")}
          </Link>
        </p>
      </div>
    );
  }

  const errorFields = summaryFields.filter((f) => errors[f]);

  const text = (field: Exclude<Field, "facilityType" | "deviceCountBand" | "consent" | "needs">, opts: {
    label: MessageKey;
    type?: string;
    autoComplete: string;
    required?: boolean;
    help?: MessageKey;
    inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  }) => {
    const helpId = opts.help ? `ra-${field}-help` : undefined;
    const required = opts.required ?? true;
    return (
      <div>
        <label htmlFor={`ra-${field}`} className="pub-label">
          {t(opts.label)}
          {required ? null : <span className="font-normal text-pub-subtle"> ({t("access.optional")})</span>}
        </label>
        <input
          id={`ra-${field}`}
          name={field}
          type={opts.type ?? "text"}
          inputMode={opts.inputMode}
          autoComplete={opts.autoComplete}
          required={required}
          aria-required={required}
          value={values[field]}
          onChange={(e) => set(field, e.target.value)}
          onBlur={() => checkOnBlur(field)}
          aria-invalid={errors[field] ? true : undefined}
          aria-describedby={describedBy(field, helpId)}
          className="pub-input"
        />
        {opts.help ? (
          <p id={helpId} className="pub-help">
            {t(opts.help)}
          </p>
        ) : null}
        {errors[field] ? (
          <p id={`ra-${field}-error`} className="pub-field-error">
            {errorText(field)}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <div>
      <h1 className="pub-display pub-display-m text-pub-text">{t("access.title")}</h1>
      <p className="mt-3 text-pub-muted">{t("access.lead")}</p>

      {/* Calm progress over the two sections (focus-driven; nothing is hidden). */}
      <ol className="auth-progress mt-8" aria-label={t("access.step", { n: section, total: 2 })}>
        {([1, 2] as const).map((n) => (
          <li key={n} aria-current={section === n ? "step" : undefined} data-done={section > n ? "true" : undefined}>
            <span className="font-semibold">{n}</span> · {t(n === 1 ? "access.section.institution" : "access.section.contact")}
          </li>
        ))}
      </ol>

      <div ref={summaryRef} tabIndex={-1} className="mt-6 outline-none">
        {errorFields.length > 0 || formError ? (
          <div role="alert" className="pub-alert auth-alert-in">
            <div>
              <p className="font-semibold">{formError ?? t("access.errorSummary")}</p>
              {errorFields.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-pub-muted">
                  {errorFields.map((f) => (
                    <li key={f}>
                      <a href={`#${controlId(f)}`} className="pub-link">
                        {t(`access.${f}` as MessageKey)}
                      </a>
                      {": "}
                      {errorText(f)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-8">
        <fieldset className="space-y-5" onFocus={() => setSection(1)}>
          <legend className="mb-4 text-sm font-semibold uppercase tracking-wide text-pub-subtle">
            {t("access.section.institution")}
          </legend>
          {text("organisationName", { label: "access.organisationName", autoComplete: "organization" })}

          <fieldset aria-describedby={errors.facilityType ? "ra-facilityType-error" : undefined}>
            <legend className="pub-label">{t("access.facilityType")}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {FACILITIES.map((f) => (
                <label
                  key={f}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-pub-border-strong bg-pub-raised px-3 text-[0.9375rem] has-[:checked]:border-pub-accent"
                >
                  <input
                    id={`ra-facilityType-${f}`}
                    type="radio"
                    name="facilityType"
                    value={f}
                    checked={values.facilityType === f}
                    onChange={() => set("facilityType", f)}
                    className="pub-check mt-0"
                  />
                  {t(`access.facility.${f}` as MessageKey)}
                </label>
              ))}
            </div>
            {errors.facilityType ? (
              <p id="ra-facilityType-error" className="pub-field-error">
                {errorText("facilityType")}
              </p>
            ) : null}
          </fieldset>

          {text("city", { label: "access.city", autoComplete: "address-level2" })}

          <div>
            <label htmlFor="ra-deviceCountBand" className="pub-label">
              {t("access.deviceCountBand")}
            </label>
            <select
              id="ra-deviceCountBand"
              name="deviceCountBand"
              required
              value={values.deviceCountBand}
              onChange={(e) => set("deviceCountBand", e.target.value)}
              aria-invalid={errors.deviceCountBand ? true : undefined}
              aria-describedby={describedBy("deviceCountBand")}
              className="pub-input"
            >
              <option value="">{t("access.band.choose")}</option>
              {BANDS.map((b) => (
                <option key={b} value={b}>
                  {t(`access.band.${b}` as MessageKey)}
                </option>
              ))}
            </select>
            {errors.deviceCountBand ? (
              <p id="ra-deviceCountBand-error" className="pub-field-error">
                {errorText("deviceCountBand")}
              </p>
            ) : null}
          </div>
        </fieldset>

        <fieldset className="space-y-5" onFocus={() => setSection(2)}>
          <legend className="mb-4 text-sm font-semibold uppercase tracking-wide text-pub-subtle">
            {t("access.section.contact")}
          </legend>
          {text("contactName", { label: "access.contactName", autoComplete: "name" })}
          {text("contactRole", { label: "access.contactRole", autoComplete: "organization-title", required: false })}
          {text("workEmail", { label: "access.workEmail", type: "email", autoComplete: "email", inputMode: "email" })}
          {text("whatsapp", {
            label: "access.whatsapp",
            type: "tel",
            autoComplete: "tel",
            inputMode: "tel",
            help: "access.whatsappHelp",
          })}
          <div>
            <label htmlFor="ra-needs" className="pub-label">
              {t("access.needs")}
              <span className="font-normal text-pub-subtle"> ({t("access.optional")})</span>
            </label>
            <textarea
              id="ra-needs"
              name="needs"
              maxLength={2000}
              value={values.needs}
              onChange={(e) => set("needs", e.target.value)}
              aria-invalid={errors.needs ? true : undefined}
              aria-describedby={describedBy("needs", "ra-needs-help")}
              className="pub-input"
            />
            <p id="ra-needs-help" className="pub-help">
              {t("access.needsHelp")}
            </p>
            {errors.needs ? (
              <p id="ra-needs-error" className="pub-field-error">
                {errorText("needs")}
              </p>
            ) : null}
          </div>
        </fieldset>

        {/* Honeypot: off-screen, not focusable, not announced. A person never fills it. */}
        <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
          <label htmlFor="ra-website">{t("access.honeypot")}</label>
          <input
            id="ra-website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={values.website}
            onChange={(e) => set("website", e.target.value)}
          />
        </div>

        <div>
          <div className="flex items-start gap-3">
            <input
              id="ra-consent"
              name="consent"
              type="checkbox"
              checked={values.consent}
              onChange={(e) => set("consent", e.target.checked)}
              required
              aria-invalid={errors.consent ? true : undefined}
              aria-describedby={describedBy("consent")}
              className="pub-check"
            />
            <label htmlFor="ra-consent" className="text-[0.9375rem] text-pub-muted">
              {t("access.consent.before")}
              <a href={privacyNoticeUrl} className="pub-link" target="_blank" rel="noopener noreferrer">
                {t("access.consent.notice")}
                <span className="sr-only"> ({t("access.newTab")})</span>
              </a>
              {t("access.consent.after")}
            </label>
          </div>
          {errors.consent ? (
            <p id="ra-consent-error" className="pub-field-error">
              {errorText("consent")}
            </p>
          ) : null}
        </div>

        <button type="submit" disabled={submitting} aria-busy={submitting} className="pub-btn pub-btn-primary pub-btn-block">
          {submitting ? (
            <>
              <Spinner />
              <span>{t("access.busy")}</span>
            </>
          ) : (
            <span>{t("access.submit")}</span>
          )}
        </button>
      </form>

      <p className="mt-8 text-center text-[0.9375rem]">
        <Link href="/login" className="pub-link inline-flex min-h-11 items-center">
          {t("access.haveAccount")}
        </Link>
      </p>
    </div>
  );
}

export default RequestAccessForm;
