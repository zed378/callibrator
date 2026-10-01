# Owner brief — API contract / Swagger best practice (2026-09-29)

Decisions from the owner's brainstorming round. Binding for P9-25; the ADR and spec follow them.

**As-built today:** 417 `@swagger` JSDoc YAML blocks across 55 route files → `swagger-jsdoc` →
`swagger.json` → Swagger UI at `/docs` (off in production unless `SWAGGER_ENABLED=true`,
`src/docs/swagger.js`). Drift against the validators is caught after the fact by
`swaggerValidatorAlignment.p608.test.js`, which pins a `KNOWN_DRIFT` list. Every request shape is
written twice: once as a Zod validator (P9-11) and once as uncompiled YAML in a comment.

| Topic | Decision |
|---|---|
| Source of truth | **Code-first from Zod** — the OpenAPI document is generated from the same Zod schemas `validate()` enforces |
| Library | **`zod-openapi`** (Zod 4 native, `.meta()`, OpenAPI 3.1) |
| Location | **Beside the route file** — `routes/api/<name>.openapi.ts` next to `<name>.route.*`; shared schemas stay in the validators / `packages/contracts` |
| Responses | **Envelope + typed data** — generic `{ success, status, message, data, meta }` with a Zod schema for `data`; standard 400/401/403/404/409 error responses |
| Operation metadata | `x-permission` (from the same `dynamicAccess` resource/action) · realistic synthetic examples (no PII) · tenant semantics note (cross-tenant = 404, state conflict = 409) · `x-rate-limit` · `x-audited` |
| CI enforcement | Spec generated in CI and **diffed** against committed `openapi.json` · **Spectral** lint · **oasdiff** breaking-change check against main · **route-without-doc guard** (like `twoTenantRoutes.guard`) |
| Docs UI | **Scalar** (MIT), replacing Swagger UI; self-hosted assets under the existing docs CSP |
| Publishing | **Behind login** — super admin / developer permission; not public |
| Frontend client | **`openapi-typescript` + `openapi-fetch`**, generated from the spec; replaces the speculative hand-written `frontend/src/api` services module by module |
| Migration | **Per module with Phase 9** — a route converted to TS moves its docs to `.openapi.ts`; during the transition the published spec = Zod-generated ∪ remaining JSDoc |
| Roadmap | **New card P9-25** in Phase 9: foundation now (library, envelope, Scalar, auth gate, CI checks, guard); per-route migration rides with P9-20/P9-21 |
