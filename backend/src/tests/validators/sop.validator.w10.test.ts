/**
 * W-10 (2026-10-05) — `createSopDocument`, the body `POST /api/v1/sop` now
 * validates (`@callibrator/contracts/sop`, re-exported by
 * `validators/sop.validator`). The route's own behaviour is pinned by
 * routes/sop.create.w10.test.ts; this pins the schema, and runs in the
 * contracts package's suite too (its 100% gate).
 */
import * as contract from "@callibrator/contracts/sop";
import { createSopDocument } from "../../validators/sop.validator";

describe("W-10 sop.validator — createSopDocument", () => {
  it("is the contract's own object", () => {
    expect(createSopDocument).toBe(contract.createSopDocument);
  });

  it("accepts the fields the service reads, trims text, converts a boolean string and strips the rest", () => {
    expect(
      createSopDocument.parse({
        title: "  Pump SOP ",
        version: " 2.1 ",
        contentUrl: "https://docs.example.test/sop.pdf",
        requiresTraining: "false",
        status: "PUBLISHED",
        tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
    ).toEqual({ title: "Pump SOP", version: "2.1", contentUrl: "https://docs.example.test/sop.pdf", requiresTraining: false });
    expect(createSopDocument.parse({ title: "A", version: null, contentUrl: null })).toEqual({
      title: "A",
      version: null,
      contentUrl: null,
    });
    expect(createSopDocument.parse({ title: "A", requiresTraining: true })).toEqual({ title: "A", requiresTraining: true });
  });

  it.each([
    ["an empty object", {}],
    ["an array", []],
    ["null", null],
    ["a blank title", { title: " " }],
    ["a numeric title", { title: 5 }],
    ["a title past its column", { title: "t".repeat(256) }],
    ["a version past its column", { title: "A", version: "v".repeat(21) }],
    ["a contentUrl past its column", { title: "A", contentUrl: "u".repeat(256) }],
    ["requiresTraining: null", { title: "A", requiresTraining: null }],
    ["requiresTraining that is no boolean", { title: "A", requiresTraining: "yes" }],
  ])("refuses %s", (_label, body) => {
    expect(createSopDocument.safeParse(body).success).toBe(false);
  });
});
