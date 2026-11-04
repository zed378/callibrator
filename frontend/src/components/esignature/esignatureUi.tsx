"use client";
/**
 * P21-15 (ADR-140) — the pieces every e-signature screen shares: the specimen as an image, the
 * credential fields, the verification QR, one application's card, and the API error's code and
 * explanation (a 409 is shown as its explanation, never as a generic failure).
 */
import React, { useEffect, useState } from "react";
import { Input, Select } from "@/components/ui";
import { ExternalLink, ShieldCheck } from "lucide-react";
import type { EsignatureApplication } from "@/api/services/personalEsignature.service";

/** A specimen SVG as an `<img>` source: an image never runs script, whatever the SVG holds. */
export const specimenSrc = (svg: string): string => {
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
};

export function SpecimenImage({ svg, alt, className = "h-16" }: { svg: string; alt: string; className?: string }) {
  if (!svg) return null;
  // eslint-disable-next-line @next/next/no-img-element -- a data URI of the sanitised specimen; next/image does not take one
  return <img src={specimenSrc(svg)} alt={alt} className={`${className} w-auto max-w-full rounded border border-border bg-card p-1 dark:invert`} />;
}

/** The code and explanation an API error carries (the backend's top-level `code` and `message`). */
export const apiError = (err: unknown): { status: number | null; code: string | null; message: string } => {
  const response = (err as { response?: { status?: number; data?: { code?: unknown; message?: unknown } } } | null)?.response;
  const message = typeof response?.data?.message === "string" ? response.data.message : err instanceof Error ? err.message : "The request failed.";
  return { status: response?.status ?? null, code: typeof response?.data?.code === "string" ? response.data.code : null, message };
};

export interface CredentialState {
  authMethod: "password" | "mfa";
  credential: string;
}

export const EMPTY_CREDENTIAL: CredentialState = { authMethod: "password", credential: "" };

/** Re-enter a credential (Part 11 § 11.200 (a)): never stored by the browser. */
export function CredentialFields({ value, onChange, idPrefix }: { value: CredentialState; onChange: (next: CredentialState) => void; idPrefix: string }) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" /> Confirm it is you
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${idPrefix}-method`} className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Method
          </label>
          <Select
            id={`${idPrefix}-method`}
            value={value.authMethod}
            onChange={(next) => onChange({ ...value, authMethod: next as "password" | "mfa" })}
            options={[
              { value: "password", label: "Password" },
              { value: "mfa", label: "MFA code" },
            ]}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-credential`} className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {value.authMethod === "mfa" ? "Authenticator code *" : "Password *"}
          </label>
          <Input
            id={`${idPrefix}-credential`}
            required
            type={value.authMethod === "mfa" ? "text" : "password"}
            autoComplete="off"
            inputMode={value.authMethod === "mfa" ? "numeric" : undefined}
            value={value.credential}
            onChange={(e) => onChange({ ...value, credential: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

/** The verification link as a QR, drawn in the browser (the library loads on demand). */
export function VerifyQr({ url, label }: { url: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const QRCode = (await import("qrcode")).default;
        const made = await QRCode.toDataURL(url, { margin: 0, width: 128 });
        if (active) setSrc(made);
      } catch {
        // No QR: the link beside it still works.
      }
    })();
    return () => {
      active = false;
    };
  }, [url]);
  // eslint-disable-next-line @next/next/no-img-element -- a data URI drawn here; next/image does not take one
  return src ? <img src={src} alt={label} className="h-24 w-24 rounded border border-border bg-card p-1 dark:invert" /> : null;
}

const MEANING: Record<string, string> = {
  performed: "Performed",
  reviewed: "Reviewed",
  approved: "Approved",
  authored: "Authored",
  acknowledged: "Acknowledged",
};

/** One application: the specimen, who, what it means, when, the integrity now, the link and its QR. */
export function ApplicationCard({ application }: { application: EsignatureApplication }) {
  const { signer } = application;
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <SpecimenImage svg={application.specimenSvg} alt={`E-signature of ${signer.name}`} />
        <div className="text-sm">
          <p className="font-semibold text-foreground">{signer.name}</p>
          <p className="text-xs text-muted-foreground">{[signer.role, signer.organisation].filter(Boolean).join(" · ")}</p>
          <p className="text-xs">
            {MEANING[application.meaning] ?? application.meaning} · {new Date(application.signedAt).toLocaleString()}
          </p>
          {application.integrity && (
            <p className={`text-xs font-medium ${application.integrity === "intact" ? "text-success" : "text-destructive"}`}>
              {application.integrity === "intact" ? "Content unchanged since signing" : "Content changed since signing"}
            </p>
          )}
          <a href={application.verifyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary underline">
            Verify this signature <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </div>
      </div>
      <VerifyQr url={application.verifyUrl} label={`Verification QR for ${signer.name}'s signature`} />
    </li>
  );
}
