"use client";
/**
 * P21-15 (ADR-140; spec v2 § 5) — "check it yourself": the content hash recomputed IN THE BROWSER, so
 * a reader need not trust the server's verdict.
 *
 *  - a record: the served canonical pairs, checked against the scheme's form (the contracts module,
 *    loaded on demand — the first load stays inside the public budget) and hashed with Web Crypto;
 *  - a document: the reader picks the signed file; its bytes are hashed here and never sent anywhere.
 */
import React, { useState } from "react";

type Outcome = "idle" | "match" | "mismatch" | "unavailable";

export interface HashCheckLabels {
  title: string;
  intro: string;
  run: string;
  file: string;
  match: string;
  mismatch: string;
  unavailable: string;
}

/** SHA-256 hex of bytes in the browser. */
export const sha256Hex = async (bytes: ArrayBuffer | Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

export function HashCheck({ scheme, contentHash, canonicalContent, labels }: { scheme: string; contentHash: string; canonicalContent: string[][] | null; labels: HashCheckLabels }) {
  const [outcome, setOutcome] = useState<Outcome>("idle");
  const subtle = typeof crypto !== "undefined" && Boolean(crypto.subtle);

  const compare = (hash: string | null): void => setOutcome(hash === null ? "unavailable" : hash === contentHash ? "match" : "mismatch");

  const recompute = async (): Promise<void> => {
    try {
      const { canonicalJsonOfPairs } = await import("@callibrator/contracts/esignatures");
      const json = canonicalJsonOfPairs(scheme, canonicalContent);
      compare(json === null || !subtle ? null : await sha256Hex(new TextEncoder().encode(json)));
    } catch {
      setOutcome("unavailable");
    }
  };

  const hashFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      compare(subtle ? await sha256Hex(await file.arrayBuffer()) : null);
    } catch {
      setOutcome("unavailable");
    }
  };

  return (
    <section aria-labelledby="esig-check" className="pub-card mt-6 p-5">
      <h2 id="esig-check" className="text-base font-semibold text-pub-text">
        {labels.title}
      </h2>
      <p className="mt-2 text-sm text-pub-text">{labels.intro}</p>
      {canonicalContent ? (
        <button type="button" onClick={() => void recompute()} className="pub-btn pub-btn-secondary mt-3">
          {labels.run}
        </button>
      ) : (
        <label className="mt-3 block text-sm text-pub-text">
          {labels.file}
          <input type="file" className="mt-2 block text-sm" onChange={(e) => void hashFile(e.target.files?.[0])} />
        </label>
      )}
      <p role="status" aria-live="polite" className="mt-3 text-sm font-medium text-pub-text">
        {outcome === "idle" ? "" : labels[outcome]}
      </p>
    </section>
  );
}

export default HashCheck;
