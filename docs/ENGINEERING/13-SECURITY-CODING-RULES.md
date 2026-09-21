# 13 — Security Coding Rules

The rules a developer applies while writing code. The threat model and control design are in [`../SECURITY/`](../SECURITY/00-SECURITY-REQUIREMENTS.md); this is the checklist at the keyboard. Each rule cites the defect that made it a rule.

---

## Tenancy

| Rule | Because |
|---|---|
| `tenantId` comes from the principal, never from body, query or header | a body field is attacker-controlled |
| `x-tenant-id` is honoured only for `SUPERADMIN` — and ignored, not rejected, for anyone else | a rejection confirms the header means something |
| a model with **no tenant attribute** is not scoped by the hooks; check ownership explicitly | `Tenant.findByPk(req.params.tenantId)` on `tenant-hierarchy` let any user write any tenant (A-01) |
| raw SQL carries `tenant_id = $n`, bound | the hooks do not see raw SQL |
| cross-tenant access returns **404** | 403 is an existence oracle |
| no **global** unique constraint on tenant data | a uniqueness error reveals another tenant's data (`serialNumber`, P6-06) |

## Authorisation

| Rule | Because |
|---|---|
| every route declares a gate: `dynamicAccess(slug, action)` or `rbac([...])` | a route with only `auth` is open to every account (A-02) |
| pass `dynamicAccess` a real **menu slug** | `"AuditLogs"` matches no slug (A-07) |
| routes that configure where tenant data goes are `denyApiKey` and admin-only | storage settings, webhooks, custom domains |
| API keys reach only routes that declare a scope | scopes were enforced on 16 of 53 route files (A-03) |
| hiding a menu item is not authorisation | the route is still reachable by URL |
| search, export and report endpoints apply the same read permissions as the lists they draw from | `/search` returned stock and certificates to any role (A-04) |

## Input

| Rule | Because |
|---|---|
| validate `{ params, query, body }` together | a path parameter the validator never saw 400ed every request |
| never read `req.body.x` unguarded (Express 5) | an absent body is `undefined` → 500 |
| no `z.any()` / `.passthrough()` / `Joi.any()` at the boundary | it is validation switched off |
| file uploads go through the virus scanner, fail-closed | `VIRUS_SCAN_FAIL_OPEN=false` |

## Outbound Requests

| Rule | Because |
|---|---|
| every URL a tenant supplies passes `assertSafeUrl` at registration **and** `assertResolvedHostIsPublic` immediately before the request | DNS can change after registration |
| operator-configured endpoints (e.g. `http://minio:9000`) are deliberately exempt | keep the asymmetry when refactoring |
| outbound calls have a timeout | webhook delivery: 8 s |

## Secrets and Crypto

| Rule | Because |
|---|---|
| secrets come from configuration, never from code or fixtures in `src/` | there is no secret scanner to catch you (A-19) |
| `CERT_SIGNING_SECRET`, `ENCRYPT_KEY`, `KMS_MASTER_KEY` are not practically rotatable — never regenerate them in a deployment | every issued certificate and wrapped credential depends on them |
| API keys stored as SHA-256 hash + display prefix; shown once | a leaked table is not a leaked key |
| webhook secrets returned only at creation | |
| compare secrets with a constant-time function | |

## Errors and Logs

| Rule | Because |
|---|---|
| only the central handler writes error responses | `asyncHandler` returned raw error text to production clients (A-13) |
| never log a token, password, OTP, API key or signed URL | logs are copied, shipped and retained |
| `/health` returns status only | it disclosed the Node version publicly (A-06) |

## Sessions and Realtime

| Rule | Because |
|---|---|
| the auth cookie is httpOnly, set only by Next.js `app/api/v1/auth/login` | routing `/api/` to the backend broke login |
| Socket.IO handshake: token from `auth`, never the query string; check user status and tenant suspension | query strings land in proxy logs (A-05) |
| a Socket.IO room join takes the raw id and is authorised server-side | `kanban:join` checks project access |

## Evidence Records

| Rule | Because |
|---|---|
| audit rows are written inside the action's transaction | no row for a rolled-back change |
| `performedBy`, `calibratedBy`, `approvedBy`, `signedBy` come from `req.user`, never the body | attribution a client can set is not attribution |
| calibration records are superseded, not edited | append-only is currently a convention (PR-2, P6-03) |
