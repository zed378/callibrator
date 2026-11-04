"use client";
/**
 * P21-15 (ADR-140; spec v2 § 5) — Sign a document: drop any file; the browser computes its SHA-256 and
 * the file is never uploaded. Give a title, choose a meaning, re-enter a credential, sign. The result
 * offers the verify link, its QR, and a printable signature sheet (specimen, details, QR) to attach to
 * the paper document. Below: what I have signed.
 */
import React, { useCallback, useEffect, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Button, Input, Select } from "@/components/ui";
import { FileCheck, Printer } from "lucide-react";
import { personalEsignatureService, type EsignatureApplication } from "@/api/services/personalEsignature.service";
import { typedApi, unwrap } from "@/api/typed";
import { ApplicationCard, CredentialFields, EMPTY_CREDENTIAL, apiError, type CredentialState } from "@/components/esignature/esignatureUi";

/** SHA-256 hex of a file's bytes, in the browser. */
const hashFile = async (file: File): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

const MEANINGS = [
  { value: "authored", label: "Authored" },
  { value: "reviewed", label: "Reviewed" },
  { value: "approved", label: "Approved" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "performed", label: "Performed" },
];

type Meaning = "authored" | "reviewed" | "approved" | "acknowledged" | "performed";

export default function SignDocumentPage() {
  const [file, setFile] = useState<{ name: string; size: number; hash: string } | null>(null);
  const [hashing, setHashing] = useState(false);
  const [title, setTitle] = useState("");
  const [meaning, setMeaning] = useState<Meaning>("authored");
  const [credential, setCredential] = useState<CredentialState>(EMPTY_CREDENTIAL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EsignatureApplication | null>(null);
  const [mine, setMine] = useState<EsignatureApplication[]>([]);

  const loadMine = useCallback(async () => {
    try {
      setMine((await typedApi.GET("/api/v1/esignature/me/applications", { params: { query: { page: 1, limit: 20 } } }).then(unwrap)).data);
    } catch {
      setMine([]);
    }
  }, []);

  useEffect(() => {
    let active = true;
    typedApi
      .GET("/api/v1/esignature/me/applications", { params: { query: { page: 1, limit: 20 } } })
      .then(unwrap)
      .then((answer) => {
        if (active) setMine(answer.data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const choose = async (picked: File | undefined): Promise<void> => {
    if (!picked) return;
    setHashing(true);
    setError(null);
    setResult(null);
    try {
      setFile({ name: picked.name, size: picked.size, hash: await hashFile(picked) });
      setTitle((current) => current || picked.name);
    } catch {
      setError("This browser cannot compute the file's hash.");
    } finally {
      setHashing(false);
    }
  };

  const sign = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await personalEsignatureService.signDocument({ title, contentHash: file.hash, sizeBytes: file.size, meaning, ...credential }));
      setCredential(EMPTY_CREDENTIAL);
      await loadMine();
    } catch (err) {
      setError(apiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Sign a document</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your browser computes the file&apos;s SHA-256; the file itself is never uploaded or stored. Anyone holding the verification link can check the
            signature, and compare their copy of the file.
          </p>
        </div>

        <form onSubmit={(e) => void sign(e)} className="space-y-4 rounded-2xl border border-border bg-muted/50 p-6 print:hidden">
          <label className="block text-sm font-medium">
            File
            <input type="file" className="mt-2 block text-sm" onChange={(e) => void choose(e.target.files?.[0])} />
          </label>
          {hashing && <p role="status" className="text-sm">Computing the hash…</p>}
          {file && (
            <p className="break-all font-mono text-xs">
              SHA-256: {file.hash} ({file.size} bytes)
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="doc-title" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Title *
              </label>
              <Input id="doc-title" required maxLength={255} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <label htmlFor="doc-meaning" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Meaning *
              </label>
              <Select id="doc-meaning" value={meaning} onChange={(value) => setMeaning(value as Meaning)} options={MEANINGS} />
            </div>
          </div>
          <CredentialFields value={credential} onChange={setCredential} idPrefix="doc-esig" />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy || !file}>
            <FileCheck className="mr-1 h-4 w-4" aria-hidden="true" /> Sign
          </Button>
        </form>

        {result && (
          <section aria-labelledby="signature-sheet" className="space-y-3 rounded-2xl border border-border p-6">
            <h2 id="signature-sheet" className="text-base font-semibold">
              Signature sheet — {result.documentTitle}
            </h2>
            <p className="break-all font-mono text-xs">SHA-256: {result.contentHash}</p>
            <ul>
              <ApplicationCard application={result} />
            </ul>
            <Button type="button" variant="outline" className="print:hidden" onClick={() => window.print()}>
              <Printer className="mr-1 h-4 w-4" aria-hidden="true" /> Print the signature sheet
            </Button>
          </section>
        )}

        <section aria-labelledby="my-signatures" className="space-y-3 print:hidden">
          <h2 id="my-signatures" className="text-base font-semibold">
            What I have signed
          </h2>
          {mine.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul className="space-y-2">
              {mine.map((a) => (
                <ApplicationCard key={a.id} application={a} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </DashboardLayout>
  );
}
