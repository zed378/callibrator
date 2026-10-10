/**
 * P22-06 (F-65, F-67; `docs/UPSTREAM/09-REPORT-LAYOUTS.md` § 3) — the inventory list PDF, rendered
 * IN THE BROWSER with jsPDF (imported on demand; no backend PDF, no stored file):
 *
 *  - **provider** variant (D2): A3 landscape, a title line, 14 columns — No, facility, device, make,
 *    type, QR, serial, room, floor, condition, technician, inventory date, front photo, serial-plate
 *    photo (thumbnails, or "-" without photos) — and two signature blocks, "technical performer" and
 *    the document's facility (the upstream named "the last row's" facility);
 *  - **facility** variant (D3): A4 landscape, the facility's name as the heading, 9 columns.
 *
 * Fixes over the upstream (09 § 3.3): a generation date and "page n of m" on every page, the header
 * row repeated on every page, our condition vocabulary. Text goes through the self-hosted Unicode
 * font when it can be fetched (the certificate's, ADR-095 O-5), else Helvetica with Latin-1 folding.
 */
import { CERTIFICATE_FONT_FAMILY, codeMapOf, loadCertificateFont, pdfText, pdfUnicodeText } from "@/lib/certificatePdf";
import type { InventoryRow } from "./documents";

export type InventoryVariant = "provider" | "facility";

/** The printed words (the page's language). */
export interface InventoryPdfLabels {
  title: string;
  columns: readonly string[];
  generated: string;
  /** "Page {page} of {pages}" with the two placeholders. */
  page: string;
  performer: string;
  facilitySide: string;
  none: string;
}

export interface InventoryPdfInput {
  variant: InventoryVariant;
  facilityName: string | null;
  rows: readonly InventoryRow[];
  /** Thumbnails as JPEG data URLs, by attachment id; absent = "without photos". */
  photos?: ReadonlyMap<string, string> | null;
  labels: InventoryPdfLabels;
  generatedAt: string;
}

/** Relative column widths per variant (the photo columns fixed at the thumbnail's size). */
const PROVIDER_WEIGHTS = [3, 12, 14, 8, 8, 7, 9, 9, 4, 6, 10, 7, 0, 0];
const FACILITY_WEIGHTS = [3, 18, 10, 10, 8, 11, 12, 5, 8];
/** A thumbnail's printed size (pt). */
export const PHOTO_PT = 40;
const FONT_PT = 7.5;
const LINE_PT = 9;
const PAD = 3;
const MARGIN = 28;
const FOOTER = 22;

const cellsOf = (r: InventoryRow, index: number, variant: InventoryVariant): (string | null)[] =>
  variant === "provider"
    ? [String(index + 1), r.facility, r.name, r.make, r.type, r.qrCode, r.serial, r.room, r.floor, r.condition, r.technician, r.inventoryDate, null, null]
    : [String(index + 1), r.name, r.make, r.type, r.qrCode, r.serial, r.room, r.floor, r.condition];

/** The document as PDF bytes. */
export async function renderInventoryPdf(input: InventoryPdfInput): Promise<ArrayBuffer> {
  const { jsPDF } = await import("jspdf");
  const provider = input.variant === "provider";
  const pdf = new jsPDF({ unit: "pt", format: provider ? "a3" : "a4", orientation: "landscape" });

  let sans = "helvetica";
  let t: (value: string | null | undefined) => string = pdfText;
  const files = await loadCertificateFont();
  if (files) {
    const maps: Readonly<Record<number, unknown>>[] = [];
    for (const style of ["normal", "bold"] as const) {
      const vfsName = `${CERTIFICATE_FONT_FAMILY}-${style}.ttf`;
      pdf.addFileToVFS(vfsName, files[style]);
      pdf.addFont(vfsName, CERTIFICATE_FONT_FAMILY, style);
      pdf.setFont(CERTIFICATE_FONT_FAMILY, style);
      const map = codeMapOf(pdf.getFont());
      if (map) maps.push(map);
    }
    if (maps.length === 2) {
      const covers = (cp: number): boolean => cp <= 0xffff && maps.every((m) => m[cp] !== undefined);
      sans = CERTIFICATE_FONT_FAMILY;
      t = (value) => pdfUnicodeText(value, covers);
    }
  }
  pdf.setProperties({ title: t(input.labels.title), creator: "Device Calibrator" });

  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const usable = W - 2 * MARGIN;
  const weights = provider ? PROVIDER_WEIGHTS : FACILITY_WEIGHTS;
  const fixed = provider ? 2 * (PHOTO_PT + 2 * PAD) : 0;
  const unit = (usable - fixed) / weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w === 0 ? PHOTO_PT + 2 * PAD : w * unit));
  const photos = input.photos ?? null;

  let y = MARGIN;

  // The heading: the provider's title line, or the facility's name (09 § 3.1, § 3.2).
  pdf.setFont(sans, "bold");
  pdf.setFontSize(provider ? 14 : 16);
  pdf.text(t(provider ? input.labels.title : (input.facilityName ?? input.labels.title)), MARGIN, y + 12);
  y += provider ? 20 : 22;
  if (!provider) {
    pdf.setFont(sans, "normal");
    pdf.setFontSize(9);
    pdf.text(t(input.labels.title), MARGIN, y + 6);
    y += 12;
  }
  pdf.setDrawColor(120);
  pdf.line(MARGIN, y, W - MARGIN, y);
  y += 8;

  const drawHeader = (): void => {
    pdf.setFont(sans, "bold");
    pdf.setFontSize(FONT_PT);
    const lines = input.labels.columns.map((c, i) => pdf.splitTextToSize(t(c), (widths[i] ?? 0) - 2 * PAD) as string[]);
    const h = Math.max(...lines.map((l) => l.length)) * LINE_PT + 2 * PAD;
    let x = MARGIN;
    pdf.setFillColor(229, 231, 235);
    widths.forEach((w, i) => {
      pdf.rect(x, y, w, h, "FD");
      pdf.text(lines[i] ?? [], x + PAD, y + PAD + LINE_PT - 2);
      x += w;
    });
    y += h;
    pdf.setFont(sans, "normal");
  };

  drawHeader();
  pdf.setFontSize(FONT_PT);
  input.rows.forEach((row, index) => {
    const cells = cellsOf(row, index, input.variant);
    const lines = cells.map((c, i) => (pdf.splitTextToSize(t(c ?? "-"), (widths[i] ?? 0) - 2 * PAD) as string[]).slice(0, 6));
    const textH = Math.max(...lines.map((l) => l.length)) * LINE_PT + 2 * PAD;
    const h = provider && photos ? Math.max(textH, PHOTO_PT + 2 * PAD) : textH;
    if (y + h > H - MARGIN - FOOTER) {
      pdf.addPage();
      y = MARGIN;
      drawHeader();
      pdf.setFontSize(FONT_PT);
    }
    let x = MARGIN;
    widths.forEach((w, i) => {
      pdf.rect(x, y, w, h);
      const photoId = provider && i >= 12 ? (i === 12 ? row.frontPhotoId : row.platePhotoId) : null;
      const image = photoId && photos ? photos.get(photoId) : undefined;
      if (provider && i >= 12) {
        if (image) pdf.addImage(image, "JPEG", x + PAD, y + PAD, PHOTO_PT, PHOTO_PT);
        else pdf.text("-", x + PAD, y + PAD + LINE_PT - 2);
      } else {
        pdf.text(lines[i] ?? [], x + PAD, y + PAD + LINE_PT - 2);
      }
      x += w;
    });
    y += h;
  });

  // The provider variant's signature blocks (09 § 3.1): the performer, and the DOCUMENT's facility.
  if (provider) {
    const blockH = 96;
    if (y + 24 + blockH > H - MARGIN - FOOTER) {
      pdf.addPage();
      y = MARGIN;
    }
    y += 24;
    const colW = usable / 2;
    pdf.setFontSize(10);
    pdf.setFont(sans, "bold");
    pdf.text(t(input.labels.performer), MARGIN + colW / 2, y, { align: "center" });
    pdf.text(t(input.labels.facilitySide), MARGIN + colW + colW / 2, y, { align: "center" });
    pdf.setFont(sans, "normal");
    pdf.text(t(input.facilityName ?? input.labels.none), MARGIN + colW + colW / 2, y + 13, { align: "center" });
    pdf.line(MARGIN + colW / 2 - 90, y + 80, MARGIN + colW / 2 + 90, y + 80);
    pdf.line(MARGIN + colW + colW / 2 - 90, y + 80, MARGIN + colW + colW / 2 + 90, y + 80);
  }

  // The footer on every page: when it was generated, and "page n of m".
  const pages = pdf.getNumberOfPages();
  pdf.setFont(sans, "normal");
  pdf.setFontSize(8);
  for (let p = 1; p <= pages; p += 1) {
    pdf.setPage(p);
    pdf.text(t(`${input.labels.generated} ${input.generatedAt}`), MARGIN, H - MARGIN / 2);
    pdf.text(t(input.labels.page.replace("{page}", String(p)).replace("{pages}", String(pages))), W - MARGIN, H - MARGIN / 2, { align: "right" });
  }
  return pdf.output("arraybuffer");
}
