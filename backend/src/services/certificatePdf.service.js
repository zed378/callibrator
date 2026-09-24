// src/services/certificatePdf.service.js
//
// Renders calibration certificates to PDF (puppeteer) with an embedded
// verification QR code, computes a tamper-evident SHA-256 integrity hash + an
// HMAC signature, and powers the public verification endpoint.
//
// The PDF is written under uploads/certificates/<random>.pdf and the
// certificate row's filePath/fileSize are updated. The file name is
// deliberately NOT the certificate number — see randomPdfFileName below
// (ADR-042 step 1, finding S-01).
//
// ADR-042 step 4: that directory is NOT served statically any more. The PDF is
// reached only through GET /certificates/:id/pdf (auth + certificate:read +
// tenant) or, for the public verification page, a short-lived HMAC capability
// minted by the verification endpoint for a SIGNED certificate
// (GET /certificates/verify/:certificateNumber/document?token=...).
// `filePath` is therefore a storage locator (`certificates/<file>`), not a
// URL; only its basename is ever used to find the file.

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
const signing = require("./storage/signing");
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
// P6-10 — the HMAC below names the key that made it: a fingerprint of
// CERT_SIGNING_SECRET (utils/keyring.util.js), not a fixed label. Today the
// signature is returned by generateCertificatePdf and neither persisted, nor
// printed, nor verified anywhere (A-241) — which is why rotating
// CERT_SIGNING_SECRET breaks no issued certificate. Anything that starts
// storing it must store this id beside it and verify against the key it
// names (docs/SECURITY/13-KEY-ROTATION.md § CERT_SIGNING_SECRET).
const SIGNATURE_KEY_ID = `hmac-sha256:${require("../utils/keyring.util").keyIdOf(Buffer.from(SIGNING_SECRET))}`;

// ADR-042 step 4 — the public verification page's document capability.
// An hour, not the attachment links' five minutes: the page mints a fresh one
// on every load, so the TTL only has to outlive one person reading one
// certificate (an auditor with the tab open), and the bookmark a third party
// keeps is the verification page, never this URL.
const DOCUMENT_URL_TTL_SEC = Number(process.env.CERT_DOCUMENT_URL_TTL_SEC) || 3600;
// Domain-separated from every other HMAC made with the same secret.
const documentKey = (certificateNumber) => `certificate-document:${certificateNumber}`;

/** A host-relative, expiring URL to a signed certificate's PDF. */
const mintDocumentUrl = (certificateNumber) => {
  const { token } = signing.sign(documentKey(certificateNumber), DOCUMENT_URL_TTL_SEC, SIGNING_SECRET);
  return `/api/v1/certificates/verify/${encodeURIComponent(certificateNumber)}/document?token=${token}`;
};

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

// ADR-042 step 1 / S-01. The PDF used to be written as <certificateNumber>.pdf,
// and the certificate number is `CERT-<YYYYMMDD>-<tenantCode>-<sequence>` — a
// per-tenant, per-day counter, not a secret. /uploads is an unauthenticated
// express.static mount, so that name made every tenant's certificates walkable
// from the open internet. The name is now a random token; the certificate
// NUMBER is unchanged and remains the identifier printed on the document and
// carried by the QR code.
//
// The shape is the one utils/upload.util.js already uses for uploads
// (timestamp + small counter + uuid v4) rather than a second scheme. The
// timestamp and counter are only there for that consistency — the 122 random
// bits of the uuid are what make the name unguessable, so they come from
// crypto.randomUUID (a CSPRNG-backed v4) rather than the `uuid` package: that
// package is replaced by a constant in the Jest environment (__mocks__/uuid.js),
// which would make the one property this name exists for untestable.
const randomPdfFileName = () =>
  `${Date.now()}-${Math.floor(Math.random() * 10000)}-${crypto.randomUUID()}.pdf`;

// The name a browser should save a download as. This is a Content-Disposition
// label only — it is never used as a path, and the file on disk keeps the
// random name above.
const downloadFileName = (certificateNumber) =>
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

  const previousFilePath = cert.filePath;

  const dir = storagePath("uploads", "certificates");
  fs.mkdirSync(dir, { recursive: true });
  const fileName = randomPdfFileName();
  const absPath = path.join(dir, fileName);
  fs.writeFileSync(absPath, pdfBuffer);

  // A storage locator, not a URL (ADR-042 step 4): nothing serves this path.
  const relPath = `certificates/${fileName}`;
  await cert.update({ filePath: relPath, fileSize: pdfBuffer.length });

  // Regenerating supersedes the previous document. It is no longer publicly
  // reachable (ADR-042 step 4), but a superseded certificate kept on disk is
  // still a stale copy of a regulated record, so it is removed. Done after the
  // row is updated, so a failure here can never leave the row pointing at a
  // file that was deleted. basename() keeps the unlink inside the
  // certificates directory whatever the stored value says.
  if (previousFilePath) {
    const supersededAbsPath = path.join(dir, path.basename(previousFilePath));
    try {
      fs.unlinkSync(supersededAbsPath);
    } catch (err) {
      // Already gone, or not removable. The new file is written and the row is
      // committed either way, so this is not worth failing the generation over
      // — but it is worth a log line: a file that survives here is a stale
      // copy of a regulated record left on disk.
      logger.warn("Superseded certificate PDF could not be removed", {
        certificateId: cert.id,
        path: supersededAbsPath,
        error: err.message,
      });
    }
  }

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
      signatureKeyId: SIGNATURE_KEY_ID,
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
    const absPath = storagePath(
      "uploads",
      "certificates",
      path.basename(cert.filePath),
    );
    if (fs.existsSync(absPath)) {
      return {
        success: true,
        status: 200,
        data: {
          absPath,
          // The on-disk name is random; the saved-as name stays readable.
          fileName: downloadFileName(cert.certificateNumber),
          fileSize: cert.fileSize,
        },
      };
    }
  }
  // A missing file self-heals here: generateCertificatePdf writes a fresh
  // random name and updates cert.filePath, so a stale row never 404s the
  // authenticated download.
  const gen = await generateCertificatePdf(tenantId, certificateId, opts);
  if (!gen.success) {
    return gen;
  }
  return {
    success: true,
    status: 200,
    data: {
      absPath: gen.data.absPath,
      fileName: downloadFileName(cert.certificateNumber),
      fileSize: gen.data.fileSize,
    },
  };
};

// ------------------------------------------------------------------
// PUBLIC VERIFICATION
// ------------------------------------------------------------------
const verifyByCertificateNumber = async (certificateNumber, { baseUrl } = {}) => {
  // A-130 (F-11, ADR-051 A-107) — `paranoid: false`. A soft-deleted
  // certificate used to answer "No certificate matches this number", which to
  // a third party holding the printed copy reads as a forgery — and a deleted
  // REVOKED certificate lost the one fact the holder needed. The row is
  // reported as it stands, marked `withdrawn`, and never as valid.
  const cert = await Certificate.findOne({
    where: { certificateNumber },
    paranoid: false,
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
  const withdrawn = !!cert.deletedAt;
  const valid = signed && !revoked && !expired && !withdrawn;
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
      withdrawn,
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
      // ADR-042 step 2 / A-57. This endpoint is deliberately unauthenticated,
      // so whatever it returns here is published to anyone who walks the
      // certificate number. Only an ISSUED certificate's document is published:
      // `signed` is the only status that means the tenant has stood behind the
      // result. A draft, a pending approval or an approved-but-unsigned
      // certificate is a calibration result the issuer has explicitly not
      // stood behind yet, and publishing it is worse than publishing a
      // finished one.
      //
      // DECISION — a REVOKED certificate returns null. The argument for
      // publishing it is real: a holder who scanned the QR would see the
      // document and the renderer stamps a REVOKED watermark on it. It loses
      // to two facts in this codebase. (1) The stored PDF is whatever was
      // rendered when it was generated — a certificate signed and then revoked
      // still has its SIGNED, unwatermarked PDF on disk, because nothing
      // re-renders on revocation and getOrCreatePdf serves the cached file. So
      // publishing it hands an unauthenticated caller a document that asserts
      // the opposite of the verdict beside it. (2) The revocation is already
      // reported here, in `status`, `revoked` and `valid`, which is what a
      // third party actually needs; the holder can still fetch the document
      // through the authenticated download route. If revocation is ever made
      // to re-render the PDF, this is worth revisiting.
      //
      // `expired` is NOT part of the gate: an expired certificate was properly
      // issued and its document is real history, so it stays published.
      //
      // A withdrawn (soft-deleted) certificate publishes no document either.
      //
      // ADR-042 step 4: what is published is no longer the file's path (that
      // directory is not served) but a short-lived capability for THIS
      // certificate's document, verified again — status included — when it is
      // fetched (getVerifiedDocument).
      documentUrl: signed && !withdrawn && cert.filePath ? mintDocumentUrl(cert.certificateNumber) : null,
    },
  };
};

/**
 * Resolve the public verification page's document capability.
 *
 * The token is checked BEFORE the database is touched. The certificate is then
 * re-checked as it stands now, not as it stood when the token was minted: a
 * certificate revoked or withdrawn inside the token's lifetime stops yielding
 * its document at once. Not found, not signed, withdrawn and never-rendered are
 * the same 404.
 *
 * @param {string} certificateNumber
 * @param {string} token - `<exp>.<hmac>` from mintDocumentUrl
 * @returns {Promise<{success: boolean, status: number, message?: string, data?: {absPath: string, fileName: string}}>}
 */
const getVerifiedDocument = async (certificateNumber, token) => {
  if (!signing.verify(documentKey(certificateNumber), token, SIGNING_SECRET)) {
    return { success: false, status: 403, message: "Invalid or expired document link" };
  }
  const cert = await Certificate.findOne({
    where: { certificateNumber },
    attributes: ["id", "certificateNumber", "status", "filePath"],
  });
  if (!cert || cert.status !== "signed" || !cert.filePath) {
    return { success: false, status: 404, message: "Certificate document not found" };
  }
  const absPath = storagePath("uploads", "certificates", path.basename(cert.filePath));
  if (!fs.existsSync(absPath)) {
    return { success: false, status: 410, message: "Certificate document is no longer available" };
  }
  return {
    success: true,
    status: 200,
    data: { absPath, fileName: downloadFileName(cert.certificateNumber) },
  };
};

module.exports = {
  computeIntegrityHash,
  computeSignature,
  SIGNATURE_KEY_ID,
  generateCertificatePdf,
  getOrCreatePdf,
  verifyByCertificateNumber,
  getVerifiedDocument,
  mintDocumentUrl,
};
