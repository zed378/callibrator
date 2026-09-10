# 03 — API Client

`frontend/src/api/client.ts` and `frontend/src/api/services/` — 51 services, 51 contract tests.

---

## The Layering

```
page → hook → service → client.ts → API
```

**Never call `axios` from a component.** Every rule below lives in one of the two lower layers, and a component that reaches past them gets none of them.

## `client.ts`

One axios instance owning four things:

| Responsibility | Detail |
|---|---|
| Base URL | `NEXT_PUBLIC_API_BASE_URL` + `NEXT_PUBLIC_API_VERSION` |
| Auth header | `Authorization: Bearer <token>` from `authStore` |
| Tenant header | `X-Tenant-ID` when `NEXT_PUBLIC_TENANT_ID` is set |
| **Envelope unwrap** | `data` returned, `meta` surfaced separately |

Plus error normalisation and a 401 handler that clears the session.

## The Envelope

```json
{ "success": true, "status": 200, "message": "Success", "data": [], "meta": { "total": 0, "page": 1, "limit": 20, "totalPages": 0 } }
```

**Rows are in `data`. Pagination is in a top-level `meta`, a sibling of `data`.**

There is no `data.rows`. There is no `data.items`. There is no `data.meta`.

`client.ts` unwraps `data` and surfaces `meta` separately. **A service that reaches past the unwrap is doing it wrong.**

Getting this wrong renders an empty list with **no error at all** — which is exactly what happened when `GET /qms/nc`, `/qms/capa` and `/sop` returned `{ total, ..., nonConformances: [] }` inside `data`. Three screens rendered empty for weeks.

### Fallbacks

An endpoint returning `null` where a list is expected must unwrap to `[]`, not `null`. The contract tests assert this explicitly, because a `null` reaching a `.map()` is a crash and an empty array is an empty state.

## One Service per Domain

`src/api/services/<domain>.service.ts` — one function per endpoint, typed in and out.

A service function:

- takes typed arguments,
- returns typed data,
- does not touch stores,
- does not render anything,
- does not decide what to do with an error.

## Every Service Has a Contract Test

51 services, 51 `*.service.test.ts`. Each asserts the **exact** path, method, payload and unwrap.

They exist because they were once absent and it mattered: several services had been written against endpoints that **did not exist**, with tests mocking the fabrication. **3,863 tests passed while 13 endpoints were broken.**

### What the tests document

The tests record reality, not intent. Several assert shapes that look like mistakes and are not:

| Reality | |
|---|---|
| `menuGroupRole.getAdminMenuGroups` calls `/menu-groups/menu-groups/admin` | a doubled path — the router mounted at `/menu-groups` defines `/menu-groups/admin` |
| Warehouse location CRUD is **flat** — `/warehouses/locations` | reading is nested, writing is not |
| Stock update, transfer and opname use **`PATCH`** | devices and calibration records use `PUT` |
| `POST /users/detail` fetches one user | detail by POST with the id in the body |
| `DELETE /users/delete?userId=` | the id is in the **query string** |
| `/tenant-lifecycle` and `/data-retention` do not exist | both are under `/api/v1/tenants/:tenantId/...` |

Full list: [`../API/00-API-STANDARDS.md`](../API/00-API-STANDARDS.md) § Known Mount Aliases.

### Mocks prove the client, not the contract

**A mock test proves the client calls what the developer believed. Only a live call proves the endpoint exists and answers that way.**

Both are needed and neither substitutes. The live half is the 51-spec E2E suite in `backend/src/tests/e2e/` — see [`10-TESTING.md`](./10-TESTING.md).

## Types Are a Belief, Not a Guarantee

Response types live in `src/types/` and are **hand-written**. There is no shared `packages/` workspace — a CommonJS JavaScript backend and a TypeScript frontend share no code.

The type says what the developer believed the API returns. The contract test says what the client sends. Only the live suite says what the API actually does.

Generating types from `swagger.json` would close part of this gap. It is in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md), with the caveat that Swagger and the enforced Joi validators already disagree for the GDPR endpoints — a generator would faithfully reproduce that drift.

## Errors

`client.ts` normalises every failure into one shape carrying the status, the message and any field detail.

| Status | Handling |
|---|---|
| 400 | field detail mapped back to form fields |
| 401 | clear the session, redirect to login |
| 403 | `AccessDeniedModal` |
| 404 | not-found state — **includes cross-tenant**, which is deliberate |
| **409** | surface as a **state explanation**, never a generic error |
| 429 | "too many requests", with the window |
| 5xx | error state with retry, and the `X-Request-Id` |

409 is the one most often mishandled. "This certificate is in `draft` and must be submitted first" is the message; "Something went wrong" is not.

### Always surface `X-Request-Id`

It is exposed through CORS specifically so a client can read it. It is the one piece of information a user can safely quote in a bug report, and the only thing tying a client symptom to a server log line.

## The Two Transport Paths

| Path | When |
|---|---|
| Browser → API origin, Bearer token | the default |
| Browser → same-origin `/api/v1/...` → Next proxy → API | strict CSP, or a corporate proxy |

Decided by `NEXT_PUBLIC_API_BASE_URL`. **The proxy forwards the caller's credentials and adds none of its own** — a proxy that attaches a service credential turns every route behind it into an unauthenticated one.

## Uploads

Multipart, with the content type left to the browser so the boundary is correct.

Downloads go through **signed, time-limited URLs**, minted by `POST /attachments/:id/signed-url` and built client-side by `src/lib/uploadUrl.ts`. The URL is the capability; expiry bounds the damage when one leaks.

## Adding a Service Function

1. Read the actual route file in `backend/src/routes/api/` — **not** the Swagger spec, which drifts.
2. Note the verb (`PATCH` versus `PUT`), the path shape, and where identifiers live (path, body, or query string).
3. Add the function with typed arguments and return.
4. Add the contract test asserting path, method, payload and unwrap.
5. Verify against a **running** backend, not only the mock.

Step 1 is not optional. Step 5 is the one that has caught real defects.
