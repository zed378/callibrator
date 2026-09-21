# 06 — Error and Response Standards

How a response is shaped, which status it carries, and — most important — who is allowed to write an error response.

---

## The Envelope

```ts
type ApiResponse<T> = {
  success: boolean;
  status: number;
  message: string;
  data: T | null;
  meta?: PaginationMeta;   // TOP-LEVEL sibling of data
};
```

| Rule | Why |
|---|---|
| rows live in `data` | three screens rendered empty for weeks because an endpoint put rows in `data.rows` |
| pagination in top-level `meta` | never `data.meta`, never `data.items` |
| `data: null` on error | the client can branch on `success` alone |

Built by `utils/response.util.js` → `success(res, data, meta, message, status)` and `error(res, message, status, details)`. **`paginated()` in the same file is dead code** — no callers, and it reads `res.query` instead of `req.query` (A-18).

## Status Codes

| Code | Use |
|---|---|
| 400 | validation failed |
| 401 | no, expired or invalid credentials |
| 403 | authenticated, **inside its own tenant**, lacks the permission |
| **404** | not found — **including "belongs to another tenant"** |
| **409** | invalid state transition |
| 413 | body over 10 MB |
| 429 | rate limited |
| 500 | an unexpected failure — generic message, request id |
| 503 | a dependency is down (`/health`) |

**Cross-tenant is 404, never 403.** A 403 says "this exists"; answering it turns id enumeration into a tenant-membership oracle.

**A 409 explains the state.** "This certificate is in `draft` and must be submitted first" — never a generic error. Before ADR-035 an invalid certificate transition threw a plain `Error`, surfaced as a 500, and hid the fact that approval was unreachable.

## The Error Classes

```ts
class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly isOperational = true,
    readonly details: unknown = null,
  ) { super(message); }
}
```

Throw an `AppError` with the right status for every expected failure. Anything else that reaches the handler is, by definition, a bug.

## Who May Write an Error Response

**Only the central error handler** (`middlewares/errorHandlers.middleware.js`). It logs the full error with the request id and returns a sanitised body.

**As-built, this rule is broken** in two places (A-13):

| Where | What it does |
|---|---|
| `utils/controllerWrapper.util.js#asyncHandler` — used by 44 controllers | sends `error.message` itself, **before** the central handler runs, then calls `next(error)` anyway |
| `middlewares/dynamicAccess.middleware.js` | returns `{ success: false, message: error.message }` with a 500 and no envelope |

The consequence is observable on production: an unexpected `TypeError` was returned verbatim — `Cannot read properties of undefined (reading 'roleId')`. A raw PostgreSQL message would carry SQL and schema names the same way.

The target:

```ts
export const asyncHandler =
  (fn: AsyncHandler): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);   // forward; never answer
  };
```

## What the Client Sees

| Error | Development | Production |
|---|---|---|
| `AppError` (operational) | message + details | message; details omitted |
| anything else | message + stack | **"Internal server error"** + `requestId` |

`requestId` is the thread that ties a user's report to a log line. Every error response carries it.

## Validation Errors

400 with a message listing the failing fields. The Zod migration (P9-11) must keep this **byte-compatible** — the frontend parses it.

## Never Hide an Error Behind a Default

```js
// ❌ as-built, until 2026-09-21
} catch (err) {
  logger.error("Failed to get usage", { error: err.message });
  return { total: 0, current: 0, history: [] };
}
```

The query in that `try` failed on every call. Every tenant's metered usage read as **zero**, the only trace a log line nobody watched. Return a default only when the default is a true answer; otherwise throw.
