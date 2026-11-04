"use client";
/**
 * P21-15 (ADR-140; spec v2 § 5) — a calibration record's e-signatures: every application (specimen,
 * name, role, meaning, time, the integrity now, the verify link and its QR), and Sign — `performed`
 * for the record's performer, `reviewed` for anyone else with calibration write — with a re-entered
 * credential. Without an e-signature the answer is `ESIG_NONE`, shown with a link to the profile; every
 * 409 is shown as its explanation. The submit stays disabled while the request is pending.
 */
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Dialog } from "@/components/ui";
import type { Calibration } from "@/api/services/calibration.service";
import { personalEsignatureService, type EsignatureApplication } from "@/api/services/personalEsignature.service";
import { ApplicationCard, CredentialFields, EMPTY_CREDENTIAL, apiError, type CredentialState } from "@/components/esignature/esignatureUi";

interface Props {
  record: Calibration | null;
  currentUserId: string | undefined;
  canSign: boolean;
  onClose: () => void;
}

export function RecordEsignaturesModal({ record, currentUserId, canSign, onClose }: Props) {
  const [applications, setApplications] = useState<EsignatureApplication[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [credential, setCredential] = useState<CredentialState>(EMPTY_CREDENTIAL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string | null; message: string } | null>(null);
  const recordId = record?.id ?? null;
  const meaning = record && currentUserId && record.performedBy === currentUserId ? "performed" : "reviewed";

  const load = useCallback(async (id: string) => {
    try {
      setApplications(await personalEsignatureService.recordApplications(id));
      setLoadError(null);
    } catch (err) {
      setLoadError(apiError(err).message);
    }
  }, []);

  useEffect(() => {
    if (!recordId) return undefined;
    let active = true;
    personalEsignatureService
      .recordApplications(recordId)
      .then((next) => {
        if (active) setApplications(next);
      })
      .catch((err: unknown) => {
        if (active) setLoadError(apiError(err).message);
      });
    return () => {
      active = false;
    };
  }, [recordId]);

  const close = (): void => {
    setApplications(null);
    setSigning(false);
    setCredential(EMPTY_CREDENTIAL);
    setError(null);
    onClose();
  };

  const sign = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!recordId) return;
    setBusy(true);
    setError(null);
    try {
      await personalEsignatureService.signRecord(recordId, { meaning, ...credential });
      setSigning(false);
      setCredential(EMPTY_CREDENTIAL);
      await load(recordId);
    } catch (err) {
      const { code, message } = apiError(err);
      setError({ code, message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog isOpen={record !== null} onClose={close} title="E-signatures on this calibration record">
      <div className="space-y-4 pt-2">
        <p className="text-xs text-muted-foreground">
          An e-signature attests who performed or reviewed this record. It is not the calibration certificate.
        </p>
        {loadError && (
          <p role="alert" className="text-sm text-destructive">
            {loadError}
          </p>
        )}
        {applications && applications.length === 0 && <p className="text-sm">No one has signed this record yet.</p>}
        {applications && applications.length > 0 && (
          <ul className="space-y-2">
            {applications.map((a) => (
              <ApplicationCard key={a.id} application={a} />
            ))}
          </ul>
        )}

        {canSign && !signing && (
          <Button type="button" onClick={() => setSigning(true)}>
            Sign as {meaning}
          </Button>
        )}
        {canSign && signing && (
          <form onSubmit={(e) => void sign(e)} className="space-y-3">
            <p className="text-sm">
              {meaning === "performed"
                ? "By signing, you attest that you performed this calibration and that these are the results you measured."
                : "By signing, you attest that you reviewed this calibration record."}
            </p>
            <CredentialFields value={credential} onChange={setCredential} idPrefix="record-esig" />
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

export default RecordEsignaturesModal;
