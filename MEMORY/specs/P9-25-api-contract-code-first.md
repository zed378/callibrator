# P9-25 — API contract, code-first (spec)

**Card:** `TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md` § P9-25 · **Decision:** ADR-103 · **Owner brief (binding):** [`P9-25-owner-brief-api-contract.md`](./P9-25-owner-brief-api-contract.md) · **Record:** `MEMORY/records/2026-09-29-P9-25-api-contract-foundation.md`

## Goal

One contract, generated from the schemas the server enforces, published only to signed-in developers, and gated in CI so it cannot go stale, invalid, silently broken, or miss a route.

## Shape

| Piece | Where | Contract |
|---|---|---|
| Per-route docs | `backend/src/routes/api/<name>.openapi.ts` | `export default defineRouteDocs({ router: "api/<name>.route", mount, tag, tagDescription?, tenantScoped, operations })`. `router` must equal the sibling file (the builder refuses otherwise). |
| Operation | `DocumentedOperation` (`src/docs/openapi/operation.ts`) | `method`, `path` (as the ROUTER registers it), `operationId`, `summary`, `description?`, `permission` (`{kind:"dynamicAccess",resource,action}` · `{kind:"rbac",roles}` · `{kind:"superAdminOnly"}` · `null` = public), `audited`, `params?` (every `:param`, no more, no fewer), `query?`, `body?` (**the schema object `validate()` mounts**), `success` (`data` / `list` / `empty`), `conflict?` (the state a 409 explains), `errors?` |
| Envelope + errors | `src/docs/openapi/envelope.ts` | `envelope(T)`, `listEnvelope(T)` (`meta` top-level), `emptyEnvelope()`, `ErrorEnvelope`, `errorResponses[400/401/403/404/409/429]` (components, with examples) |
| Derived per operation | `toOperation` | 400 when a body/query/param exists; 401+403 when not public; 404 on a `:param`; 409 when `conflict`; 429 always; `security` `[]` + `x-public` when public; `x-permission`, `x-audited`, `x-rate-limit`, `x-source`; tenant 404 note when `tenantScoped` and a `:param` exists |
| Builder | `backend/scripts/openapi/build.ts` | `buildDocument()` = code-first ∪ JSDoc (3.0→3.1 normalised), `failOnErrors` on JSDoc YAML, refuses a double-documented operation or a conflicting component; sorted; `serialise`, `isCurrent` |
| CLI | `backend/scripts/openapi.ts` | `openapi:generate` · `openapi:check` · `openapi:lint` (Spectral + shrink-only baseline; `--write-baseline`) · `openapi:breaking` (oasdiff vs `OPENAPI_BASE_REF`, default `origin/main`; SKIPPED without the binary or without a base file) |
| Reference UI | `backend/src/routes/internal/apiDocs.route.ts`, `backend/src/docs/apiDocs.ts` | `GET /`, `/assets/scalar.js`, `/assets/init.js`, `/openapi.json` at `/docs` and `/api/v1/docs`; `GET /docs.json`. Every path: `auth → denyApiKey → rbac([TENANT_ADMIN])`. 503 envelope when the build lacks the spec or the bundle. Mounted only when `SWAGGER_ENABLED` allows. |
| Frontend | `frontend/src/api/generated/schema.d.ts` (generated), `frontend/src/api/typed.ts` | `typedApi` (openapi-fetch over `api.*`), `unwrap`; `npm run api:types`, `npm run api:types:check` |

## Rules for moving a route module (P9-20/P9-21)

1. Write `<name>.openapi.ts`; name the validators' own schema objects — never re-declare a body.
2. Delete the module's `@swagger` blocks in the same change (the builder refuses both).
3. Declare `permission` exactly as the chain's gate; `openapiRoutes.p925` compares.
4. `npm run openapi:generate`, `cd frontend && npm run api:types`; commit `openapi.json` and `schema.d.ts`.
5. Delete the module's now-documented lines from `tests/guards/openapiRoutes.undocumented.json`, its entries from P6-08's `swaggerValidatorAlignment.knownDrift.json`, and any fixed Spectral baseline entry. Each list only shrinks.
6. Examples are synthetic (`*.example`, RFC 5737/2606 style) — no PII.

## Out of scope for the foundation

Moving the other 50+ modules; response schemas for JSDoc routes; making `x-audited` verified; the 429 body into the envelope (a behaviour change); `/documentation` and `/standards` behind sign-in.

## Abuse cases

See the card.
