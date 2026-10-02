/**
 * Q-50 (ADR-107) — `captureSignedSnapshot`, the moment a certificate's printed
 * content is fixed, on the REAL models over the in-memory database
 * (fixtures/memoryDb), for the references the sign route never meets:
 *  - a reference that no longer resolves prints null (a deleted user or device,
 *    an issuing tenant that cannot be read), as the live document would;
 *  - a device row whose optional fields are empty prints them as null;
 *  - called with no transaction, the reads run outside one (the default).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as DocumentService from "../../services/certificateDocument.service";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { captureSignedSnapshot } = jest.requireActual<typeof DocumentService>("../../services/certificateDocument.service");

const TENANT = "c1000000-0000-4000-8000-000000000001";
const DEVICE_FULL = "c2000000-0000-4000-8000-000000000001";
const DEVICE_BARE = "c2000000-0000-4000-8000-000000000002";
/** A row read without its name (the column is NOT NULL; seeded directly, past the model's validation). */
const DEVICE_NAMELESS = "c2000000-0000-4000-8000-000000000003";
const USER = "c3000000-0000-4000-8000-000000000001";
const GONE = "c9000000-0000-4000-8000-000000000009";

beforeAll(() => {
  mdb.seed("Tenant", {
    id: TENANT,
    name: "Lab Kalibrasi Sehat",
    subdomain: "sehat",
    email: "lab@sehat.example.id",
    address: "Jl. Kesehatan No. 10",
    city: "Jakarta Pusat",
    plan: "free",
    status: "active",
  });
  mdb.seed("CalibrationDevice", [
    { id: DEVICE_FULL, tenantId: TENANT, name: "Infusion pump", serialNumber: "SN-1", manufacturer: "Example Medical", model: "IP-200", status: "active" },
    { id: DEVICE_BARE, tenantId: TENANT, name: "Thermometer", serialNumber: null, manufacturer: null, model: null, status: "active" },
    { id: DEVICE_NAMELESS, tenantId: TENANT, name: null, serialNumber: "SN-3", manufacturer: null, model: null, status: "active" },
  ]);
  mdb.seed("User", {
    id: USER,
    tenantId: TENANT,
    username: "ani",
    email: "ani@sehat.example.id",
    password: "x".repeat(60),
    firstName: "Ani",
    lastName: "Putri",
    status: "ACTIVE",
    isActive: true,
  });
});

describe("Q-50 — captureSignedSnapshot, the references the sign route never meets", () => {
  it("called with no transaction: reads the live rows and fixes them, people included", async () => {
    const snapshot = await captureSignedSnapshot({
      tenantId: TENANT,
      deviceId: DEVICE_FULL,
      calibratedBy: USER,
      approvedBy: USER,
      signedBy: USER,
    });
    expect(snapshot.version).toBe(1);
    expect(snapshot.issuer.name).toBe("Lab Kalibrasi Sehat");
    expect(snapshot.device).toEqual({ name: "Infusion pump", serialNumber: "SN-1", manufacturer: "Example Medical", model: "IP-200" });
    expect([snapshot.calibratedBy, snapshot.approvedBy, snapshot.signedBy]).toEqual(["Ani Putri", "Ani Putri", "Ani Putri"]);
  });

  it("a device with empty optional fields prints them as null, not undefined", async () => {
    const snapshot = await captureSignedSnapshot({
      tenantId: TENANT,
      deviceId: DEVICE_BARE,
      calibratedBy: null,
      approvedBy: null,
      signedBy: USER,
    });
    expect(snapshot.device).toEqual({ name: "Thermometer", serialNumber: null, manufacturer: null, model: null });
    expect(snapshot.calibratedBy).toBeNull();
    expect(snapshot.approvedBy).toBeNull();
  });

  it("a device row with no name prints a null name (the ?? null guard), the rest as stored", async () => {
    const snapshot = await captureSignedSnapshot({
      tenantId: TENANT,
      deviceId: DEVICE_NAMELESS,
      calibratedBy: null,
      approvedBy: null,
      signedBy: null,
    });
    expect(snapshot.device).toEqual({ name: null, serialNumber: "SN-3", manufacturer: null, model: null });
  });

  it("a reference that no longer resolves is recorded as null: no device, no person, no issuer fields", async () => {
    const subject: Parameters<typeof captureSignedSnapshot>[0] = {
      tenantId: GONE,
      deviceId: GONE,
      calibratedBy: GONE,
      approvedBy: null,
      signedBy: GONE,
    };
    const snapshot = await captureSignedSnapshot(subject);
    expect(snapshot.device).toBeNull();
    expect(snapshot.calibratedBy).toBeNull();
    expect(snapshot.approvedBy).toBeNull();
    expect(snapshot.signedBy).toBeNull();
    // The issuer of a tenant that cannot be read: every field null, as the live document would print it.
    expect(Object.values(snapshot.issuer).every((v) => v === null)).toBe(true);
  });
});
