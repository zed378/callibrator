# 00 — Coding Context

The one file to read at the start of every session before writing backend or frontend code. Everything here is a summary; follow the link when the summary is not enough.

> **Language status (as-built 2026-10-02).** The backend's source is **TypeScript, strict** (ADR-038; toolchain ADR-087), compiled to CommonJS; the only source `.js` file left is the dead `utils/checkMenu.util.js`, awaiting deletion (A-18). The **694 `.js` files in the test trees are legacy JavaScript** (682 test files and 12 fixtures and helpers, `src/tests/` and `__tests__/`, counted 2026-10-02), converted opportunistically under P9-26; **all new code, tests included, is TypeScript** (`npm run ratchet` refuses a new `.js` file). The frontend is TypeScript as well. Where a section describes behaviour, it is **as-built** unless marked *target*.

---

## 1. What This System Is

**Callibrator** — multi-tenant SaaS for hospital medical-device calibration, maintenance and lifecycle management. Compliance-bearing: ISO 17025, FDA 21 CFR Part 11, ISO 13485, GDPR, KARS, SNARS.

The two things that must never break:

- **tenant isolation** — one hospital never sees another's data;
- **evidence** — calibration records, certificates, signatures and audit rows prove what happened, to an auditor, years later.

## 2. Stack

| Concern | As-built | Target |
|---|---|---|
| Backend language | **TypeScript, strict**, emitted as CommonJS (ADR-038, ADR-087), checked by TypeScript 7; the one source `.js` left is `utils/checkMenu.util.js` (A-18); 694 legacy `.js` test-tree files (P9-26) | same, with the legacy tests converted (P9-26) |
| HTTP | Express 5 | same |
| Database | **PostgreSQL 18 + pgvector, only** (ADR-039) | same |
| ORM | Sequelize 6, global tenant-scoping hooks (ADR-029); all 73 models typed with `InferAttributes` (`initModel`, P9-10) | same |
| Validation | **Zod** — the schema is the type (`validate(schema, { from })`, P9-11); Joi removed (ADR-093) | same |
| Tests | Jest 30, 100% coverage gate; `.ts` transformed by Babel 8 (`backend/jest.transform.js` — not `@swc/jest`, whose getters `jest.spyOn` cannot replace; ADR-087) | same |
| Cache / state | Redis (`ioredis`) | same |
| Queue | RabbitMQ (`amqplib`) | same; webhook delivery moves onto it (A-10) |
| Realtime | Socket.IO, both ends (ADR-031) | same |
| IoT | HTTP ingest + optional MQTT **client** of an external broker | same |
| Build | `npm run build:dist` (TypeScript 7 compiles the source into `dist/`) → `pkg` single binary | same |
| Frontend | Next.js 16 · React 19 · TypeScript · Tailwind 4 · Zustand | same |

Anything not in this table is an ADR-worthy choice. Write it into `MEMORY/DECISIONS.md` **before** adding the dependency.

## 3. Where Things Live

```
backend/src/
  routes/api/       one file per module; the ONLY place a URL is defined
  controllers/      HTTP in, HTTP out — no business logic
  services/         business logic, transactions, audit writes
  models/           Sequelize models (+ index.ts: associations, scoping hooks)
  validators/       request schemas            (Joi today → Zod)
  middlewares/      auth, tenant context, permission gates, errors, logging
  utils/            pure helpers; response envelope; AppError
  config/           env, database, socket, migrator — the only reader of process.env (target)
  migrations/       Umzug; names FROZEN once applied
  workers/          RabbitMQ consumers
  types/            (target) shared types: Express augmentation, branded ids, state unions
frontend/src/
  app/              Next.js routes — including app/api/v1/**, which OWNS the auth cookie
  api/services/     one client per backend module
  components/ stores/ hooks/ lib/
```

Detail: [`02-PROJECT-STRUCTURE.md`](./02-PROJECT-STRUCTURE.md).

## 4. Which Layer May Call Which

```
route ──▶ middleware chain ──▶ controller ──▶ service ──▶ model / sql() helper
                                                   └──▶ other services, queues, storage
```

| Layer | May | May not |
|---|---|---|
| route | declare the URL, the permission gate, the validator | contain logic |
| controller | read `req.validated` / identity, call **one** service, send the envelope | open transactions, touch models, catch errors to answer them itself |
| service | own the transaction, write the audit row inside it, call models and other services | read `req`/`res`; read `process.env` |
| model | declare columns, associations, scopes | know about HTTP |

## 5. The Five Non-Negotiables

1. **Tenant isolation is automatic — do not fight it.** The ORM hooks add the tenant predicate; a principal with no tenant matches `NO_TENANT_UUID` and sees **nothing**. Never read `tenantId` from a request body. **Raw SQL bypasses the hooks** — it carries `tenant_id = $n`, bound. Models without a `tenantId` attribute (such as `Tenant` itself) are **not** scoped: loading one by a path id needs an explicit ownership check — that omission is audit finding A-01.
2. **Cross-tenant is 404, never 403.** Not-found, soft-deleted and not-yours must be indistinguishable.
3. **Every route has a permission gate** — `dynamicAccess(slug, action)` or `rbac([...])`, plus `denyApiKey` where a service account must not reach. The build enforces it (P6-04, DONE 2026-09-25): `routePermissionGuard.p604` fails on a route with neither a gate nor a reviewed exemption.
4. **Every mutation writes its audit row inside the same transaction.**
5. **Every new `:id` route gets a two-tenant test asserting 404.**

## 6. The Envelope

```json
{ "success": true, "status": 200, "message": "...", "data": [], "meta": { "total": 0 } }
```

Rows in `data`; pagination in a **top-level** `meta`. Never `data.rows`, never `data.meta`. Detail: [`06-ERROR-RESPONSE-STANDARDS.md`](./06-ERROR-RESPONSE-STANDARDS.md).

## 7. The Traps That Have Already Cost Production Defects

| Trap | Result |
|---|---|
| optional include without `required: false` | INNER JOIN — the list returns **nothing** |
| `$1` placeholders passed as `replacements` | PostgreSQL: `there is no parameter $1` — hid behind a `catch` and read all metered usage as **zero** |
| `req.body.x` on Express 5 with no body | `req.body` is `undefined` → 500 |
| `schema.validate` passed to Express as middleware | 500 on every request |
| a path parameter the validator never sees | 400 on every request — merge `{ ...req.params, ...req.body }` |
| `db` destructured from the models barrel | it exports `sequelize` — `undefined` |
| `tenantId` on the `sessions` model | its attributes are snake_case: `tenant_id` |
| `is_deleted` in code | the attribute is `isDeleted` |
| a `catch` that returns a default | the outage is hidden and reported as a real answer |
| a new role without a `ROLE_LEVELS` entry | fails every privileged gate, silently |

Several of these are now refused mechanically by the TypeScript backend (ADR-038): `db` from the models barrel, `tenantId` on `sessions` and `is_deleted` are compile errors against the typed models; `replacements` is refused by `sql()`, and a direct `.query(` is a lint error; `validate(schema)` is the only way a schema reaches a router (schemaAsMiddleware.p911); `bodyDefault` fills an absent body; and a role without a `ROLE_LEVELS` entry refuses the boot (authorization wiring). The optional include, the path parameter a validator is not given, and the `catch` that returns a default are still caught only by tests and review.

## 8. Read Next

| When you are about to… | Read |
|---|---|
| write any backend file | [`05-LAYER-TEMPLATES.md`](./05-LAYER-TEMPLATES.md) |
| write TypeScript | [`04-TYPESCRIPT-STANDARDS.md`](./04-TYPESCRIPT-STANDARDS.md) |
| touch the database | [`07-DATABASE-ACCESS-STANDARDS.md`](./07-DATABASE-ACCESS-STANDARDS.md) |
| handle an error | [`06-ERROR-RESPONSE-STANDARDS.md`](./06-ERROR-RESPONSE-STANDARDS.md) |
| write a test | [`09-TESTING-CONVENTIONS.md`](./09-TESTING-CONVENTIONS.md) |
| open a PR | [`14-CODE-REVIEW-CHECKLIST.md`](./14-CODE-REVIEW-CHECKLIST.md) |
