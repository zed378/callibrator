# 00 — Coding Context

The one file to read at the start of every session before writing backend or frontend code. Everything here is a summary; follow the link when the summary is not enough.

> **Target standard: TypeScript, strict (ADR-038).** The backend is **still JavaScript/CommonJS** — 370 `.js` source files on 2026-09-21 — and its migration is [`../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`](../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md). TypeScript in this category is the standard for **new and converted** code. Where a section describes the code as it is today, it says **as-built**. The frontend is already TypeScript.

---

## 1. What This System Is

**Callibrator** — multi-tenant SaaS for hospital medical-device calibration, maintenance and lifecycle management. Compliance-bearing: ISO 17025, FDA 21 CFR Part 11, ISO 13485, GDPR, KARS, SNARS.

The two things that must never break:

- **tenant isolation** — one hospital never sees another's data;
- **evidence** — calibration records, certificates, signatures and audit rows prove what happened, to an auditor, years later.

## 2. Stack

| Concern | As-built | Target |
|---|---|---|
| Backend language | JavaScript, CommonJS | **TypeScript, strict**, emitted as CommonJS (ADR-038) |
| HTTP | Express 5 | same |
| Database | **PostgreSQL 18 + pgvector, only** (ADR-039) | same |
| ORM | Sequelize 6, global tenant-scoping hooks (ADR-029) | same, typed with `InferAttributes` |
| Validation | Joi | **Zod** — the schema is the type |
| Tests | Jest 30, 100% coverage gate | Jest 30 + `@swc/jest`, gate unchanged |
| Cache / state | Redis (`ioredis`) | same |
| Queue | RabbitMQ (`amqplib`) | same; webhook delivery moves onto it (A-10) |
| Realtime | Socket.IO, both ends (ADR-031) | same |
| IoT | HTTP ingest + optional MQTT **client** of an external broker | same |
| Build | `pkg` single binary | `tsc` → `pkg` |
| Frontend | Next.js 16 · React 19 · TypeScript · Tailwind 4 · Zustand | same |

Anything not in this table is an ADR-worthy choice. Write it into `MEMORY/DECISIONS.md` **before** adding the dependency.

## 3. Where Things Live

```
backend/src/
  routes/api/       one file per module; the ONLY place a URL is defined
  controllers/      HTTP in, HTTP out — no business logic
  services/         business logic, transactions, audit writes
  models/           Sequelize models (+ index.js: associations, scoping hooks)
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
3. **Every route has a permission gate** — `dynamicAccess(slug, action)` or `rbac([...])`, plus `denyApiKey` where a service account must not reach. Nothing in the build enforces it yet (P6-04); 31 route files currently have neither gate (A-03).
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

Every one of these is a compile error or a lint error under the target standard. That is the argument for ADR-038.

## 8. Read Next

| When you are about to… | Read |
|---|---|
| write any backend file | [`05-LAYER-TEMPLATES.md`](./05-LAYER-TEMPLATES.md) |
| write TypeScript | [`04-TYPESCRIPT-STANDARDS.md`](./04-TYPESCRIPT-STANDARDS.md) |
| touch the database | [`07-DATABASE-ACCESS-STANDARDS.md`](./07-DATABASE-ACCESS-STANDARDS.md) |
| handle an error | [`06-ERROR-RESPONSE-STANDARDS.md`](./06-ERROR-RESPONSE-STANDARDS.md) |
| write a test | [`09-TESTING-CONVENTIONS.md`](./09-TESTING-CONVENTIONS.md) |
| open a PR | [`14-CODE-REVIEW-CHECKLIST.md`](./14-CODE-REVIEW-CHECKLIST.md) |
