/**
 * P9-22 (ADR-097) — the envelope schemas against the backend's REAL
 * `success()` / `error()` / `paginate()` (utils/response.util), not against
 * themselves.
 *
 * A fake Express response records the status and body the backend writes; the
 * body is parsed with the contract. A change to the backend's envelope, or to
 * the schemas, fails here. The last case proves the schema refuses the shapes
 * CLAUDE.md forbids (`data.rows`, `data.meta`) and a list without its meta.
 */
import { z } from "zod";
import {
  ErrorEnvelope,
  PaginationMeta,
  RateLimitBody,
  emptyEnvelope,
  envelope,
  listEnvelope,
} from "@callibrator/contracts/envelope";
import * as response from "../../../backend/src/utils/response.util";

interface Captured {
  status?: number;
  body?: unknown;
}

/** The part of an Express response `success()` / `error()` use. */
const fakeRes = (captured: Captured): Parameters<typeof response.success>[0] => {
  const res = {
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(body: unknown) {
      captured.body = body;
      return res;
    },
  };
  return res as unknown as Parameters<typeof response.success>[0];
};

const row = z.object({ id: z.string() });

describe("@callibrator/contracts/envelope against utils/response.util", () => {
  it("a paginated list: success(res, page.data, meta-of-paginate()) parses as listEnvelope", () => {
    const { data, ...meta } = response.paginate([{ id: "a" }, { id: "b" }, { id: "c" }], 1, 2);
    const out: Captured = {};
    response.success(fakeRes(out), data, meta, "ok");
    const parsed = listEnvelope(row).parse(out.body);
    expect(out.status).toBe(200);
    expect(parsed.data).toEqual([{ id: "a" }, { id: "b" }]);
    expect(parsed.meta).toEqual({ total: 3, page: 1, limit: 2, totalPages: 2 });
  });

  it("a single record: success(res, row, message, 201) parses as envelope, with no meta", () => {
    const out: Captured = {};
    response.success(fakeRes(out), { id: "a" }, "created", 201);
    expect(out.status).toBe(201);
    expect(envelope(row).parse(out.body)).toEqual({ success: true, status: 201, message: "created", data: { id: "a" } });
  });

  it("an action with no value: success(res, null, message) parses as emptyEnvelope", () => {
    const out: Captured = {};
    response.success(fakeRes(out), null, "deleted");
    expect(emptyEnvelope().parse(out.body)).toEqual({ success: true, status: 200, message: "deleted", data: null });
  });

  it("a validation error: error(res, 'Validation Error', 400, fieldErrors) parses as ErrorEnvelope", () => {
    const out: Captured = {};
    response.error(fakeRes(out), "Validation Error", 400, [{ field: "name", message: "Required" }]);
    expect(ErrorEnvelope.parse(out.body)).toEqual({
      success: false,
      status: 400,
      message: "Validation Error",
      data: null,
      details: [{ field: "name", message: "Required" }],
    });
  });

  it("the 429 body parses as RateLimitBody", () => {
    expect(
      RateLimitBody.safeParse({ success: false, status: 429, message: "Too many requests", data: null, retryAfter: 900 })
        .success,
    ).toBe(true);
  });

  it("bites: the forbidden list shapes, and a list without its full meta, are refused", () => {
    const base = { success: true, status: 200, message: "ok" };
    const meta = { total: 1, page: 1, limit: 25, totalPages: 1 };
    expect(listEnvelope(row).safeParse({ ...base, data: { rows: [{ id: "a" }] }, meta }).success).toBe(false);
    expect(listEnvelope(row).safeParse({ ...base, data: { meta, items: [] } }).success).toBe(false);
    expect(listEnvelope(row).safeParse({ ...base, data: [{ id: "a" }] }).success).toBe(false);
    expect(listEnvelope(row).safeParse({ ...base, data: [{ id: "a" }], meta: { total: 1 } }).success).toBe(false);
    expect(PaginationMeta.safeParse({ ...meta, total: -1 }).success).toBe(false);
  });
});
