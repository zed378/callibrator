/**
 * Q-50 (ADR-107) — a signed certificate's content is fixed at signing
 * (ISO/IEC 17025 7.8): the issuer, instrument and people it prints are
 * SNAPSHOT on the row when it is signed (`signedSnapshot`), printed from the
 * snapshot from then on, and bound by the v3 hash `certificate-content-v3`.
 *
 * A certificate signed before ADR-107 has no snapshot. Nothing is invented for
 * it: it stays v2 (and v1 as `legacyHash`), printed and hashed exactly as
 * before — the v2 hash and its HMAC are recomputed here against an
 * independent oracle, so an old printout still verifies.
 *
 * The v3 oracle below is written out by hand from ADR-107's field list, not
 * produced by the module under test.
 */
import * as crypto from "crypto";
import { environment } from "../../config/env";
import {
  INTEGRITY_SCHEME_V2,
  INTEGRITY_SCHEME_V3,
  buildContentPayloadV3,
  computeContentHash,
  computeContentHashV3,
  computeIntegrityHash,
  computeSignature,
  toCertificateDocument,
  type CertificateSource,
} from "../../services/certificateDocument.service";
import type { CertificateSignedSnapshot } from "../../utils/jsonShape.util";

const sha256 = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");

const SNAPSHOT: CertificateSignedSnapshot = {
  version: 1,
  issuer: {
    name: "Lab Kalibrasi Sehat",
    email: "lab@sehat.example.id",
    phone: "+62 21-555 0100",
    address: "Jl. Kesehatan No. 10",
    city: "Jakarta Pusat",
    state: "DKI Jakarta",
    zipCode: "10110",
    country: "Indonesia",
    website: "https://sehat.example.id",
  },
  device: { name: "Infusion pump", serialNumber: "SN-9", manufacturer: "B. Braun", model: "Perfusor" },
  calibratedBy: "Ani Putri",
  approvedBy: "Budi Santoso",
  signedBy: "Citra Dewi",
};

/** The same certificate, with the LIVE rows as they stand now (renamed, moved). */
const cert = (over: Partial<CertificateSource> = {}): CertificateSource => ({
  certificateNumber: "CERT-20260930-LKS-0007",
  tenantId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  calibrationRecordId: "33333333-3333-4333-8333-333333333333",
  type: "calibration",
  status: "signed",
  standard: "ISO 17025",
  issueDate: new Date("2026-09-01T00:00:00.000Z"),
  validUntil: new Date("2027-09-01T00:00:00.000Z"),
  summary: "All points within tolerance",
  conditions: "23 C, 45 % RH",
  notes: null,
  calibratedBy: "44444444-4444-4444-8444-444444444444",
  approvedBy: "55555555-5555-4555-8555-555555555555",
  signedBy: "66666666-6666-4666-8666-666666666666",
  signedAt: new Date("2026-09-30T08:00:00.000Z"),
  digitalSignature: "sig-bytes",
  digitalSignatureKeyId: "key-1",
  signedSnapshot: SNAPSHOT,
  tenant: { name: "Lab Kalibrasi Sehat", address: "Jl. Kesehatan No. 10", city: "Jakarta Pusat" },
  device: { name: "Infusion pump", serialNumber: "SN-9", manufacturer: "B. Braun", model: "Perfusor" },
  calibratedByUser: { firstName: "Ani", lastName: "Putri" },
  approvedByUser: { firstName: "Budi", lastName: "Santoso" },
  signedByUser: { firstName: "Citra", lastName: "Dewi" },
  ...over,
});

/** ADR-107's v3 payload, written out by hand: the v2 fields in v2's order, then the snapshot in a fixed key order. */
const oracleV3 = (c: CertificateSource, s: CertificateSignedSnapshot): string =>
  JSON.stringify({
    scheme: "certificate-content-v3",
    certificateNumber: c.certificateNumber,
    tenantId: c.tenantId,
    deviceId: c.deviceId,
    calibrationRecordId: c.calibrationRecordId ?? null,
    type: c.type ?? null,
    status: c.status ?? null,
    standard: c.standard ?? null,
    issueDate: c.issueDate ? new Date(c.issueDate).toISOString() : null,
    validUntil: c.validUntil ? new Date(c.validUntil).toISOString() : null,
    summary: c.summary ?? null,
    conditions: c.conditions ?? null,
    notes: c.notes ?? null,
    calibratedBy: c.calibratedBy ?? null,
    approvedBy: c.approvedBy ?? null,
    signedBy: c.signedBy ?? null,
    signedAt: c.signedAt ? new Date(c.signedAt).toISOString() : null,
    digitalSignature: c.digitalSignature ?? null,
    digitalSignatureKeyId: c.digitalSignatureKeyId ?? null,
    snapshot: {
      version: s.version,
      issuer: {
        name: s.issuer.name,
        email: s.issuer.email,
        phone: s.issuer.phone,
        address: s.issuer.address,
        city: s.issuer.city,
        state: s.issuer.state,
        zipCode: s.issuer.zipCode,
        country: s.issuer.country,
        website: s.issuer.website,
      },
      device: s.device
        ? { name: s.device.name, serialNumber: s.device.serialNumber, manufacturer: s.device.manufacturer, model: s.device.model }
        : null,
      calibratedBy: s.calibratedBy,
      approvedBy: s.approvedBy,
      signedBy: s.signedBy,
    },
  });

describe("v3 — a certificate signed with a snapshot", () => {
  it("prints v3, whose hash is the SHA-256 of ADR-107's payload (independent oracle)", () => {
    expect(buildContentPayloadV3(cert())).toBe(oracleV3(cert(), SNAPSHOT));
    const doc = toCertificateDocument(cert(), { withSignature: true });
    expect(doc.integrity.scheme).toBe(INTEGRITY_SCHEME_V3);
    expect(doc.integrity.hash).toBe(sha256(oracleV3(cert(), SNAPSHOT)));
    expect(doc.integrity.hash).toBe(computeContentHashV3(cert()));
    // The HMAC is over the hash the certificate prints.
    expect(doc.integrity.signature).toBe(computeSignature(doc.integrity.hash));
    // v1 is still reported, unchanged, as the legacy hash.
    expect(doc.integrity.legacyHash).toBe(computeIntegrityHash(cert()));
  });

  it("prints the issuer, instrument and people FROM THE SNAPSHOT, and says so", () => {
    const doc = toCertificateDocument(cert());
    expect(doc.issuedBy).toBe(SNAPSHOT.issuer.name);
    expect(doc.issuer).toEqual(SNAPSHOT.issuer);
    expect(doc.device).toEqual(SNAPSHOT.device);
    expect([doc.calibratedBy, doc.approvedBy, doc.signedBy]).toEqual(["Ani Putri", "Budi Santoso", "Citra Dewi"]);
    expect(doc.contentAsOf).toBe("signing");
  });

  it("a rename, an address change, a device edit or a user rename AFTER signing changes nothing on the certificate", () => {
    const before = toCertificateDocument(cert(), { withSignature: true });
    const after = toCertificateDocument(
      cert({
        tenant: { name: "Lab Renamed", address: "Jl. Baru 1", city: "Bandung", phone: "+62 22 700 1000" },
        device: { name: "Pump (relabelled)", serialNumber: "SN-9X", manufacturer: "Other", model: "X" },
        calibratedByUser: { firstName: "Ani", lastName: "Wijaya" },
        approvedByUser: null,
        signedByUser: { firstName: "C.", lastName: "Dewi-Santoso" },
      }),
      { withSignature: true },
    );
    expect(after).toEqual(before);
  });

  it("tampering with the snapshot fails v3: the recomputed hash no longer matches the printed one", () => {
    const printed = computeContentHashV3(cert());
    for (const tampered of [
      { ...SNAPSHOT, issuer: { ...SNAPSHOT.issuer, address: "Jl. Palsu 99" } },
      { ...SNAPSHOT, issuer: { ...SNAPSHOT.issuer, name: "Another Lab" } },
      { ...SNAPSHOT, device: { name: "Infusion pump", serialNumber: "SN-10", manufacturer: "B. Braun", model: "Perfusor" } },
      { ...SNAPSHOT, device: null },
      { ...SNAPSHOT, signedBy: "Someone Else" },
    ] as CertificateSignedSnapshot[]) {
      expect(computeContentHashV3(cert({ signedSnapshot: tampered }))).not.toBe(printed);
    }
  });

  it("binds every printed certificate field as v2 does (a summary edit changes v3)", () => {
    expect(computeContentHashV3(cert({ summary: "Out of tolerance" }))).not.toBe(computeContentHashV3(cert()));
    expect(computeContentHashV3(cert({ validUntil: new Date("2028-01-01T00:00:00.000Z") }))).not.toBe(computeContentHashV3(cert()));
  });

  it("does not depend on the key order PostgreSQL returns a JSONB object in", () => {
    const reordered = JSON.parse(
      JSON.stringify({
        signedBy: SNAPSHOT.signedBy,
        device: { model: "Perfusor", manufacturer: "B. Braun", serialNumber: "SN-9", name: "Infusion pump" },
        issuer: Object.fromEntries(Object.entries(SNAPSHOT.issuer).reverse()),
        approvedBy: SNAPSHOT.approvedBy,
        calibratedBy: SNAPSHOT.calibratedBy,
        version: 1,
      }),
    ) as CertificateSignedSnapshot;
    expect(computeContentHashV3(cert({ signedSnapshot: reordered }))).toBe(computeContentHashV3(cert()));
  });

  it("a revoked certificate that was signed with a snapshot is still printed from it (v3)", () => {
    const doc = toCertificateDocument(cert({ status: "revoked" }));
    expect(doc.integrity.scheme).toBe(INTEGRITY_SCHEME_V3);
    expect(doc.issuer).toEqual(SNAPSHOT.issuer);
  });
});

describe("v2 — a certificate with no snapshot (signed before ADR-107, or not yet signed)", () => {
  /** The v2 payload as M-11 defined it, written out (the oracle for "exactly as before"). */
  const oracleV2 = (c: CertificateSource): string => {
    const v3 = JSON.parse(oracleV3(c, SNAPSHOT)) as Record<string, unknown>;
    delete v3["snapshot"];
    return JSON.stringify({ ...v3, scheme: "certificate-content-v2" });
  };

  it("an already-signed certificate stays v2: same hash, and its v2 HMAC still verifies", () => {
    const old = cert({ signedSnapshot: null, tenant: { name: "Lab Kalibrasi Sehat" } });
    const doc = toCertificateDocument(old, { withSignature: true });
    expect(doc.integrity.scheme).toBe(INTEGRITY_SCHEME_V2);
    expect(doc.integrity.hash).toBe(sha256(oracleV2(old)));
    expect(doc.integrity.hash).toBe(computeContentHash(old));
    expect(doc.integrity.signature).toBe(
      crypto.createHmac("sha256", environment()["CERT_SIGNING_SECRET"] ?? "").update(sha256(oracleV2(old))).digest("hex"),
    );
    expect(doc.integrity.legacyHash).toBe(computeIntegrityHash(old));
    expect(doc.contentAsOf).toBe("live");
  });

  it("nothing is invented for it: it prints the live rows, as it always did", () => {
    const doc = toCertificateDocument(cert({ signedSnapshot: null }));
    expect(doc.issuedBy).toBe("Lab Kalibrasi Sehat");
    expect(doc.issuer?.address).toBe("Jl. Kesehatan No. 10");
    expect(doc.issuer?.phone).toBeNull();
    expect(doc.calibratedBy).toBe("Ani Putri");
  });

  it("v3 is never computed without a snapshot: a missing snapshot is not hashed as null", () => {
    expect(() => buildContentPayloadV3(cert({ signedSnapshot: null }))).toThrow("has no signing snapshot: it is v2, not v3");
    // An ABSENT key (a row read without the column), not an explicit undefined (exactOptionalPropertyTypes).
    const withoutSnapshot = cert();
    delete withoutSnapshot.signedSnapshot;
    expect(() => computeContentHashV3(withoutSnapshot)).toThrow("it is v2, not v3");
  });

  it("a draft prints the live data (v2) — the PDF watermarks it", () => {
    const draft = toCertificateDocument(cert({ status: "draft", signedSnapshot: null, signedBy: null, signedAt: null }));
    expect(draft.integrity.scheme).toBe(INTEGRITY_SCHEME_V2);
    expect(draft.contentAsOf).toBe("live");
    expect(draft.signedBy).toBeNull();
  });
});
