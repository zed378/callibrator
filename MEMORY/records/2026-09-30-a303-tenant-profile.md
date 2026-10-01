# 2026-09-30 — A-303: the tenant profile is stored, validated, and printed as the certificate issuer

**Decision:** made by the **coordinating session under the owner's delegation to decide by best practice**, recorded here as that. The owner has not confirmed it yet. No ADR: this adds columns to a table; the architecture is unchanged.
**Audit:** A-303 (TASKS/AUDIT-2026-09-REMEDIATION.md), found while fixing A-296 ([2026-09-29-multipart-sanitizer.md](./2026-09-29-multipart-sanitizer.md)).
**Open question raised:** Q-50 (TASKS/BACKLOG.md), on whether the hash binds the issuer.
**Tree:** HEAD `ce74932` plus uncommitted parallel work.

## The defect

`PATCH /tenants/edit` and `POST /tenants/create` accepted `description`, `phone`, `address`, `city`, `state`, `zipCode`, `country` and `website`. `tenant.service` wrote them, and the tenant form sent them. None of them was a Tenant attribute or a `tenants` column, so Sequelize dropped every one while the 200 said the edit had worked. The A-295 / Q-35 defect class again.

## The decision

- **Add the columns.** ISO/IEC 17025 7.8.2 requires the issuing laboratory's name and address on every certificate, so a tenant must be able to store them. The columns also serve invoices and the request-access flow.
- **`maxUsers` is not a tenant-edit field.** It is a plan/quota value the platform sets. It was never an attribute either: the seat limit is `limitSeats`, so even a super admin's edit of it stored nothing.
  - The house contract for an unknown body key is to **strip** it (`validators/input.ts`: "unknown keys stripped"), so it is stripped, not refused with a 400.
  - A tenant admin sending `maxUsers` used to get a 403 (A-63). It now gets a 200, and nothing about seats is written. A tenant still cannot raise its own seats; it never could, because nothing was ever stored.

## What changed

**Backend.** Model, validator and service:

| File | Change |
|---|---|
| `models/tenant.model.ts` | 8 attributes, following the Amendment 7 pattern: `description` TEXT, `phone` VARCHAR(50), `address` TEXT, `city` / `state` VARCHAR(100), `zipCode` VARCHAR(20), `country` VARCHAR(100), `website` VARCHAR(255). All nullable, and typed `string \| null` in the interface. The hooks are untouched |
| `validators/tenant.validator.ts` | One `profileFields` block, shared by create and update. Rules:<br>• `website`: `z.url({ protocol: /^https?$/ })`, max 255. Plain `z.url()` accepted `javascript:`, `data:` and `ftp:`.<br>• `phone`: digits and `+ ( ) . - /`, an optional `ext.`/`x` extension, 6–20 digits, max 50.<br>• `city`, `state`, `zipCode`, `country`: capped at their column lengths, so an over-long value is a 400, not a PostgreSQL 500.<br>• `maxUsers`: removed from `updateTenantSchema`; `createTenantSchema` is unchanged |
| `services/tenant.service.js` | `updateTenant` no longer reads or writes `maxUsers`. `PLATFORM_CONTROLLED_FIELDS` is now `["status"]`. The P9-12 lead cleared this edit before it snapshots the file for P9-13 |

**Backend.** Migration:

| File | Change |
|---|---|
| `migrations/0102-tenant-profile-columns.ts` | New migration. It uses the next free number at write time: 0100 and 0101 were taken while this work ran. It describes the table first and adds each column only if missing, so a rerun changes nothing. It has one narrow catch ("table does not exist"); anything else re-throws. It has a `down`, which is idempotent too |
| `config/migrator.js` | One manifest line after 0101 |

**Backend.** Certificate document and API docs:

| File | Change |
|---|---|
| `services/certificateDocument.service.ts` | The document gains `issuer: { name, email, phone, address, city, state, zipCode, country, website } \| null` (`toIssuer`), and the tenant include loads those columns (`ISSUER_ATTRIBUTES`). `issuedBy` is kept. **Neither hash changes** (see below) |
| `routes/api/tenant.route.js` | The OpenAPI text for `/edit` only: `maxUsers` removed, and the new rules stated |

**Frontend:**

| File | Change |
|---|---|
| `lib/certificatePdf.ts` | `issuerLines(issuer)` builds two lines. The address line is "street, city, province postcode, country"; the contact line is "Tel. … \| email \| website". They are printed under the issuer name in place of the "CALIBRATION MANAGEMENT SYSTEM" tagline, which is kept when there is no issuer or nothing to print, as with an older backend.<br>Following the ADR-095 follow-up agent's rules, the lines go through `t(...)` in the embedded Unicode font. A long line is set smaller, down to 6 pt, before it would wrap into the header rule. |
| `api/services/calibration.service.ts` | Adds the `CertificateIssuer` type, and `issuer?` on `CertificateDocument` |
| Edit tenant form | The Max Users input is removed from `EditTenantModal.tsx`, and `maxUsers` from the edit state and payload (`hooks/useTenants.ts`, `stores/tenantStore.ts`, `api/services/tenant.service.ts#update`).<br>The profile fields are now sent even when emptied (`""`), because a stored field must be clearable. Email is still sent only when set: the model validates it as an email, so `""` would fail. |

## The hash: not bound (Q-50, for the owner)

> **Superseded 2026-09-30:** the owner's delegate decided (b) — see the Follow-up section below and ADR-107.

The coordinator's instruction was that v2 should bind the issuer address if it is printed. **This was not done.**

- **The service's own rule.** `certificateDocument.service` already declines to hash the tenant name, for a stated reason: names are printed from the LIVE rows, and binding them "would make a later rename look like tampering." An address is the same kind of value.
- **What binding it live would cause:** every signed certificate would fail verification the day the laboratory updates its address.
- **What changing the v2 payload would cause:** every v2 hash already printed would change.

Binding it correctly needs a **snapshot of the issuer on the certificate at signing** (new certificate columns) and a **v3** scheme over it, with v1 and v2 still verifiable. That is a design decision with a migration, so it is Q-50 and was not built here.

As built, a printed address is the laboratory's current address, and neither hash covers it. `certificateDocument.issuer.a303.test.ts` pins that a change of address changes no hash.

## Evidence

**Fail-before, on the unchanged code:** `routes/tenant.profile.a303.test.ts` failed 16 of 18 (profile fields not stored; `javascript:`/`ftp:`/`data:` websites and junk phones accepted; a tenant admin's `maxUsers` answered 403). `services/certificateDocument.issuer.a303.test.ts` failed 3 of 4 (no `issuer` in the document).

**New tests:**

| Suite | Tests | What it covers |
|---|---|---|
| `backend/src/tests/routes/tenant.profile.a303.test.ts` | 18 | The REAL tenant router, dynamicAccess, controller, tenant service and audit service on `memoryDb`:<br>• the profile is stored and audited; a partial edit keeps the other fields; `""` clears a field;<br>• website and phone are refused or accepted by the rules above;<br>• `maxUsers` is stripped for a tenant admin and for a super admin |
| `backend/src/tests/migrations/0102-tenant-profile-columns.test.ts` | 9 | The manifest entry; the columns equal the model's own underscored fields, types and lengths; idempotent up; up adds only what is missing; skips when the table is absent; failures propagate; down; no blanket catch |
| `backend/src/tests/services/certificateDocument.issuer.a303.test.ts` | 4 | The issuer block; `null` or sparse input; no hash changes; the include loads `ISSUER_ATTRIBUTES` |
| `frontend/src/lib/certificatePdf.issuer.a303.test.ts` | 7 | `issuerLines`; the Helvetica fallback prints both lines and drops the tagline; the tagline is kept with no issuer; a Vietnamese address prints exactly in the embedded font (ToUnicode decode); a long line is set between 6 and 8 pt, not wrapped |

**Tests updated for the decision**, each change pinning the new rule rather than deleting it:
- backend: `tenant.edit.a63` (a tenant admin's `maxUsers` → 200 and unchanged; the super admin's status still works, its `maxUsers` is stripped); `tenant.service.coverage` (the 403 now names `status` only, plus a new strip test); `tenant.validator.test` (maxUsers stripped; the website message); `certificateDocument.service.m11` (the document now carries `issuer`);
- frontend: `useTenants.test` (no `maxUsers`; an emptied field is sent as `""`); `tenant.service.test` (a new FormData test: `""` is sent, an absent field is not, `maxUsers` never); `tenants/__tests__/page.test.tsx` (no Max Users input; the payload has no `maxUsers`, and an emptied website is sent as `""`).

**PostgreSQL 18.6** (`pgvector/pgvector:pg18`, a disposable container `a303-pg18`, removed afterwards), driven by a scratch tsx script through the real Sequelize QueryInterface:
- **Upgraded database** (a `tenants` table without the columns):
  - `up` added the 8 columns (`\d tenants` above: `description text`, `phone varchar(50)`, `address text`, `city`/`state varchar(100)`, `zip_code varchar(20)`, `country varchar(100)`, `website varchar(255)`, all nullable);
  - a second `up` changed nothing;
  - `down` removed exactly those 8;
  - `up` again restored them.
- **Fresh database:** `Tenant.sync()` from the model created the same 8 columns, with the same types and lengths (`information_schema.columns`). A `create` and `findByPk` through the model round-tripped every profile field.
- **Role:** not run as `callibrator_app`. This is DDL, which migrations run as the owner.

**Boundary checks:**
- **Backend affected suites:** 465 tests passed across `services/tenant.service*`, `routes/tenant*` and `validators/tenant*`. The certificate suites passed 64 of 64 (`certificateDocument*`, `certificatePdf.controller`, `certificateVerify*`). `src/tests/models`, including `modelTypes.p910`, `includeRequired.d12` and `unscopedModels.d17`, passed except `associationForeignKeys.a148` (certificates.submitted_by, another agent's in-flight work). `guards/auditInTransaction.p611` fails on `contentMedia.service`, which another agent is converting.
- **Frontend:** 98 suites and 1,069 tests passed across `dashboard/tenants`, `lib`, `api/services`, `app/verify`, `stores`, `dashboard/certificates` and `a11y.adr090`.
- **Backend `npm run typecheck`:** 0 errors, on a run where it counted `error TS` lines.
- **Frontend `npm run typecheck`:** one error, in `dashboard/menu-groups/page.tsx`. That is another agent's file; none of mine reports an error.
- **ESLint:** 0 errors on every changed file in both workspaces. The warnings in `tenant.service.js` and `tenant.service.coverage.test.js` were already there.
- **`npm run ratchet`:** passed, "926 .js file(s), at the floor". No `.js` file was added.
- **Full backend `test:coverage`:** see the addendum.

## Found, not fixed

> **Fixed 2026-09-30:** see the Follow-up section below (seat limit).

- **`maxUsers` on create and on the access-request approval is still dropped.** `createTenantSchema` defaults it to 10 and `createTenant` writes it, and `accessRequest.service.ts:561` passes it. None of those is stored, because the seat limit is `limitSeats`.
- **`getTenantUserCount` returns `maxUsers: tenant.maxUsers` (always `undefined`) and a `remainingSlots` computed from it.** That is NaN: `Math.max(0, undefined - n)` evaluates to NaN.
- **Both bullets need one decision:** map `maxUsers` onto `limitSeats`, or remove it everywhere. That is the platform-quota owner's call. It was not changed here.

## Addendum — `backend/openapi.json` and the full coverage run (2026-09-30)

**`backend/openapi.json`** (the committed contract that `/docs` serves) was edited by hand for `PATCH /api/v1/tenants/edit` only: the description was changed and the `maxUsers` property removed, to match the route's JSDoc. It was not regenerated, because a regeneration would also pull in other agents' in-flight routes (access requests, `authPublic`).

`swaggerValidatorAlignment.p608` and `openapiRoutes.p925` still fail. Their diffs name only those other routes, and nothing from the tenant routes.

**Full `npm run test:coverage -- --ci`, on a busy tree:**

| Measure | Result |
|---|---|
| Suites | 739 passed, 24 failed, 28 skipped |
| Tests | 14,041 passed, 53 failed |
| All files | 99.95 / 99.9 / 99.93 / 99.95 |
| Files changed here | 100/100/100/100: `tenant.service.js`, `tenant.validator.ts`, `upload.util.ts`, `globalSanitizer`, `accessLog` |

**`certificateDocument.service.ts` was 99.07% branches** (line 175: a tenant row with no name). A test was added for it (`certificateDocument.issuer.a303` › "a tenant row with no name gives a null name"). The certificate suites then passed, 44 of 44.

**The 24 failing suites belong to other agents' in-flight work:**
- `auditInTransaction.p611` and `contentMedia` (a `.js` file converted mid-run);
- `associationForeignKeys.a148` (`certificates.submitted_by`);
- the OpenAPI/route guards (`p925`, `p608`, `p604`, `a127`, `a253`, `admin.route`), which name the new access-request and `authPublic` routes;
- `signInPolicy`, `mfa.rotation`, `password`, `publicAuth`, `sso.oidcRoundTrip`, `webhook*`, `workflow.service`, `schedulerSwitch`, `unboundedFindAll`, `activityLog.a14`, `user.passwordReset`, `auth.mfaManageRateLimit`, `scim.userAudit`.

**`tenantBackup.twoTenant.test.ts` failed during the full run and passed on its own right after.** Under that load the suite took 173 s, so it was a timeout.

## Follow-up 2026-09-30: two coordinator decisions, implemented

Both are **working decisions by the coordinating session under the owner's delegation to decide by best practice**, and both await the owner's confirmation.

### Q-50: the issuer is snapshot at signing, and v3 binds it (ADR-107)

The full decision, alternatives and bad implications are in [ADR-107](../DECISIONS.md). In short: what a certificate prints (the issuer name, address and contact; the instrument; the people) is snapshot into the new `certificates.signed_snapshot` column (migration **0103**) during the sign transaction. From then on the certificate is printed from the snapshot and hashed under `certificate-content-v3`. A certificate signed before this has no snapshot and stays v2, exactly as before: nothing is back-filled.

What changed:

| File | Change |
|---|---|
| `backend/src/migrations/0103-certificate-signed-snapshot.ts` | New migration: `signed_snapshot` JSONB, nullable, no default, no back-fill. It has one narrow catch that re-throws anything else, and a down. It is in the manifest after 0102. The number was 0103 at write time |
| `backend/src/models/certificate.model.ts` | New `signedSnapshot` attribute, with its D-27 validator. The hooks are untouched; the P9 lead cleared the edit |
| `backend/src/utils/jsonShape.util.ts` | New entry `Certificate.signedSnapshot`: strict and versioned. Exports the `CertificateSignedSnapshot` type |
| `backend/src/services/certificateDocument.service.ts` | Adds `INTEGRITY_SCHEME_V3`, `canonicalSnapshot` (a fixed key order), `buildContentPayloadV3` and `computeContentHashV3`, and `captureSignedSnapshot`.<br>`toCertificateDocument` prints from the snapshot when one exists, and adds `contentAsOf: "signing" \| "live"`.<br>v2's payload is unchanged: the same keys in the same order, now built by a shared `contentFields`. |
| `backend/src/services/certificate.service.js` | `signCertificate` sets `signedSnapshot` after the signer, before the one save in the sign transaction |
| `backend/src/services/certificatePdf.service.js` | In the verify verdicts, `issuedTo` and the full verdict's `device` now come from the document, so they are snapshot-aware. The include loads the issuer columns. The minimal/full split, the token check and the minimal field list are unchanged: the security agent's A-293 conditions, confirmed with it first |
| `frontend/src/lib/certificatePdf.ts` | A v3 certificate prints "Issuer, instrument and signatories as recorded at signing." under its hash, through `t()` in the sans font, following the ADR-095 follow-up agent's rules. It had finished with the file |
| `frontend/src/api/services/calibration.service.ts` | Adds `contentAsOf`; the `scheme` doc now names v3 |

The verification page needed no change: its integrity label already interpolates `data.integrity.scheme`, and the backend now sends v3 there.

### The seat limit: `limitSeats` is the single source

`maxUsers` was never a Tenant attribute; the seat limit is `limitSeats`, which `quota.service` enforces.

Before the change:
- Tenant create wrote `maxUsers || 10`, which was dropped, so every tenant got the model default of 5 whatever the operator entered.
- `POST /tenants/user-count` answered `maxUsers: undefined, remainingSlots: NaN`.
- The tenant card showed an empty "Max Users".

What changed:

| File | Change |
|---|---|
| `backend/src/validators/tenant.validator.ts` | `createTenantSchema` takes an optional `limitSeats` (an integer of at least 1, or `null` = unlimited). `maxUsers` is gone, and as an unknown key it is stripped |
| `backend/src/services/tenant.service.js` | `createTenant` writes `limitSeats` only when given (otherwise the model default applies), and its audit row records it.<br>`getTenantUserCount` returns `{ tenantId, userCount, limitSeats, remainingSlots, unlimited }`. A null or negative limit is unlimited (quota.service's rule), and both numbers are then null. `remainingSlots` is floored at 0.<br>P10-05's outer-transaction option is intact (`phase10.units.p1005`, `accessRequest.service.p1005`). The P9 lead was told when I finished with the file |
| Access-request approval | No change needed: the Phase 10 lane had already removed `maxUsers`, and the default of 5 is acceptable to it |
| `backend/src/routes/api/tenant.route.js`, `backend/openapi.json` | The create body documents `limitSeats`, not `maxUsers` (hand-edited, as before) |
| Frontend | Create modal and `TenantFormFields`: "Seat limit" (`limitSeats`, empty means the plan default). `useTenants` and the create payload in `tenantStore` and `tenant.service` send `limitSeats`. `TenantCard` shows `limitSeats`, or "Unlimited". `Tenant.limitSeats` replaces `maxUsers` in `types/index.ts`, and `TenantUserCount` has the new shape |

### Evidence for the follow-ups

**Fail-before, on the code as it stood:**
- `backend/src/tests/routes/tenant.seats.limitSeats.test.ts` failed 11 of 12:
  - `limitSeats` was stripped, so 25 was stored as 5;
  - `limitSeats: 0` got a 201, not a 400;
  - user-count gave NaN (null), and nothing reported unlimited.
- `backend/src/tests/services/certificateDocument.snapshot.q50.test.ts` failed 9 of 10.
- `backend/src/tests/routes/certificates.signSnapshot.q50.test.ts` failed 3 of 6. Signing stored no snapshot, it printed live, and a rename changed the signed document. Its later verify case was **planted** instead: with `issuedTo` restored to the live name, it failed 1 of 8, and the file was restored and checked with `cmp`.

**Now passing:**

| Suite | Tests |
|---|---|
| `tenant.seats.limitSeats` | 12 |
| `certificateDocument.snapshot.q50` | 10 |
| `certificates.signSnapshot.q50` | 8 |
| `migrations/0103-certificate-signed-snapshot` | 6 |
| frontend `TenantCard.seats` | 4 |
| frontend `certificatePdf.issuer.a303` | 9 |

**Updated to the new rules:**
- backend: `tenant.service.coverage` (create and user-count), `tenant.validator.test`, `jsonShape.d27` (15 columns, with good and bad fixtures for the snapshot), `certificateDocument.service.m11` (`contentAsOf`).
- backend: `certificate.service`, `certificate.audit.a41`, `certificate.transitionLock.a167` and `webhookEmit.a11` double the whole models barrel, so they stub `captureSignedSnapshot`, with the reason written next to the stub.
- frontend: `useTenants`, `tenant.service`, `tenants/page`, `TenantFormFields`, `brandColor.adr090`, `SsoSettingsPanel` and `a11y.adr090`.

**PostgreSQL 18.6**, in a disposable container `q50-pg18` since removed, through the real QueryInterface:
- 0103 up added `signed_snapshot jsonb`, nullable (`\d certificates`); a second up changed nothing.
- An already-signed row kept `signed_snapshot = NULL`.
- A snapshot written and read back came back with its keys re-ordered (`device,issuer,version,signedBy,approvedBy,calibratedBy`), and the v3 hash of the read-back value equalled the original's. This is why the payload uses a fixed key order.
- Down removed the column.

**Suites, typecheck and lint:**
- **Backend affected suites all pass:** `services/certificate*`, `routes/certificate*`, `certificateVerify.a293`, `certificateDocument.verifyToken.a293`, `models/certificateVerificationToken.a293`, `services/tenant.service*`, `validators/tenant*`, `routes/tenant*`, `src/tests/models` (1,146 tests), `jsonShape.d27`.
- **Frontend:** 103 suites and 1,094 tests pass (tenants, lib, api/services, verify, stores, certificates, `a11y.adr090`).
- **Backend `npm run typecheck`:** one error, in another agent's `migrations/0105-api-key-actor-columns.test.ts`.
- **`tsc -p tsconfig.build.json`:** clean on my files. The ADR-095 follow-up agent caught that `captureSignedSnapshot`'s optional `transaction` broke the image build under `exactOptionalPropertyTypes`, and it was fixed.
- **Frontend typecheck:** clean.
- **ESLint:** 0 errors on every changed file in both workspaces.
- **`npm run ratchet`:** the floor went 908 → 906 for `.js` files other agents removed. No `.js` file was added.

**docs/ amended, referencing ADR-107 (the deviation protocol):**
- `docs/BACKEND/07-CERTIFICATE-PIPELINE.md`: three integrity schemes now, and v3 is described.
- `docs/API/08-CERTIFICATE-ESIGNATURE-API.md`: the document now carries `integrity.scheme` v2/v3, `issuer` and `contentAsOf`.
- `docs/FRONTEND/07-MEDIA-HANDLING.md`: covers the v3 hash and its printed line.
- `docs/BACKEND/10-MODULE-REFERENCE.md`: the tenant fields now say `limitSeats` and the stored profile. The "columns missing" wart is struck through as fixed.

### Addendum: the boot report, and the full coverage run (2026-09-30)

**"`jsonShape is not defined`" at boot.** The coordinator reported that the backend would not boot. The cause was a window of about a minute between two of my edits. The `signedSnapshot` attribute, which calls `jsonShape`, went into `certificate.model.ts` in one edit, and its `import` in the next; anything that loaded the model in between threw. The current file is correct.

How the boot was proved:
- **tsx:** `node --import tsx -e "require('./src/models')"` printed "models OK".
- **A real boot on a disposable PostgreSQL 18 + Redis 8.6**, both removed afterwards: `node --import tsx index.js` applied every migration through 0105, including 0102 and 0103. It logged `[schema-verify] OK: 74 tables, 919 columns and 13 control objects match the models`, then "Server running".
- **The built dist:** `npm run build:dist` itself was blocked by another agent's in-flight `meteredBilling.service` (.js and .ts side by side). Its two steps were run by hand instead: a TS7 `tsc -p tsconfig.build.json` emit plus the copied `.js` sources. `require('./src/models')` on that output loaded, and `captureSignedSnapshot` was a function.

**Lesson:** a model change must land in ONE edit, and is proved by a require, not only by jest and typecheck. Jest's transform loaded the model only after both edits, so it never saw the gap.

**Full `npm run test:coverage -- --ci`:**

| Measure | Result |
|---|---|
| Suites | 769 passed, 9 failed, 28 skipped |
| Tests | 14,238 passed, 27 failed |
| All files | 98.8 / 98.51 / 98.61 / 98.81 |
| At 100/100/100/100 | `certificate.service.js`, `certificatePdf.service.js`, `tenant.service.js`, `jsonShape.util.ts`, `tenant.validator.ts` |
| Not at 100 | `certificateDocument.service.ts`: 95.62% branches. Line 290, the throw for a certificate with no snapshot, was uncovered; a test was added (`certificateDocument.snapshot.q50` › "v3 is never computed without a snapshot"), and the suite now passes 11 of 11 |

**The 9 failing suites belong to other agents' in-flight work.** Each diff names only their files:
- the `webauthn` controller, route and credential model (0104);
- `passkeyLogin.p1010`;
- `denyPlatformAuthoring.a127` (`webauthn DELETE /credentials/:id`);
- `swaggerValidatorAlignment.p608` (the `webauthn` paths);
- `unboundedFindAll.d24` (`meteredBilling.service.ts`);
- `tenantBackup.service`;
- `ssrf.outbound.a176`;
- `jsonShape.d27`: it counts **16** JSON columns, because `WebauthnCredential.transports` was added by the webauthn work with no shape entry. My edit set the count to 15 (with ADR-107's column). The webauthn owner must add its entry and fixtures and raise the count to 16.
