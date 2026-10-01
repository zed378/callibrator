/**
 * A-303 — the certificate document names the issuing laboratory's address and
 * contact (ISO/IEC 17025 7.8.2), and the integrity hashes do NOT bind them.
 *
 * The issuer is the tenant row, printed LIVE, exactly like the tenant name
 * (`issuedBy`): binding a live, editable row into the v2 hash would make every
 * signed certificate fail verification the day the laboratory updates its
 * address. So v1 and v2 are unchanged, and a change of address changes no hash.
 */
import models from "../../models";
import {
  computeContentHash,
  computeIntegrityHash,
  getCertificateDocument,
  toCertificateDocument,
  type CertificateSource,
} from "../../services/certificateDocument.service";

const TENANT = {
  name: "Lab Kalibrasi Sehat",
  email: "lab@sehat.example.id",
  phone: "+62 21-555 0100",
  address: "Jl. Kesehatan No. 10",
  city: "Jakarta Pusat",
  state: "DKI Jakarta",
  zipCode: "10110",
  country: "Indonesia",
  website: "https://sehat.example.id",
};

const cert = (tenant: CertificateSource["tenant"] = TENANT): CertificateSource => ({
  certificateNumber: "CERT-20260930-LKS-0001",
  tenantId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  type: "calibration",
  status: "signed",
  issueDate: new Date("2026-09-01T00:00:00.000Z"),
  signedAt: new Date("2026-09-02T00:00:00.000Z"),
  tenant,
});

describe("A-303: the certificate document's issuer", () => {
  it("carries the tenant's name, address and contact, and keeps issuedBy", () => {
    const doc = toCertificateDocument(cert());
    expect(doc.issuedBy).toBe(TENANT.name);
    expect(doc.issuer).toEqual(TENANT);
  });

  it("is null when no tenant is loaded, and fills nulls for a sparse tenant row", () => {
    expect(toCertificateDocument(cert(null)).issuer).toBeNull();
    expect(toCertificateDocument(cert({ name: "Lab" })).issuer).toEqual({
      name: "Lab",
      email: null,
      phone: null,
      address: null,
      city: null,
      state: null,
      zipCode: null,
      country: null,
      website: null,
    });
  });

  it("a tenant row with no name gives a null name", () => {
    expect(toCertificateDocument(cert({})).issuer?.name).toBeNull();
  });

  it("is bound by neither hash: a change of address changes no printed hash", () => {
    const moved = cert({ ...TENANT, address: "Jl. Baru No. 1", city: "Bandung", phone: "+62 22 700 1000" });
    expect(computeContentHash(moved)).toBe(computeContentHash(cert()));
    expect(computeIntegrityHash(moved)).toBe(computeIntegrityHash(cert()));
    expect(computeContentHash(cert(null))).toBe(computeContentHash(cert()));
  });

  it("getCertificateDocument loads the issuer columns on the tenant include", async () => {
    const findOne = jest.spyOn(models.Certificate, "findOne").mockResolvedValueOnce(cert() as never);
    const result = await getCertificateDocument("tenant-a", "cert-1");
    const [options] = findOne.mock.calls[0] as [{ include: { as: string; attributes?: string[] }[] }];
    const tenantInclude = options.include.find((i) => i.as === "tenant");
    expect(tenantInclude?.attributes).toEqual([
      "id",
      "name",
      "email",
      "phone",
      "address",
      "city",
      "state",
      "zipCode",
      "country",
      "website",
    ]);
    expect(result.success && result.data.issuer).toEqual(TENANT);
  });
});
