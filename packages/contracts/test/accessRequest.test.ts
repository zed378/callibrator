/**
 * P9-22 (ADR-097 Am. 2) — the access-request schemas, now in this package.
 *
 * Their behaviour was pinned in the backend by phase10.units.p1005 (which loads
 * the whole backend with an in-memory database, too heavy for this suite).
 * These cases restate that suite's expectations of the schemas, written from
 * the P10-05 spec's rules (E.164 WhatsApp, lower-cased work email, blanks as
 * absent, a silent honeypot), not from the schema's code.
 */
import {
  accessRequestIdSchema,
  approveAccessRequestSchema,
  eraseAccessRequestsSchema,
  listAccessRequestsSchema,
  normaliseWhatsapp,
  rejectAccessRequestSchema,
  submitAccessRequestSchema,
} from "@callibrator/contracts/accessRequest";

const ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const body = {
  organisationName: "RS",
  facilityType: "hospital",
  city: "Jakarta",
  deviceCountBand: "lt_100",
  contactName: "Ana",
  workEmail: " ANA@X.TEST ",
  whatsapp: "62 812 3456 789",
  consent: true,
  consentVersion: "v1",
  locale: "en",
};

describe("@callibrator/contracts/accessRequest", () => {
  it("normalises WhatsApp numbers to E.164 (0… and 62… become +62…; others are compacted)", () => {
    expect(normaliseWhatsapp("0812-3456-7890")).toBe("+6281234567890");
    expect(normaliseWhatsapp("62 812 3456 7890")).toBe("+6281234567890");
    expect(normaliseWhatsapp("+44 (20) 7946.0958")).toBe("+442079460958");
  });

  it("the intake trims, lower-cases, reads blanks as absent, defaults the honeypot and drops unknown keys", () => {
    const parsed = submitAccessRequestSchema.parse({ ...body, contactRole: "  ", needs: null, status: "approved" });
    expect(parsed).toMatchObject({
      workEmail: "ana@x.test",
      whatsapp: "+628123456789",
      contactRole: null,
      needs: null,
      website: "",
    });
    expect(parsed).not.toHaveProperty("status");
    expect(submitAccessRequestSchema.parse({ ...body, needs: "calibration of 40 pumps" }).needs).toBe(
      "calibration of 40 pumps",
    );
    expect(submitAccessRequestSchema.parse({ ...body, website: "spam.example" }).website).toBe("spam.example");
  });

  it("the intake refuses a missing consent, an unusable number and an unknown facility type", () => {
    expect(submitAccessRequestSchema.safeParse({ ...body, consent: false }).success).toBe(false);
    expect(submitAccessRequestSchema.safeParse({ ...body, whatsapp: "abc" }).success).toBe(false);
    expect(submitAccessRequestSchema.safeParse({ ...body, facilityType: "spa" }).success).toBe(false);
  });

  it("the queue, id, approve, reject and erasure schemas", () => {
    expect(listAccessRequestsSchema.parse({})).toEqual({ status: "pending", page: 1, limit: 20 });
    expect(listAccessRequestsSchema.parse({ status: "expired", page: "2", limit: "50" })).toEqual({
      status: "expired",
      page: 2,
      limit: 50,
    });
    expect(accessRequestIdSchema.safeParse({ id: "x" }).success).toBe(false);
    expect(approveAccessRequestSchema.safeParse({ id: ID, tenantCode: "a b" }).success).toBe(false);
    expect(approveAccessRequestSchema.parse({ id: ID, tenantCode: "RS-1", maxUsers: 5 })).toEqual({ id: ID, tenantCode: "RS-1" });
    expect(rejectAccessRequestSchema.parse({ id: ID, reason: "x" }).spam).toBe(false);
    expect(eraseAccessRequestsSchema.parse({ email: " Ana@X.Test " })).toEqual({ email: "ana@x.test" });
  });
});
