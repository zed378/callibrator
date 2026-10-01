# 2026-09-29 — P9-11 DONE: the validators are Zod, and Joi is gone

**ADR:** [ADR-093](../DECISIONS.md) · **Card:** P9-11 (`TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`) · **Spec:** [`MEMORY/specs/P9-11-validation-error-contract.md`](../specs/P9-11-validation-error-contract.md) · **Agent:** P9-11 helper, with four test-rewrite sub-agents · **Tree:** HEAD `ce74932` plus the working tree of 2026-09-29. The Phase 9 lead (P9-10, P9-07, then P9-12) and other agents were editing it at the same time. What each check ran on is stated below.

## What was decided

The spec and the orchestrator first required the validation 400 to stay **byte-compatible**. Native Zod cannot do that. Its wording differs, and it also *accepts* different inputs from Joi. A Joi re-implementation on top of Zod was prototyped, then withdrawn.

The **owner** then decided:
- Joi → Zod everywhere, in one change, and `joi` is removed.
- The 400 keeps its status, envelope and top-level `message`, and `details` still appears only outside production.
- The wording inside `details` may change, and every changed string is listed.

ADR-093 records the decision, the table of changed strings and the consequences.

## What changed

| Area | Files |
|---|---|
| Validators | `backend/src/validators/*.validator.ts`: 38 converted from `.js`. `iot.validator.ts` moved from Joi to Zod. `audit` and `webauthn` are **deleted**: they exported only the dropped helper, and nothing imported them. New: `calibrationDeviceReinstate.validator.ts` (the schema moved out of its service), `fields.ts` (explicit conversions, email, uuid, case-insensitive enums) and `input.ts` (`validateInput`, `checkInput`, `fieldErrors`) |
| Middleware | `middlewares/validation.middleware.ts` replaces the `.js`. It provides `validate(schema, { from })`: the path wins in a merge, `req.validated` is set, and `validated(req, schema)` reads it back typed. `src/types/express.d.ts` gains `validated?: unknown` (the lead's file, edited with its consent) |
| Surface B | `routes/api/meteredBilling.route.js` mounts `validate(...)` and `validate(..., { from: "query" })`; `validateBody` / `validateQuery` are gone |
| Surfaces C and E | controllers: auth, calibrationDevices, calibrationRecords, certificate, certificatePdf, dataRetention, featureFlag, iot, menuGroup, networkSecurity, oidcProvider, scim, sso, stock, tenant, tenantHierarchy, tenantLifecycle, user, warehouse. Services: auth, calibrationDevices, calibrationDeviceReinstate, calibrationRecords, certificate, gdpr, stock, tenant, user, warehouse |
| `utils/jsonShape.util.ts` | the 14 shapes are Zod, and the D-27 types are `z.infer` (the lead's file, cleared by the lead) |
| Dependencies | `zod` `^4.6.5` added to `backend/package.json`; `joi` uninstalled; `package-lock.json` changed |
| Tests, new | `tests/middlewares/validation.p911.test.ts`, `tests/validators/fields.p911.test.ts`, `tests/validators/iot.validator.p911.test.ts`, `tests/guards/schemaAsMiddleware.p911.test.ts` |
| Tests, rewritten | the 38 contract suites plus `middleware.contract` and `harness.ts`; `bodylessBody.a09` (now it guards the one-helper rule); `swaggerValidatorAlignment.p608` (reads Zod shapes); `enumMirrors.d26` (reads `z.enum`); `liveContract.smoke` (restates Zod messages, uses `z.toJSONSchema`); every `tests/validators/*.test.js`; `middlewares/validation.test.js`; and 12 controller and 18 service test files |
| Tests, deleted | the `audit` / `webauthn` validator and contract suites; `validators/meteredBilling.middleware.test.js` |
| Docs | `docs/BACKEND/03-VALIDATION.md` (amended; ADR-093); `TASKS/AUDIT-2026-09-REMEDIATION.md` (A-272, A-273, A-274); the P9-11 card; `TASKS/PROGRESS.md` |
| Comments | every mention of Joi in `backend/src` and `backend/index.js` is reworded. The lead reworded the ones in its own files (`appError.util.ts`, `modelTypes.p910.test.ts`). `scripts/generate-illustrations.js` labels now say Zod |
| Ratchet | `backend/.ts-ratchet.json` floor 1106 → 1092 (with the lead's models) → **1050** |

## Evidence

| Check | Result |
|---|---|
| Contract suites, `npm test -- src/tests/contracts/validation` | **39 suites, 45 tests passed** |
| Differential, Joi at `HEAD` (scratch `p911/old/`) against Zod, `abortEarly: false`, `stripUnknown: true` (scratch `p911/differential.ts`) | 155 schemas, **232,655 payloads**; every acceptance difference is a braced or unhyphenated uuid, or an email TLD outside the IANA list (**0 unexplained**) |
| `jsonShape` / iot tolerance, against the Joi originals (scratch `p911/compare-jsonshape.ts`) | **1,022 checks, 0 differences** (confirmed independently by the lead's model harness) |
| Validator figures | the 39 modules, `fields.ts` and `input.ts` at **100/100/100/100** |
| Full gate, `npm run test:coverage -- --ci --forceExit` | exit 0: **700 of 724 suites passed (24 skipped), 13,272 tests passed (155 skipped), 100/100/100/100** |
| Typecheck, lint, ratchet | TypeScript 7 clean; `npx eslint src/` **0 errors**; ts-ratchet at the floor of 1050 |
| Packages | `npm audit` **0**; `npm ls --all` exit 0; `npm ls joi` empty; `grep -rnwi joi backend/src backend/index.js` empty |
| Live E2E, first image, from the tree at 09:41Z (P9-00 method; project `callib-p911`; `127.0.0.1:25100`; fresh named volumes; seeded) | run A failed 1 test: `http` › oversized email answered 401, where Joi answered 400 → fixed with the email length limits. Runs B and C: **53/53 specs, 392 tests**, per spec **equal to P9-00** |
| Live E2E, final image, from a snapshot of the working tree at 10:05Z | runs D (10:32Z) and E (10:34Z): **53/53 specs, 396 tests, 0 failed**. Per spec equal to P9-00, except `certificates` with 12 tests where P9-00 had 8: another agent added those four in the working tree, and all pass. Access log over D and E: 0 × 429; the only 5xx were 2 × `POST /ai/query` 500 (no AI provider, as in P9-00) |
| Frontend `npm test` | 157 suites, 1,408 tests passed |
| Teardown | `down -v --rmi local`: no container, volume, network or image left; the scratch `.env` and the snapshot were deleted |

The final image was built from a snapshot rather than the live tree. The lead was mid-P9-12, and the live tree refused `build:dist` because `utils/jwt.util` existed as both `.js` and `.ts`. The snapshot drops the in-flight `.ts` half. At copy time no dual module remained.

## Findings

- **Differences removed before landing**, found by the differential, the test agents and the E2E run:
  - a whitespace `lastName` now trims to `""`, as before;
  - `addDomain.domain` accepts IP addresses again;
  - `numeric` refuses unsafe numbers;
  - `email()` accepts `%`, `!` and `#` in the local part, which Zod's default refused, and holds RFC 5321's length limits.
- **Differences kept**, all listed in ADR-093:
  - braced or unhyphenated uuids are refused;
  - an email TLD is no longer checked against the IANA list;
  - four loose ISO-date spellings are refused;
  - list-query `status` filters are case-folded;
  - `calibrationDate` defaults to a Date, not a millisecond number;
  - a webhook url spelt `HTTPS://` is accepted;
  - a duplicate webhook event is reported at `events`.
- **A test that proved nothing:** `certificatePdf.controller.test.js` "should generate PDF" passed through the error path. Its fake schema made validation throw, so the service never ran. It now asserts the service call and the 200 (controller-tests agent).
- **Noticed in passing, not fixed** (outside this card):
  - `user.service` imports `checkUsernameSchema`, which does not exist; the validator exports `usernameCheckSchema`. It is unused;
  - `user.service` reads `createdBy` / `updatedBy` from the validated value, where the schemas strip them. It works around this with `input.*`.

## Open

- **A-272:** surface D drops the field list.
- **A-273:** three controllers let the body win over the path.
- **A-274:** the unused `includeDeleted` scopes.
- The P9-22 helper plans to move `fields.ts`, `vendor` and `calibrationDevices` into `packages/contracts` (its ADR-095), re-exported from the same backend paths.
