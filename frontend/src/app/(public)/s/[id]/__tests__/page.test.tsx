/** @jest-environment jsdom */
/**
 * P21-15 (ADR-140; spec v2 § 5) — the public e-signature verification `/s/[id]?t=`: the shell (never
 * indexed, no referrer, one <main>, the body inside a Suspense boundary), the body for every outcome —
 * a valid record (the verdict as the one h1, the specimen as an <img> data URI, the details, the
 * e-signature's and the record's states), a document, a changed and an invalid verdict, not found,
 * rate-limited, failed — and the "check it yourself" island recomputing the hash in the browser (the
 * served pairs, or a file the reader picks). Indonesian and English; axe.
 */
import React from "react";
import { webcrypto, createHash } from "node:crypto";
import { TextEncoder } from "node:util";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { calibrationRecordDataPairs } from "@callibrator/contracts/esignatures";
import { id } from "@/i18n/messages/id";
import { en } from "@/i18n/messages/en";
import { createTranslator } from "@/i18n/translate";
import { axeViolations } from "@/tests/a11y/axe";
import type { PublicEsignature, PublicEsignatureOutcome } from "@/lib/publicEsignature.server";

Object.defineProperty(globalThis, "TextEncoder", { value: TextEncoder, configurable: true, writable: true });
Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true, writable: true });

jest.mock("@/i18n/server", () => ({
  getServerI18n: jest.fn(async () => ({ locale: "id", messages: id, t: createTranslator(id) })),
}));
jest.mock("next/headers", () => ({ headers: jest.fn(async () => new Headers({ "x-forwarded-for": "203.0.113.9" })) }));
jest.mock("@/components/public/PublicSurface", () => ({ PublicSurface: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
jest.mock("@/components/public/BrandLockup", () => ({ BrandLockup: () => <span>brand</span> }));
jest.mock("@/components/public/LanguageForm", () => ({ LanguageForm: () => <span>language</span> }));
const read = jest.fn<Promise<PublicEsignatureOutcome>, [string, string, Headers]>();
jest.mock("@/lib/publicEsignature.server", () => ({
  ...jest.requireActual("@/lib/publicEsignature.server"),
  readPublicEsignature: (appId: string, token: string, h: Headers) => read(appId, token, h),
}));

import PublicEsignaturePage, { generateMetadata } from "../page";
import { EsignatureContent, formatDay } from "../EsignatureContent";

const APP = "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a";
const TOKEN = "q3kZ0x9VbN2mP4rT6wY8aC1dE3fG5hJ7";
const PAIRS = calibrationRecordDataPairs({
  tenantId: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f",
  id: "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d",
  deviceId: "1d2c3b4a-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  calibrationDate: "2030-01-15",
}).map(([n, v]) => [n, v]);
const HASH = createHash("sha256").update(JSON.stringify(PAIRS), "utf8").digest("hex");
const SPECIMEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0 L10 10"/></svg>';

const VERDICT: PublicEsignature = {
  verdict: "valid",
  explanation: { id: "Tanda tangan elektronik sah sintetis.", en: "The e-signature is valid (synthetic)." },
  esignatureState: "active",
  esignatureStateAt: null,
  documentState: "current",
  documentStateAt: null,
  signedAt: "2030-01-15T09:30:00.123Z",
  meaning: "performed",
  signer: { name: "Teknisi Sintetis", role: "HEALTHCARE TECHNICIAN", organisation: "Lab Sintetis" },
  specimenSvg: SPECIMEN,
  keyFingerprint: "f".repeat(64),
  publicKeyPem: "-----BEGIN PUBLIC KEY-----\nSYNTHETIC\n-----END PUBLIC KEY-----",
  organisation: { name: "Lab Sintetis" },
  documentType: "calibration_record",
  documentTitle: "Calibration record Pompa 2030-01-15",
  contentScheme: "calrec-data-v1",
  contentHash: HASH,
  canonicalContent: PAIRS,
  summary: { deviceName: "Pompa infus sintetis", brand: "Pembuat", model: "P-1", serialNumber: "SN-1", calibrationDate: "2030-01-15", dueDate: null, isCompliant: true },
};

const body = async (outcome: PublicEsignatureOutcome, locale: "id" | "en" = "id", token: string | string[] = TOKEN) => {
  read.mockResolvedValueOnce(outcome);
  const t = createTranslator(locale === "id" ? id : en);
  return render(<main>{await EsignatureContent({ params: Promise.resolve({ id: APP }), searchParams: Promise.resolve({ t: token }), locale, t })}</main>);
};

beforeEach(() => read.mockReset());

describe("P21-15 — /s/[id] (server)", () => {
  it("the shell: never indexed, no referrer, one main, the loading state while the body streams", async () => {
    expect(await generateMetadata()).toEqual({ title: "Verifikasi tanda tangan elektronik", robots: { index: false, follow: false }, referrer: "no-referrer" });
    read.mockReturnValueOnce(new Promise(() => undefined));
    render(await PublicEsignaturePage({ params: Promise.resolve({ id: APP }), searchParams: Promise.resolve({ t: TOKEN }) }));
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.queryAllByRole("heading", { level: 1 })).toHaveLength(0);
  });

  it("a valid record: the verdict is the one h1; the specimen is an <img> data URI; the details; the token sent, never printed; axe", async () => {
    const { container } = await body({ kind: "ok", verdict: VERDICT });
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Tanda tangan sah"]);
    const img = screen.getByRole("img", { name: "Spesimen tanda tangan: Teknisi Sintetis" });
    expect(img.getAttribute("src")).toBe(`data:image/svg+xml;base64,${Buffer.from(SPECIMEN).toString("base64")}`);
    for (const text of ["Tanda tangan elektronik sah sintetis.", "Dilaksanakan", "Lab Sintetis", "Memenuhi syarat", "15 Januari 2030"]) {
      expect(screen.getAllByText(text, { exact: false }).length).toBeGreaterThan(0);
    }
    expect(container.innerHTML).not.toContain(TOKEN);
    expect(read.mock.calls[0]?.slice(0, 2)).toEqual([APP, TOKEN]);
    expect(read.mock.calls[0]?.[2].get("x-forwarded-for")).toBe("203.0.113.9");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("check it yourself: the served pairs hash to the content hash in the browser — and a tampered hash does not match", async () => {
    await body({ kind: "ok", verdict: VERDICT }, "en");
    fireEvent.click(screen.getByRole("button", { name: "Recompute" }));
    await waitFor(() => expect(screen.getByText("Match: the content is what was signed.")).toBeTruthy());
    read.mockReset();
    await body({ kind: "ok", verdict: { ...VERDICT, contentHash: "0".repeat(64) } }, "en");
    fireEvent.click(screen.getAllByRole("button", { name: "Recompute" })[1] as HTMLElement);
    await waitFor(() => expect(screen.getByText("No match: the content differs from what was signed.")).toBeTruthy());
  });

  it("a revoked e-signature and a voided record are said beside the verdict; a changed verdict; an array token takes the first", async () => {
    await body(
      { kind: "ok", verdict: { ...VERDICT, verdict: "content_changed", esignatureState: "revoked", esignatureStateAt: "2030-06-01", documentState: "voided", documentStateAt: "2030-05-03", summary: { ...VERDICT.summary!, isCompliant: null } } },
      "en",
      [TOKEN, "other"],
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("The content has changed");
    expect(screen.getByText("This e-signature was revoked on 1 June 2030; documents signed before then still verify.")).toBeTruthy();
    expect(screen.getByText("This record was voided on 3 May 2030.")).toBeTruthy();
    expect(read.mock.calls[0]?.[1]).toBe(TOKEN);
  });

  it("a document: no record summary; the reader picks the file and the browser hashes it", async () => {
    const bytes = new TextEncoder().encode("synthetic file");
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    await body({ kind: "ok", verdict: { ...VERDICT, verdict: "invalid", documentType: "document", contentScheme: "file-sha256", contentHash: fileHash, canonicalContent: null, summary: null, documentState: null, signer: { name: "S", role: null, organisation: null }, organisation: { name: null } } }, "en", []);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("The signature does not match");
    expect(screen.queryByText("Device")).toBeNull();
    const file = new File([bytes], "synthetic.txt");
    Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
    fireEvent.change(screen.getByLabelText("Choose a file"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText("Match: the content is what was signed.")).toBeTruthy());
  });

  it.each([
    [{ kind: "not_found" } as const, "Tidak ditemukan", "Tidak ada tanda tangan elektronik yang menjawab tautan ini."],
    [{ kind: "rate_limited" } as const, "Terlalu banyak permintaan", "Terlalu banyak tautan dibuka dari jaringan ini. Coba lagi dalam beberapa menit."],
    [{ kind: "failed" } as const, "Tanda tangan tidak dapat diperiksa", "Tanda tangan tidak dapat diperiksa saat ini. Coba lagi nanti."],
  ])("%o: one h1 and one sentence, nothing about why", async (outcome, title, text) => {
    await body(outcome);
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual([title]);
    expect(screen.getByText(text)).toBeTruthy();
  });

  it("formatDay: the calendar day as written; anything else is a dash", () => {
    expect([formatDay("2030-12-31", "en"), formatDay("2030-12-31T23:00:00Z", "id"), formatDay(null, "en"), formatDay("soon", "en")]).toEqual(["31 December 2030", "31 Desember 2030", "—", "—"]);
  });
});
