"use client";
/**
 * P21-15 (ADR-140 § 6; spec v2 § 5) — a certificate's e-signatures: every application (specimen, name,
 * role, meaning, time, the integrity now, the verify link and its QR), and Sign — `performed` for the
 * certificate's calibrator, `approved` for its approver or signer — with a re-entered credential. The
 * approve and sign steps already affix the actor's e-signature automatically. Without an e-signature
 * the answer is `ESIG_NONE`, with a link to the profile; every 409 is shown as its explanation. The
 * certificate's own digital signature is not touched.
 */
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Dialog } from "@/components/ui";
import type { Certificate } from "@/api/services/calibration.service";
import { personalEsignatureService, type EsignatureApplication } from "@/api/services/personalEsignature.service";
import { ApplicationCard, CredentialFields, EMPTY_CREDENTIAL, apiError, type CredentialState } from "@/components/esignature/esignatureUi";

interface Props {
  certificate: Certificate | null;
  currentUserId: string | undefined;
  canSign: boolean;
  onClose: () => void;
}

export function CertificateEsignaturesModal({ certificate, currentUserId, canSign, onClose }: Props) {
  const [applications, setApplications] = useState<EsignatureApplication[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [credential, setCredential] = useState<CredentialState>(EMPTY_CREDENTIAL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string | null; message: string } | null>(null);
  const certificateId = certificate?.id ?? null;
  const meaning: "performed" | "approved" | null = !certificate || !currentUserId
    ? null
    : certificate.calibratedBy === currentUserId
      ? "performed"
      : certificate.approvedBy === currentUserId || certificate.signedBy === currentUserId
        ? "approved"
        : null;

  const load = useCallback(async (id: string) => {
    try {
      setApplications(await personalEsignatureService.certificateApplications(id));
      setLoadError(null);
    } catch (err) {
      setLoadError(apiError(err).message);
    }
  }, []);

  useEffect(() => {
    if (!certificateId) return undefined;
    let active = true;
    personalEsignatureService
      .certificateApplications(certificateId)
      .then((next) => {
        if (active) setApplications(next);
      })
      .catch((err: unknown) => {
        if (active) setLoadError(apiError(err).message);
      });
    return () => {
      active = false;
    };
  }, [certificateId]);

  const close = (): void => {
    setApplications(null);
    setSigning(false);
    setCredential(EMPTY_CREDENTIAL);
    setError(null);
    onClose();
  };

  const sign = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!certificateId || !meaning) return;
    setBusy(true);
    setError(null);
    try {
      await personalEsignatureService.signCertificate(certificateId, { meaning, ...credential });
      setSigning(false);
      setCredential(EMPTY_CREDENTIAL);
      await load(certificateId);
    } catch (err) {
      const { code, message } = apiError(err);
      setError({ code, message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog isOpen={certificate !== null} onClose={close} title="E-signatures on this certificate">
      <div className="space-y-4 pt-2">
        <p className="text-xs text-muted-foreground">
          A personal e-signature affixed to this certificate. The certificate&apos;s own digital signature does not depend on it.
        </p>
        {loadError && (
          <p role="alert" className="text-sm text-destructive">
            {loadError}
          </p>
        )}
        {applications && applications.length === 0 && <p className="text-sm">No e-signature is affixed to this certificate yet.</p>}
        {applications && applications.length > 0 && (
          <ul className="space-y-2">
            {applications.map((a) => (
              <ApplicationCard key={a.id} application={a} />
            ))}
          </ul>
        )}

        {canSign && meaning && !signing && (
          <Button type="button" onClick={() => setSigning(true)}>
            Sign as {meaning}
          </Button>
        )}
        {canSign && meaning && signing && (
          <form onSubmit={(e) => void sign(e)} className="space-y-3">
            <p className="text-sm">
              {meaning === "performed"
                ? "By signing, you attest that you performed the calibration this certificate reports."
                : "By signing, you attest that you approved this certificate."}
            </p>
            <CredentialFields value={credential} onChange={setCredential} idPrefix="certificate-esig" />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error.message}{" "}
                {error.code === "ESIG_NONE" && (
                  <Link href="/dashboard/profile" className="underline">
                    Open my profile
                  </Link>
                )}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                Sign
              </Button>
              <Button type="button" variant="outline" onClick={() => setSigning(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </Dialog>
  );
}

export default CertificateEsignaturesModal;
