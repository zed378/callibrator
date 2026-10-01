# 2026-09-30 — Phase 10 backend: request access, the super-admin queue, the invitation, identifier-first discovery and SSO start, passwordless passkeys, the registration flag

**Cards:** P10-05, P10-07 (API and dashboard page), P10-15 (endpoint), P10-10 (backend), P10-12, P10-04 (backend part) · **ADR:** ADR-108 (as built, with the deviations), which amends ADR-059 item 7 for Q-46 · **Specs:** `MEMORY/specs/P10-05-request-access.md`, `P10-10-passkey-login.md` (both carry an "as built" note) · **Migrations:** 0099, 0100, 0101 · **Status:** every card is IN REVIEW. None is DONE, because the live E2E each spec names has not run.

Q-42 (retention), Q-44 (register off in production), Q-45 (invitation link) and Q-46 (passkey counts as MFA) are ADR-098 working decisions. They **still await the owner's confirmation**, and this work is built on them.

---

## P10-05 — the request-access backend

**Built.** All new code is TypeScript.
- Constants, model and migration: `constants/accessRequest.ts`, `models/accessRequest.model.ts` (registered in the typed barrel and in `types/models`), migration **0099** (`0099-access-requests.ts`).
- Validator, service, controller and route: `validators/accessRequest.validator.ts`, `services/accessRequest.service.ts`, `controllers/accessRequest.controller.ts`, and the public `routes/api/accessRequests.route.ts` (`POST /api/v1/access-requests`).
- Its contract: `routes/api/accessRequests.openapi.ts`.
- Configuration: `config/publicAccess.ts` (the notify address, and the IP pepper, which is required in production). `.env.example` documents both.
- Two `SYSTEM_ACTORS`: `system:access-request-intake` and `system:access-request-retention`.
- `tenant.service.js#createTenant` gains an optional outer `{ transaction }`: it never commits or rolls back a transaction it does not own, and it writes the cache in `afterCommit`.

**How the intake behaves:**
- One neutral answer, 202 `Request received`, for a new request, a duplicate, a 4th request from one address in 24 h, and a filled honeypot.
- The request row and its audit row share one transaction. The audit row carries no personal data.
- The platform inbox is notified after commit with the organisation's name and the queue link only. Nothing is sent to the requester.
- A body's `tenantId`, `status`, `decidedBy` or `provisionedTenantId` is stripped.

**Retention (Q-42).** `runAccessRequestRetention` runs in the nightly retention scheduler after the tenant sweep. It expires a request still pending after 90 days, and deletes a rejected, spam or expired request 12 months after its decision, in batches of 500, audited. A failure there fails the run.

**DSAR.** `POST /admin/access-requests/erasure` handles an erasure by address. It deletes the requests that never became a tenant and masks an approved one.

## P10-07 — the super-admin queue

**API.** These routes are on `admin.route.js`, behind `router.use(auth)` and `rbac(SUPER_ADMIN)`, and are documented with JSDoc:
- `GET /admin/access-requests`: rows in `data`; `{ total, page, limit, counts }` in a top-level `meta`; each row has a duplicate count.
- `GET /admin/access-requests/:id`.
- `POST /admin/access-requests/:id/approve`, `/reject` and `/resend-invitation`.

**What approve does.** Under `FOR UPDATE`, in ONE transaction, it:
1. creates the tenant through `createTenant`;
2. creates the first administrator with no usable password, as HEALTHCARE ADMIN, or CALIBRATOR ADMIN for a lab;
3. mints the invitation (a 256-bit token; only its hash is stored, and it lasts 7 days);
4. marks the request approved;
5. writes APPROVE, CREATE Tenant (PLATFORM) and CREATE User (the new tenant).

The email goes out after commit, in the requester's language, on `emailLinkOrigin()`. Every conflict is a 409 with a state explanation and rolls back the whole approval: a request that is not pending, a tenant code or name that is taken, or an address that already has an account.

**Menu.** The `access-requests` slug is granted to SUPERADMIN only, in `MENU_SLUGS`, `ROLE_MENU_ASSIGNMENTS`, the seed, **migration 0101** and `MENU_PAGE_GATES`. The `Inbox` icon was added to the frontend's `menuHelpers`.

**Page.** `frontend/src/app/dashboard/access-requests/page.tsx`, with its service `frontend/src/api/services/accessRequest.service.ts`. It has status tabs with counts, a table and a side panel with Approve and Reject forms; Approve is prefilled, and a tenant code is suggested. A 409's explanation is shown inline. The page shows *Resend invitation* where the backend says the invitation can be resent. The list has three states: loading, empty and failed with retry. A non-super-admin sees a restriction notice and nothing is requested.

## P10-15 — invitation acceptance (the endpoint)

**Built.** `services/invitation.service.ts` and `POST /api/v1/auth/invitation/accept` (`routes/api/authPublic.route.ts`).
- The token hash is looked up under a row lock. The password rule is the reset rule.
- An instance save sets the password, `isEmailVerified: true`, clears `mustChangePassword` and `temporaryPasswordExpiresAt`, and lets the P10-16 hook clear the one-time flag.
- The same transaction spends the token and writes the audit row.
- Every bad link — unknown, used, expired or re-issued — gets one 400.

The `/invitation` page is the Phase 10 frontend lead's; the contract was sent to it.

## P10-10 — passwordless passkey sign-in (backend)

**Built.**
- `services/passkeyLogin.service.ts` provides `POST /api/v1/auth/passkey/options` and `/verify`.
- Migration **0100** adds the partial unique index on `users.webauthn_credential_id`, and refuses to run if a credential id is shared.
- `utils/mfaPolicy.util.ts#isMultiFactorMethod` treats "passkey" as MFA; that is the Q-46 amendment of ADR-059.
- `auth.service` gains `assertMaySignIn` and `completePasswordlessSignIn`, extracted from `loginUser` with no behaviour change. `auth.service.js` was converted to `.ts` afterwards by the P9-12 lead, carrying these.

**Why a passkey counts as the second factor (Q-46).** A user-verifying passkey signs with a device-bound private key that never leaves the authenticator (possession), and it unlocks only with the user's biometric or PIN (inherence or knowledge). The signature is bound to the RP origin, so it cannot be phished to another site. That is multi-factor, phishing-resistant authentication in NIST SP 800-63B's terms.

An assertion without the UV flag is refused. A session that signed in with a password gets nothing from an enrolled passkey (A-160).

**Not built here:** the login-page button and the virtual-authenticator live E2E. The button stays hidden until P10-10 is DONE.

## P10-12 — the registration flag and neutral answers

**Built.**
- `SELF_REGISTRATION_ENABLED` (`config/publicAccess.ts`) is off by default in production. When off, `middlewares/selfRegistration.middleware.ts`, which sits first in the `/register` chain, sends the request out of the router (`next("router")`), so it gets the app's own 404 "Route not found". Nothing is budgeted, looked up, written or mailed.
- Where registration is enabled, `auth.service#registerUser` gives a new address, a taken email and a taken username the same answer: `REGISTRATION_ACCEPTED`, a 202. A taken case still pays for the bcrypt hash, rolls back, and writes and mails nothing.
- The activation origin (A-289) is the security lane's `emailLinkOrigin()`, which was already in the controller.

## P10-04 — identifier-first discovery and the SSO start (backend)

**Built.**
- `services/loginDiscovery.service.ts`: `POST /api/v1/auth/login/discover`, decided by email **domain** only. A username, or an SSO that cannot start, gets `password`.
- `sso.controller.js#startSsoFor`: `POST /api/v1/auth/sso/start`. It chooses OIDC when an OIDC client is configured, else SAML. Every refusal, including an unreachable IdP, is the A-292 404, which comes from the security lane's `ssoUnavailable`.
- The claim is the platform-controlled `tenant_settings.sso_email_domains`, set through `GET`/`PUT /admin/tenants/:id/sso-domains` (super admin). It is not writable by tenants. A domain has one claimant at most, and public mailbox domains are refused.

---

## Evidence (named)

All test files are TypeScript.

| Test | What it proves | Result |
|---|---|---|
| `src/tests/services/accessRequest.service.p1005.test.ts` | Intake, the one transaction, audit without personal data, honeypot, cap, notification, queue, detail, approve (one transaction; 409s roll back, including the taken code and the taken address), reject, resend, invitation accept (single use, expiry, rollback, suspended account), retention, erasure. Uses the real models, hooks, audit, createTenant and assertIdentityFree | 43/43 |
| `src/tests/routes/accessRequest.route.p1005.test.ts` (and `admin.route.test.js`, updated to the 11 admin routes, 11/11) | The real public and admin chains. The neutral answer compared byte for byte (status, body, headers) for new, duplicate, over-cap and honeypot. Body stripping. 400s about shape. The 6th request → 429 with Retry-After. For every admin route: 401 with no token, 403 for a tenant admin, 200 for the super admin. Approve cannot choose the invited address | 26/26 |
| `src/tests/services/passkeyLogin.service.p1010.test.ts` | **Real P-256 assertions**, signed in the test and verified by the real `@simplewebauthn/server`. Success gives a session, one LOGIN row (`method: passkey`) and a token with `amr: passkey`. An operator with no TOTP is admitted with no enrolment demanded. Every failure is the single 401: the ceremony used once, unknown ceremony, unknown or disabled credential, bad signature, no UV, wrong origin, wrong or missing user handle. Counter regression is refused and audited. Throttle 429; suspended tenant, locked account and suspended account refused. Two tenants: a credential signs in only as its owner | 24/24 |
| `src/tests/routes/publicAuth.route.p1004.test.ts` | Discover: a username → password; an existing and an unknown address in one domain answer identically; OIDC and SAML work; fallback to password. SSO start: the protocol choice and the redirect_uri precedence; unknown code, SSO off, no protocol and an unreachable IdP give one identical 404. Passkey options carry no `allowCredentials`. Passkey verify and invitation accept give the envelopes the frontend expects | 15/15 |
| `src/tests/services/phase10.units.p1005.test.ts` | The config flags. The register gate through the REAL auth router: off → the absent-route 404 and `registerUser` never called; on → the neutral 202. `mfaPolicy` for Q-46. The validators. The SSO domain claim (409, 400 and 404 cases). `createTenant` with an outer transaction: after a rollback no tenant, no audit row and no cache entry; the cache is written after commit; a code clash leaves the outer transaction open | 21/21 |
| `src/tests/migrations/phase10.migrations.p1005.test.ts` | What 0099, 0100 and 0101 issue on each path. Registered under `.js` names. No `try` | 16/16 |
| `src/tests/middlewares/retentionScheduler.middleware.test.js` (2 new cases) | The access-request step runs after the tenants; a failure in it fails the run | 14/14 |
| **`src/tests/services/accessRequest.p1005.live.test.ts`** on **PostgreSQL 18.6** (`pgvector/pgvector:pg18`, a disposable container `p1005-pg18` on 127.0.0.1:55105, scratch DB, boot path `runSchemaSetup`) | Columns, ENUMs, the CHECK, the tenant FK (SET NULL) and every index match 0099. The 0100 index exists. `schemaVerify` passes. **The CHECK refuses a decided row without `decided_at`.** **Two concurrent approvals of one request → exactly one tenant, one administrator and one APPROVE row; the other gets the 409.** A taken code rolls back everything. `down` then `up` via the createTable path rebuilds the same shape | **6/6** (213 s) |
| `frontend/src/app/dashboard/access-requests/__tests__/page.test.tsx` | The restriction for a non-super-admin (nothing requested); `data`/`meta` read correctly; empty and failed states; prefill; approve sends no address; the 409 shown inline; reject needs a reason; resend; no axe violations | 9/9 |

**`\d access_requests` (psql, the live database above, after the boot path):**
```
Indexes:
    "access_requests_pkey" PRIMARY KEY, btree (id)
    "access_requests_admin_user_id" btree (admin_user_id)
    "access_requests_decided_by" btree (decided_by)
    "access_requests_invitation_token_hash_unique" UNIQUE, btree (invitation_token_hash) WHERE invitation_token_hash IS NOT NULL
    "access_requests_provisioned_tenant_id" btree (provisioned_tenant_id)
    "access_requests_status_created_at" btree (status, created_at DESC)
    "access_requests_work_email" btree (work_email)
Check constraints:
    "access_requests_decided_iff_not_pending" CHECK ((status = 'pending'::enum_access_requests_status) = (decided_at IS NULL))
Foreign-key constraints:
    "access_requests_admin_user_id_fkey" FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE SET NULL
    "access_requests_decided_by_fkey" FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL
    "access_requests_provisioned_tenant_id_fkey" FOREIGN KEY (provisioned_tenant_id) REFERENCES tenants(id) ON UPDATE CASCADE ON DELETE SET NULL
schema_migrations: 0099-access-requests.js, 0100-user-webauthn-credential-unique.js, 0101-access-requests-menu.js (and 0102, another lane's)
users_webauthn_credential_id_unique: CREATE UNIQUE INDEX … ON public.users USING btree (webauthn_credential_id) WHERE (webauthn_credential_id IS NOT NULL)
```

**Mutation checks:**
- `requireUserVerification: false` in `passkeyLogin.service.ts` → `passkeyLogin.service.p1010` fails, 1 of 24 ("an assertion WITHOUT user verification is refused"). Restored.
- The `FOR UPDATE` lock removed from `accessRequest.service#findOr404` → the live concurrent-approve test **fails**. Both approvals proceed, and the second dies on a unique-constraint error instead of the 409 state explanation. The database's unique indexes still stopped a second tenant, but the lock is what makes the answer correct. Restored.
- `.strip()` versus `.strict()`: the service never reads status or tenant from the body. The route test asserts the stored row, so a mutation that made the schema pass the extra keys through would not change the stored row. The test proves the observable rule (BR-P10-5), not the schema mode.

**Guards updated, each with a reviewed reason:**
- `twoTenantRoutes.guard`: the four access-request `:id` routes and the two sso-domains routes are `platform`.
- `routeGateExemptions.ts`: the six new public routes are listed.
- `denyPlatformAuthoring.a127` NOT_GUARDED: the public intake (matched on its `submit` handler) and the approve route (a platform act).
- `unboundedFindAll.d24`: five reviewed entries. The retention reads are batched.
- `auditInTransaction.p611`: the counter-regression audit runs inside its own transaction.
- 0067 D-20: the foreign-key indexes are read from 0099.
- `includeRequired.d12`: 72 models. `unscopedModels.d17`: AccessRequest is `global`. `enumMirrors.d26`: the four ENUMs read their constants. `associationForeignKeys.a148`: two users links set SET NULL.
- `systemActors.a124` and `menuPageAccess`.
- `openapiRoutes.p925`: the `inFlight` pins were emptied, because all 14 routes are now documented.
- `swaggerValidatorAlignment.p608`: two comparator fixes. Route modules are keyed without their extension, so a `.ts` route was previously read as "unmounted". Path parameters are omitted from a `from: ["params", "body"]` schema before the comparison. The P9-25 lead agreed to both.

**Gates:**
- `npm run typecheck`: 0 errors, 2026-09-30.
- `npx eslint` on every changed backend and frontend file: 0 errors — **as of the Amendment 1 pass**. **Correction:** the first report said 0 errors, but that run's output was never read (it went to a background file). A re-run found 40+ errors in this lane's test files: `process.env` instead of `config/env#environment()`, `import()` type annotations, `require` imports, and assertions. They are fixed; the named files lint clean.
- `npm run ratchet`: passes (it reported the floor lowered 913 → 910 by other lanes' deletions).
- `npm run openapi:generate`, then `openapi:lint`: no new error.
- `frontend npm run api:types`: regenerated.
- The full `npm run test:coverage -- --ci` ran on Node 26.10.0 on 2026-09-30, on a tree shared with other lanes:
- 767 suites ran (28 skipped); 763 passed and 4 failed.
- 14,317 tests: 14,127 passed, 182 skipped, 8 failed.
- Global coverage: 99.96 / 99.86 / 99.9 / 99.96.

Of those failures, only `admin.route.test.js` was this lane's: it counted 3 admin routes. It is updated to the 11 named routes and passes 11/11.

**Other lanes' failures, not caused by this work:**
- `certificate.controller.test.js` (4 tests);
- `routePermissionGuard.p604`: the `auth.route.js POST /impersonate` exemption names `auth.service.js#impersonateUser`, and the file is now `.ts` after the P9-12 conversion;
- `swaggerValidatorAlignment.p608`: `PATCH /api/v1/roles/:id`, the roles fields;
- the coverage gaps in `menuGroup.controller.js` (lines 53–54) and `certificateDocument.service.ts`.

Every file this lane added is at 100%.

## Deviations → ADR-108

- The migration numbers are 0099, 0100 and 0101. 0097 and 0098 were taken; the 0097 file was renamed before anything ran it.
- The tenant FK is added in the migration, not on the model.
- The invitation token is random with its hash stored, not a JWT.
- The public routes use request budgets, not `endpointRateLimiter` or `authPreCheck`.
- Configuration is in `config/publicAccess.ts`.
- The page is at `/dashboard/access-requests`.
- Approve takes no `maxUsers` (A-303; the seat limit is `limitSeats`, another lane's).
- The approve identity conflict is not held to the A-128 budget.
- DSAR erasure is on the admin router.

## Open

- **The live E2E has not run.** Two flows need it: submit → queue → approve → invitation accept → sign in; and a passkey with a virtual authenticator (P10-13).
- **Q-42, Q-44, Q-45 and Q-46 await the owner.** If Q-46 is overturned, `isMultiFactorMethod("passkey")` must become false, and a passkey sign-in must hand off to the TOTP step.
- ~~One passkey per user~~ — several since Amendment 1 (below).
- The consent text and the privacy notice need legal review before `/request-access` goes live (Q-42).
- The frontend lead's `/request-access`, `/invitation` and login pages are theirs to record.

---

## Amendment 1 (2026-09-30) — several passkeys per user (ADR-108 Amendment 1)

**The decision:** the coordinator decided, under the owner's delegation, that a user may hold several passkeys (a phone, a laptop, a security key), named and revocable, and that the last sign-in method must never be removable in a way that locks the account out.

**Built:**
- **Model and migration.** `models/webauthnCredential.model.ts` is a child of the user: no tenant column; `user_id` → users ON DELETE CASCADE; a unique `credential_id`; `transports` with a D-27 shape in `utils/jsonShape.util.ts`, where the column count moved 15 → 16.
- **Migration 0104** (`0104-webauthn-credentials.ts`) creates the table, moves every old one-per-user passkey into it, and clears the old credential columns. `webauthn_enabled` stays as the "has a passkey" flag.
- **A User model `beforeSave` hook.** Turning the flag off removes the user's passkeys in the same transaction, so remove-all, the administrator's reset and GDPR erasure all purge without changes of their own.
- **`webauthn.service.ts`:** registration adds a row (named, at most 10, a duplicate is 409), purges leftovers after a reset, and is audited WEBAUTHN_REGISTER. The options exclude the user's own passkeys, and the step-up allows any of them. New functions: `listPasskeys`, `renamePasskey` (audited WEBAUTHN_RENAME) and `revokePasskey`. `revokePasskey` requires the A-213 re-authentication, which is the lock-out guard for the last passkey; it is audited WEBAUTHN_REVOKE and turns the flag off with the last one.
- **`passkeyLogin.service.ts`** looks the credential up in the new table and requires the account's flag.
- **Routes** in `webauthn.route.js`: `GET /credentials`, `PATCH /credentials/:id` and `DELETE /credentials/:id`, served by `controllers/webauthnCredentials.controller.ts` and `validators/webauthnCredential.validator.ts`, with JSDoc.
- **Guards:** route-gate `self` entries, the a127 NOT_GUARDED entry, the d17 child entry plus two reviewed parent-less queries, the d24 PARENT entries, the a148 CASCADE entry, d12 at 73 models, d27 at 16 columns. openapi.json and the frontend types were regenerated.
- **Frontend:** `/dashboard/webauthn` shows a list of passkeys, a name field for a new one, rename, remove-one with the re-authentication dialog (the last one warns that the password becomes the way in), and remove-all. `frontend/src/api/services/webauthn.service.ts` gains `listPasskeys`, `renamePasskey` and `revokePasskey`. The frontend lead agreed this page is this lane's.

**Found and fixed on the way (the boot crash):** `export interface PasskeySummary` sat beside `export =` in `webauthn.service.ts`. tsx/esbuild compiles that to a reference to an undefined `webauthn_service_module`, and the backend did not boot. The interface is now module-local (the P9 lead's Amendment 15 now lints this). Proven:
- `npm run load:check -- --src` required all 528 modules, then the index.js boot order, and reported OK;
- a full `node --import tsx index.js` boot on PG 18 reached "Server running on port 5906" and answered the new routes live;
- `npm run build:dist` (after the meteredBilling lane removed its duplicate `.js`) compiled 337 TypeScript files, and requiring the built `dist` modules loaded them all.

**Evidence (named):**

| Test | Proves | Result |
|---|---|---|
| `src/tests/routes/webauthnCredentials.twoTenant.test.ts` (`@two-tenant` PATCH and DELETE `/credentials/:id`) | **Another tenant's passkey id is a 404, identical to a missing one, and nothing is written.** The owner reaches it. List, rename (audited), revoke-one (audited, and the audit row names no credential id). **The lock-out guard:** without the password, or with a wrong one, a 400 and nothing is removed; the last passkey goes only with the password, and turns the flag off. The flag-off hook purges. Remove-all is audited with its count. **Registration with a REAL "none" attestation** (a P-256 key and authData with the attested credential), verified by the real library: a third passkey, named, audited, with the options excluding the enrolled ones; an unnamed passkey gets "Passkey 3"; a duplicate is 409; a reset starts clean; an 11th is 409; `/status` reports the count | 16/16 |
| `src/tests/services/webauthn.service.test.js` (rewritten) | Every branch of the service, with the library and the models doubled | 29/29; the service at 100% statements, branches, functions and lines together with the other two suites |
| `src/tests/services/webauthn.disable.a213.test.js` (updated) | Remove-all re-authenticates; the audit row carries `passkeysRemoved` | 11/11 |
| `src/tests/services/passkeyLogin.service.p1010.test.ts` (updated, +1) | Sign-in through the new table; **a second passkey of the same account signs in, and only its counter advances** | 25/25 |
| `src/tests/services/accessRequest.p1005.live.test.ts` (+1, **PostgreSQL 18.6**) | 0104 moves a real one-per-user passkey (count 7, named "Passkey"), clears the old columns and keeps the flag, and a re-run changes nothing. A second passkey is allowed; the same credential id on another user is refused (a unique violation). The ON DELETE CASCADE foreign key and the user_id index exist, and `schemaVerify` passes | 7/7 |
| `src/tests/migrations/phase10.migrations.p1005.test.ts` (+3) | 0104's statements on each path | 20/20 |
| `frontend/src/app/dashboard/webauthn/__tests__/page.test.tsx` (updated) | The list; add with a name; remove-one sends DELETE with the password; the last-passkey warning; remove-all with MFA; a wrong password keeps the dialog open; cancel; rename; no axe violations | passes (31 with the service suite) |

`\d webauthn_credentials` (psql, PG 18.6, after 0104's createTable path): the columns above; `webauthn_credentials_credential_id_key` UNIQUE; `webauthn_credentials_user_id` btree; `webauthn_credentials_user_id_fkey` FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE.

**The full `npm run test:coverage -- --ci`**, run on 2026-09-30 on a tree shared with several lanes converting modules:
- 790 of 819 suites ran (29 skipped): 773 passed and 17 failed.
- 14,608 tests: 14,235 passed, 190 skipped, 183 failed.
- Global coverage: 99.83 / 98.19 / 99.09 / 99.86.

**This lane's one failure:** `jsonShape.d27` needed GOOD and BAD fixtures for the new transports column. It is added and passes 95/95. Every file this lane touched is at 100%.

**The rest are other lanes' in-flight work:**
- the content, reporting, featureFlag, kanban, stock, ticket, warehouse and meteredBilling service suites, and `csvInjection.a319`;
- `sso.refusalTiming.a292` (the security lane);
- `unboundedFindAll.d24` (meteredBilling);
- `swaggerValidatorAlignment.p608` (`PATCH /roles/:id`);
- the coverage gaps in those services.

**Open:**
- The old `users.webauthn_*` credential columns are empty but still exist; a later contract migration drops them.
- A federated SSO-only user cannot remove a passkey, because the re-authentication needs a password. An administrator can reset their passkeys.
- There is no live browser E2E of registering several passkeys.

---

## Migration 0104 — its own record (2026-09-30, after the live PG18 check)

**What it is.** `backend/src/migrations/0104-webauthn-credentials.ts`, registered as `0104-webauthn-credentials.js`, is the expand step of ADR-108 Amendment 1. In one transaction it:
- creates `webauthn_credentials` unless `db.sync()` already did;
- creates the `user_id` index (D-20);
- moves every legacy passkey from `users.webauthn_credential_id / _public_key / _sign_count` into the new table, named "Passkey", keeping the sign count, and skipping a credential already there (idempotent);
- clears the moved columns.

`users.webauthn_enabled` stays. `down` moves each user's oldest passkey back to `users` and drops the table: a user with several passkeys keeps one, and the rest are lost. That is stated in the file.

**Proven.**
- **This lane's live suite** (`accessRequest.p1005.live.test.ts`, PG 18.6): a real legacy passkey is moved with its count of 7, the old columns are cleared and the flag kept; a re-run changes nothing; a duplicate credential id is refused; the ON DELETE CASCADE foreign key exists; `schemaVerify` passes. 7/7.
- **The independent live check** (`MEMORY/records/2026-09-30-live-pg18-migrations-a283.md`): the upgrade path moved both legacy passkeys, the application role has full DML on the table, down restored both exactly, and up again gave an identical catalog.
- **0100 vs 0104:** no conflict. 0100 guarantees the legacy ids are unique, so 0104's backfill cannot violate the new unique index. After 0104 the legacy columns are NULL and 0100's index is inert. The stale migrator comment on 0100 is corrected.

**Finding fixed: a half-enrolled credential was dropped silently.** A legacy row with a credential id but no public key is not moved, and is cleared with the rest.
- **Decision (ADR-108 Amendment 1):** dropping it is correct. Without a key it cannot verify a signature, so it could never sign anyone in.
- **It is no longer silent:** 0104 now counts these rows (`UNUSABLE_SQL`) before clearing, and logs a `warn` with the count only — no user or credential id.
- **Test:** `phase10.migrations.p1005.test.ts` › "is dropped, not moved, and the COUNT is logged — no identifier reaches the log", and "says nothing when there is none". 26/26.

**Contract step: written, NOT registered.** `backend/src/migrations/pending/drop-legacy-user-webauthn-columns.ts`.
- **What it does:** it refuses, and drops nothing, while any user still holds a legacy value. Otherwise it drops 0100's `users_webauthn_credential_id_unique` index and the three emptied columns. `webauthn_enabled` stays. `down` re-adds the columns and the index.
- **Why it lives in `pending/`:** it sits outside the manifest and outside the top-level scan of `manifestNames.p923` on purpose. It is tested with the rest: not in the manifest, drops when clean, refuses when a legacy value is held, idempotent, and down restores.
- **When:** only after the VM deploy has run 0104 and been verified.
- **How to register it**, all in one change, as its header lists:
  - give it the next free number and add it to the manifest;
  - remove the three attributes from `user.model.ts` (`schemaVerify` would refuse the boot otherwise);
  - remove them from `gdpr.service.js#AUTHENTICATORS_CLEARED`, from `user.service.ts` and from the tests;
  - run it on production-shaped data and check `\d users`.
- **Tracked on the P10-10 card.**

**Gates for this follow-up:** ESLint 0 errors on the changed files; typecheck clean for these files; `npm run ratchet` at the floor; `npm run load:check -- --src` OK; `manifestNames.p923` passes.
