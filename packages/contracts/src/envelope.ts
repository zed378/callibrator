/**
 * The response envelope: the one Zod definition of the shape every API
 * response has (CLAUDE.md § The Response Envelope).
 *
 *   { "success": true, "status": 200, "message": "...", "data": [...], "meta": { "total": 0, ... } }
 *
 * Rows go in `data`. Pagination goes in a top-level `meta`, a SIBLING of
 * `data`: never `data.rows`, `data.items` or `data.meta`. Violating it renders
 * an empty list with no error, which three screens once did for weeks.
 *
 * P9-22 (ADR-097, Amendment 1; ADR-087, the amendment moving the envelope
 * here): the schemas below were P9-25's (ADR-103), written for the OpenAPI
 * document, and moved here VERBATIM, `.meta()` annotations included (native
 * Zod 4; the backend's zod-openapi reads them). backend/src/docs/openapi/
 * envelope.ts re-exports them and keeps the OpenAPI response components;
 * backend/src/types/apiResponse.ts re-exports the types. One definition feeds
 * the published contract, the backend's types and the frontend.
 *
 * Built by the backend's `utils/response.util` (`success()` / `error()`).
 * test/envelope.test.ts parses that function's real output with these
 * schemas, so a change to either side fails there.
 */
import { z } from "zod";

/**
 * `meta` of a paginated list — `success(res, rows, meta)`. All four keys are
 * required: they are what `response.util#paginate` returns and what every
 * paginated service builds. Not a generic `meta`: a success body's own `meta`
 * stays optional (ApiSuccessResponse).
 */
export const PaginationMeta = z
  .object({
    total: z.number().int().min(0).meta({ description: "Rows matching the filter, across all pages" }),
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    totalPages: z.number().int().min(0),
  })
  .meta({ id: "PaginationMeta", example: { total: 42, page: 1, limit: 25, totalPages: 2 } });

const status = z.number().int().meta({ description: "The HTTP status, repeated in the body" });

/** The fields every success envelope carries. */
// A type alias, not an interface: Zod's shape constraint needs the implicit index signature.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- see the line above
type EnvelopeShape<T extends z.ZodType> = {
  success: z.ZodLiteral<true>;
  status: typeof status;
  message: z.ZodString;
  data: T;
};

/**
 * The success envelope around one value (`data` is the given schema).
 *
 * @param data - the schema of `data`
 * @returns the envelope schema
 */
export const envelope = <T extends z.ZodType>(data: T): z.ZodObject<EnvelopeShape<T>> =>
  z.object({
    success: z.literal(true),
    status,
    message: z.string(),
    data,
  });

/**
 * The success envelope around a page of rows: `data` is the array, `meta` its sibling.
 *
 * @param item - the schema of one row
 * @returns the envelope schema
 */
export const listEnvelope = <T extends z.ZodType>(
  item: T,
): z.ZodObject<EnvelopeShape<z.ZodArray<T>> & { meta: typeof PaginationMeta }> =>
  z.object({
    success: z.literal(true),
    status,
    message: z.string(),
    data: z.array(item),
    meta: PaginationMeta,
  });

/**
 * The success envelope of an action that answers no value (`data: null`).
 *
 * @returns the envelope schema
 */
export const emptyEnvelope = (): z.ZodObject<EnvelopeShape<z.ZodNull>> => envelope(z.null());

/** One field-level validation problem (the backend's `validators/input.ts#fieldErrors`). */
const FieldError = z.object({
  field: z.string().meta({ description: "The path of the offending field, joined by dots" }),
  message: z.string(),
});

/** Every error the API answers through `response.util#error` or the error handler. */
export const ErrorEnvelope = z
  .object({
    success: z.literal(false),
    status,
    message: z.string(),
    data: z.null(),
    details: z
      .array(FieldError)
      .optional()
      .meta({ description: "Field errors of a validation 400. Present outside production only." }),
    requestId: z
      .string()
      .optional()
      .meta({ description: "On a generic 500 in production: quote it to support; it is in the server log" }),
  })
  .meta({ id: "ErrorEnvelope" });

/**
 * The global limiter's 429 body (`index.js` defaultLimiter `message`,
 * middlewares/globalRateLimit.middleware.ts). Q-53 (ADR-109 §6): the envelope,
 * plus `retryAfter` (seconds, the `Retry-After` header) as the request budgets.
 */
export const RateLimitBody = z
  .object({
    success: z.literal(false),
    status: z.literal(429),
    message: z.string(),
    data: z.null(),
    retryAfter: z.number().int().positive().nullable(),
  })
  .meta({
    id: "RateLimitBody",
    example: { success: false, status: 429, message: "Too many requests, please try again later", data: null, retryAfter: 900 },
  });

/**
 * A success body, as `response.util#success` builds it: the envelope, plus
 * `meta`, `token`, `refreshToken` and `session` only when set.
 */
export type ApiSuccessResponse<T = unknown> = Omit<z.output<ReturnType<typeof envelope<z.ZodUnknown>>>, "data"> & {
  data: T;
  meta?: object;
  token?: unknown;
  refreshToken?: unknown;
  session?: unknown;
};

/** A paginated list body: rows in `data`, pagination in the top-level `meta`. */
export type ApiListResponse<R = unknown> = Omit<z.output<ReturnType<typeof listEnvelope<z.ZodUnknown>>>, "data"> & {
  data: R[];
};

/**
 * An error body, as `response.util#error` builds it: `details` (any shape the
 * caller passed) outside production only, and extra top-level fields (a field
 * `errors` list, a production `requestId`) spread in.
 */
export type ApiErrorResponse = Omit<z.output<typeof ErrorEnvelope>, "details"> & {
  details?: unknown;
  [extra: string]: unknown;
};

/** Either envelope. */
export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;
