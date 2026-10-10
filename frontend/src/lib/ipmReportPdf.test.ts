/** @jest-environment node */
/**
 * P23-02 — the IPM report PDF, rendered with the real jsPDF (no DOM) and read back.
 *
 *  - **Golden file** (`__golden__/ipmReport.synthetic.en.txt`, written by hand from P19-06 § 11):
 *    the synthetic report's text runs, in order — the blocks, labels, the device's own calibration
 *    dates (L-1), the session's inspection result (L-2), condition and cleanliness apart (L-3), the
 *    computed electrical-safety result, the performance readings, the recommendation in words, the
 *    notes, both signature columns, the footer with the page, the reader and the integrity hash.
 *  - A4 landscape; the verification QR on the first page; no watermark on an issued report, one on a
 *    preview, a superseded and a voided one; "INTEGRITY CHECK FAILED" on a mismatch; the lineage band;
 *    a long report breaks onto more pages, each numbered; the Unicode font when it can be fetched.
 *  - The helpers: result cells by kind, dates in the report's zone, the file name, the signature text.
 */
import { readFileSync } from "fs";
import path from "path";
import { resetCertificateFontCache } from "@/lib/certificatePdf";
import { createTranslator } from "@/i18n/translate";
import { en } from "@/i18n/messages/en";
import { id } from "@/i18n/messages/id";
import type { Messages } from "@/i18n";
import { ipmReportDoc } from "@/tests/support/ipmReportFixtures";
import { ipmReportFileName, renderIpmReportPdf, resultCells, signatureText, watermarkOf, zonedText, type RenderOptions } from "./ipmReportPdf";

const PUBLIC = path.join(__dirname, "../../public");
const translate = (dict: Messages) => {
  const t = createTranslator(dict);
  return (key: string, values?: Record<string, string | number>) => t(key as keyof Messages, values);
};
const options = (over: Partial<RenderOptions> = {}): RenderOptions => ({
  t: translate(en),
  locale: "en-GB",
  readerName: "Synthetic Reader",
  now: new Date("2026-10-10T04:00:00.000Z"),
  ...over,
});

/** The text runs of a PDF built with a standard font: every `(…) Tj`, escapes undone. */
const runs = (bytes: ArrayBuffer): string[] =>
  [...Buffer.from(bytes).toString("latin1").matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => (m[1] ?? "").replace(/\\([()\\])/g, "$1"));

const golden = (): string[] =>
  readFileSync(path.join(__dirname, "__golden__/ipmReport.synthetic.en.txt"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l !== "" && !l.startsWith("#"));

beforeEach(() => {
  resetCertificateFontCache();
  jest.restoreAllMocks();
  jest.spyOn(global, "fetch").mockRejectedValue(new Error("offline"));
});

describe("P23-02 — the IPM report PDF", () => {
  it("golden: the synthetic report prints every expected run, in order", async () => {
    const printed = runs(await renderIpmReportPdf(ipmReportDoc(), options()));
    // Standard-font runs are Latin-1 bytes, read back as code points: they compare with the UTF-8 file's text as is.
    const expected = golden();
    expect(expected.length).toBeGreaterThan(50);
    let at = 0;
    const missing: string[] = [];
    for (const line of expected) {
      const index = printed.indexOf(line, at);
      if (index === -1) missing.push(line);
      else at = index + 1;
    }
    expect(missing).toEqual([]);
  });

  it("A4 landscape, the QR on the first page, no watermark on the issued report", async () => {
    const pdf = Buffer.from(await renderIpmReportPdf(ipmReportDoc(), options())).toString("latin1");
    expect(pdf).toMatch(/\/MediaBox \[0 0 841\.8\d* 595\.2\d*\]/);
    expect(pdf).toContain("/Subtype /Image");
    expect(pdf).not.toContain("(DRAFT - NOT A RECORD) Tj");
    expect(pdf).not.toContain("(SUPERSEDED) Tj");
  });

  it("watermarks: a preview, a superseded and a voided report; the lineage band; a failed integrity check", async () => {
    const preview = runs(
      await renderIpmReportPdf(ipmReportDoc({ kind: "preview", status: "draft", reportNumber: null, verifyUrl: null, visitNumber: null, signatures: [], integrity: null, countersignEnabled: false }), options()),
    );
    expect(preview).toContain("DRAFT - NOT A RECORD");
    expect(preview).toContain("Synthetic Technician - not yet signed electronically");
    expect(preview.some((r) => r.startsWith("DRAFT - NOT A RECORD · Page 1 / 1"))).toBe(true);
    const superseded = runs(
      await renderIpmReportPdf(
        ipmReportDoc({ status: "superseded", lineage: { supersedesReportNumber: "IPM-SC-20261001-001", supersededByReportNumber: "IPM-SC-20261011-002", supersededAt: "2026-10-11T02:00:00.000Z", voidedAt: null } }),
        options(),
      ),
    );
    expect(superseded).toContain("SUPERSEDED");
    expect(superseded).toContain("This report supersedes IPM-SC-20261001-001");
    expect(superseded).toContain("Superseded by IPM-SC-20261011-002 on 11 Oct 2026");
    const voided = runs(
      await renderIpmReportPdf(
        ipmReportDoc({
          status: "voided",
          lineage: { supersedesReportNumber: null, supersededByReportNumber: null, supersededAt: null, voidedAt: "2026-10-12T02:00:00.000Z" },
          flags: { capturedOffline: true, imported: true },
          integrity: { scheme: "ipm-report-v1", hash: "f".repeat(64), state: "mismatch" },
        }),
        options(),
      ),
    );
    expect(voided).toContain("VOIDED");
    expect(voided).toContain("Voided on 12 Oct 2026");
    expect(voided).toContain("Imported from the previous system (SKP IPM); not signed electronically");
    expect(voided).toContain("INTEGRITY CHECK FAILED");
  });

  it("a long report breaks onto more pages, each numbered; an empty issuer and device print dashes", async () => {
    const many = Array.from({ length: 70 }, (_, i) => ({ ...(ipmReportDoc().sections[0]?.items[0] ?? {}), label: `Reading ${String(i)}` }));
    const doc = ipmReportDoc({
      sections: [
        { section: "environment", items: many },
        { section: "completeness", items: many.slice(0, 30) },
        { section: "function", items: many.slice(0, 5) },
      ] as ReturnType<typeof ipmReportDoc>["sections"],
      issuer: { name: null, email: null, phone: null, address: null, city: null, state: null, zipCode: null, country: null, website: null },
      device: { name: null, manufacturer: null, model: null, serialNumber: null, qrCode: null, deviceTypeId: null, deviceTypeName: null, lastCalibrationDate: null, nextCalibrationDate: "not a day" },
      room: null,
      floor: null,
      notes: null,
      legacyVisitNumber: 4,
      recommendation: null,
      inspectionOutcome: null,
    });
    const printed = runs(await renderIpmReportPdf(doc, options()));
    const pages = printed.filter((r) => /· Page \d+ \/ \d+ ·/.test(r));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.at(-1)).toContain(`Page ${String(pages.length)} / ${String(pages.length)}`);
    expect(printed).toContain("007 · upstream: 4");
    expect(printed).toContain("-");
  });

  it("Indonesian labels; the Unicode font when it can be fetched", async () => {
    jest.spyOn(global, "fetch").mockImplementation(async (url) => new Response(readFileSync(path.join(PUBLIC, String(url)))));
    const pdf = Buffer.from(await renderIpmReportPdf(ipmReportDoc(), options({ t: translate(id), locale: "id-ID" }))).toString("latin1");
    expect(pdf).toMatch(/NotoSans/);
    resetCertificateFontCache();
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("offline"));
    const idRuns = runs(await renderIpmReportPdf(ipmReportDoc(), options({ t: translate(id), locale: "id-ID" })));
    expect(idRuns).toContain("Rekomendasi Hasil Pekerjaan");
    expect(idRuns).toContain("Alat Harus Diperbaiki");
    expect(idRuns).toContain("Teknisi Pelaksana");
  });
});

describe("P23-02 — the report helpers", () => {
  const t = translate(en);

  it("result cells by kind", () => {
    expect(resultCells({ inputKind: "tri_state", outcome: "fail" }, t)).toEqual({ result: "Not good", value: "" });
    expect(resultCells({ inputKind: "tri_state", outcome: null }, t)).toEqual({ result: "—", value: "" });
    expect(resultCells({ inputKind: "condition_clean", outcome: "good", cleanliness: null }, t)).toEqual({ result: "Good", value: "—" });
    expect(resultCells({ inputKind: "measured", rawValue: "approx 3", unit: null }, t)).toEqual({ result: "—", value: "approx 3" });
    expect(resultCells({ inputKind: "measured_with_limit", outcome: "fail", warnFlag: true, outcomeSource: "computed", measuredValue: null }, t)).toEqual({
      result: "Not good (computed, warning range)",
      value: "—",
    });
    expect(resultCells({ inputKind: "setting_measured_reference", outcome: null }, t)).toEqual({ result: "—", value: "— / — / — / —" });
    expect(resultCells({ inputKind: "text", textValue: null }, t)).toEqual({ result: "—", value: "" });
  });

  it("dates in the report's zone (an unknown zone falls back to UTC), the file name, the watermark, the signature text", () => {
    expect(zonedText("2026-10-10T02:00:00.000Z", "Asia/Jakarta", "en-GB")).toBe("10 Oct 2026, 09:00 (Asia/Jakarta)");
    expect(zonedText("2026-10-10T02:00:00.000Z", "Mars/Base", "en-GB", false)).toBe("10 Oct 2026");
    expect(zonedText(null, "UTC", "en-GB")).toBe("—");
    expect(zonedText("nope", "UTC", "en-GB")).toBe("—");
    expect(ipmReportFileName(ipmReportDoc())).toBe("IPM_IPM-SC-20261010-007_2026-10-10.pdf");
    expect(ipmReportFileName(ipmReportDoc({ reportNumber: null }))).toBe("IPM_DRAFT_QR-000123_2026-10-10.pdf");
    expect(ipmReportFileName(ipmReportDoc({ reportNumber: null, device: { qrCode: null } }))).toBe("IPM_DRAFT_device_2026-10-10.pdf");
    expect(watermarkOf({ kind: "issued", status: "submitted" })).toBeNull();
    const doc = ipmReportDoc();
    const sig = doc.signatures[0];
    expect(signatureText(sig, doc, options(), "performer")).toBe(
      "Signed electronically by Synthetic Technician (HEALTHCARE TECHNICIAN, Synthetic Calibration Co) on 10 Oct 2026, 10:05 (Asia/Jakarta) — meaning: authorship — hash 0123456789ab…",
    );
    expect(signatureText(sig && { ...sig, valid: false, role: null, organisation: null }, { ...doc, integrity: null }, options(), "performer")).toBe(
      "Signed electronically by Synthetic Technician (—) on 10 Oct 2026, 10:05 (Asia/Jakarta) — meaning: authorship — hash … — signature does not match this content",
    );
    expect(signatureText(undefined, { ...doc, countersignEnabled: false }, options(), "countersign")).toBe("");
  });
});
