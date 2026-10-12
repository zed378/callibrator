/**
 * `GET /ipm/sessions`' `unsigned` filter (@callibrator/contracts/inspectionSessions): optional, a
 * boolean or its text form, refused otherwise — the field app's "to sign" list.
 */
import { ipmSessionListQuery } from "@callibrator/contracts/inspectionSessions";

describe("@callibrator/contracts/inspectionSessions — the unsigned filter", () => {
  it("is optional; true and false, as booleans or text, are read as booleans", () => {
    expect(ipmSessionListQuery.parse({}).unsigned).toBeUndefined();
    expect(ipmSessionListQuery.parse({ unsigned: "true" }).unsigned).toBe(true);
    expect(ipmSessionListQuery.parse({ unsigned: "false" }).unsigned).toBe(false);
    expect(ipmSessionListQuery.parse({ unsigned: true }).unsigned).toBe(true);
  });

  it("refuses anything else", () => {
    expect(ipmSessionListQuery.safeParse({ unsigned: "maybe" }).success).toBe(false);
    expect(ipmSessionListQuery.safeParse({ unsigned: 2 }).success).toBe(false);
  });
});
