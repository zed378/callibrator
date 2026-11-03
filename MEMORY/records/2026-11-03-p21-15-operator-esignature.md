# 2026-11-03: P21-15 — personal e-signatures, applied to calibration records and documents by hash, publicly verifiable (ADR-140) — WIP

**Status:** **WIP, partly built.** Parts (1) the data, my e-signature API and Profile → E-signature, (2) application to calibration records and the public verification page, and (3) documents by hash are built and tested. **Part (4), certificates, is NOT built**: `POST /certificates/:id/esignatures`, the automatic application on approve and sign, the specimen in the frontend renderer, and `cert-data-v1`'s field list. Nothing was pushed, merged or deployed.

**Spec:** [`specs/P21-15-operator-esignature.md`](../specs/P21-15-operator-esignature.md) **v2** (v1, the operator's signature on a calibration record alone, was built first and then reworked into v2 the same day on the owner's third instruction; nothing of v1 survives except its canonical record form, token handling and tests, which v2 reuses). **Decision:** ADR-140.

## What was built

**Data — migration 0149** (`backend/src/migrations/0149-user-esignatures.ts`):
- `user_esignatures` (one ACTIVE per user, versioned; specimen SVG; RSA-3072 public key; the private key as a KMS envelope via `signingKeyWrap.service`; SHA-256 key fingerprint; `active` → `superseded` | `revoked`).
- `esignature_applications` (signer snapshot, document type/id/title, meaning, content scheme and hash, method, RSA-SHA256 signature over the signed payload, instant, 192-bit token; once per document, signer and meaning).
- CHECKs for every value list, shape and lifecycle; the token UNIQUE globally (ADR-138 § 2's exception); the partial UNIQUEs.
- ENABLE ALWAYS triggers for every role: append-mostly e-signatures, append-only applications, the user of the row's tenant, and an application only by the signer's ACTIVE e-signature on an effective full record of its tenant, `performed` by its performer and `reviewed` by anyone else.
- Grants: `callibrator_app` gets SELECT and INSERT (plus UPDATE of the four lifecycle columns on `user_esignatures`). No try/catch. `down` refuses while either table holds a row.

**Contracts** — `packages/contracts/src/esignatures.ts`:
- the specimen allow-list `specimenProblem`, the canonical `calrec-data-v1` pairs, `canonicalJsonOfPairs` (what the browser hashes), the signed payload `esig-app-v1-rsa-sha256`, the request schemas and the strict answers.
- Golden text and hash tests pin each form.

**Backend:**
- `services/userEsignature.service.ts`: create or replace, revoke mine, a tenant administrator's revoke, `requireActive`, `signWith`.
- `services/esignatureApplication.service.ts`: apply to a record, sign a document by hash, the record's applications, my applications, the public verdict.
- `controllers/userEsignature.controller.ts`.
- Routes: `routes/api/userEsignatures.route.ts`, mounted at `/api/v1/esignature` before the generic workflows; `routes/api/publicEsignatures.route.ts` at `/api/v1/public/esignatures`; two routes added on `calibrationRecords.route.ts` (`POST/GET /:calibrationRecordId/esignatures`).
- OpenAPI modules for all of them, and `docs/openapi/esignatureSchemas.ts`.
- Rate limits `esigVerifyToken`, `esigVerify`, `esigSign`.
- The public exemption in `routeGateExemptions` and the two-tenant allow-list; `GET /:calibrationRecordId/esignatures` marked facility-readable.
- `eSignature.service` now exports `loadSigningKey`, `loadVerificationKey` and `SIGNATURE_DIGEST` (keys added to its `export =` object; v1 used them, v2 does not need them, and they are kept as harmless exports).
- `UserEsignature.privateKeyEnc` is in SECRET_ATTRIBUTES.
- The new env var `PUBLIC_APP_URL` is in `.env.example`.

**Frontend:**
- **Profile → E-signature** (`EsignatureSettings`): draw (pointer, pen, touch) or upload, preview, save with a credential, fingerprint, history, Replace, Revoke.
- The calibration records table gets an **E-signatures** action and a `RecordEsignaturesModal`: the applications with specimen, integrity, verify link and QR; Sign as performed or reviewed; the `ESIG_NONE` link to the profile.
- **Sign a document** at `/dashboard/esignature/documents`: the browser computes the SHA-256, the file is never uploaded; a printable signature sheet; what I have signed.
- **Public page `/s/[id]?t=`**: server-rendered under the nonce CSP, ID/EN, noindex, one `<main>` and one `<h1>`. The specimen is shown as an `<img>` of a data URI, never inlined. The "check it yourself" island recomputes the hash with Web Crypto, or hashes a file the reader picks.
- `next.config.ts` sends noindex, no-referrer and no-store on `/s/*`; `robots.ts` disallows `/s/`; the `bundle-budget.json` entry for `/s/[id]` is 120 KB brotli.
- `client.ts` treats the credential routes' 401 as a wrong credential.

**The coordinator's extra item:** the public device page `/d/[token]` rendered an `<h1 className="pub-eyebrow">` in its Suspense fallback, beside the body's `<h1>` (the device name). The fallback eyebrow is now a `<p>`; the `/s/[id]` shell had the same pattern and got the same fix. `d/[token]/__tests__/page.test.tsx` now asserts the shell renders no `<h1>` and that the eyebrow is a `P`. The body tests already assert exactly one `<h1>`. A fail-before run of the new assertion was **not** made.

## Deviations from the spec (all recorded in ADR-140)

1. The route paths use `:calibrationRecordId`, the router's existing parameter name, rather than `:id`.
2. The state refusals come before the performer check (the IPM order). In v1's list order, a record with no performer could never reach `CALREC_EXTERNAL`.
3. A signing budget (`esigSign`, 10 per 15 minutes per user and address) was added to every route that re-enters a credential (the A-185 class). The spec's chains do not list it.
4. A BEFORE INSERT trigger enforces the signing rules in the database as a floor; the spec asks only for append-only.
5. `PUBLIC_APP_URL` is a new configuration key. The spec names it, but it did not exist.
6. **No grant migration:** every role that performs, approves or signs already holds `esignature` write (0025 and 0032 withdrew it only from USER, ROOM USER and WAREHOUSE STAFF).
7. A document application's Part 11 row uses `entityType` `EsignatureDocument` and the application's own id, because `entity_id` is NOT NULL.
8. A facility-bound account cannot reach `/esignature/me…` (not marked facility-accessible).
9. The dashboard screens are English, like the surrounding dashboard; only the public page is ID/EN.
10. `/api/v1/esignature/me` is in the frontend's credential list by path, so an expired session on `GET /me` shows an error instead of redirecting to sign-in.

## Evidence (every test named; counts as run)

**Environment notes, read first:**
- This worktree had no `node_modules`; it uses junctions to the main checkout's (with `@callibrator/contracts` pointing at this worktree's package) and a copied `backend/.env`.
- Its files were checked out with CRLF; they were renormalised to LF, because CRLF made text-parsing guards fail (e.g. `auditCoverage.p611`).
- The worktree path contains `.claude`, which breaks jest's absolute `testMatch` globs in `packages/contracts` and `frontend`; those runs pass `--testMatch` explicitly.
- `next build` needed a **temporary** `turbopack.root` override, because Turbopack refuses junction targets outside its root. The override was reverted, and `git diff` shows only the `/s/*` headers in `next.config.ts`.

**Contracts:** `npm test` (75 suites, 1,462 tests passed), coverage **100 / 100 / 100 / 100** over `packages/contracts/src`, including `esignatures.ts`. The new suite is `test/esignatures.p2115.test.ts` (28 tests); `npm run typecheck` reports 0 errors.

**Backend:**
- `npm run typecheck`: 0 errors.
- `npx eslint` on every changed file: clean.
- `npm run ratchet`: "3 .js file(s), at the floor".
- `npm run build:dist`: 815 TypeScript files plus 68 of the contracts.
- `npm run load:check`: OK, dist via node (805 modules, 120 in boot order); `-- --src`: OK via tsx.
- `npm run openapi:check`: current (573 operations). `openapi:lint`: no new error; the 15 baseline warnings name no new schema.
- `src/tests/routes/esignatures.p2115.test.ts`: **33/33**.
- `src/tests/routes/userEsignatures.twoTenant.test.ts`: 2/2 (`@two-tenant POST /users/:userId/revoke`).
- `src/tests/routes/calibrationRecords.twoTenant.test.ts`: 10/10 (two new `@two-tenant` routes).
- `src/tests/routes/domainRoutes.twoFacility.test.ts`: passing (new `@two-facility GET /:calibrationRecordId/esignatures`).
- `src/tests/migrations/0149-user-esignatures.p2115.test.ts`: 6/6.
- `jsonShape.d27` + `denyPlatformAuthoring.a127`: 259/259 (both updated: 33 JSON columns with fixtures; the new routes reviewed).
- `twoTenantRoutes.guard`, `associationForeignKeys.a148` and `includeRequired.d12` (91 models): passing in the `src/tests/guards` + `src/tests/models` run (66 suites; the only failure, `prePushHook.a19`, is pre-existing).
- **Coverage of the changed files, from the suites above:** `userEsignature.service.ts`, `esignatureApplication.service.ts`, `userEsignature.controller.ts`, `userEsignatures.route.ts`, `publicEsignatures.route.ts` and `calibrationRecords.route.ts` at **100 / 100 / 100 / 100**. The three OpenAPI modules and `jsonShape.util.ts` reach 100 % under the openapi and d27 suites (the findRelatedTests run).
- **Live suite on PostgreSQL 18** (`pgvector/pgvector:pg18` container `p2115-pg`, started for this run and removed by name afterwards): `npm run test:live -- --only=p2115` (`userEsignatures.p2115.live.test.ts`, newly registered in `scripts/live-suites.ts`) passed **10 passed, 0 failed, 0 skipped**. Every refusal was checked as `callibrator_app` and as the owner; the unique indexes were checked fail-before; the grants were checked; a reboot applied nothing.
- **Broad run:** `--findRelatedTests` over every changed source, plus `src/tests/guards`, `src/tests/models` and the suites above: 661 suites, **11,834 of 11,839 tests passed, 5 failed**:
  - `webhook.delivery.a10` (passes alone, 7/7: load);
  - `roles.audit.a41` 1 and `tenantLifecycle.w01` 1 (both fail identically on the main checkout at `e1c0a73d`);
  - `appRoutes.a253` 2 (passes on the main checkout; here Express `sendFile` refuses the `.claude` dot-directory in the worktree path).
- `prePushHook.a19` fails 6 of 12, identically on the main checkout (gitleaks absent).

**Frontend:**
- `npm run typecheck`: 0 errors. `api:types:check`: current. `npx eslint` on every changed file: clean.
- New suites:
  - `s/[id]/__tests__/page.test.tsx` 9 tests;
  - `components/esignature/__tests__/esignature.p2115.test.tsx` 8;
  - `EsignatureSettings.p2115.test.tsx` 4;
  - `RecordEsignaturesModal.p2115.test.tsx` 3;
  - `esignature/documents/__tests__/page.p2115.test.tsx` 2;
  - `lib/publicEsignature.server.test.ts` 7;
  - `api/services/personalEsignature.service.test.ts` 2;
  - all pass; the `d/[token]` and `s/[id]` page suites together pass 19/19.
- Changed tests: `calibration/__tests__/page.test.tsx` (a non-compliant row now shows an E-signatures button; the assertion checks it offers no Certify) and `d/[token]/__tests__/page.test.tsx` (one-h1 shell).
- `dashboardColours.p1101.guard` passes: no raw colours (the specimen ink is `currentColor`, the surfaces are theme tokens).
- **Full suite:** 406 suites, **4,185 of 4,186 tests passed**. The one failure, `field/ui/__tests__/FieldApp.test.tsx`, timed out under the parallel load and passes alone (14/14). Global coverage is 95.08 / 87.39 / 91.83 / 95.66 against the 90 / 81 / 86 / 91 gate.
- `next build`: compiled, 99 pages. `node scripts/bundle-budget.mjs`: every route within; **`/s/[id]` brotli 116.3 / 120 KB, gzip 136.1 / 141 KB, CSS 11.5 / 13 KB**.

**Not run:**
- the full backend coverage run (`npm run test:coverage`; due at the end of Phase 31 by the owner's rule);
- `upgradeBoot.am3` (`--with=upgrade`) and the other live suites;
- `make test-e2e`;
- any browser check of the pages;
- GitHub CI (not waited on, by the owner's rule).

## What is left (in order)

1. **Certificates (spec § 4, § 5, ADR-140 § 6):**
   - choose and record `cert-data-v1`'s fields (an ADR-140 amendment);
   - `POST/GET /certificates/:certificateId/esignatures` with its state 409s and a two-tenant test;
   - the automatic application inside the approve and sign steps' transactions when the actor has an active e-signature (never blocking without one);
   - the specimen, name, role, date and QR in the frontend certificate renderer's signature blocks, and the signing panel;
   - a link from `/verify` to the e-signature verifications.
2. Optionally, mark `/esignature/me…` facility-accessible (`self`) so bound users can create one.
