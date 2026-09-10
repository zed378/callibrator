# Memory Index

Every change record, newest first. One line each: date, task, title, and the hook that tells you whether this is the record you need.

Add a line here as part of writing the record — **an unindexed record is a record nobody finds.**

---

## Records

| Date | Task | Record | Hook |
|---|---|---|---|
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
