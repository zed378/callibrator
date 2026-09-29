# 2026-09-28 — Phase 9: the logger and the tenant context are TypeScript (P9-05a), plus two logger-dependent utils

**ADR:** [ADR-087 Amendment 2](../DECISIONS.md) · **Cards:** P9-05a done; P9-05 and P9-09 (group b) advanced · **Tree:** HEAD `35ebd76` plus the shared working tree. Helpers 1 and 2 were working in it at the same time; helper 2's 12 `utils/` conversions landed during this round. Continues [`2026-09-28-p9-ratchet-constants-paths.md`](./2026-09-28-p9-ratchet-constants-paths.md).

## What changed

| Area | Files |
|---|---|
| Converted | `src/middlewares/activityLog.middleware.ts`, `src/middlewares/tenantContext.middleware.ts`, `src/utils/dbReady.util.ts`, `src/utils/circuitBreaker.util.ts` |
| Shared types | `src/types/express.d.ts` (`requestId`, `user`, `tenantId` on `Request`), `src/types/ids.ts` (`TenantId`) |
| Test changed (named) | `src/tests/routes/tenantHierarchy.visibility.q05.test.js` reads `tenantContext.middleware.ts`. Its assertions are unchanged |
| Docs | ADR-087 Amendment 2; `docs/ENGINEERING/09-TESTING-CONVENTIONS.md` (new tests are `.ts`); the P9-05, P9-05a and P9-09 cards (the P9-05a DoD line is amended so the store keeps `null`); `TASKS/PROGRESS.md`; the as-built banner in the standards doc; `CLAUDE.md` |

Every converted file had no uncommitted change from another agent (`git status --porcelain`) when it was converted.

## Evidence

**Lint and type checks**

| Check | Result |
|---|---|
| `npm run typecheck` (TypeScript 7) | exit 0 after each step |
| `npx eslint` on each converted file | 0 problems. Line-level directives each carry a reason: `process.env` read at load until P9-06; `||` as built; the template interpolation of an unknown `.message` |

**tenantContext's four gates**

| Gate | Result |
|---|---|
| (a) q05 guard | The guard fails when a line naming "hierarchy … descendants" is planted in the `.ts` file: "1 failed, 11 passed". It passes (12) with the line removed |
| (b) identity | 80 checks identical (scratch `p9/compare2.js`). This covers 15 request shapes, including two PLATFORM contexts, plus the no-context and nested cases |
| (c) isolation suites | 39 suites, 1,192 tests passed. They are listed in ADR-087 Amendment 2 |
| (d) live PostgreSQL 18.6 as `callibrator_app` | 13/13 checks passed (scratch `p9/live-two-tenant.js`, output quoted in the ADR). The first run had a wrong assertion: it expected "asking for B's `tenantId` returns nothing", but as built the hook replaces that id with A's, so A gets its own rows. I corrected the assertion to "never a B row". No code changed |

**Identity checks on the other conversions**

| Module | Result |
|---|---|
| activityLog | 392 checks identical (scratch `p9/compare3.js`). It compares, under 7 environment variants: the logger configuration, 10 records × 3 request contexts through both formats (key order included), 10 URLs, 11 keys, and 3 requests through the middleware |
| dbReady | 15 checks identical (scratch `p9/compare4.js`) |
| circuitBreaker | A 22-step trace, identical (scratch `p9/compare5.js`), including late binding of `getBreaker` |

**Tests and full runs**

| Check | Result |
|---|---|
| Own suites | activityLog: 4 suites, plus the guards (10 suites, 97 tests), `activityLog.middleware.ts` at 100% · dbReady: 13 tests, 100% · circuitBreaker: 173 tests across its own suite, clamAv and meteredBilling, 100% |
| Full run, with tenantContext converted | Every suite passed. Coverage was 99.62%, but only because helper 2's five `utils/*.ts` files sat beside their `.js` twins mid-conversion, so the `.ts` files went unmeasured |
| **Full run at this boundary** | `npm run test:coverage -- --ci --forceExit` exit 0. 642 of 666 suites passed (24 skipped), 12,808 tests passed (155 skipped), **100/100/100/100**, 167 s |
| `npm run ratchet` | 1183 `.js` files, at the floor |

**Docker (end of round)**

| Check | Result |
|---|---|
| `docker build -f backend/Dockerfile .` (node:26.10.0-alpine) | exit 0; "build-dist: 446 JavaScript files copied, 35 TypeScript files compiled -> dist/"; pkg `node26-linux-x64` |
| Image boot (pg18, redis 8.6, rabbitmq 3.13 at CI's digests; `DB_APP_ROLE=callibrator_app`) | `/health` **200** `{"status":"ok"}` after 11 s. 63 migrations (to `0090`) ran. The log shows "Authorization wiring validated: 171 dynamicAccess gate(s), 11 role-menu assignment(s), 12 role name(s)", then "Database queries now run as the application role "callibrator_app"", then "Server running on port 3000". Templates, `swagger.json`, `docs` and `public` are present. Containers, network and image were removed afterwards |

## Not converted, and why

- `generateSwagger`: it imports `docs/*`, which is JavaScript (P9-21).
- `upload`: it imports `fileValidation`, which is JavaScript with another agent's uncommitted change.
- `tenantScope`: the next step. It needs the same four gates, and before that the `.js`-only guards must learn `.ts`.
- `constants/routeGateExemptions`: still has another agent's uncommitted change.

## Found

**Source-walking guards ignore `.ts`.** Helper 2 found this and I confirmed it: 17 guard suites filter on `.js`, so each conversion silently removes its file from those guards. Nothing is lost for the files converted so far. But it must be fixed before tenantScope, the models, services and routes convert (ADR-087 Amendment 2).
