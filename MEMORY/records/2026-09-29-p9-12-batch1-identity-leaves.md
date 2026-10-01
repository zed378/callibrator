# 2026-09-29 — P9-12 batch 1: jwt.util, and the session, webauthn, userPermission and roles services are TypeScript

**ADR:** [ADR-087 Amendment 13](../DECISIONS.md) · **Card:** P9-12 IN PROGRESS (batch 1 of 3) · **Tree:** HEAD `ce74932` plus P9-10, P9-07 and P9-11 (uncommitted), with other agents working in parallel (listed in the ADR, §9).

## What changed

| Area | Files |
|---|---|
| Converted (`.js` removed after `cmp`) | `src/utils/jwt.util.ts`, `src/services/session.service.ts`, `src/services/webauthn.service.ts`, `src/services/userPermission.service.ts`, `src/services/roles.service.ts` |
| Declarations for still-JavaScript dependencies | `src/services/redis.service.d.ts`, `src/services/audit.service.d.ts`. Each is `export =` of the module's exact export object and is deleted when that module converts. |
| Shared types | `src/types/auth.ts` (new).<br>`src/types/sequelize.d.ts`: `skipTenantScope` on every scoped operation's options.<br>`src/types/express.d.ts`: `impersonatorId`, and `role.roleLevel` / `role_level`, both for P9-19. |
| Tests | `tests/services/unboundedFindAll.d24.test.js`: 7 allow-list keys re-keyed from `.js::` to `.ts::` (the only test change).<br>New guard: `tests/guards/declarationDrift.p912.test.ts`. |
| Config | `backend/jest.config.js`: `!src/**/*.d.ts` in `collectCoverageFrom`. |
| Packages | `@types/jsonwebtoken@^9.0.10` and `@types/qrcode@^1.5.6` (devDependencies). `npm audit` reports 0, and neither has install scripts. |
| Findings | `TASKS/AUDIT-2026-09-REMEDIATION.md`: A-285, A-286, A-287 |

## Evidence

- **Export surface: identical for all five.** `p9/compareSurfaceSrc.js` compared the original JavaScript and the converted module, with both sharing every dependency instance. It checks key order, descriptors, `typeof`, function `length` and `name`, class statics and `__esModule`. The one accepted change is that anonymous `exports.x = () => {}` functions are now named after their key: 11 in session, 4 in userPermission.
- **jwt.util behaviour: 1,223 checks over 8 key-ring configurations, identical** (`p9/compareJwt.js`). The harness is bite-tested with 4 plants, all detected. One of them (kid selection removed) was first missed, which led to adding a token signed by the previous key that names the current key's `kid`.
- **Suites, unchanged apart from the d24 re-key; each module at 100 / 100 / 100 / 100:**

  | Module | Suites | Tests |
  |---|---|---|
  | jwt.util | 50 | 941 |
  | session | 50 | 843 |
  | webauthn | 6 | 113 |
  | userPermission | 40 | 1,026 |
  | roles | 40 | 806 |

- **Checks:** the typecheck is clean, ESLint reports 0 errors on every file in this batch, and ts-ratchet moved from 1045 to 1035.
- **Declaration drift guard:** on its first run it found that `audit.service.js` had gained two constants (another agent's change) that the new declaration did not name; the declaration now names them. A plant removing a key fails the guard.

## Not green in the tree at this boundary (other agents' in-flight work)

- **Full `test:coverage`:** 99.74 / 99.5 / 99.68 / 99.75. The failing suites are stripeWebhook ×3, signingKeyWrap.s08, schedulerSwitch.w02, audit.platform.a125 and audit.service. Coverage gaps are in stripeWebhook.service.js, audit.service.js and auditPrincipal.util.ts. None of these touches this batch.
- **ESLint ratchet:** 18 new errors, all in other agents' new files (the oidc/scim tests, metricsAuth, denyPlatformAuthoring, a stripeWebhook test).
- **`dist`:** it builds but does not load, because `@callibrator/contracts` resolves to TypeScript source until the P9-22 build step lands.

## Left in P9-12

- **Batch 2:** `user.service` (1,889 lines) and `auth.service` (2,088 lines).
- **Batch 3:** `apiKey`, `sso`, `scim` and `oidcProvider`, now released after A-275/A-278/A-280 (ADR-094).
- **At the end of the round:** the full gate on a quiet tree, and the P9-00 E2E baseline against the image.
