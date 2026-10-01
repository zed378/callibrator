/**
 * P9-11 (ADR-093) — the one helper every controller and service uses to check
 * input against a request schema outside the `validate()` middleware.
 *
 * Before P9-11 each file in `validators/` exported its own `validate(data,
 * schema)` in one of four shapes (returning an `{ error, value }` result, or
 * throwing an array, a key-map or an `Error`). They are replaced by the two
 * functions here, over Zod:
 *
 * - `validateInput(data, schema)` returns the parsed value, or throws the
 *   plain `{ status: 400, message: "Validation failed", errors }` object the
 *   majority of callers already threw. `asyncHandler` answers it as before
 *   (surface D: the `errors` never reach the wire, AUDIT A-272).
 * - `checkInput(data, schema)` never throws: `{ ok: true, value }` or
 *   `{ ok: false, errors }`, for callers that answer or collect the errors
 *   themselves (an import loop, a custom 400 body).
 *
 * Both validate `data ?? {}`: Express 5 leaves `req.body` undefined when no
 * body is sent, and an absent body must fail the required-field rules, not
 * slip through (A-09).
 */
import type { z } from "zod";

/** One field's failure, as every 400 in this API lists it. */
export interface FieldError {
  readonly field: string;
  readonly message: string;
}

/** What `validateInput` throws. A plain object, as the callers threw before (surface D). */
export interface ValidationFailure {
  readonly status: 400;
  readonly message: "Validation failed";
  readonly errors: FieldError[];
}

/** What `checkInput` answers. */
export type CheckResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: FieldError[] };

/**
 * @param error - a Zod error
 * @returns one `{ field, message }` per issue, the path joined with dots, in Zod's order
 */
export const fieldErrors = (error: z.ZodError): FieldError[] =>
  error.issues.map((issue) => ({ field: issue.path.map(String).join("."), message: issue.message }));

/**
 * Check `data` against `schema` without throwing.
 *
 * @param data - the input; `undefined` / `null` is checked as `{}`
 * @param schema - a request schema
 * @returns the parsed value (unknown keys stripped, conversions applied), or the field errors
 */
export const checkInput = <S extends z.ZodType>(data: unknown, schema: S): CheckResult<z.output<S>> => {
  const result = schema.safeParse(data ?? {});
  return result.success ? { ok: true, value: result.data } : { ok: false, errors: fieldErrors(result.error) };
};

/**
 * Check `data` against `schema`.
 *
 * @param data - the input; `undefined` / `null` is checked as `{}`
 * @param schema - a request schema
 * @returns the parsed value (unknown keys stripped, conversions applied)
 * @throws ValidationFailure — a plain object with status 400
 */
export const validateInput = <S extends z.ZodType>(data: unknown, schema: S): z.output<S> => {
  const result = checkInput(data, schema);
  if (!result.ok) {
    const failure: ValidationFailure = { status: 400, message: "Validation failed", errors: result.errors };
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- the plain object every caller threw before P9-11; asyncHandler reads its status (surface D, A-272)
    throw failure;
  }
  return result.value;
};
