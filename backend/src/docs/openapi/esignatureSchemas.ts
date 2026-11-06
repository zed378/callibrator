/**
 * P21-15 (ADR-140) — the e-signature answers as OpenAPI components: the contracts' strict schemas
 * (@callibrator/contracts/esignatures) with an id and a synthetic example each. Named exports only.
 */
import { esignatureApplicationView, myEsignatureState, myEsignatureView, publicEsignatureVerdict } from "@callibrator/contracts/esignatures";

const SPECIMEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><path d="M10 80 C 40 10, 65 10, 95 80" fill="none" stroke="#111" stroke-width="2"/></svg>';
const FINGERPRINT = "9f2b6c1d4e8a7b3c5d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e";
const HASH = "56e69d620f618fec1190787ceaed5496af6ae3f7871d87a59c257a8cabc76075";
const SIGNER = { name: "Teknisi Sintetis", role: "HEALTHCARE TECHNICIAN", organisation: "Lab Sintetis" };

const MINE = {
  id: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
  version: 2,
  status: "active",
  specimenSvg: SPECIMEN,
  keyFingerprint: FINGERPRINT,
  createdAt: "2030-01-10T08:00:00.000Z",
  supersededAt: null,
  revokedAt: null,
};

export const MyEsignature = myEsignatureView.meta({
  id: "MyEsignature",
  description: "P21-15: a personal e-signature as its owner sees it — the specimen and the key's fingerprint, never the private key",
  examples: [MINE],
});

export const MyEsignatureState = myEsignatureState.meta({
  id: "MyEsignatureState",
  description: "P21-15: the caller's active e-signature (or null) and its earlier versions, newest first",
  examples: [{ active: MINE, history: [{ ...MINE, id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e", version: 1, status: "superseded", supersededAt: "2030-01-10T08:00:00.000Z" }] }],
});

export const EsignatureApplication = esignatureApplicationView.meta({
  id: "EsignatureApplication",
  description: "P21-15: one application of a personal e-signature to a document, with its public verification link",
  examples: [{
    id: "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a",
    documentType: "calibration_record",
    documentId: "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d",
    documentTitle: "Calibration record Pompa infus sintetis 2030-01-15",
    meaning: "performed",
    signer: SIGNER,
    specimenSvg: SPECIMEN,
    keyFingerprint: FINGERPRINT,
    contentScheme: "calrec-data-v1",
    contentHash: HASH,
    authMethod: "password",
    signedAt: "2030-01-15T09:30:00.123Z",
    verifyUrl: "https://app.example.test/s/4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a?t=q3kZ0x9VbN2mP4rT6wY8aC1dE3fG5hJ7",
    integrity: "intact",
  }],
});

export const EsignatureVerification = publicEsignatureVerdict.meta({
  id: "EsignatureVerification",
  description:
    "P21-15: the verdict on an e-signature application. `verdict` is the field to branch on; `esignatureState` and `documentState` are shown beside it, " +
    "never in its place. For a record, `canonicalContent` hashes (SHA-256 of its JSON) to `contentHash` when unchanged; for a document the reader hashes the " +
    "file. `publicKeyPem` lets anyone check the RSA signature offline.",
  examples: [{
    verdict: "valid",
    explanation: {
      id: "Tanda tangan elektronik sah dan isi dokumen tidak berubah sejak ditandatangani.",
      en: "The e-signature is valid and the document's content has not changed since it was signed.",
    },
    esignatureState: "active",
    esignatureStateAt: null,
    documentState: "current",
    documentStateAt: null,
    signedAt: "2030-01-15T09:30:00.123Z",
    meaning: "performed",
    signer: SIGNER,
    specimenSvg: SPECIMEN,
    keyFingerprint: FINGERPRINT,
    publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEA\n-----END PUBLIC KEY-----\n",
    organisation: { name: "Lab Sintetis" },
    documentType: "calibration_record",
    documentTitle: "Calibration record Pompa infus sintetis 2030-01-15",
    contentScheme: "calrec-data-v1",
    contentHash: HASH,
    canonicalContent: [
      ["schemeVersion", "calrec-data-v1"],
      ["tenantId", "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f"],
    ],
    summary: {
      deviceName: "Pompa infus sintetis",
      brand: "Pembuat",
      model: "P-1",
      serialNumber: "SN-0001",
      calibrationDate: "2030-01-15",
      dueDate: "2031-01-15",
      isCompliant: true,
    },
  }],
});
