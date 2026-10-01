/**
 * P9-11 (ADR-093) — the explicit conversions in validators/fields: what each
 * converts, and — the part `z.coerce` gets wrong — what each leaves alone.
 */
import { z } from "zod";
import {
  booleanish,
  caseless,
  dateLike,
  email,
  isoDate,
  isoDateText,
  jsonObject,
  nullableText,
  numeric,
  optionalText,
  uuid,
} from "../../validators/fields";

const ok = (schema: z.ZodType, value: unknown): unknown => {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`expected ${JSON.stringify(value)} to pass: ${result.error.message}`);
  }
  return result.data;
};
const fails = (schema: z.ZodType, value: unknown): boolean => !schema.safeParse(value).success;

describe("P9-11 validators/fields", () => {
  it("numeric converts a string that spells a number, and nothing else", () => {
    const n = numeric(z.number());
    expect(ok(n, 5)).toBe(5);
    expect(ok(n, "5")).toBe(5);
    expect(ok(n, " -1.5e2 ")).toBe(-150);
    expect(ok(n, ".5")).toBe(0.5);
    for (const value of ["", " ", "0x10", "5a", "Infinity", true, null, [], {}]) {
      expect(fails(n, value)).toBe(true);
    }
  });

  it("booleanish converts only \"true\" / \"false\" (any case, trimmed)", () => {
    const b = booleanish();
    expect(ok(b, true)).toBe(true);
    expect(ok(b, " TRUE ")).toBe(true);
    expect(ok(b, "false")).toBe(false);
    for (const value of ["yes", "1", 1, 0, null, ""]) {
      expect(fails(b, value)).toBe(true);
    }
  });

  it("dateLike takes a Date, a date string or a millisecond count, and refuses the rest", () => {
    const d = dateLike();
    const when = new Date("2026-09-29T00:00:00.000Z");
    expect(ok(d, when)).toEqual(when);
    expect(ok(d, "2026-09-29T00:00:00.000Z")).toEqual(when);
    expect(ok(d, when.getTime())).toEqual(when);
    expect(ok(d, String(when.getTime()))).toEqual(when);
    for (const value of ["", "  ", "not a date", Number.NaN, Infinity, null, true, {}]) {
      expect(fails(d, value)).toBe(true);
    }
  });

  it("isoDate accepts ISO 8601 text (date or date-time) or a Date, and outputs a Date", () => {
    const d = isoDate();
    expect(ok(d, "2026-09-29")).toEqual(new Date("2026-09-29"));
    expect(ok(d, "2026-09-29T10:00:00Z")).toEqual(new Date("2026-09-29T10:00:00Z"));
    expect(ok(d, "2026-09-29T10:00:00+07:00")).toEqual(new Date("2026-09-29T10:00:00+07:00"));
    const when = new Date(0);
    expect(ok(d, when)).toBe(when);
    for (const value of ["29/09/2026", "Sep 29 2026", 1_700_000_000_000, ""]) {
      expect(fails(d, value)).toBe(true);
    }
  });

  it("isoDateText normalises ISO text to toISOString()", () => {
    expect(ok(isoDateText(), "2026-09-29")).toBe("2026-09-29T00:00:00.000Z");
    expect(fails(isoDateText(), "yesterday")).toBe(true);
  });

  it("uuid accepts any 8-4-4-4-12 hex id, not only RFC versions", () => {
    expect(ok(uuid(), "11111111-1111-1111-1111-111111111111")).toBe("11111111-1111-1111-1111-111111111111");
    expect(fails(uuid(), "not-a-uuid")).toBe(true);
  });

  it("caseless folds the case before matching, in either direction", () => {
    expect(ok(caseless(["ACTIVE", "INACTIVE"] as const, "upper"), "active")).toBe("ACTIVE");
    expect(ok(caseless(["active", "inactive"] as const, "lower"), "InActive")).toBe("inactive");
    expect(fails(caseless(["ACTIVE"] as const, "upper"), "retired")).toBe(true);
  });

  it("optionalText trims and allows empty, null and absent; nullableText does not trim", () => {
    expect(ok(optionalText(3), "  ab  ")).toBe("ab");
    expect(ok(optionalText(), "   ")).toBe("");
    expect(ok(optionalText(), null)).toBeNull();
    expect(ok(optionalText(), undefined)).toBeUndefined();
    expect(fails(optionalText(3), "abcd")).toBe(true);
    expect(ok(nullableText(3), " a ")).toBe(" a ");
    expect(ok(nullableText(), "")).toBe("");
    expect(fails(nullableText(3), "abcd")).toBe(true);
  });

  it("jsonObject is any object, not an array or a scalar", () => {
    expect(ok(jsonObject(), { a: 1 })).toEqual({ a: 1 });
    for (const value of [[], "x", 1, null]) {
      expect(fails(jsonObject(), value)).toBe(true);
    }
  });

  it("email accepts every unquoted RFC local-part character and needs a dotted, alphabetic domain", () => {
    for (const address of ["a@b.co", "a_b%c@hospital-a.example.com", "a!b#c@x.com", "first.last+tag@sub.example.org"]) {
      expect(ok(email(), address)).toBe(address);
    }
    expect(ok(email(), `${"a".repeat(64)}@x.com`)).toBe(`${"a".repeat(64)}@x.com`);
    for (const address of ["a@b", "a@b.c1", "a..b@x.com", ".a@x.com", "a@-x.com", "a b@x.com", "", `${"a".repeat(65)}@x.com`, `a@${Array.from({ length: 5 }, () => "b".repeat(60)).join(".")}.com`, `${"a".repeat(50000)}@test.com`]) {
      expect(fails(email(), address)).toBe(true);
    }
  });
});
