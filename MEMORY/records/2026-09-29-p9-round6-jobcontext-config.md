# 2026-09-29 — Phase 9 round 6: the context-dependent utils, `jobContext` under the isolation gates, `migrationLock` live, `jsonShape` + `iot.validator`, and P9-06 part 1

**ADR:** [ADR-087 Amendment 6](../DECISIONS.md) · **Cards:** P9-09 advanced (30 of 36 utils), P9-06 part 1 done, P9-11 (`iot.validator` ahead, still Joi) · **Tree:** HEAD `35ebd76` plus the working tree. I was the only agent running. Continues [`2026-09-29-p9-leaves-baseline-image.md`](./2026-09-29-p9-leaves-baseline-image.md).

## What changed

| Area | Files |
|---|---|
| Converted (`.js` removed) | `src/utils/authorizationWiring.util.ts`, `publicBaseUrl.util.ts`, `schedulerSwitch.util.ts`, `jobContext.util.ts`, `migrationLock.util.ts`, `jsonShape.util.ts`; `src/validators/iot.validator.ts` (still Joi) |
| New | `src/config/env.ts`: `env`, `envOr`, `environment`, `isProduction`. These are the only reads of `process.env` in converted code, done at call time; `envOr` keeps `\|\|` |
| Retrofitted to `config/env` (P9-06 part 1) | `appError`, `controllerWrapper`, `dbRole`, `fileValidation`, `response`, `schemaVerify`, `storagePath`, `upload`, `constants/roleConstants`, `middlewares/activityLog` (its region directive went too). Every Stage-B `no-restricted-properties` directive is gone |
| Test changes | `src/tests/utils/jobContext.w12.test.js`: its guard expectation now names `utils/jobContext.util.ts`, a file-name change. **New:** `src/tests/config/env.p906.test.ts` (4 tests) |
| Ratchet | `backend/.ts-ratchet.json` floor 1172 → **1165** |
| Docs | ADR-087 Amendment 6; the P9-06, P9-09 and P9-11 cards; `TASKS/PROGRESS.md`; the standards banner (50 modules); `CLAUDE.md` scale row |

## Evidence

**Identity against the working-copy originals** (scripts in scratch `p9/`; each placed the originals into a copy of `dist/src` and compared them with the compiled modules)

| Module | Result |
|---|---|
| authorizationWiring, publicBaseUrl, schedulerSwitch | **150 identical** (`compare9.js`) |
| jobContext | **141 identical** (`compare10.js`) |
| migrationLock | **21 identical** (`compare11.js`) |
| jsonShape + iot.validator | **266 identical** (`compare12.js`) |
| P9-06 retrofit, all ten modules | **62 environment cases identical** (`compare13.js`). Each case ran in a fresh process. Eight variables were each tested unset, empty and set, in both the packaged and the source layout |

**jobContext gates** (the owner's four)

| Gate | Result |
|---|---|
| (a) guards bite on `.ts` | A planted `isSystemTask: true` and a literal `runAsSystem` reason each failed `jobContext.w12`; with them removed it passed 12/12 |
| (b) identity | 141 checks identical |
| (c) suites | 71 suites, 1,563 tests, 100%: isolation, scheduler, schedulerSwitch, authorizationWiring and publicBaseUrl |
| (d) live PostgreSQL 18.6 as `callibrator_app` | **15/15** (`live-jobcontext.js`). A `runForTenant(A)` job never reads or writes B, and `runAsSystem` refuses an unlisted reason. As built, a create naming B inside an A job is stamped A |

**Live suites on PostgreSQL 18**

| Suite | Result |
|---|---|
| `backgroundJobs.w12` | 8 passed |
| `calibrationScheduler.w03` | 3 passed |
| `batch.w17` | 2 passed |
| `tenantHookless.w34` | 6 passed |
| p803 migration lock (on `callibrator_p9_scratch`) | 4/4, including "npm run migrate WAITS for a held lock" (5,077 ms) |

**Named tests**

| Test | Result |
|---|---|
| `iot.validator.contract.test.ts` | passes **unchanged** |
| `env.p906.test.ts` | 4/4, and it **bites**: with `envOr` switched to `??`, 1 of its 4 tests fails |
| `activityLog.a14.stdout` | passes |

**The boundary**

| Check | Result |
|---|---|
| `npm run test:coverage -- --ci --forceExit` | **698 of 722 suites passed (24 skipped), 13,052 tests (155 skipped), 100% on all four measures**. The run preceded `env.p906.test.ts`; `src/config/` is outside the coverage figure (ADR-085) |
| TypeScript 7 `--noEmit` | clean |
| `node scripts/ci/eslint-ratchet.js` | 0 errors, baseline 0 |
| `npm run ratchet` | floor 1165 |
| `npm run build:dist` | 431 JavaScript files copied, 52 TypeScript files compiled |

**Docker, end of round**

- **Stack:** the P9-00 scratch stack, compose project `callib-p9r6`, on Node 26.10.0-alpine, with pgvector pg18, Redis and RabbitMQ; a fresh-secret `.env`; `DB_APP_ROLE=callibrator_app`.
- **Boot:**
  - schema-verify OK (72 tables, 867 columns, 8 control objects);
  - the application role `callibrator_app` in effect;
  - 171 `dynamicAccess` gates validated;
  - `/health` returned 200.
- **Seed and login:** seeding returned 200, and the seeded super admin logged in.
- **Restart:** "roles table agrees with ROLE_LEVELS for 11 seeded role(s)".
- **Cleanup:** `down -v --rmi local`; no container, image, network or volume is left, and the `.env` was deleted.

## Open

- **P9-06 part 2:** the Zod schema over every variable, and a boot that fails listing every problem. It changes behaviour, so it is its own change. The unconverted `.js` still read `process.env` directly.
- **`authorizationWiring`** scans `routes/api/*.route.js` only and reads `seedMenuGroups.util.js` by name. It must learn `.ts` before routes (P9-21) and `seedMenuGroups` (after P9-10) convert.
- **The six utils left** each wait on another card: `kmsVerify` (P9-18), `jwt` (P9-12), `generateSwagger` (P9-21), and `checkMenu`, `session` and `seedMenuGroups` (P9-10).
- **Nothing is committed.** Every change is in the working tree.
