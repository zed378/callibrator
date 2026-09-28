# Memory Index

Every change record, newest first. One line each: date, task, title, and the hook that tells you whether this is the record you need.

Add a line here as part of writing the record — **an unindexed record is a record nobody finds.**

---

## Records

| Date | Task | Record | Hook |
|---|---|---|---|
| 2026-09-28 | ADR-082, P7-01, P7-02, P7-03, M-13 | [CI stages in CI form, alert routing, log shipping](./records/2026-09-28-p7-01-02-03.md) | `backend-test`, `boot-and-migrate` and `npm audit` run as CI would, and **three red-on-day-one defects fixed** (`tsx` skipped under NODE_ENV=production, `migrate:status` hang, `.env`-dependent coverage); alerts reach a real HTTP receiver; the pinned Vector shipped real backend logs to Loki with 0 secrets. **Still never run on GitHub** |
| 2026-09-28 | ADR-081, S-09, S-13, S-23, S-25, S-31, S-33, S-34 | [The by-the-book production start, deploy/docs S-card remainder](./records/2026-09-28-adr081-deploy-by-the-book.md) | **First real `make env; make secrets; make up ENV=prod`** (GNU Make in a container): four defects found and fixed. The unread `ACME_DIRECTORY_URL` guard; `FORCE_HTTPS` 301ing `/health` so the backend was never healthy (probes exempt); nginx crash-looping with no certificate behind a green `make up`; placeholder `DB_PASS`/JWT secrets passing preflight. Fresh-clone start from `backend/.env.example` works; S-33 two-replica claim proven on real Redis; ACME/TLS references made consistent with `acme-client`'s removal |
| 2026-09-28 | P6-02, A-20, ADR-077 | [P6-02: the live E2E suite green](./records/2026-09-28-p6-02-e2e-green.md) | **First uninterrupted green E2E run, twice** (392 tests, no 429). Eleven app defects found on the way: **no session could ever be refreshed** (login never sent the refresh token), **every GDPR export and tenant backup 500**, and **a new operator could not enrol MFA in the browser** (modal loop). The 71-test Playwright suite is withdrawn; a five-check puppeteer smoke replaces it |
| 2026-09-28 | ADR-085, P6-01, P6-04, P6-07, P6-08, P6-11, P6-12, P6-13, P6-14 | [Phase 6: the open cards](./records/2026-09-28-phase6-open-cards.md) | P6-04/07/08 were stale (done 2026-09-25); **every webhook rotation 500ed on PostgreSQL** (audit row without `actorType`) — fixed; sid-less tokens refused; open sockets re-checked every 60 s; webhook secret rotation with an overlap (migration 0090, PG 18.6 verified); coverage scope written down; 638 suites / 12,780 tests at 100% |
| 2026-09-28 | ADR-078, P7-04, P7-05, P6-10, P6-06 | [Restore drill, secret escrow, rotation rehearsal](./records/2026-09-27-p7-04-restore-drill.md) | First restore drill (compose, PG 18): checklist identical before/after, RTO 234 s, RPO = dump age; a restore under the wrong KMS key booted — now refused at boot; API tenant backups held no users (fixed); dump restore needs the app role first; **the image cannot render certificate PDFs (open)**; rotation rehearsed on drill data incl. MFA seeds; soft-deleted devices keep their serial |
| 2026-09-27 | ADR-076, A-42, A-18, A-257, A-19, Node 26, TypeScript 7.0.2 | [Hygiene, Node 26, TypeScript 7](./records/2026-09-27-a076-hygiene-node26-ts7.md) | 24 runtime `console.*` sites moved to the logger behind a guard; Node 26 pinned everywhere; TypeScript 7 beside the TS 6 API; `make hooks` installs a checksum-verified gitleaks; 11 unused deps removed. **The backend image at `a31c601` did not build** (no `build:dist`). 12,775 backend tests at 100 %, on Node 26 |
| 2026-09-27 | ADR-089, P999-01…25 | [Dual-Backend Target Architecture & Planning](./records/2026-09-27-dual-backend-architecture-planning.md) | Architectural decision and technical documentation update establishing Dual-Backend (TS existing + Go future engine), Multi-Frontend targets, shared component boundary rules, and Phase 999 backlog. Documentation/planning only |
| 2026-09-27 | ADR-074, F-05, F-07, F-09…F-14, F-16 | [Frontend board (fe2)](./records/2026-09-27-frontend-board-fe2.md) | The Next proxy streams and bounds its upstream wait; `/metered-billing/history` joins the envelope; **every backend timeout had answered 503, never the documented 408**; SSO hand-off same-origin only; the 10 bare overlays are modal dialogs. Headless checks against a stand-in backend, not the real one |
| 2026-09-25 | ADR-060…073, W-33, W-34, P6-03, A-116, A-260 … | [Phase 0 batch 7](./records/2026-09-25-phase0-batch7.md) | Batch 6's halted work verified: most of its 53 failures were stale or Windows-bound tests. **Every bulk delete in a tenant context had failed** (5 routes answered 500); **`sum` leaked across tenants** (1107 = 7 + 1100 on PG18). 12,164 backend tests at 100 %, on Node 24 |
| 2026-09-25 | ADR-053, ADR-054, A-07, A-10, A-29, A-68, A-148, A-150, S-04 … | [Phase 0 batch 5](./records/2026-09-25-phase0-batch5.md) | Twenty concurrent agents. **Tenant secrets were in plaintext**, **ClamAV had never scanned**, **SSO had never worked**, **tenant export leaked password hashes**, finance locked out three admin roles. A boot failure on existing databases (model index before migration 0039) fixed at commit. Deploy notes are in the record |
| 2026-09-24 | dependency upgrade | [Dependency upgrade to latest](./records/2026-09-24-dependency-upgrade.md) | Every package at its latest (TypeScript held at 6.0.3 and ESLint at 9.39.5 — the ecosystem does not accept 7/10 yet), fresh lockfile, `^` restored. **0 vulnerabilities** (was 20): `jwk-to-pem` replaced by Node crypto, Sequelize's uuid overridden. ioredis 6 pinned to RESP2. Lint counts identical before and after; all gates green |
| 2026-09-24 | ADR-050…052, A-99, A-121, A-122, A-138 … | [Phase 0 batch 4](./records/2026-09-24-phase0-batch4.md) | Owner questions Q-09–Q-19 decided by debate (ADR-051). Audit rows made permanent (no purge; RESTRICT, proven on pg18); regulated records survive their authors (migration 0030, fresh and migrated schemas identical). **MFA had never worked** on otplib 13, hidden by a global mock; **every user's TOTP secret was in GET /users**; tenant backup had never worked. Deploy notes are in the record |
| 2026-09-24 | A-63…A-75, A-84, A-85, A-87, D-04 | [Phase 0 batch 3 checkpoint](./records/2026-09-24-phase0-batch3-checkpoint.md) | Checkpoint committed at the owner's request with four agents in flight. The headline: **the tenant hooks never filtered an include** — proven on PostgreSQL 18 to return another tenant's device and user — now fixed at the mechanism without changing any join type (ADR-048). Also: any user could suspend any tenant (A-63), and a PUT could approve a certificate (A-64). Coverage at the checkpoint is 99.93 %, not 100 % |
| 2026-09-24 | A-41, A-48, A-59, A-60, A-61, A-62, W-01, S-13 … | [Phase 0 batch 2](./records/2026-09-24-phase0-batch2.md) | Sessions became revocable (logout had never revoked anything); the activation, MFA and socket tokens stopped being bearer tokens; SSO tokens left the URL; 25 compliance mutations audit inside their transaction, which exposed that **every e-signature had committed without an audit row**; tenant lifecycle got the six columns it had silently written into nothing, verified on PostgreSQL 18.6. Found and queued: **A-63** (any user can suspend any tenant) and **A-64** (a PUT can approve a certificate) |
| 2026-09-24 | D-01, V-01, A-58, AZ-04, S-02 … | [Phase 0 foundation repairs](./records/2026-09-24-phase0-foundation-repairs.md) | Repaired `36205df`, which seven interrupted agents left pushed **red**. Its contents were not uniformly broken: one fix was complete, one had tests and no fix, one had a correct fix and a broken test, one was wired to nothing, and one — the backup-restore rewrite — would have **failed every real restore** by writing an invalid ENUM value, green because the mock accepted any string. Tenant isolation now covers `bulkCreate`/`upsert` (verified live), a boot assertion refuses unseeded gates, and cross-tenant is a 404 everywhere it was a 403 |
| 2026-09-23 | A-04 … A-50 | [Wave 0 parallel remediation](./records/2026-09-23-wave0-parallel-remediation.md) | Nine agents on disjoint findings. Eighteen fixed — including **no electronic signature could ever verify** (`Date.now()` inside the hashed payload; ADR-040), the rate limiter never using Redis, every RabbitMQ call leaking a connection, and every per-user permission override silently doing nothing. **Twenty new findings were found while fixing or documenting something else**, among them audit rows written outside the transaction, revocation that does not revoke (checked on the VM: 24-hour tokens), and `createTwoTenants()` — the fixture `CLAUDE.md` calls one line — not existing at all |
| 2026-09-23 | A-01, A-02, A-03, A-27 | [Wave 0 authorization fixes](./records/2026-09-23-wave0-authorisation-fixes.md) | Four routes that authenticated but did not authorize: any user could mint a `*` API key and have SCIM make it SUPERADMIN, re-parent **another hospital's** tenant, or repoint the tenant's storage and webhooks. Also **corrects** the 2026-09-21 A-27 write-up — SCIM is not `auth`-only; my matrix script did not know the inline `requireApiKeyOrAdmin` gate — and records A-33, SCIM PATCH ignoring `path` so a standards-compliant deprovision returns 200 and does nothing |
| 2026-09-21 | — | [Backend audit](./records/2026-09-21-backend-audit.md) | Started as a documentation task and turned into an audit: a **cross-tenant write** on `tenant-hierarchy`, tenant configuration open to every user, API-key scopes enforced on 16 of 53 route files, and **metered billing reading every tenant's usage as zero** (fixed). Five documented claims were false — an embedded MQTT broker, MySQL support, a `pre-push` hook, a secret scanner, and my own explanation of empty `docker logs`. Led to ADR-038 (TypeScript) and ADR-039 (PostgreSQL only) |
| 2026-09-10 | — | [First production deployment](./records/2026-09-10-first-production-deployment.md) | Nine defects, **none reachable from a test**: an unanchored `storage/` in `.gitignore` excluded six committed source files from every clean clone; a fourth required secret nothing named crash-looped the container with an empty `docker logs`; and a proxy rule sending `/api/` to the backend broke browser login while the backend answered 200 throughout. A clean-clone build in CI would have caught four of them (P7-01) |
| 2026-09-10 | — | [Monorepo restructure and as-built documentation](./records/2026-09-10-monorepo-restructure-and-as-built-docs.md) | `CLAUDE.md` told engineers and agents to write strict TypeScript with no `any` for a backend that is **JavaScript**, and `TASKS/` listed foundation work as TODO that had shipped months earlier. 135 documents rewritten from the code rather than from the plan; nine ADRs record what actually happened; `deploy/` and a Makefile added with guards that **refuse to render** rather than deploying something that misbehaves quietly |

---

## Before This Index Existed

The system reached 33 modules, 72 models and 342 test files before `MEMORY/` was used as intended. The work below happened and was recorded elsewhere — in the audit report, in the module reference, in the migration history. It is listed so the trail is not simply blank.

| Approximate date | What | Where it is recorded |
|---|---|---|
| 2026-07 | **Full-stack integration audit** — 51 route modules audited live, 24 defects found, 15 backend defects fixed and re-verified against a running server | [`../docs/ARCHIVE/2026-07-fullstack-integration-audit.md`](../docs/ARCHIVE/2026-07-fullstack-integration-audit.md) |
| 2026-07 | Row Level Security **removed**; ORM-layer deny-by-default scoping adopted | migrations `0012` → `0015`, ADR-029 |
| 2026-07 | Plain-WebSocket realtime trialled and **reverted** | ADR-031 |
| 2026-07 | Pluggable object storage — local, s3, nfs; per-tenant and global | migration `0016`, ADR recorded in `docs/ARCHITECTURE/05` |
| 2026-07 | Module reference generated from static analysis of `backend/src` | [`../docs/BACKEND/10-MODULE-REFERENCE.md`](../docs/BACKEND/10-MODULE-REFERENCE.md) |
| 2026-09-10 | Monorepo scaffolding, first `docs/` `MEMORY/` `TASKS/` structure | [`../docs/ARCHIVE/2026-09-10-monorepo-setup-summary.md`](../docs/ARCHIVE/2026-09-10-monorepo-setup-summary.md) |

**This gap is the point of the folder.** Everything above had to be reconstructed by reading code and audit reports, which is precisely what a change record exists to make unnecessary.

---

## The Defects Worth Knowing About

Not records in their own right, but the ones that recur and shape how everything here is written. Full accounts in the audit report; the mechanism is what matters.

| Defect | Mechanism | Where it is now documented |
|---|---|---|
| **Every token rejected 15 minutes after login** | `verifyAccessToken` passed `maxAge: "15m"` against tokens signed `expiresIn=1d` | `docs/SECURITY/03` |
| **Certificate list returned zero rows while rows existed** | four includes defaulted to INNER JOINs; every draft has a null actor FK | `docs/BACKEND/00`, `docs/DATABASE/08` |
| **Risks with no assignee were invisible** — absent from lists, 404 on get, update and delete | same INNER JOIN shape, plus the `User` `defaultScope` | `docs/API/10` |
| **QMS, CAPA and SOP lists rendered empty** | rows returned inside `data` instead of `data` + top-level `meta` | `docs/API/00` |
| **Approving a certificate was unreachable** | no `submit` transition; an invalid state threw a plain `Error` → 500 | ADR-035 |
| **Every tenant create returned a 500** | `subdomain` required by the model, never collected | ADR-036 |
| **Suspend, resume and offboard all 500ed** | uppercase status values and a state outside the ENUM | ADR-037 |
| **The nightly retention purge failed every night** | `Session.destroy({ where: { tenantId } })` — the attribute is `tenant_id` | `docs/DATABASE/03` |
| **Every workflow create and update 500ed** | `db` destructured from the models barrel, which exports `sequelize` | `docs/BACKEND/02` |
| **Several endpoints 400ed every request** | path parameters validated in the body | `docs/BACKEND/03` |
| **A Joi schema spread into a plain object** | `schema.validate is not a function`, on every request | `docs/BACKEND/03` |
| **3,863 tests passed while 13 endpoints were broken** | frontend services written against imagined endpoints, tests mocking the fabrication | `docs/TESTING/00` |

The last one is the reason the live E2E layer exists at all.

---

## By Theme

### Isolation
- ADR-029 — deny-by-default ORM scoping; why RLS was removed, and the fail-open branch it carried
- `docs/SECURITY/05` — mandatory reading; where the hooks do not reach

### Evidence integrity
- ADR-035 — the certificate state machine, and why an invalid transition is a 409
- **PR-2, open** — `calibration_records` append-only is a **convention, not a constraint**; the model is `paranoid` and has `PUT`/`DELETE` routes

### Stale specifications
- The 2026-09-10 record — the trap, realised rather than avoided
- `DECISIONS.md` **Part II** — nine ADRs recording what was built differently from what was planned

### Things that render but are not known to work
- Helm charts — `helm lint` and `helm template` pass; **no cluster has been reachable**
- The live E2E suite — every fix verified individually; **never a clean pass in one uninterrupted run**

Both distinctions are kept deliberately. Rounding them up is how a status report becomes untrustworthy.
