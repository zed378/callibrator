/** @jest-environment node */
/**
 * P22-06 — the inventory PDF rendered with the real jsPDF (no DOM needed) and read back:
 *  - provider variant: A3 landscape, the 14 headers, photos drawn as images where given and "-"
 *    where not, the two signature blocks naming the DOCUMENT's facility, "page n of m" on every page;
 *  - facility variant: A4 landscape, the facility's name as the heading, enough rows to break
 *    pages (the header repeated, every page numbered);
 *  - the Unicode font when it can be fetched, Helvetica (Latin-1 folding) when it cannot.
 */
import { readFileSync } from "fs";
import path from "path";
import { resetCertificateFontCache } from "@/lib/certificatePdf";
import type { InventoryRow } from "./documents";
import { renderInventoryPdf, type InventoryPdfLabels } from "./inventoryPdf";

const PUBLIC = path.join(__dirname, "../../../public");
/** A 1 × 1 baseline JPEG. */
const JPEG =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

const labels = (columns: number): InventoryPdfLabels => ({
  title: "Devices of the hospital or clinic",
  columns: Array.from({ length: columns }, (_, i) => `Col${String(i)}`),
  generated: "Generated",
  page: "Page {page} of {pages}",
  performer: "Technical performer",
  facilitySide: "For the facility",
  none: "-",
});

const row = (i: number, over: Partial<InventoryRow> = {}): InventoryRow => ({
  id: `d${String(i)}`,
  facility: "Synthetic clinic",
  name: `Synthetic device ${String(i)}`,
  make: "Make",
  type: "Type",
  qrCode: `QR-${String(i).padStart(6, "0")}`,
  serial: `SN-${String(i)}`,
  room: "ICU",
  floor: "2",
  condition: "Good",
  technician: "Synthetic Tech",
  inventoryDate: "2026-09-01",
  calibrationDate: null,
  frontPhotoId: null,
  platePhotoId: null,
  ...over,
});

const text = (bytes: ArrayBuffer): string => Buffer.from(bytes).toString("latin1");
const pageCount = (pdf: string): number => (pdf.match(/\/Type \/Page\b/g) ?? []).length;

beforeEach(() => {
  resetCertificateFontCache();
  jest.restoreAllMocks();
});

describe("P22-06 — inventory PDF", () => {
  it("provider: A3 landscape, headers, a photo drawn and a missing one as '-', the signature blocks, page numbers (Helvetica)", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("offline"));
    const bytes = await renderInventoryPdf({
      variant: "provider",
      facilityName: "Synthetic clinic",
      rows: [row(1, { frontPhotoId: "p1", platePhotoId: "p2", technician: null, make: null })],
      photos: new Map([["p1", JPEG]]),
      labels: labels(14),
      generatedAt: "10 Oct 2026, 09:00",
    });
    const pdf = text(bytes);
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf).toMatch(/\/MediaBox \[0 0 1190\.5\d* 841\.8\d*\]/);
    expect(pdf).toContain("(Devices of the hospital or clinic) Tj");
    expect(pdf).toContain("(Col13) Tj");
    expect(pdf).toContain("(Synthetic device 1) Tj");
    expect(pdf).toContain("/Subtype /Image");
    expect(pdf).toContain("(-) Tj");
    expect(pdf).toContain("(Technical performer) Tj");
    expect(pdf).toContain("(For the facility) Tj");
    expect(pdf).toContain("(Synthetic clinic) Tj");
    expect(pdf).toContain("(Generated 10 Oct 2026, 09:00) Tj");
    expect(pdf).toContain("(Page 1 of 1) Tj");
  });

  it("facility: A4 landscape, the facility as the heading, many rows over several pages, each numbered", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("offline"));
    const rows = Array.from({ length: 120 }, (_, i) => row(i + 1));
    const pdf = text(
      await renderInventoryPdf({ variant: "facility", facilityName: "Synthetic clinic", rows, labels: labels(9), generatedAt: "now" }),
    );
    expect(pdf).toMatch(/\/MediaBox \[0 0 841\.8\d* 595\.2\d*\]/);
    const pages = pageCount(pdf);
    expect(pages).toBeGreaterThan(2);
    expect(pdf).toContain(`(Page ${String(pages)} of ${String(pages)}) Tj`);
    expect((pdf.match(/\(Col8\) Tj/g) ?? []).length).toBe(pages);
    expect(pdf).not.toContain("(Technical performer) Tj");
  });

  it("provider without photos and without a facility name; a full last page moves the signatures to a new one", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("offline"));
    const one = text(await renderInventoryPdf({ variant: "provider", facilityName: null, rows: [], photos: null, labels: labels(14), generatedAt: "now" }));
    expect(one).toContain("(For the facility) Tj");
    expect(pageCount(one)).toBe(1);
    // A facility PDF without a name heads with the title.
    const nameless = text(await renderInventoryPdf({ variant: "facility", facilityName: null, rows: [row(1)], labels: labels(9), generatedAt: "now" }));
    expect((nameless.match(/\(Devices of the hospital or clinic\) Tj/g) ?? []).length).toBe(2);
    // Enough rows that the last page has no room left for the signatures.
    const counts = [];
    for (const n of [38, 39, 40, 41, 42]) {
      const pdf = text(await renderInventoryPdf({ variant: "provider", facilityName: "F", rows: Array.from({ length: n }, (_, i) => row(i)), labels: labels(14), generatedAt: "now" }));
      counts.push(pageCount(pdf));
    }
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(2);
  });

  it("the Unicode font when it can be fetched (both weights embedded)", async () => {
    jest.spyOn(global, "fetch").mockImplementation(async (url) => new Response(readFileSync(path.join(PUBLIC, String(url)))));
    const pdf = text(
      await renderInventoryPdf({ variant: "facility", facilityName: "Klinik Sehat — Ünïcødé", rows: [row(1, { name: "Pompa infus ✓" })], labels: labels(9), generatedAt: "now" }),
    );
    expect(pdf).toContain("/FontName /");
    expect(pdf).toMatch(/NotoSans/);
    expect(pdf).not.toContain("(Klinik Sehat");
  });
});
