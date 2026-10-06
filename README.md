# Callibrator

**Hospital Device Calibration Platform** — multi-tenant SaaS for medical-device calibration, maintenance and lifecycle management.

Built for two sides of the same transaction: **healthcare facilities** that own devices and must prove they are calibrated, and **calibration providers** that perform the work and issue the certificates.

Compliance targets: ISO 17025 · FDA 21 CFR Part 11 · ISO 13485 · GDPR · KARS · SNARS.

---

## The Idea

A hospital that cannot prove a defibrillator was calibrated within its interval has, for audit purposes, an uncalibrated defibrillator. **The evidence is the compliance.**

Callibrator makes that evidence a by-product of doing the work: every device has an interval, every calibration produces an append-only record naming who performed it (a database trigger and the application role's missing `UPDATE`/`DELETE` grant, P6-03), every certificate is signed and **publicly verifiable without a login**, and every mutation is audit-logged.

## Quick Start

```bash
make env          # create deploy/compose/.env
make secrets      # generate the required secrets (paste them into deploy/compose/.env)
make dev          # bring the stack up (builds from this tree: docker-compose.build.yml)
make help         # every target
```

### Deploying: images are pulled, not built

The application images are published on Docker Hub as public repositories (ADR-123): `zed378/calibration-be`, `zed378/calibration-fe` and `zed378/calibration-backup`, each tagged with the short commit and `latest`. A deployment **pulls** them; nothing is built on the host:

```bash
cd deploy/compose
docker compose -f docker-compose.yml -f docker-compose.vm.yml pull
docker compose -f docker-compose.yml -f docker-compose.vm.yml up -d      # or: make deploy-vm
```

- **Pin the release** for anything that holds real data. Set `IMAGE_TAG=<short commit>` in `deploy/compose/.env`, and optionally the per-image `*_DIGEST`. `latest` moves on every release.
- **The frontend image serves one URL.** `NEXT_PUBLIC_*` are inlined at build time, and `zed378/calibration-fe` is built for the reference deployment, `https://kalibrasi.zedth.my.id`. Another URL needs its own frontend image: `scripts/release/push-images.ps1 -PublicUrl <url> -FrontendRepository <yours>`.
- **Releases** are built, secret-scanned and pushed with `pwsh -File scripts/release/push-images.ps1`, from PowerShell or cmd, on a clean tree.

The full procedure, including the VM's step by step: [`deploy/README.md`](deploy/README.md).

Requires Docker with the compose plugin, **Node 26** (pinned by the root `.nvmrc`), npm (the root `package-lock.json` is the lockfile, ADR-044), and optionally `make` — every target is one or two commands in the `Makefile`, runnable directly.

The backend **refuses to start** without its required secrets — among them `CERT_SIGNING_SECRET`, `ENCRYPT_KEY`, `ATTACHMENT_URL_SECRET`, and in production `KMS_MASTER_KEY`. That is deliberate: starting without them produces certificates that cannot be verified, and the failure would appear days later in front of an auditor.

### First sign-in

There is no default password (ADR-099). On first boot the backend gives the platform super admin a **one-time password**, written only to a file inside the container; the log says where, never the value:

```bash
docker exec <backend-container> cat /app/.bootstrap/superadmin-password
```

Its first use asks for a new password before anything else. Details and recovery (`./backend rotate-bootstrap-password`): [`deploy/README.md`](deploy/README.md).

### Configuration worth knowing

| Variable | Effect |
|---|---|
| `PRIVACY_NOTICE_URL` | the published privacy notice. **Unset, the public access-request form and `POST /api/v1/access-requests` do not exist** (404), in every environment (ADR-113) |
| `NEXT_PUBLIC_CONTACT_WHATSAPP`, `NEXT_PUBLIC_CONTACT_EMAIL` | the public pages' contact buttons, read at **build** time; empty hides the button |
| `SELF_REGISTRATION_ENABLED` | whether `POST /api/v1/auth/register` exists; unset means **off in production**, on elsewhere (P10-12). Request access is the way in |
| `STRIPE_SECRET_KEY`, `BILLING_ENABLED` | in production with billing enabled, a missing key **stops the boot** (ADR-111); `BILLING_ENABLED=false` for a deployment that does not bill through Stripe |
| `SWAGGER_ENABLED` | the API reference: on outside production, off in production unless `true` |

## Layout

```
docs/          193 as-built documents (docs/ARCHIVE/ excluded)
MEMORY/        decisions, change records, specs, templates
TASKS/         the execution board
deploy/        compose stacks and Helm charts
backend/       Express · TypeScript (strict), compiled to CommonJS
frontend/      Next.js 16 · React 19 · TypeScript
packages/      @callibrator/contracts — request schemas shared by both
Makefile       development, gates, deployment
```

## The Stack, Accurately

| | |
|---|---|
| Runtime | **Node 26** (root `.nvmrc`) |
| Backend | Express 5 — **TypeScript, strict**, compiled to CommonJS (ADR-038, ADR-087); checked by TypeScript 7 (`@typescript/native`); run through `tsx` in development |
| Validation | **Zod** (ADR-093), shared with the frontend through `@callibrator/contracts` |
| ORM | Sequelize 6, with global tenant-scoping hooks |
| Database | PostgreSQL 18 + pgvector, only (ADR-039, ADR-041) |
| Frontend | Next.js 16 · React 19 · TypeScript · Tailwind 4 · Zustand |
| Realtime | Socket.IO both ends (ADR-031) |
| Infrastructure | Redis · RabbitMQ · MQTT client (external broker) · ClamAV · pgvector |
| Distribution | the **backend image is a `pkg` binary**; the **frontend image is Next standalone on Node** (S-29). A compiled frontend binary (`next-bun-compile`, `NEXT_COMPILE=true`) is opt-in and not built in the image |

## Scale

Counted 2026-10-02 with the method `CLAUDE.md` states. Counts are dated snapshots; re-count before quoting.

| | |
|---|---|
| Route modules | 55 (+3 internal) |
| Models | 73 |
| Migrations | 79 |
| Services / controllers / validators | 91 / 64 / 44 |
| Backend test files | 950 under `backend/src/tests` (271 TypeScript, 679 legacy JavaScript) + 3 in `backend/__tests__` |
| Live E2E spec files | 57 |
| API operations (`openapi.json`, all code-first) | 479 |
| Frontend API services (52 with a test file) | 54 |
| Dashboard pages | 60 |
| ADRs | 112 (highest number 113) |

## Where to Start Reading

| You are | Read |
|---|---|
| New to the project | [`docs/PLAN/00-PROJECT-OVERVIEW.md`](docs/PLAN/00-PROJECT-OVERVIEW.md) |
| **An engineer, any discipline** | [`docs/SECURITY/05-MULTI-TENANCY-SECURITY.md`](docs/SECURITY/05-MULTI-TENANCY-SECURITY.md) — **mandatory** |
| Working on the backend | [`docs/BACKEND/00-BACKEND-STANDARDS.md`](docs/BACKEND/00-BACKEND-STANDARDS.md) |
| Working on the frontend | [`docs/FRONTEND/00-FRONTEND-STANDARDS.md`](docs/FRONTEND/00-FRONTEND-STANDARDS.md) |
| Deploying | [`deploy/README.md`](deploy/README.md) |
| An AI agent | [`CLAUDE.md`](CLAUDE.md), then [`AGENTS.md`](AGENTS.md) |
| Wondering why something is the way it is | [`MEMORY/DECISIONS.md`](MEMORY/DECISIONS.md) — **Part II first** |

## Documentation

`docs/` describes the system **as it is actually built**. Every document names the source files it derives from, so you can check it rather than trust it.

| | | |
|---|---|---|
| [`PLAN/`](docs/PLAN/00-PROJECT-OVERVIEW.md) | 19 | product, business rules, roles, compliance, risks |
| [`ARCHITECTURE/`](docs/ARCHITECTURE/00-SYSTEM-ARCHITECTURE.md) | 13 | system design |
| [`API/`](docs/API/00-API-STANDARDS.md) | 15 | the contract |
| [`DATABASE/`](docs/DATABASE/00-DATA-MODEL.md) | 14 | the models by domain |
| [`SECURITY/`](docs/SECURITY/00-SECURITY-REQUIREMENTS.md) | 15 | threat model through incident response |
| [`UI-UX/`](docs/UI-UX/00-DESIGN-DIRECTION.md) | 21 | experience design and the design system |
| [`FRONTEND/`](docs/FRONTEND/00-FRONTEND-STANDARDS.md) | 14 | frontend architecture |
| [`BACKEND/`](docs/BACKEND/00-BACKEND-STANDARDS.md) | 13 | backend architecture and the module reference |
| [`DEVOPS/`](docs/DEVOPS/00-ENVIRONMENTS.md) | 12 | environments, deployment, observability |
| [`TESTING/`](docs/TESTING/00-TEST-STRATEGY.md) | 8 | the strategy and every suite enforcing it |
| [`ENGINEERING/`](docs/ENGINEERING/README.md) | 17 | coding standards, TypeScript rules, layer templates, tooling |

(Top-level documents per category, counted 2026-10-02.)

### The API reference

The contract is generated **code-first** from the Zod schemas the routes enforce (ADR-103): `backend/openapi.json`, 479 operations, regenerated by `npm run openapi:generate` and checked by `openapi:check`, Spectral (`openapi:lint`) and a breaking-change check. It is served by **Scalar, self-hosted and behind sign-in** — a signed-in tenant admin or the platform super admin opens `<frontend>/api/v1/docs`; an API key never gets in. Off in production unless `SWAGGER_ENABLED=true`.

## Commands

```bash
make dev              # local stack, hot reload
make verify           # lint · ts-ratchet · typecheck · test · build · load-check
make test-e2e         # 57 live spec files against a running server (not in verify, not in CI)
make migrate          # then: make migrate-verify — the log is not evidence
make deploy ENV=prod TAG=<sha>   # pulls; TAG = the release's short commit
make deploy-vm                   # the single-host VM: pull + up -d, never builds (ADR-123)
pwsh -File scripts/release/push-images.ps1 [-DryRun]   # build, scan and push the three images (PowerShell/cmd)

cd backend
npm start             # node --import tsx index.ts (the release build compiles it to dist/index.js)
npm run typecheck     # TypeScript 7 — never bare `npx tsc` (ADR-076)
npm run ratchet       # refuses any new .js file, tests included (ADR-087)
npm run load:check    # every module loads: dist/ under node; add `-- --src` for src/ under tsx
npm test              # through the npm script, not bare `npx jest` (A-99)
```

`make verify` does **not** cover the live or browser suites. A green `verify` is not a green release.

## Current State, Stated Honestly

Phases 0–5 are shipped; Phase 9 (the TypeScript migration) has converted every backend source module but one. A status page that hides a red gate is not a status page.

| | |
|---|---|
| Backend unit coverage gate (100%) | 🟢 **100%** statements / branches / functions / lines on 2026-10-05, closing tree: 890 suites passed, 37 skipped, 0 failed (15,054 tests) — [closing gates](MEMORY/records/2026-10-05-closing-gates-st.md) |
| Typecheck · lint · build · load | 🟢 0 type errors, 0 lint errors and 0 warnings, `build:dist` / `next build` / bundle budget and `load:check` OK, npm audit gates green — 2026-10-05, closing tree. 🟡 `openapi:breaking` against `main` reports 3 breaking changes, all `POST /api/v1/sop` (W-10's new validation): fine for a direct push to `main`, a pull request needs them recorded first ([record](MEMORY/records/2026-10-05-closing-gates-st.md)) |
| Live E2E in one uninterrupted run | 🟢 **achieved twice back to back on 2026-10-05 on the tree of the work since `dded70c`** (runs S and T: 433 tests passed, 0 failed, smoke 7/7, a11y 80/80, responsive 45/45, Phase 10 browser 12/12, 0 × 5xx), by hand — 🟡 **not run by CI** |
| `calibration_records` append-only | 🟢 a **database constraint**: trigger + the application role's REVOKE (P6-03, ADR-062) |
| CI pipeline | 🟡 **has run on GitHub, never fully green**: the second run, on `dded70c`, passed 9 of 11 jobs; the two failures (npm audit, backend coverage) are addressed in the working tree (ADR-117) — a green run awaits a push (P7-01) |
| Helm charts | 🟡 **install, upgrade and serve on one local kind cluster** (ADR-106) — not a production cluster. A-310 (sign-in under `FORCE_HTTPS=true`) is fixed in code, not re-run on a cluster |
| TypeScript migration | 🟡 every source module is TypeScript except the dead `utils/checkMenu.util.js` (its deletion awaits the owner, A-18); 694 legacy `.js` files in the test trees are converted opportunistically (P9-26) |

Full board: [`TASKS/PROGRESS.md`](TASKS/PROGRESS.md). Everything unverified is listed in [`TASKS/BACKLOG.md`](TASKS/BACKLOG.md) § Unverified Claims.

## Roadmap

| | |
|---|---|
| **Phase 10** — landing, sign-in, request access, verification | 🟡 in progress ([`TASKS/PHASE-10-LANDING-AUTH-REVAMP.md`](TASKS/PHASE-10-LANDING-AUTH-REVAMP.md), ADR-098) |
| **Phase 11** — admin dashboard revamp | ⏸ on hold until the owner instructs ([`TASKS/PHASE-11-DASHBOARD-REVAMP.md`](TASKS/PHASE-11-DASHBOARD-REVAMP.md)) |
| **Upstream PHP feature adoption** | ⏳ after Phase 9; must finish before Phase 999 |
| **Phase 999** — Go backend engine, dual backend | ⏳ planned, nothing built ([`TASKS/PHASE-999-GO-MIGRATION-AND-DUAL-BACKEND.md`](TASKS/PHASE-999-GO-MIGRATION-AND-DUAL-BACKEND.md), ADR-089) |

## The Rules That Matter Most

**Tenant isolation is deny-by-default.** Global Sequelize hooks inject the predicate; you do not opt in. A principal with no resolvable tenant sees **nothing**.

**Cross-tenant returns 404, never 403.** A 403 confirms the resource exists.

**Every route needs a permission gate** — and the build enforces it (`routePermissionGuard.p604`, P6-04).

**Name the test.** An assertion that a test passed is not evidence. "IDOR tested, all good" with no test named is worse than silence, because it stops anyone looking again.

## Contributing

One task, one branch, one PR. `main` stays deployable.

```
feat/P6-04-route-permission-guard
```

**Nothing is `DONE` without its record in `MEMORY/records/`.** New code — tests included — is TypeScript. Conventions: [`TASKS/00-TASK-CONVENTIONS.md`](TASKS/00-TASK-CONVENTIONS.md).

## A Note on This Repository's History

The previous `CLAUDE.md` instructed engineers and agents to write **strict TypeScript with no `any`** — for a backend that was JavaScript. The task board listed foundation work as TODO that had shipped months earlier.

An instruction document that disagrees with the code produces confidently wrong work, **and the confidence is the dangerous part**.

That is recorded as PR-4, and it is why `docs/` is as-built, why Part II of `DECISIONS.md` exists, and why every document here names the file it derives from. The backend has since been migrated to TypeScript (ADR-038, Phase 9) — and the documents said so only after the code did.
