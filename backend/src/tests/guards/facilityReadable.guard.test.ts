/**
 * P21-09 — G-12 of docs/SECURITY/15 § 11 (spec MEMORY/specs/P19-04-client-facilities.md § 7.5):
 * every FACILITY_READABLE entry is a context-derived rule over a model that really has it.
 *
 * Against the REAL model registry (memoryDb loads the barrel): each entry's model exists, is
 * tenant-scoped, declares NO facility column (a facility model is filtered, never "readable"),
 * declares the rule's attribute; the rule kind is one of the two; each entry names an existing
 * test file that names the model. A rule over a misspelt attribute would make the hooks write a
 * predicate on a column that does not exist — `Session` is snake-case (the CLAUDE.md trap).
 */
import fs from "fs";
import path from "path";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as Models from "../../models";
import { FACILITY_READABLE, type FacilityReadableEntry } from "../../constants/facilityAccess";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
jest.requireActual<typeof Models>("../../models");

const TESTS = path.join(__dirname, "..");
const entries = Object.entries(FACILITY_READABLE as Readonly<Record<string, FacilityReadableEntry>>);

describe("G-12 — FACILITY_READABLE", () => {
  it("is frozen and holds exactly the five entries of ADR-124 Am. 1 § 5 and ADR-126 Am. 1 § 8's IdempotencyKey", () => {
    expect(Object.isFrozen(FACILITY_READABLE)).toBe(true);
    expect(Object.keys(FACILITY_READABLE).sort()).toEqual(["ClientFacility", "ConsentRecord", "DsarRequest", "IdempotencyKey", "Notification", "Session"]);
  });

  it.each(entries)("%s: a tenant model without a facility column, declaring its rule's attribute", (name, entry) => {
    const model = mdb.sequelize.models[name] as unknown as { rawAttributes: Record<string, unknown> } | undefined;
    expect(model).toBeDefined();
    const attrs = (model as { rawAttributes: Record<string, unknown> }).rawAttributes;
    expect("tenantId" in attrs || "tenant_id" in attrs).toBe(true);
    expect("clientFacilityId" in attrs || "client_facility_id" in attrs).toBe(false);
    expect(attrs).toHaveProperty(entry.attribute);
    expect(["own-facility", "own-user"]).toContain(entry.rule);
    expect(entry.reason.length).toBeGreaterThan(5);
  });

  it.each(entries)("%s: names an existing test that names the model", (name, entry) => {
    const file = path.join(TESTS, entry.test);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toContain(name);
  });

  it("the own-facility rule is the facility row's own id; every other is own-user", () => {
    for (const [name, entry] of entries) {
      expect(entry.rule === "own-facility").toBe(name === "ClientFacility");
    }
    expect(FACILITY_READABLE.ClientFacility.attribute).toBe("id");
    expect(FACILITY_READABLE.Session.attribute).toBe("user_id");
  });
});
