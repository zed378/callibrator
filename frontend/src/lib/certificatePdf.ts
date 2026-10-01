// src/lib/certificatePdf.ts
//
// M-11 (ADR-095) — the certificate PDF is rendered HERE, in the browser, with
// jsPDF. The backend renders no PDF: it serves the certificate DOCUMENT
// (GET /api/v1/certificates/:id/document, or the public verification
// endpoint's `document` for a signed certificate), and this turns it into an
// A4 PDF with every printed field, the verification QR code, and the
// integrity hash the public verification page recomputes.
//
// The QR encodes `doc.verifyUrl`, which the backend resolves (the public
// verification page when CERT_VERIFY_BASE_URL is set) — never an origin
// guessed here, so the printed URL and the QR are what the server attests.
//
// CSP (ADR-071): jsPDF and qrcode are imported on demand, run no eval and
// inject no script or style; the file reaches the user as a Blob download.

import type { CertificateDocument, CertificateIssuer } from "@/api/services/calibration.service";

type RGB = [number, number, number];

const STATUS_LABEL: Record<string, string> = {
  draft: "DRAFT",
  pending_approval: "PENDING APPROVAL",
  approved: "APPROVED",
  signed: "SIGNED",
  revoked: "REVOKED",
};

const STATUS_COLOR: Record<string, RGB> = {
  draft: [107, 114, 128],
  pending_approval: [217, 119, 6],
  approved: [37, 99, 235],
  signed: [5, 150, 105],
  revoked: [220, 38, 38],
};

const NEUTRAL: RGB = [107, 114, 128];
/** How long a download's Blob URL stays valid after the click. */
export const BLOB_URL_LIFETIME_MS = 60_000;
const ACCENT: RGB = [79, 70, 229];
const EMPTY = "-";

/**
 * jsPDF's standard fonts encode Latin-1 only. A character outside it would
 * print as garbage, so accents are folded ("é" → "e") and anything else left
 * outside Latin-1 becomes "?". Printed values are otherwise exactly the data.
 */
export const pdfText = (value: string | null | undefined): string => {
  if (value === null || value === undefined || value === "") return EMPTY;
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\n\x20-\x7e\xa0-\xff]/g, "?");
};

/**
 * ADR-095 follow-up (O-5) — the Unicode font. Noto Sans (SIL OFL 1.1,
 * public/licenses/OFL-NotoSans.txt), subset to Latin (Basic, Latin-1,
 * Extended-A/-B, Extended Additional — so Vietnamese), IPA, combining marks,
 * Greek, Cyrillic, general punctuation, currency, letterlike symbols, number
 * forms, arrows and mathematical operators: about 135 KB per weight. It is
 * self-hosted under public/fonts/ and fetched only when a PDF is rendered, so
 * no page pays for it. Anything the font does not cover (Arabic, Hebrew, CJK,
 * Thai, Indic scripts, emoji) is folded to its base letter when it has one, and
 * otherwise prints as "?" — never a blank or a missing-glyph box.
 *
 * If the font cannot be fetched, the PDF still renders, with jsPDF's built-in
 * Helvetica and the Latin-1 folding of `pdfText`.
 */
export const CERTIFICATE_FONT_FAMILY = "NotoSans";
export const CERTIFICATE_FONT_URLS = {
  normal: "/fonts/NotoSans-Regular-LGC.ttf",
  bold: "/fonts/NotoSans-Bold-LGC.ttf",
} as const;

type FontStyle = keyof typeof CERTIFICATE_FONT_URLS;
type FontFiles = Record<FontStyle, string>;

let fontFiles: Promise<FontFiles> | null = null;

const toBase64 = (bytes: ArrayBuffer): string => {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

const fetchFont = async (url: string): Promise<string> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${String(response.status)}`);
  return toBase64(await response.arrayBuffer());
};

/**
 * The font files as base64, fetched once per page load. A failed fetch is not
 * cached, so the next PDF tries again.
 * @returns the files, or null when they could not be fetched
 */
export async function loadCertificateFont(): Promise<FontFiles | null> {
  fontFiles ??= (async () => {
    const [normal, bold] = await Promise.all([
      fetchFont(CERTIFICATE_FONT_URLS.normal),
      fetchFont(CERTIFICATE_FONT_URLS.bold),
    ]);
    return { normal, bold };
  })();
  try {
    return await fontFiles;
  } catch {
    fontFiles = null;
    return null;
  }
}

/** Test seam: forget the fetched font. */
export const resetCertificateFontCache = (): void => {
  fontFiles = null;
};

/**
 * Text for the Unicode font: NFC (so "ặ" is the one precomposed glyph the font
 * has), with each character the font lacks folded to its base letter when the
 * font has that, and otherwise "?".
 * @param covers - whether the font has a glyph for a code point
 */
export const pdfUnicodeText = (value: string | null | undefined, covers: (codePoint: number) => boolean): string => {
  if (value === null || value === undefined || value === "") return EMPTY;
  let out = "";
  for (const ch of value.normalize("NFC")) {
    const cp = ch.codePointAt(0) ?? 0;
    if (ch === "\n" || covers(cp)) {
      out += ch;
      continue;
    }
    const base = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    out += base !== "" && [...base].every((b) => covers(b.codePointAt(0) ?? 0)) ? base : "?";
  }
  return out;
};

/** The glyph map jsPDF parsed from an embedded TrueType font (BMP code points). */
export const codeMapOf = (font: unknown): Readonly<Record<number, unknown>> | null => {
  if (typeof font !== "object" || font === null || !("metadata" in font)) return null;
  const { metadata } = font;
  if (typeof metadata !== "object" || metadata === null || !("cmap" in metadata)) return null;
  const { cmap } = metadata;
  if (typeof cmap !== "object" || cmap === null || !("unicode" in cmap)) return null;
  const { unicode } = cmap;
  if (typeof unicode !== "object" || unicode === null || !("codeMap" in unicode)) return null;
  const { codeMap } = unicode;
  return typeof codeMap === "object" && codeMap !== null ? (codeMap as Record<number, unknown>) : null;
};

/** yyyy-mm-dd, as the backend template printed dates. */
/**
 * A-303 — the issuer's address line and contact line, as printed under its
 * name (ISO/IEC 17025 7.8.2: the laboratory's name and address on the report).
 * Empty parts are skipped; a line with nothing in it is not returned. The
 * address reads "street, city, province postcode, country".
 */
export const issuerLines = (issuer: CertificateIssuer | null | undefined): string[] => {
  if (!issuer) return [];
  const filled = (parts: (string | null | undefined)[]): string[] =>
    parts.map((p) => (p ?? "").trim()).filter((p) => p !== "");
  const region = filled([issuer.state, issuer.zipCode]).join(" ");
  const address = filled([issuer.address, issuer.city, region, issuer.country]).join(", ");
  const contact = filled([issuer.phone ? `Tel. ${issuer.phone.trim()}` : null, issuer.email, issuer.website]).join(" | ");
  return [address, contact].filter((line) => line !== "");
};

/** ADR-107: the line a v3 certificate prints under its integrity hash. */
export const CONTENT_AS_OF_SIGNING = "Issuer, instrument and signatories as recorded at signing.";

export const pdfDate = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toISOString().slice(0, 10) : EMPTY;

/** The saved-as name: the certificate number, reduced to a safe file name. */
export const certificatePdfFileName = (certificateNumber: string): string =>
  `${certificateNumber.replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf`;

/**
 * Render `doc` to PDF bytes.
 * @returns the PDF file's bytes (they start with `%PDF-`)
 */
export async function renderCertificatePdf(doc: CertificateDocument): Promise<ArrayBuffer> {
  const { jsPDF } = await import("jspdf");
  const QRCode = (await import("qrcode")).default;
  const qrDataUrl = await QRCode.toDataURL(doc.verifyUrl, { margin: 1, width: 240 });

  const pdf = new jsPDF({ unit: "pt", format: "a4" });

  // The Unicode font when it can be fetched; Helvetica (Latin-1) otherwise.
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
      // A character is printed only when BOTH weights have its glyph.
      const covers = (cp: number): boolean => cp <= 0xffff && maps.every((m) => m[cp] !== undefined);
      sans = CERTIFICATE_FONT_FAMILY;
      t = (value) => pdfUnicodeText(value, covers);
    }
  }
  pdf.setProperties({
    title: `Certificate ${pdfText(doc.certificateNumber)}`,
    subject: `${pdfText(doc.type)} certificate`,
    creator: "Callibrator",
    keywords: `${doc.integrity.scheme} ${doc.integrity.hash}`,
  });
  const W = pdf.internal.pageSize.getWidth();
  const M = 48;
  const status = doc.status;
  const label = STATUS_LABEL[status] ?? t(status).toUpperCase();

  // Watermark for anything that is not a signed certificate — drawn first, behind.
  if (status !== "signed") {
    pdf.setTextColor(232, 232, 238);
    pdf.setFont(sans, "bold");
    pdf.setFontSize(70);
    pdf.text(label, W / 2, 470, { align: "center", angle: 22 });
  }

  // Header: the issuing organisation.
  pdf.setTextColor(...ACCENT);
  pdf.setFont(sans, "bold");
  pdf.setFontSize(19);
  pdf.text(t(doc.issuedBy ?? "Calibration laboratory"), M, 60, { maxWidth: W - 2 * M - 200 });
  pdf.setTextColor(...NEUTRAL);
  pdf.setFont(sans, "normal");
  pdf.setFontSize(8);
  // A-303: the issuer's address and contact under its name; the tagline only
  // when there is neither (an older backend, or a tenant with no profile).
  const issuerText = issuerLines(doc.issuer);
  if (issuerText.length === 0) {
    pdf.text("CALIBRATION MANAGEMENT SYSTEM", M, 73);
  } else {
    // Two 8 pt lines fit above the rule at y 92. A longer line is set smaller
    // (down to 6 pt) rather than wrapped into the rule; only past that does it wrap.
    const maxW = W - 2 * M - 200;
    issuerText.forEach((line, i) => {
      const printed = t(line);
      let size = 8;
      while (size > 6 && pdf.getTextWidth(printed) > maxW) {
        size -= 0.5;
        pdf.setFontSize(size);
      }
      pdf.text(printed, M, 73 + i * 10, { maxWidth: maxW });
      pdf.setFontSize(8);
    });
  }

  pdf.setTextColor(17, 24, 39);
  pdf.setFont(sans, "bold");
  pdf.setFontSize(14);
  const type = t(doc.type);
  pdf.text(`${type.charAt(0).toUpperCase()}${type.slice(1)} Certificate`.toUpperCase(), W - M, 58, {
    align: "right",
  });

  // Status pill.
  const sc = STATUS_COLOR[status] ?? NEUTRAL;
  pdf.setFont(sans, "bold");
  pdf.setFontSize(8);
  const pw = pdf.getTextWidth(label) + 16;
  pdf.setFillColor(...sc);
  pdf.roundedRect(W - M - pw, 66, pw, 15, 7, 7, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.text(label, W - M - pw / 2, 76, { align: "center" });

  pdf.setDrawColor(...ACCENT);
  pdf.setLineWidth(2);
  pdf.line(M, 92, W - M, 92);

  // Certificate number.
  pdf.setTextColor(17, 24, 39);
  pdf.setFont(sans, "normal");
  pdf.setFontSize(11);
  pdf.text("Certificate No: ", M, 116);
  const lblW = pdf.getTextWidth("Certificate No: ");
  pdf.setTextColor(...ACCENT);
  pdf.setFont(sans, "bold");
  pdf.text(t(doc.certificateNumber), M + lblW, 116);

  // Two-column detail sections.
  const col = (W - 2 * M) / 2;
  const section = (x: number, y0: number, heading: string, rows: [string, string][]) => {
    pdf.setTextColor(...NEUTRAL);
    pdf.setFont(sans, "bold");
    pdf.setFontSize(9);
    pdf.text(heading.toUpperCase(), x, y0);
    pdf.setDrawColor(229, 231, 235);
    pdf.setLineWidth(0.5);
    pdf.line(x, y0 + 4, x + col - 20, y0 + 4);
    rows.forEach(([name, value], i) => {
      const ry = y0 + 20 + i * 16;
      pdf.setTextColor(...NEUTRAL);
      pdf.setFont(sans, "normal");
      pdf.setFontSize(9);
      pdf.text(name, x, ry);
      pdf.setTextColor(17, 24, 39);
      pdf.setFont(sans, "bold");
      pdf.text(value, x + 92, ry, { maxWidth: col - 112 });
    });
  };
  section(M, 150, "Instrument", [
    ["Name", t(doc.device?.name)],
    ["Serial No.", t(doc.device?.serialNumber)],
    ["Manufacturer", t(doc.device?.manufacturer)],
    ["Model", t(doc.device?.model)],
  ]);
  section(M + col, 150, "Certificate", [
    ["Standard", t(doc.standard)],
    ["Issue Date", pdfDate(doc.issueDate)],
    ["Valid Until", pdfDate(doc.validUntil)],
    ["Type", type],
  ]);

  // Text blocks.
  const block = (heading: string, text: string, y0: number): number => {
    pdf.setTextColor(...NEUTRAL);
    pdf.setFont(sans, "bold");
    pdf.setFontSize(9);
    pdf.text(heading.toUpperCase(), M, y0);
    pdf.setDrawColor(229, 231, 235);
    pdf.setLineWidth(0.5);
    pdf.line(M, y0 + 4, W - M, y0 + 4);
    pdf.setTextColor(55, 65, 81);
    pdf.setFont(sans, "normal");
    pdf.setFontSize(10);
    const lines = pdf.splitTextToSize(text, W - 2 * M) as string[];
    pdf.text(lines, M, y0 + 20);
    return y0 + 20 + lines.length * 13 + 14;
  };
  let y = block("Summary", t(doc.summary), 250);
  y = block("Conditions", t(doc.conditions), y);
  y = block("Notes", t(doc.notes), y);

  // Signatures.
  y = Math.max(y, 620);
  const sigW = (W - 2 * M) / 3;
  const signed = status === "signed" || status === "revoked";
  const sigs: [string, string][] = [
    ["Calibrated By", t(doc.calibratedBy)],
    ["Approved By", t(doc.approvedBy)],
    [
      signed ? `Digitally Signed${doc.signedAt ? ` - ${pdfDate(doc.signedAt)}` : ""}` : "Signed By",
      signed ? t(doc.signedBy) : EMPTY,
    ],
  ];
  sigs.forEach(([role, name], i) => {
    const x = M + i * sigW;
    const cx = x + (sigW - 24) / 2;
    pdf.setDrawColor(156, 163, 175);
    pdf.setLineWidth(0.5);
    pdf.line(x, y, x + sigW - 24, y);
    pdf.setTextColor(17, 24, 39);
    pdf.setFont(sans, "bold");
    pdf.setFontSize(10);
    pdf.text(name, cx, y + 14, { align: "center" });
    pdf.setTextColor(...NEUTRAL);
    pdf.setFont(sans, "normal");
    pdf.setFontSize(8);
    pdf.text(role.toUpperCase(), cx, y + 26, { align: "center" });
  });

  // Footer: verification QR, URL and the integrity hash.
  const footY = 712;
  pdf.setDrawColor(229, 231, 235);
  pdf.setLineWidth(0.5);
  pdf.line(M, footY - 14, W - M, footY - 14);
  pdf.addImage(qrDataUrl, "PNG", W - M - 90, footY - 6, 90, 90);
  const textW = W - 2 * M - 110;
  pdf.setTextColor(...NEUTRAL);
  pdf.setFont(sans, "normal");
  pdf.setFontSize(8);
  pdf.text("Scan the QR code to verify this certificate, or visit:", M, footY + 2);
  pdf.setTextColor(55, 65, 81);
  const urlLines = pdf.splitTextToSize(t(doc.verifyUrl), textW) as string[];
  pdf.text(urlLines, M, footY + 14);
  const hy = footY + 18 + urlLines.length * 10;
  pdf.setTextColor(...NEUTRAL);
  pdf.text(`Integrity (${t(doc.integrity.scheme)}, ${doc.integrity.algorithm}):`, M, hy);
  pdf.setFont("courier", "normal");
  pdf.setTextColor(55, 65, 81);
  const hashLines = pdf.splitTextToSize(doc.integrity.hash, textW) as string[];
  pdf.text(hashLines, M, hy + 11);
  // ADR-107: a certificate signed with a snapshot says what it prints is fixed.
  if (doc.contentAsOf === "signing") {
    pdf.setFont(sans, "normal");
    pdf.setTextColor(...NEUTRAL);
    pdf.text(t(CONTENT_AS_OF_SIGNING), M, hy + 13 + hashLines.length * 10, { maxWidth: textW });
  }

  return pdf.output("arraybuffer");
}

/**
 * Render `doc` and hand it to the browser as a download
 * (`<certificateNumber>.pdf`).
 */
export async function downloadCertificatePdf(doc: CertificateDocument): Promise<void> {
  const bytes = await renderCertificatePdf(doc);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = certificatePdfFileName(doc.certificateNumber);
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Released a minute later, not at once: a browser that reads the Blob
    // after the click returns (a download manager, a PDF viewer tab) must
    // still find it. A minute of one PDF in memory is the cost.
    setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_LIFETIME_MS);
  }
}
