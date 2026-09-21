# 02 — Project Structure

The repository as it is, and the additions the TypeScript migration makes.

> **As-built** unless marked **(target)**. Targets are created by the Phase 9 task named beside them.

---

## Repository

```
Callibrator/
├── backend/                  Express API — JavaScript today, TypeScript target (ADR-038)
├── frontend/                 Next.js 16 app — TypeScript
├── packages/contracts/       (target, P9-22) shared Zod schemas, consumed by both
├── deploy/
│   ├── compose/              primary deployment (ADR-032): base + dev/staging/prod/vm overlays, nginx
│   └── helm/callibrator/     renders; not cluster-validated
├── docs/                     as-built specification, by category
├── MEMORY/                   decisions (ADRs), change records, changelog
├── TASKS/                    phases, audit remediation, backlog, progress board
├── Makefile                  env, secrets, up/down, deploy, verify — `make` is manual
├── package.json              workspace root (turbo)
└── pnpm-workspace.yaml       workspaces: backend, frontend
```

`packages/*` is not in the workspace list today because nothing lives there. P9-22 adds it with the first shared package.

## Backend

```
backend/
├── index.js                  composition root: middleware order, 56 router mounts, health, schedulers
├── src/
│   ├── config/               index.js (DB, PostgreSQL only), socket.js, migrator.js
│   ├── constants/            role levels, menu slugs, rate limits, app constants
│   ├── controllers/          56 — HTTP in, HTTP out
│   ├── middlewares/          21 — auth, tenant context, gates, validation, errors, logging, schedulers
│   ├── migrations/           18 Umzug migrations; names frozen once applied
│   ├── models/               72 models + index.js (associations, scoping hooks)
│   ├── routes/api/           53 route modules
│   ├── routes/internal/      migration/seeding (bootstrap-gated)
│   ├── scripts/              migrate, migrateStorage, seedDemo, backfillEmbeddings
│   ├── services/             76 incl. storage/ (local | s3 | nfs drivers)
│   ├── templates/            email and certificate HTML — shipped next to the binary
│   ├── utils/                20 — envelope, AppError, wrappers, tenant scope, SSRF, paths
│   ├── validators/           37 Joi schemas (→ Zod, P9-11)
│   ├── workers/              batchJob.worker.js
│   ├── types/                (target, P9-05) express.d.ts, ids.ts, state unions
│   └── tests/                340 test files; e2e/ runs against a live server
├── public/                   static files at /public — shipped in the image since 2026-09-11
├── uploads/                  runtime data — gitignored; a volume in every deployment
├── tsconfig.json             (target, P9-01)
└── Dockerfile                node:24 builder → debian slim runtime with Chromium
```

### Two directories that look like source and are not

| Directory | What it is |
|---|---|
| `backend/uploads/` | runtime data, gitignored, **shadowed by a bind mount** in every deployment. Anything committed-looking in it is not shipped. The default avatar lived here and never reached a browser |
| `backend/agents/`, `backend/memory/`, `backend/docs/openclaw/` | agent persona and legacy notes carried in from earlier tooling. Not project documentation; not maintained |

### Composition order is behaviour

`index.js` wires security headers → HPP → CORS → rate limit → body parsing (with the Stripe raw-body hook) → 30 s timeout → request id → access and activity logging → static → sanitiser → swagger → routers → health → not-found → error handler. Four of those orderings are load-bearing; see [`../BACKEND/04-MIDDLEWARE-PIPELINE.md`](../BACKEND/04-MIDDLEWARE-PIPELINE.md).

## Frontend

```
frontend/src/
├── app/
│   ├── api/v1/auth/login/route.ts   sets the httpOnly auth_token cookie
│   ├── api/v1/[...path]/route.ts    proxies to the backend, injecting Authorization from the cookie
│   ├── dashboard/                   ~60 surfaces
│   ├── login/ register/ verify/     public
│   └── layout.tsx                   metadata, icons, theme bootstrap
├── api/services/                    51 clients, each with a contract test
├── components/                      ui/, layouts/, brand/ (inlined logo mark), landing/
├── stores/ hooks/ lib/ types/
└── public/                          brand/, favicon.ico, apple-touch-icon.png, default-avatar.svg
```

**Next.js owns `/api/v1/*`.** A reverse proxy that sends `/api/` to the backend breaks login. See [`../DEVOPS/03-REVERSE-PROXY.md`](../DEVOPS/03-REVERSE-PROXY.md).

## Where a New Thing Goes

| New thing | Location |
|---|---|
| an endpoint | a route in the module's `routes/api/*.route.*`, its controller, its service |
| a request schema | `validators/<module>.validator.*` (Zod for new code) |
| a table | a model **and** a migration; never `sync` against a real database |
| a cross-module type | `src/types/` (target) |
| a background job | a RabbitMQ consumer under `workers/` |
| a shared helper | `utils/` — only if it has no business logic |
