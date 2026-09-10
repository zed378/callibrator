"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ShieldCheck,
  ShieldX,
  ShieldAlert,
  Loader2,
  FileText,
  ExternalLink,
  ArrowLeft,
} from "lucide-react";
import AuroraBackground from "@/components/motion/AuroraBackground";
import { API_BASE_URL } from "@/constants";

// ------------------------------------------------------------------
// Public certificate-validation page.
//
// A calibration certificate's QR encodes <CERT_VERIFY_BASE_URL>/<number>, which
// lands here. We call the PUBLIC backend endpoint
// GET /api/v1/certificates/verify/:number (no auth) and render the authenticity
// verdict, every field an assessor needs, and the signed PDF itself.
// ------------------------------------------------------------------

interface VerifyData {
  found: boolean;
  valid: boolean;
  status?: string;
  revoked?: boolean;
  expired?: boolean;
  certificateNumber?: string;
  type?: string;
  standard?: string | null;
  issuedTo?: string | null;
  device?: { name: string; serialNumber: string } | null;
  issueDate?: string | null;
  validUntil?: string | null;
  signedBy?: string | null;
  signedAt?: string | null;
  integrityHash?: string;
  verifyUrl?: string;
  documentUrl?: string | null;
  message?: string;
}

const fmtDate = (d?: string | null) =>
  d
    ? new Date(d).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";

/** The verdict banner: colour + icon + copy driven by the verification result. */
function Verdict({ data }: { data: VerifyData }) {
  let tone: "valid" | "invalid" | "warn";
  let title: string;
  let sub: string;
  const Icon =
    data.valid && data.found
      ? ShieldCheck
      : data.revoked || !data.found
        ? ShieldX
        : ShieldAlert;

  if (!data.found) {
    tone = "invalid";
    title = "Certificate not found";
    sub = "No certificate matches this number. It may be mistyped or invalid.";
  } else if (data.valid) {
    tone = "valid";
    title = "Certificate is valid";
    sub = "This certificate is authentic, signed, and currently in force.";
  } else if (data.revoked) {
    tone = "invalid";
    title = "Certificate revoked";
    sub = "This certificate was revoked by the issuer and is no longer valid.";
  } else if (data.expired) {
    tone = "warn";
    title = "Certificate expired";
    sub = "This certificate is authentic but has passed its validity date.";
  } else {
    tone = "warn";
    title = "Not yet valid";
    sub = `This certificate is not signed (status: ${data.status ?? "unknown"}).`;
  }

  const tones: Record<string, string> = {
    valid: "bg-success/10 text-success ring-success/30",
    invalid: "bg-destructive/10 text-destructive ring-destructive/30",
    warn: "bg-warning/10 text-warning ring-warning/30",
  };

  return (
    <div
      className={`flex items-start gap-4 rounded-2xl p-5 ring-1 ${tones[tone]}`}
    >
      <Icon className="h-9 w-9 shrink-0" />
      <div>
        <h2 className="font-display text-xl font-bold tracking-tight">
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm text-foreground sm:text-right">{value}</span>
    </div>
  );
}

function CertificateVerifyContent() {
  const params = useParams();
  const certificateNumber = decodeURIComponent(
    String(params.certificateNumber ?? ""),
  );

  const [data, setData] = useState<VerifyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // Same-origin proxy forwards to the public backend endpoint (no auth).
        const res = await fetch(
          `/api/v1/certificates/verify/${encodeURIComponent(certificateNumber)}`,
        );
        const json = await res.json();
        if (!active) return;
        if (!res.ok || !json?.data) {
          setError(json?.message || "Unable to verify this certificate.");
        } else {
          setData(json.data as VerifyData);
        }
      } catch {
        if (active) setError("Network error while verifying the certificate.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [certificateNumber]);

  const pdfUrl =
    data?.documentUrl ? `${API_BASE_URL}${data.documentUrl}` : null;

  return (
    <main className="relative min-h-screen">
      <AuroraBackground />

      <div className="relative z-10 mx-auto flex max-w-3xl flex-col px-4 py-10 sm:px-6 sm:py-14">
        <Link
          href="/"
          className="group mb-8 inline-flex w-fit items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
          Home
        </Link>

        <div className="mb-6">
          <p className="inline-flex items-center gap-3 font-display text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            <span className="h-px w-8 bg-linear-to-r from-primary to-accent" />
            Certificate verification
          </p>
          <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground">
            {certificateNumber || "Certificate"}
          </h1>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Verifying…
          </div>
        ) : error ? (
          <div className="rounded-2xl bg-destructive/10 p-5 text-sm text-destructive ring-1 ring-destructive/30">
            {error}
          </div>
        ) : data ? (
          <div className="space-y-6">
            <Verdict data={data} />

            {data.found && (
              <>
                <div className="rounded-2xl border border-border bg-card/70 p-5 backdrop-blur-sm">
                  <h3 className="mb-1 font-display text-sm font-semibold text-foreground">
                    Details
                  </h3>
                  <Row
                    label="Certificate no."
                    value={
                      <span className="font-mono">{data.certificateNumber}</span>
                    }
                  />
                  <Row
                    label="Status"
                    value={<span className="capitalize">{data.status}</span>}
                  />
                  <Row
                    label="Type"
                    value={<span className="capitalize">{data.type}</span>}
                  />
                  <Row label="Standard" value={data.standard || "—"} />
                  <Row label="Issued to" value={data.issuedTo || "—"} />
                  <Row
                    label="Device"
                    value={
                      data.device
                        ? `${data.device.name} · SN ${data.device.serialNumber}`
                        : "—"
                    }
                  />
                  <Row label="Issue date" value={fmtDate(data.issueDate)} />
                  <Row label="Valid until" value={fmtDate(data.validUntil)} />
                  <Row label="Signed by" value={data.signedBy || "—"} />
                  <Row label="Signed at" value={fmtDate(data.signedAt)} />
                  <div className="flex flex-col gap-0.5 py-3">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Integrity hash (SHA-256)
                    </span>
                    <span className="mt-1 break-all font-mono text-xs text-muted-foreground">
                      {data.integrityHash}
                    </span>
                  </div>
                </div>

                {/* The certificate document itself */}
                {pdfUrl && (
                  <div className="rounded-2xl border border-border bg-card/70 p-5 backdrop-blur-sm">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="inline-flex items-center gap-2 font-display text-sm font-semibold text-foreground">
                        <FileText className="h-4 w-4" /> Certificate document
                      </h3>
                      <a
                        href={pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                      >
                        Open PDF <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                    <iframe
                      src={pdfUrl}
                      title={`Certificate ${data.certificateNumber}`}
                      className="h-[70vh] w-full rounded-lg border border-border bg-muted"
                    />
                  </div>
                )}
              </>
            )}

            <p className="text-center text-xs text-muted-foreground">
              Verified against the issuer&apos;s records in real time. Cross-check
              the certificate number matches the printed document.
            </p>
          </div>
        ) : null}
      </div>
    </main>
  );
}

/**
 * `useParams()` reads the route params, which Next 16 treats as uncached data.
 * Without a Suspense boundary it blocks the whole route from prerendering and
 * the production build fails outright ("Uncached data was accessed outside of
 * <Suspense>"), so the content is isolated behind one.
 */
export default function CertificateVerifyPage() {
  return (
    <Suspense
      fallback={
        <main className="relative flex min-h-screen items-center justify-center px-4">
          <AuroraBackground />
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading certificate…</span>
          </div>
        </main>
      }
    >
      <CertificateVerifyContent />
    </Suspense>
  );
}
