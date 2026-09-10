// src/services/certificatePdf.service.js
//
// Renders calibration certificates to PDF (puppeteer) with an embedded
// verification QR code, computes a tamper-evident SHA-256 integrity hash + an
// HMAC signature, and powers the public verification endpoint.
//
// The PDF is written under uploads/certificates/<number>.pdf (served statically
// at /uploads/...), and the certificate row's filePath/fileSize are updated.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const QRCode = require("qrcode");
const {
  Certificate,
  CalibrationDevice,
  Tenant,
  User,
} = require("../models");
const storagePath = require("../utils/storagePath.util");
const appPath = require("../utils/appPath.util");
const { logger } = require("../middlewares/activityLog.middleware");

// appPath (execPath-relative when packaged) so the template is read from the
// files shipped next to the binary, not the unreadable __dirname-embedded copy.
const TEMPLATE_PATH = appPath("src", "templates", "certificate.html");
const SIGNING_SECRET = process.env.CERT_SIGNING_SECRET;
/* istanbul ignore next -- fail-fast startup guard: certificate signatures are
   the platform's trust anchor, so we never fall back to a hardcoded default. */
if (!SIGNING_SECRET) {
  throw new Error("CERT_SIGNING_SECRET is required (no insecure default)");
}
const SIGNATURE_KEY_ID = "hmac-sha256-v1";

const STATUS_COLORS = {
  draft: "#6b7280",
  pending_approval: "#d97706",
  approved: "#2563eb",
  signed: "#059669",
  revoked: "#dc2626",
};

// ------------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------------
const escapeHtml = (v) => {
  if (v === null || v === undefined) {
    return "";
  }
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

const safeFileName = (certificateNumber) =>
  `${String(certificateNumber).replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf`;

const userName = (u) =>
  u ? [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email : "—";

// The base URL a scanned QR resolves to. Prefer an explicit verify page URL,
// then a public API base, then the caller-provided base.
const resolveVerifyUrl = (certificateNumber, baseUrl) => {
  const explicit = process.env.CERT_VERIFY_BASE_URL;
  if (explicit) {
    return `${explicit.replace(/\/$/, "")}/${certificateNumber}`;
  }
  const base = (baseUrl || process.env.PUBLIC_BASE_URL || "http://localhost:5000").replace(/\/$/, "");
  return `${base}/api/v1/certificates/verify/${certificateNumber}`;
};

// Canonical, stable serialization of the fields that define the certificate's
// authenticity. Any change to these fields changes the integrity hash.
const buildCanonicalPayload = (cert) =>
  JSON.stringify({
    certificateNumber: cert.certificateNumber,
    tenantId: cert.tenantId,
    deviceId: cert.deviceId,
    calibrationRecordId: cert.calibrationRecordId || null,
    type: cert.type,
    status: cert.status,
    standard: cert.standard || null,
    issueDate: cert.issueDate ? new Date(cert.issueDate).toISOString() : null,
    validUntil: cert.validUntil ? new Date(cert.validUntil).toISOString() : null,
    signedBy: cert.signedBy || null,
    signedAt: cert.signedAt ? new Date(cert.signedAt).toISOString() : null,
  });

const computeIntegrityHash = (cert) =>
  crypto.createHash("sha256").update(buildCanonicalPayload(cert)).digest("hex");

const computeSignature = (hash) =>
  crypto.createHmac("sha256", SIGNING_SECRET).update(hash).digest("hex");

const loadCertificate = (tenantId, certificateId) =>
  Certificate.findOne({
    where: tenantId ? { id: certificateId, tenantId } : { id: certificateId },
    include: [
      { model: CalibrationDevice, as: "device", required: false },
      { model: Tenant, as: "tenant", attributes: ["id", "name", "code"], required: false },
      { model: User, as: "calibratedByUser", attributes: ["id", "firstName", "lastName", "email"], required: false },
      { model: User, as: "approvedByUser", attributes: ["id", "firstName", "lastName", "email"], required: false },
      { model: User, as: "signedByUser", attributes: ["id", "firstName", "lastName", "email"], required: false },
    ],
  });

// ------------------------------------------------------------------
// RENDER HTML
// ------------------------------------------------------------------
const renderHtml = (cert, { integrityHash, verifyUrl, qrDataUri }) => {
  const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
  const status = cert.status || "draft";
  const isFinal = status === "signed";
  const watermarkText =
    status === "revoked" ? "REVOKED" : status !== "signed" ? status.replace(/_/g, " ") : "";

  const values = {
    accentColor: cert.tenant?.primaryColor || "#4f46e5",
    statusColor: STATUS_COLORS[status] || "#6b7280",
    statusLabel: status.replace(/_/g, " "),
    typeLabel: (cert.type || "calibration").replace(/^\w/, (c) => c.toUpperCase()),
    tenantName: cert.tenant?.name || "Organization",
    certificateNumber: cert.certificateNumber,
    deviceName: cert.device?.name || "—",
    deviceSerial: cert.device?.serialNumber || "—",
    deviceManufacturer: cert.device?.manufacturer || "—",
    deviceModel: cert.device?.model || "—",
    standard: cert.standard || "—",
    issueDate: fmtDate(cert.issueDate),
    validUntil: fmtDate(cert.validUntil),
    summary: cert.summary || "—",
    conditions: cert.conditions || "—",
    notes: cert.notes || "",
    calibratedBy: userName(cert.calibratedByUser),
    approvedBy: userName(cert.approvedByUser),
    signedBy: isFinal ? userName(cert.signedByUser) : "—",
    signedAtLabel: cert.signedAt ? ` · ${fmtDate(cert.signedAt)}` : "",
    integrityHash,
    verifyUrl,
    watermarkBlock: watermarkText
      ? `<div class="watermark">${escapeHtml(watermarkText)}</div>`
      : "",
  };

  let html = template;
  for (const [key, value] of Object.entries(values)) {
    // qrDataUri and watermarkBlock are inserted raw; everything else escaped.
    html = html.split(`{{${key}}}`).join(escapeHtml(value));
  }
  // Raw (not escaped) insertions.
  html = html.split("{{qrDataUri}}").join(qrDataUri);
  html = html.split("{{watermarkBlock}}").join(values.watermarkBlock);
  return html;
};

// ------------------------------------------------------------------
// GENERATE PDF
// ------------------------------------------------------------------
const generateCertificatePdf = async (tenantId, certificateId, { baseUrl } = {}) => {
  const cert = await loadCertificate(tenantId, certificateId);
  if (!cert) {
    return { success: false, status: 404, message: "Certificate not found" };
  }

  const integrityHash = computeIntegrityHash(cert);
  const verifyUrl = resolveVerifyUrl(cert.certificateNumber, baseUrl);
  const qrDataUri = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 240 });
  const html = renderHtml(cert, { integrityHash, verifyUrl, qrDataUri });

  // Lazy-require puppeteer so unit tests that never generate PDFs don't load it.
  const puppeteer = require("puppeteer");
  const launchOpts = {
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  const browser = await puppeteer.launch(launchOpts);
  let pdfBuffer;
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
  } finally {
    await browser.close();
  }

  const dir = storagePath("uploads", "certificates");
  fs.mkdirSync(dir, { recursive: true });
  const fileName = safeFileName(cert.certificateNumber);
  const absPath = path.join(dir, fileName);
  fs.writeFileSync(absPath, pdfBuffer);

  const relPath = `/uploads/certificates/${fileName}`;
  await cert.update({ filePath: relPath, fileSize: pdfBuffer.length });

  logger.info("Certificate PDF generated", {
    certificateId: cert.id,
    certificateNumber: cert.certificateNumber,
    fileSize: pdfBuffer.length,
  });

  return {
    success: true,
    status: 200,
    message: "Certificate PDF generated",
    data: {
      filePath: relPath,
      absPath,
      fileSize: pdfBuffer.length,
      integrityHash,
      signature: computeSignature(integrityHash),
      verifyUrl,
    },
  };
};

// Returns an absolute path to the PDF, generating it if it does not exist yet.
const getOrCreatePdf = async (tenantId, certificateId, opts = {}) => {
  const cert = await loadCertificate(tenantId, certificateId);
  if (!cert) {
    return { success: false, status: 404, message: "Certificate not found" };
  }
  if (cert.filePath) {
    const fileName = path.basename(cert.filePath);
    const absPath = storagePath("uploads", "certificates", fileName);
    if (fs.existsSync(absPath)) {
      return {
        success: true,
        status: 200,
        data: { absPath, fileName, fileSize: cert.fileSize },
      };
    }
  }
  const gen = await generateCertificatePdf(tenantId, certificateId, opts);
  if (!gen.success) {
    return gen;
  }
  return {
    success: true,
    status: 200,
    data: {
      absPath: gen.data.absPath,
      fileName: path.basename(gen.data.filePath),
      fileSize: gen.data.fileSize,
    },
  };
};

// ------------------------------------------------------------------
// PUBLIC VERIFICATION
// ------------------------------------------------------------------
const verifyByCertificateNumber = async (certificateNumber, { baseUrl } = {}) => {
  const cert = await Certificate.findOne({
    where: { certificateNumber },
    include: [
      { model: CalibrationDevice, as: "device", attributes: ["id", "name", "serialNumber"], required: false },
      { model: Tenant, as: "tenant", attributes: ["id", "name"], required: false },
      { model: User, as: "signedByUser", attributes: ["id", "firstName", "lastName"], required: false },
    ],
  });

  if (!cert) {
    return {
      success: true,
      status: 200,
      data: { found: false, valid: false, message: "No certificate matches this number." },
    };
  }

  const now = new Date();
  const revoked = cert.status === "revoked";
  const signed = cert.status === "signed";
  const expired = !!(cert.validUntil && new Date(cert.validUntil) < now);
  const valid = signed && !revoked && !expired;
  const integrityHash = computeIntegrityHash(cert);

  return {
    success: true,
    status: 200,
    data: {
      found: true,
      valid,
      status: cert.status,
      revoked,
      expired,
      certificateNumber: cert.certificateNumber,
      type: cert.type,
      standard: cert.standard || null,
      issuedTo: cert.tenant?.name || null,
      device: cert.device
        ? { name: cert.device.name, serialNumber: cert.device.serialNumber }
        : null,
      issueDate: cert.issueDate,
      validUntil: cert.validUntil,
      signedBy: cert.signedByUser ? userName(cert.signedByUser) : null,
      signedAt: cert.signedAt,
      integrityHash,
      verifyUrl: resolveVerifyUrl(cert.certificateNumber, baseUrl),
      // Relative path to the signed PDF (served from /uploads). The public
      // verification page prefixes it with the API origin to display the doc.
      documentUrl: cert.filePath || null,
    },
  };
};

module.exports = {
  computeIntegrityHash,
  computeSignature,
  SIGNATURE_KEY_ID,
  generateCertificatePdf,
  getOrCreatePdf,
  verifyByCertificateNumber,
};
