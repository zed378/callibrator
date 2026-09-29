# Search

What `GET /api/v1/search` searches, who may see which results, and how the text matching works underneath.

> **Target standard: TypeScript, strict (ADR-038).** As built, the backend search module is **JavaScript/CommonJS**: `backend/src/services/search.service.js`, `backend/src/controllers/search.controller.js`, `backend/src/routes/api/search.route.js` and migration `backend/src/migrations/0003-add-search-vectors.js`. The frontend client (`frontend/src/api/services/search.service.ts`, `frontend/src/components/layouts/GlobalSearch.tsx`) is TypeScript. Documents here name each file by its real extension and label current behaviour **as-built**. The database is PostgreSQL only (ADR-039).

These documents are for the backend engineer changing search, and for the reviewer who must re-read it after any change. `SECURITY/05` lists global search as a tenant-isolation hotspot, because it is raw SQL across several tables.

## Documents

| | Document | Covers |
|---|---|---|
| 01 | [Global Search](./01-GLOBAL-SEARCH.md) | the endpoint, the three searchable types, the per-type permission filter (A-04), tenant isolation, the response envelope, the named suites |
| 02 | [Full-Text Search](./02-FULL-TEXT.md) | which tables carry `search_vector`, the FTS query, the ILIKE fallback and why it is a fallback, how the two paths match differently, what happens when both fail (A-56) |

There is no `00-` and nothing from `03-` on. Those numbers are unassigned. A link to a `SEARCH/` path that is absent from the table above is a broken link, not a hidden document.

## The Short Version

**Three types, one endpoint.** Devices, stock and certificates are searched concurrently, each by one raw-SQL statement that carries `tenant_id = :tenantId` explicitly, because the global tenant hooks do not see raw SQL. See [`01`](./01-GLOBAL-SEARCH.md).

**Authorization is borrowed, not duplicated.** A type is searched only if the caller passes the same `dynamicAccess(<menu>, "read")` gate as that type's own list route. The borrowing is done with a probe response object, which is still open as review finding V-10.

**Full-text first, `ILIKE` only when full-text errors.** On a database without migration 0003 the FTS statement fails and ILIKE runs. On a migrated database FTS runs and **does not match word fragments**, which ILIKE would. A type failing on both paths fails the request with a 500 and a request id. It no longer quietly returns "No results" (A-56, fixed 2026-09-24). See [`02`](./02-FULL-TEXT.md).

## Related

| For | Read |
|---|---|
| why raw SQL must carry the tenant predicate | [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md) |
| the permission model the probe runs | [`../SECURITY/04-AUTHORIZATION-RBAC.md`](../SECURITY/04-AUTHORIZATION-RBAC.md) |
| the response envelope | [`../API/00-API-STANDARDS.md`](../API/00-API-STANDARDS.md) |
| the findings | [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) § A-04, A-22, A-23, A-56 · [`../../TASKS/REVIEW-2026-09-23-REMEDIATION.md`](../../TASKS/REVIEW-2026-09-23-REMEDIATION.md) § V-10 |

**Not covered here:** vector (pgvector) retrieval over `document_chunks` for the AI/RAG features. It is a different mechanism, and it is not reached through `/api/v1/search`.
