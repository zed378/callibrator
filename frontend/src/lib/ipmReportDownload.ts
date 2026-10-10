/**
 * P23-02 — render an IPM report document in the chosen language and hand it to the browser as a
 * download (`IPM_<number>_<date>.pdf`). Pages import THIS module on demand (`import()` on the click),
 * so the renderer comes with it in one chunk; jsPDF, `qrcode` and the font load inside the renderer.
 */
import type { Messages } from "@/i18n";
import { createTranslator } from "@/i18n/translate";
import { downloadBytes } from "@/lib/export/pagedRead";
import { ipmReportFileName, renderIpmReportPdf, type IpmReportDocument } from "@/lib/ipmReportPdf";

/** The renderer's namespaces (the printed labels and the catalogue's names). */
export const IPM_REPORT_PDF_NAMESPACES = ["ipmReport.", "ipmCatalogue.section.", "ipmCatalogue.outcome."];

export async function downloadIpmReportPdf(
  doc: IpmReportDocument,
  options: { messages: Partial<Messages>; language: "id" | "en"; readerName: string },
): Promise<void> {
  const translate = createTranslator(options.messages);
  const bytes = await renderIpmReportPdf(doc, {
    t: (key, values) => translate(key as keyof Messages, values),
    locale: options.language === "id" ? "id-ID" : "en-GB",
    readerName: options.readerName,
  });
  downloadBytes(bytes, ipmReportFileName(doc), "application/pdf");
}
