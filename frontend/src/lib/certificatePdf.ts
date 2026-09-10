// src/lib/certificatePdf.ts
//
// Client-side certificate PDF renderer. The backend only serves the certificate
// DB record + the public verification endpoint; the PDF (with an embedded
// verification QR code) is generated entirely in the browser with jsPDF.

import type { Certificate } from "@/api/services/calibration.service";

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

type SignatoryUser = { firstName?: string; lastName?: string; email?: string };

const userName = (u?: SignatoryUser | null): string =>
  u ? [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || "—" : "—";

const fmtDate = (d?: string): string =>
  d ? new Date(d).toISOString().slice(0, 10) : "—";

/**
 * Render `cert` to a PDF and trigger a browser download.
 * @param orgName Organization/tenant name shown in the header.
 */
export async function generateCertificatePdf(
  cert: Certificate,
  orgName = "Calibration Management System",
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const QRCode = (await import("qrcode")).default;

  const verifyUrl = `${window.location.origin}/api/v1/certificates/verify/${encodeURIComponent(
    cert.certificateNumber,
  )}`;
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 240 });

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 48;
  const accent: RGB = [79, 70, 229];
  const status = cert.status;

  // Watermark for anything not finalized (signed).
  if (status !== "signed") {
    doc.setTextColor(232, 232, 238);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(70);
    doc.text(STATUS_LABEL[status] || status.toUpperCase(), W / 2, 470, {
      align: "center",
      angle: 22,
    });
  }

  // Header
  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(19);
  doc.text(orgName, M, 60);
  doc.setTextColor(107, 114, 128);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("CALIBRATION MANAGEMENT SYSTEM", M, 73);

  doc.setTextColor(17, 24, 39);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  const title = `${cert.type.charAt(0).toUpperCase()}${cert.type.slice(1)} Certificate`;
  doc.text(title.toUpperCase(), W - M, 58, { align: "right" });

  // Status pill
  const sc = STATUS_COLOR[status] || [107, 114, 128];
  const pillText = STATUS_LABEL[status] || status;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  const pw = doc.getTextWidth(pillText) + 16;
  doc.setFillColor(sc[0], sc[1], sc[2]);
  doc.roundedRect(W - M - pw, 66, pw, 15, 7, 7, "F");
  doc.setTextColor(255, 255, 255);
  doc.text(pillText, W - M - pw / 2, 76, { align: "center" });

  // Accent divider
  doc.setDrawColor(accent[0], accent[1], accent[2]);
  doc.setLineWidth(2);
  doc.line(M, 92, W - M, 92);

  // Certificate number
  doc.setTextColor(17, 24, 39);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("Certificate No: ", M, 116);
  const lblW = doc.getTextWidth("Certificate No: ");
  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.setFont("helvetica", "bold");
  doc.text(cert.certificateNumber, M + lblW, 116);

  // Two-column detail sections
  const colGap = (W - 2 * M) / 2;
  const drawSection = (x: number, y0: number, heading: string, rows: [string, string][]) => {
    doc.setTextColor(107, 114, 128);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(heading.toUpperCase(), x, y0);
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.5);
    doc.line(x, y0 + 4, x + colGap - 20, y0 + 4);
    let ry = y0 + 20;
    rows.forEach(([label, value]) => {
      doc.setTextColor(107, 114, 128);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(label, x, ry);
      doc.setTextColor(17, 24, 39);
      doc.setFont("helvetica", "bold");
      doc.text(value || "—", x + 92, ry, { maxWidth: colGap - 112 });
      ry += 16;
    });
  };

  drawSection(M, 150, "Instrument", [
    ["Name", cert.device?.name || "—"],
    ["Serial No.", cert.device?.serialNumber || "—"],
    ["Manufacturer", cert.device?.manufacturer || "—"],
    ["Model", cert.device?.model || "—"],
  ]);
  drawSection(M + colGap, 150, "Certificate", [
    ["Standard", cert.standard || "—"],
    ["Issue Date", fmtDate(cert.issueDate)],
    ["Valid Until", fmtDate(cert.validUntil)],
    ["Type", cert.type],
  ]);

  // Text blocks
  let y = 250;
  const drawBlock = (heading: string, text: string, y0: number): number => {
    doc.setTextColor(107, 114, 128);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(heading.toUpperCase(), M, y0);
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.5);
    doc.line(M, y0 + 4, W - M, y0 + 4);
    doc.setTextColor(55, 65, 81);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(text || "—", W - 2 * M);
    doc.text(lines, M, y0 + 20);
    return y0 + 20 + lines.length * 13 + 14;
  };
  y = drawBlock("Summary", cert.summary || "—", y);
  y = drawBlock(
    "Conditions & Notes",
    [cert.conditions, cert.notes].filter(Boolean).join("\n") || "—",
    y,
  );

  // Signatures
  y = Math.max(y, 660);
  const sigW = (W - 2 * M) / 3;
  const sigs: [string, string][] = [
    ["Calibrated By", userName(cert.calibratedByUser)],
    ["Approved By", userName(cert.approvedByUser)],
    [
      status === "signed" ? "Digitally Signed" : "Signed By",
      status === "signed" ? userName(cert.signedByUser) : "—",
    ],
  ];
  sigs.forEach(([role, name], i) => {
    const x = M + i * sigW;
    const cx = x + (sigW - 24) / 2;
    doc.setDrawColor(156, 163, 175);
    doc.setLineWidth(0.5);
    doc.line(x, y, x + sigW - 24, y);
    doc.setTextColor(17, 24, 39);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(name, cx, y + 14, { align: "center" });
    doc.setTextColor(107, 114, 128);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const suffix = i === 2 && cert.signedAt ? ` · ${fmtDate(cert.signedAt)}` : "";
    doc.text(role.toUpperCase() + suffix, cx, y + 26, { align: "center" });
  });

  // Footer: verification QR + URL
  const footY = 772;
  doc.setDrawColor(229, 231, 235);
  doc.setLineWidth(0.5);
  doc.line(M, footY - 14, W - M, footY - 14);
  doc.addImage(qrDataUrl, "PNG", W - M - 62, footY - 6, 62, 62);
  doc.setTextColor(107, 114, 128);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Scan the QR code to verify authenticity, or visit:", M, footY + 2);
  doc.setTextColor(55, 65, 81);
  const urlLines = doc.splitTextToSize(verifyUrl, W - 2 * M - 90);
  doc.text(urlLines, M, footY + 14);

  doc.save(`${cert.certificateNumber}.pdf`);
}

export default generateCertificatePdf;
