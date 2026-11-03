"use client";
/**
 * P21-15 (ADR-140; spec v2 § 5) — Profile → E-signature: every user's own e-signature. Draw or upload
 * a specimen, preview it, save it with a re-entered credential (the server generates the personal key
 * and keeps its private half under KMS). Shows the key fingerprint, the version history, Replace and
 * Revoke. A revoked or replaced e-signature still verifies what it signed.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Button, Input } from "@/components/ui";
import { personalEsignatureService, type MyEsignatureState } from "@/api/services/personalEsignature.service";
import { CredentialFields, EMPTY_CREDENTIAL, SpecimenImage, apiError, type CredentialState } from "@/components/esignature/esignatureUi";
import { SignaturePad } from "@/components/esignature/SignaturePad";

type Mode = "view" | "edit" | "revoke";

export function EsignatureSettings() {
  const [state, setState] = useState<MyEsignatureState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [specimen, setSpecimen] = useState<string | null>(null);
  const [credential, setCredential] = useState<CredentialState>(EMPTY_CREDENTIAL);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await personalEsignatureService.mine());
      setLoadError(null);
    } catch (err) {
      setLoadError(apiError(err).message);
    }
  }, []);

  useEffect(() => {
    let active = true;
    personalEsignatureService
      .mine()
      .then((next) => {
        if (active) setState(next);
      })
      .catch((err: unknown) => {
        if (active) setLoadError(apiError(err).message);
      });
    return () => {
      active = false;
    };
  }, []);

  const reset = (next: Mode): void => {
    setMode(next);
    setSpecimen(null);
    setCredential(EMPTY_CREDENTIAL);
    setReason("");
    setError(null);
  };

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!specimen) {
      setError("Draw or upload your signature first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await personalEsignatureService.save({ specimenSvg: specimen, ...credential });
      setNotice("Your e-signature is saved.");
      reset("view");
      await load();
    } catch (err) {
      setError(apiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await personalEsignatureService.revoke({ ...credential, reason });
      setNotice("Your e-signature is revoked. What it signed before still verifies.");
      reset("view");
      await load();
    } catch (err) {
      setError(apiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const active = state?.active ?? null;

  return (
    <section aria-labelledby="profile-esignature" className="rounded-2xl border border-border bg-muted/50 p-6 shadow-sm">
      <h2 id="profile-esignature" className="mb-1 text-base font-semibold text-foreground">
        E-signature
      </h2>
      <p className="mb-5 text-sm text-muted-foreground">
        Your personal signature, applied to calibration records and documents. Each signature you apply can be verified by anyone holding its link. It is not the
        calibration certificate.
      </p>

      {notice && (
        <p role="status" className="mb-4 rounded-md border border-success/20 bg-success/10 p-3 text-sm text-success">
          {notice}
        </p>
      )}
      {loadError && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {loadError}
        </p>
      )}

      {mode === "view" && state && (
        <div className="space-y-4">
          {active ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <SpecimenImage svg={active.specimenSvg} alt="Your e-signature" className="h-20" />
              <dl className="text-sm">
                <div>
                  <dt className="inline font-medium">Version: </dt>
                  <dd className="inline">{active.version}</dd>
                </div>
                <div>
                  <dt className="inline font-medium">Created: </dt>
                  <dd className="inline">{new Date(active.createdAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="inline font-medium">Key fingerprint: </dt>
                  <dd className="inline break-all font-mono text-xs">{active.keyFingerprint}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <p className="text-sm">You have no e-signature yet.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => reset("edit")}>
              {active ? "Replace" : "Create my e-signature"}
            </Button>
            {active && (
              <Button type="button" variant="outline" onClick={() => reset("revoke")}>
                Revoke
              </Button>
            )}
          </div>
          {state.history.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm font-medium">Earlier versions ({state.history.length})</summary>
              <ul className="mt-2 space-y-2">
                {state.history.map((h) => (
                  <li key={h.id} className="flex items-center gap-3 text-xs">
                    <SpecimenImage svg={h.specimenSvg} alt={`E-signature version ${String(h.version)}`} className="h-10" />
                    <span>
                      Version {h.version} · {h.status} {h.revokedAt ? `on ${new Date(h.revokedAt).toLocaleDateString()}` : h.supersededAt ? `on ${new Date(h.supersededAt).toLocaleDateString()}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {mode === "edit" && (
        <form onSubmit={(e) => void save(e)} className="space-y-4">
          <SignaturePad onChange={setSpecimen} />
          {specimen && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Preview</p>
              <SpecimenImage svg={specimen} alt="Preview of your e-signature" className="h-20" />
            </div>
          )}
          <CredentialFields value={credential} onChange={setCredential} idPrefix="esig-save" />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              Save e-signature
            </Button>
            <Button type="button" variant="outline" onClick={() => reset("view")}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {mode === "revoke" && (
        <form onSubmit={(e) => void revoke(e)} className="space-y-4">
          <div>
            <label htmlFor="esig-revoke-reason" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Reason *
            </label>
            <Input id="esig-revoke-reason" required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <CredentialFields value={credential} onChange={setCredential} idPrefix="esig-revoke" />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              Revoke e-signature
            </Button>
            <Button type="button" variant="outline" onClick={() => reset("view")}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

export default EsignatureSettings;
