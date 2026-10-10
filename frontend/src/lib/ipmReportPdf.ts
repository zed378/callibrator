/**
 * P23-02 (P19-06 § 11; ADR-126 Am. 2) — the IPM report PDF, rendered IN THE BROWSER from the
 * served data document (`GET /ipm/sessions/:id/report-document?render=pdf`, or the public
 * verification's `document`). No backend PDF, no stored file (the owner's rule, ADR-126 § 8).
 *
 * A4 landscape, 10 mm margins. Blocks in the order of `09` § 2 with the L-1 … L-8 fixes: the header
 * (title, the device in upper case, the issuer's letterhead), the identity grid (the device's own
 * last and next calibration dates — L-1), the report line (number, visit `007`), the sections in
 * `INSPECTION_SECTIONS` order in two columns (condition and cleanliness apart — L-3; the electrical
 * safety's computed result; the performance table with readings, reference and a disagreement
 * mark; battery when present — L-4), the outcomes (the inspection result is the session's — L-2),
 * the recommendation in words, the notes as text (L-8), the signatures (the technician's and the
 * IPSRS', each electronic or "not yet", above a line for a wet signature), the lineage band, and on
 * every page a footer: report number, page x / y, "generated … by <reader>", the integrity hash
 * (and "INTEGRITY CHECK FAILED" on a mismatch); the verification QR on the first page; a diagonal
 * watermark on a preview, a superseded or a voided report.
 *
 * Every fixed label comes from the caller's translator (`ipmReport.` namespace, the language the
 * reader chose); item labels, notes and snapshots print as captured. Text goes through the
 * certificate's Unicode font when it can be fetched, else Helvetica with Latin-1 folding.
 */
import { CERTIFICATE_FONT_FAMILY, codeMapOf, loadCertificateFont, pdfText, pdfUnicodeText } from "@/lib/certificatePdf";
import type { components } from "@/api/typed";

export type IpmReportDocument = components["schemas"]["IpmReportDocument"];
type Signature = components["schemas"]["IpmReportSignature"];

/** The translator the renderer prints with (the chosen language's `ipmReport.` keys and the catalogue's names). */
export type ReportTranslate = (key: string, values?: Record<string, string | number>) => string;

export interface RenderOptions {
  t: ReportTranslate;
  /** BCP-47 tag of the chosen language, for dates. */
  locale: string;
  /** The reader's display name, printed in the footer ("generated … by"). */
  readerName: string;
  /** The rendering instant (tests pin it). */
  now?: Date;
}

type Item = Record<string, unknown>;

const s = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/**
 * The Helvetica fallback's text: `pdfText`'s Latin-1 folding, except that the MICRO SIGN (µ, U+00B5)
 * is kept — it is Latin-1, but `pdfText`'s NFKD turns it into the Greek mu (U+03BC), which is not,
 * and "45 µA" would print as "45 ?A" (found by the golden file; leakage currents are in µA).
 */
export const latin1Text = (value: string | null | undefined): string =>
  value === null || value === undefined || value === "" ? pdfText(value) : value.split("µ").map((part) => (part === "" ? "" : pdfText(part))).join("µ");

/** A date-time in the report's time zone, named. */
export const zonedText = (iso: string | null | undefined, timeZone: string, locale: string, withTime = true): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat(locale, { timeZone });
  } catch {
    zone = "UTC";
  }
  const text = new Intl.DateTimeFormat(locale, { timeZone: zone, day: "numeric", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(d);
  return withTime ? `${text} (${zone})` : text;
};

/** A calendar day as printed (`YYYY-MM-DD` read as written, never shifted). */
const dayText = (value: string | null, locale: string): string => {
  const m = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  if (!m) return "—";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))));
};

/** One printed result's result cell and value cell, by input kind. */
export const resultCells = (item: Item, t: ReportTranslate): { result: string; value: string } => {
  const outcome = s(item["outcome"]);
  const result = outcome ? t(`ipmCatalogue.outcome.${outcome}`) : "—";
  const unit = s(item["unit"]);
  const withUnit = (v: string | null) => (v ? `${v}${unit ? ` ${unit}` : ""}` : null);
  const marks = [
    item["outcomeSource"] === "computed" ? t("ipmReport.flag.computed") : null,
    item["warnFlag"] === true ? t("ipmReport.flag.warn") : null,
    item["disagreementFlag"] === true ? t("ipmReport.flag.disagree") : null,
  ].filter((m): m is string => m !== null);
  const resultText = marks.length > 0 ? `${result} (${marks.join(", ")})` : result;
  switch (item["inputKind"]) {
    case "condition_clean": {
      const clean = s(item["cleanliness"]);
      return { result: resultText, value: clean ? t(`ipmReport.cleanliness.${clean}`) : "—" };
    }
    case "measured":
    case "measured_with_limit": {
      const v = withUnit(s(item["measuredValue"]) ?? s(item["rawValue"]));
      const limit = s(item["limitText"]);
      return { result: resultText, value: [v, limit ? `(${limit})` : null].filter(Boolean).join(" ") || "—" };
    }
    case "setting_measured_reference":
      return {
        result: resultText,
        value: [s(item["setting"]), withUnit(s(item["measuredValue1"])), withUnit(s(item["measuredValue2"])), s(item["reference"])].map((v) => v ?? "—").join(" / "),
      };
    case "text":
      return { result: s(item["textValue"]) ?? "—", value: "" };
    default:
      return { result: resultText, value: "" };
  }
};

/** The file name: `IPM_<reportNumber>_<performedDate>.pdf`, a preview `IPM_DRAFT_<QR>_<date>.pdf` — never a person's name. */
export const ipmReportFileName = (doc: Pick<IpmReportDocument, "reportNumber" | "performedAt" | "device">): string => {
  const date = doc.performedAt.slice(0, 10);
  const safe = (v: string) => v.replace(/[^\w.-]+/g, "_");
  return doc.reportNumber ? `IPM_${safe(doc.reportNumber)}_${date}.pdf` : `IPM_DRAFT_${safe(s(doc.device["qrCode"]) ?? "device")}_${date}.pdf`;
};

/** The watermark a document carries, or null for an issued, effective report. */
export const watermarkOf = (doc: Pick<IpmReportDocument, "kind" | "status">): "preview" | "superseded" | "voided" | null =>
  doc.kind === "preview" ? "preview" : doc.status === "superseded" ? "superseded" : doc.status === "voided" ? "voided" : null;

/** One signature's printed text. */
export const signatureText = (sig: Signature | undefined, doc: IpmReportDocument, o: RenderOptions, side: "performer" | "countersign"): string => {
  const { t } = o;
  if (sig) {
    const who = [sig.role, sig.organisation].filter(Boolean).join(", ");
    const hash = doc.integrity?.hash.slice(0, 12) ?? "";
    const line = t("ipmReport.sig.signed", {
      name: sig.name,
      role: who || "—",
      at: zonedText(sig.signedAt, doc.timeZone, o.locale),
      meaning: t(`ipmReport.sig.meaning.${sig.meaning}`),
      hash,
    });
    return sig.valid ? line : `${line} — ${t("ipmReport.sig.invalid")}`;
  }
  if (side === "performer") return t("ipmReport.sig.notSigned", { name: doc.performer.name });
  return doc.countersignEnabled ? t("ipmReport.sig.awaiting") : "";
};

/** The PDF bytes. */
export async function renderIpmReportPdf(doc: IpmReportDocument, o: RenderOptions): Promise<ArrayBuffer> {
  const { jsPDF, GState } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const { t } = o;

  let sans = "helvetica";
  let p: (value: string | null | undefined) => string = latin1Text;
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
      p = (value) => pdfUnicodeText(value, covers);
    }
  }
  pdf.setProperties({ title: `IPM ${doc.reportNumber ?? "preview"}`, creator: "Device Calibrator" });

  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const M = 28.35; // 10 mm
  const FOOT = 40;
  const bottom = H - M - FOOT;
  const LINE = 9;
  let y = M;

  const font = (style: "normal" | "bold", size: number) => {
    pdf.setFont(sans, style);
    pdf.setFontSize(size);
  };
  const lines = (text: string, width: number): string[] => pdf.splitTextToSize(p(text), width) as string[];
  const newPage = () => {
    pdf.addPage();
    y = M;
  };
  const ensure = (h: number) => {
    if (y + h > bottom) newPage();
  };

  // ── Header: the title and the device (left), the issuer's letterhead (right) ──
  const issuer = doc.issuer;
  font("bold", 13);
  pdf.text(p(t("ipmReport.title")), M, y + 12);
  font("bold", 11);
  pdf.text(p((s(doc.device["name"]) ?? "—").toUpperCase()), M, y + 28);
  font("bold", 10);
  pdf.text(p(s(issuer["name"]) ?? ""), W - M, y + 10, { align: "right" });
  font("normal", 8);
  const letter = [
    [s(issuer["address"]), s(issuer["city"]), s(issuer["state"]), s(issuer["zipCode"]), s(issuer["country"])].filter(Boolean).join(", "),
    [s(issuer["phone"]), s(issuer["email"]), s(issuer["website"])].filter(Boolean).join(" · "),
  ].filter((l) => l !== "");
  letter.forEach((l, i) => pdf.text(p(l), W - M, y + 21 + i * LINE, { align: "right" }));
  y += 38;
  pdf.setDrawColor(120);
  pdf.line(M, y, W - M, y);
  y += 6;

  // ── Identity grid (L-1: the device's own calibration dates) and the report line ──
  const identity: [string, string][] = [
    [t("ipmReport.field.facility"), doc.facility.name],
    [t("ipmReport.field.performedAt"), zonedText(doc.performedAt, doc.timeZone, o.locale, false)],
    [t("ipmReport.field.room"), [doc.room, doc.floor].filter(Boolean).join(" · ") || "—"],
    [t("ipmReport.field.qr"), s(doc.device["qrCode"]) ?? "—"],
    [t("ipmReport.field.make"), s(doc.device["manufacturer"]) ?? "—"],
    [t("ipmReport.field.serial"), s(doc.device["serialNumber"]) ?? "—"],
    [t("ipmReport.field.model"), [s(doc.device["model"]), s(doc.device["deviceTypeName"])].filter(Boolean).join(" · ") || "—"],
    [t("ipmReport.field.lastCalibration"), dayText(s(doc.device["lastCalibrationDate"]), o.locale)],
    [t("ipmReport.field.nextCalibration"), dayText(s(doc.device["nextCalibrationDate"]), o.locale)],
    [t("ipmReport.field.reportNumber"), doc.reportNumber ?? "—"],
    [
      t("ipmReport.field.visit"),
      [doc.visitNumber === null ? "—" : String(doc.visitNumber).padStart(3, "0"), doc.legacyVisitNumber === null ? null : t("ipmReport.field.legacyVisit", { n: doc.legacyVisitNumber })]
        .filter(Boolean)
        .join(" · "),
    ],
  ];
  const cellW = (W - 2 * M) / 4;
  const rowH = 22;
  identity.forEach(([label, value], i) => {
    const x = M + (i % 4) * cellW;
    const top = y + Math.floor(i / 4) * rowH;
    pdf.rect(x, top, cellW, rowH);
    font("normal", 6.5);
    pdf.text(p(label), x + 3, top + 8);
    font("bold", 8);
    pdf.text(lines(value, cellW - 6).slice(0, 1), x + 3, top + 17);
  });
  y += Math.ceil(identity.length / 4) * rowH + 8;

  // ── The sections: two columns; completeness, performance and battery full width ──
  const FULL = new Set(["completeness", "performance", "battery"]);
  const colGap = 10;
  const colW = (W - 2 * M - colGap) / 2;
  let column = 0;
  let columnTop = y;
  let columnBottom = y;
  const drawSection = (section: { section: string; items: Item[] }, x: number, width: number): void => {
    const full = width > colW;
    font("bold", 8.5);
    pdf.setFillColor(229, 231, 235);
    pdf.rect(x, y, width, 12, "F");
    pdf.text(p(t(`ipmCatalogue.section.${section.section}`)), x + 3, y + 9);
    y += 12;
    const performance = section.section === "performance" || section.section === "battery";
    const cols = performance ? [0.34, 0.11, 0.11, 0.11, 0.18, 0.15] : [0.5, 0.25, 0.25];
    const headers = performance
      ? [t("ipmReport.col.item"), t("ipmReport.col.setting"), t("ipmReport.col.reading1"), t("ipmReport.col.reading2"), t("ipmReport.col.reference"), t("ipmReport.col.result")]
      : [t("ipmReport.col.item"), t("ipmReport.col.result"), t("ipmReport.col.value")];
    const drawRow = (cells: string[], bold: boolean) => {
      font(bold ? "bold" : "normal", 7);
      const wrapped = cells.map((c, i) => lines(c, width * (cols[i] ?? 0) - 4).slice(0, 4));
      const h = Math.max(...wrapped.map((w) => w.length), 1) * 8 + 3;
      if (y + h > bottom) {
        newPage();
        if (!full) columnTop = y;
      }
      let cx = x;
      wrapped.forEach((w, i) => {
        const cw = width * (cols[i] ?? 0);
        pdf.rect(cx, y, cw, h);
        pdf.text(w, cx + 2, y + 8);
        cx += cw;
      });
      y += h;
    };
    drawRow(headers, true);
    for (const item of section.items) {
      const label = `${s(item["label"]) ?? "—"}${item["adHoc"] === true ? " *" : ""}`;
      if (performance) {
        const unit = s(item["unit"]);
        const u = (v: string | null) => (v ? `${v}${unit ? ` ${unit}` : ""}` : "—");
        drawRow([label, s(item["setting"]) ?? "—", u(s(item["measuredValue1"])), u(s(item["measuredValue2"])), s(item["reference"]) ?? s(item["limitText"]) ?? "—", resultCells(item, t).result], false);
      } else {
        const cells = resultCells(item, t);
        drawRow([label, cells.result, cells.value], false);
      }
    }
    y += 6;
  };

  const sections = doc.sections as unknown as { section: string; items: Item[] }[];
  for (const section of sections) {
    const estimate = 12 + (section.items.length + 1) * 11;
    if (FULL.has(section.section)) {
      y = Math.max(columnBottom, y);
      column = 0;
      ensure(Math.min(estimate, 120));
      drawSection(section, M, W - 2 * M);
      columnTop = y;
      columnBottom = y;
      continue;
    }
    if (column === 0) {
      y = Math.max(columnBottom, y);
      ensure(Math.min(estimate, 120));
      columnTop = y;
      drawSection(section, M, colW);
      columnBottom = y;
      column = 1;
    } else {
      const leftBottom = columnBottom;
      y = columnTop;
      drawSection(section, M + colW + colGap, colW);
      columnBottom = Math.max(leftBottom, y);
      y = columnBottom;
      column = 0;
    }
  }
  y = Math.max(columnBottom, y);

  // ── Outcomes, recommendation, notes, signatures: kept together ──
  const overall = (v: string | null) => (v ? t(`ipmReport.overall.${v}`) : "—");
  const notes = lines(doc.notes ?? "-", W - 2 * M - 6).slice(0, 8);
  const blockH = 3 * 12 + notes.length * LINE + 16 + 90;
  ensure(blockH);
  font("bold", 8);
  const summary: [string, string][] = [
    [t("ipmReport.inspectionOutcome"), overall(doc.inspectionOutcome)],
    [t("ipmReport.maintenanceOutcome"), overall(doc.maintenanceOutcome)],
    [t("ipmReport.recommendation"), doc.recommendation ? t(`ipmReport.rec.${doc.recommendation}`) : "—"],
  ];
  for (const [label, value] of summary) {
    font("normal", 7.5);
    pdf.text(p(label), M, y + 9);
    font("bold", 8.5);
    pdf.text(p(value), M + 170, y + 9);
    y += 12;
  }
  font("normal", 7.5);
  pdf.text(p(t("ipmReport.notes")), M, y + 9);
  y += 12;
  pdf.text(notes, M + 3, y + 7);
  y += notes.length * LINE + 6;

  const performer = doc.signatures.find((x) => x.kind === "performer");
  const countersign = doc.signatures.find((x) => x.kind === "countersign");
  const half = (W - 2 * M) / 2;
  font("bold", 8.5);
  pdf.text(p(t("ipmReport.sig.performer")), M, y + 9);
  pdf.text(p(t("ipmReport.sig.countersign")), M + half, y + 9);
  font("normal", 7);
  pdf.text(lines(signatureText(performer, doc, o, "performer"), half - 12).slice(0, 4), M, y + 20);
  pdf.text(lines(signatureText(countersign, doc, o, "countersign"), half - 12).slice(0, 4), M + half, y + 20);
  pdf.line(M + half + 10, y + 74, M + half + half - 40, y + 74);
  y += 82;

  // ── The lineage band ──
  const lineage = [
    doc.lineage.supersedesReportNumber ? t("ipmReport.lineage.supersedes", { number: doc.lineage.supersedesReportNumber }) : null,
    doc.lineage.supersededByReportNumber ? t("ipmReport.lineage.supersededBy", { number: doc.lineage.supersededByReportNumber, date: zonedText(doc.lineage.supersededAt, doc.timeZone, o.locale, false) }) : null,
    doc.lineage.voidedAt ? t("ipmReport.lineage.voided", { date: zonedText(doc.lineage.voidedAt, doc.timeZone, o.locale, false) }) : null,
    doc.flags.imported ? t("ipmReport.lineage.imported") : null,
  ].filter((l): l is string => l !== null);
  if (lineage.length > 0) {
    ensure(lineage.length * LINE + 6);
    font("bold", 7.5);
    lineage.forEach((l, i) => pdf.text(p(l), M, y + 8 + i * LINE));
  }

  // ── Every page: the watermark, the footer; the QR on the first ──
  const mark = watermarkOf(doc);
  const pages = pdf.getNumberOfPages();
  const qr = doc.verifyUrl ? await (await import("qrcode")).default.toDataURL(doc.verifyUrl, { margin: 0, width: 160 }) : null;
  const generated = t("ipmReport.footer.generated", { at: zonedText((o.now ?? new Date()).toISOString(), doc.timeZone, o.locale), name: o.readerName });
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    if (mark) {
      pdf.saveGraphicsState();
      pdf.setGState(new GState({ opacity: 0.15 }));
      font("bold", 64);
      pdf.setTextColor(120);
      pdf.text(p(t(`ipmReport.watermark.${mark}`)), W / 2, H / 2, { align: "center", angle: 30 });
      pdf.restoreGraphicsState();
      pdf.setTextColor(0);
    }
    font("normal", 7);
    const fy = H - M - 14;
    pdf.text(p(`${doc.reportNumber ?? t("ipmReport.watermark.preview")} · ${t("ipmReport.footer.page", { page, pages })} · ${generated}`), M, fy);
    if (doc.integrity) {
      pdf.text(p(t("ipmReport.footer.integrity", { scheme: doc.integrity.scheme, hash: doc.integrity.hash })), M, fy + 9);
      if (doc.integrity.state === "mismatch") {
        font("bold", 8);
        pdf.setTextColor(200, 0, 0);
        pdf.text(p(t("ipmReport.footer.integrityFailed")), M, fy + 19);
        pdf.setTextColor(0);
      }
    }
    if (page === 1 && qr) pdf.addImage(qr, "PNG", W - M - 62, H - M - 62, 62, 62);
  }
  return pdf.output("arraybuffer");
}
