# Changelog

User-visible and operationally significant changes, newest first. Coarser than [`MEMORY-INDEX.md`](./MEMORY-INDEX.md); every entry links to a record or an ADR.

Format loosely follows Keep a Changelog. Dates are absolute.

---

## Unreleased

### Decided

- **ADR-040 — electronic signatures are RSA-signed over a canonical payload, and verification verifies.** Until 2026-09-23 the "signature" was a SHA-256 of `documentId:userId:tenantId:Date.now()`, recomputed at verification — so **no genuine signature could ever verify** — and the per-tenant RSA key pairs signed nothing at all. Signing now uses the tenant's private key over a deterministic payload binding the document, signer, timestamp, authentication method and the signature's meaning; a soft-deleted key still verifies its past signatures; records signed under the old scheme are reported `unverifiable_legacy` rather than as valid or as forgeries. Signing without a provisioned key pair is now a 409. The reference deployment has **no** signatures (0 rows), so nothing in the archive is affected.

- **ADR-039 — PostgreSQL is the only supported database.** MySQL support was a claim, never a capability: `mysql2` was not a dependency, and search, webhooks and RAG used PostgreSQL-only SQL. The dialect is now fixed in `src/config/index.js`; any other `DB_DIALECT` refuses to start. ADR-029's tenant-isolation mechanism stands.
- **ADR-038 — the backend moves to TypeScript, strict, incrementally.** Supersedes ADR-030. Plan: `TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`. Until it completes the backend is still JavaScript, and backend documents state TypeScript as the target, never as fact.

### Fixed

- **Tenant isolation did not cover `bulkCreate` or `upsert`.** Twelve `TenantSettings.upsert` sites resolve on `(tenant_id, key)`, so a wrong tenant id overwrote another tenant's storage credentials or OIDC configuration. Both verbs now refuse a write naming another tenant. Verified against a real PostgreSQL. (D-01)
- **Tenant administrators were locked out of API keys, webhooks, storage settings and tenant backup.** The role level was never loaded and never seeded. (V-01)
- **The approval-workflow engine was SUPERADMIN-only** because five gates named `"workflow"` instead of `"workflows"`. The backend now **refuses to start** when any gate names a menu that is not seeded. (A-58)
- **Another tenant's id returned 403 instead of 404** in both authorization middlewares and in user management, which let a caller learn which ids exist. (AZ-04)
- **Restoring a tenant backup deleted every user and recreated them without passwords.** It now never deletes a live account. (S-02)
- **A global retention policy purged every tenant's rows**, audit logs included, ignoring legal hold. (D-03)
- **Restoring a soft-deleted device, user, tenant or role wrote nothing** and reported success. (D-07)
- **The public certificate check published a draft certificate's PDF**, at a guessable filename. (A-57)
- **One Redis restart disabled Redis until the backend restarted**, taking registration, passkeys, OIDC, shared rate limiting and queue deduplication with it. (W-05)
- **Deleting a role left its permissions in force for up to an hour.** (W-11)
- **Logging out left the realtime connection open and the tenant selection set**, so the next person in the same browser tab inherited the previous one's tenant. (F-01, F-06)
- **The dashboard's system-health panel was hardcoded green.** It now shows real dependency status to super-admins and nothing to anyone else. (F-02)

- **A bodyless request was a 500, and the validator was part of the problem.** Express 5 leaves `req.body` undefined where Express 4 gave `{}`, and Joi treats `undefined` as **valid** against a non-required object schema — so `validate(schema)` let an absent body straight through and the handler's first read threw. A request middleware now fills only an absent body, all 31 validator helpers coerce it, and 69 reads on unvalidated routes are guarded, so a bodyless request gets the 400 it is owed. (A-09)
- **Webhook deliveries followed redirects**, so a registered host that passed both SSRF layers could answer `302 Location: http://169.254.169.254/...` and this process would fetch cloud metadata from inside the deployment. Redirects are no longer followed; a 3xx is a delivery failure. (A-50)
- **Dead session-security middleware deleted.** It was imported by nothing and its SQL targeted a table that does not exist, so session fixation protection, a concurrent-session limit and IP binding were never in place — while eleven documents and four ADRs described them as real. Whether they should exist is now an Open Question instead of an assumption. (A-12)

- **`/search` returned rows the caller's role cannot list.** Each type is now filtered by running the same gate its own list route runs, so search cannot surface a record that resource would refuse. A principal with none of the searchable menus now gets 403 rather than a list. (A-04)
- **Socket.IO accepted any origin, took the token from the query string, and checked nothing at connect.** CORS now uses the same allow-list as HTTP, the token comes from `handshake.auth`, and a suspended tenant or inactive user is refused — as it is over HTTP. It also turned out `kanban:join` ran its access check with **no tenant context**, which the scope resolver reads as "skip the tenant predicate"; socket handlers now run inside the tenant context. (A-05)
- **`/health` published Node version, pid and memory to anyone, and checked only the database.** The public endpoint answers a verdict and nothing else; a per-dependency breakdown is super-admin-only; Redis and RabbitMQ are actually probed, and an unconfigured dependency reports "not configured" rather than healthy. (A-06, A-15)
- **A public `0.0.0.0:19883` port with nothing behind it**, removed from the VM and dev overlays. The backend is an MQTT client, not a broker. (A-17)
- **Stripe invoices never updated.** `upsertInvoice` only ever inserted, so an invoice that failed and was later paid stayed `Open` forever. `Paid` is now terminal and `amountPaid` never decreases, because Stripe does not guarantee event order and a late `payment_failed` carries `amount_paid: 0`. (A-25)
- **Redelivered queue messages did the work twice** — a duplicate email, a batch job run again. Consumers now claim a stable identity from the message body before acting. This is at-least-once with a claim, not exactly-once, and the code says so. (A-26)
- **Calibration evidence, signing keys, controlled SOPs and the risk register were mutable by any role.** All gated; publishing an SOP you authored is now a 409 with a state explanation; deleting an attachment is a soft delete with an audit row, refused outright once the parent certificate is approved or signed. (A-28)
- **The rate limiter never used Redis.** Its client was built inside a function nothing called, so every counter lived in process memory: lockouts reset on each deploy and each replica had its own. Now on the shared client, with an atomic Lua increment; on a Redis outage it falls back to memory rather than failing open. Verified against a real Redis — and against a dead one, to prove the tests can fail. (A-30)
- **`JWT_REFRESH_SECRET` signed nothing.** The key registry holds the access secret, and refresh tokens were signed from it. Tokens now carry a type claim, refresh tokens use the refresh secret alone, the algorithm list is pinned in code, and the backend **refuses to start** if the two secrets are equal or the algorithm is unsupported. (A-31)
- **SCIM PATCH ignored `path`**, the form every major IdP sends, so a deprovision returned 200 and left the account active. Paths are honoured now, an unsupported one is a 400 rather than a silent success, and `userName eq` filters return one user instead of the whole tenant. A missing role guard on group membership was closed at the same time. (A-33)
- **Every per-user permission override silently did nothing** — including `none`, which is a revocation. The matrix was keyed by menu name while every route looks it up by slug. (A-35)
- **Every RabbitMQ call opened a new connection and nothing closed it.** The cache guarded on `connection.isOpen`, which amqplib does not define — the same shape as the ioredis `.connected` bug, kept green by a mock that invented the property. Liveness now comes from the events amqplib really emits. (A-36)
- **The access log was never pruned.** `history: "30d"` names a *file* in `rotating-file-stream`, not a retention period, so the log grew without bound and a file literally named `30d` was created. (A-44)
- **A decommissioned IoT device kept ingesting, and one bad MQTT message shut the server down.** The unscoped lookup dropped the soft-delete predicate; the message handler's rejection was unawaited and uncaught, so it reached the process-level handler that calls `shutdown()`. (A-45)
- **The backend lint gate had never run.** A version mismatch crashed ESLint before it linted a file, and `make verify` runs lint first. It runs now; its 1,319 findings are formatting and are their own commit. (A-34)

- **Any account could mint an unrestricted API key and have SCIM make it SUPERADMIN.** API-key issuance was open to every authenticated user, scopes were whatever the caller sent (`["*"]` accepted), SCIM accepts any API key as a service account, and the SUPERADMIN role id is a constant committed to this repository. Issuance is now `TENANT_ADMIN`-only, scopes must name a real menu slug and action, and SCIM refuses to assign SUPERADMIN or an unknown role and refuses to rename, patch or delete a system role. The 2026-09-21 write-up said SCIM was `auth`-only — it is not; see the record for the correction. (A-27)
- **Any authenticated principal could re-parent another hospital's tenant.** The `Tenant` model has no `tenantId` attribute, so the global scoping hooks never applied to it, and three `tenant-hierarchy` mutations carried `auth` alone. Reads of a named tenant are now the caller's own tenant or **404**; re-parenting and `cross-tenant-roles` are SUPERADMIN-only and refuse API keys. (A-01)
- **Webhooks, storage settings and custom domains were open to every role** — the lowest role could point the tenant's uploads at a bucket it owned, or its event stream at a host it controlled. Now tenant-admin (webhooks, storage) and the `custom-domains` menu gate (domains), with API keys refused on writes. (A-02)
- **API-key scopes were read only by `dynamicAccess`**, so on any route gated another way — or by `auth` alone — a key scoped `warehouse:read` was simply an authenticated principal. Authorization for API keys is now deny-by-default, refused at the controller boundary unless a gate authorized the key. (A-03)

- **Self-registration, passkeys and the OIDC provider were broken in production.** Every helper in `redis.service.js` guarded on `client.connected` — a node-redis v3 property that **ioredis does not have** — so each returned early while Redis was up and healthy: no cache write, no lock, no WebAuthn challenge, no OIDC authorization request ever stored. Verified live before the fix: `POST /auth/register` answered **429 "Registration in progress"** even for a duplicate, and `POST /webauthn/registration-options` answered **503**. The unit test's ioredis mock fabricated a `connected` getter, so the suite stayed green; the getter is gone. Readiness is now `client.status === "ready"`. (A-24)
- **Metered billing read every tenant's usage as zero in production.** `getUsage` and `resetUsage` passed `$1`-style placeholders as Sequelize `replacements`, which only substitutes `?` / `:name`. PostgreSQL answered `there is no parameter $1` on every call — proven against a real PostgreSQL 17 — and `getUsage`'s `catch` turned that into `{ total: 0 }`. The MySQL branch beside it was correct and never ran; the test for the PostgreSQL branch asserted `replacements` as correct behaviour. Now `bind`.
- **RAG no longer answers from the wrong documents on a non-pgvector engine** — the recency fallback is removed with MySQL.

### Found, not yet fixed

- **Audit rows are written after the response, outside the transaction**, on `res.on("finish")`. A rolled-back action can leave a row saying it happened; a committed one can leave none. (A-41)
- **A failed audit write is announced only to `console.error`**, and production writes nothing to stdout — so a compliance record that fails to persist fails silently and durably. (A-42)
- **Revocation does not revoke.** Nothing in the request path reads `sessions`, and the deployed `JWT_ACCESS_EXPIRED` is `1d` where the documentation says `15m`: a revoked session keeps working for up to a day. (A-48)
- **SCIM user creation is a cross-tenant existence oracle** — globally unique email, tenant-scoped duplicate check. (A-37)

- **SCIM PATCH ignores `path`.** `patchUser` reads `op.value` as an object only, so the RFC 7644 form every major IdP sends — `{ "op": "replace", "path": "active", "value": false }` — is silently dropped and the endpoint answers **200 with the user unchanged**. Deprovisioning appears to succeed while the account stays active. (A-33)

### Corrected documentation

More claims found false on 2026-09-23, each corrected where it was made:

- **ADR-017 "User Sessions Bound to IP and User Agent" was never implemented.** The decision was recorded, propagated into six `docs/` files as fact, and the only code that claimed to enforce it was imported by nothing and queried a table that does not exist. Deleted; eleven documents and four ADRs corrected; whether the controls should exist is now an Open Question rather than an assumed feature. (A-12)
- `docs/ENGINEERING/12-LOGGING-CONVENTIONS.md` said `config/socket.js` was the only stdout output in production. There are **25** `console.*` sites, and the one that matters announces a failed audit write.
- `docs/DEVOPS/06-LOGGING.md` described a log redactor as as-built. **There is none**, and it recorded access-log retention that did not exist.
- `docs/API/13-INTEGRATION-API.md`: SCIM responses are wrapped in the platform envelope (no compliant client can parse them), `DELETE /Users` calls `destroy()` rather than deactivating, and credentials are encrypted with `KMS_MASTER_KEY`, not the `ENCRYPT_KEY` it named.
- A-29 said nothing sets `iotEnabled`; the demo seeder does. The conclusion stands, the premise was too broad.

Claims found false in the 2026-09-21 audit, each corrected where it was made:

- there is **no embedded `aedes` MQTT broker** — the backend is an MQTT client of an external broker, off unless `MQTT_HOST` and `MQTT_PORT` are both set; `aedes` is an unused dependency;
- `docker logs` is empty in production because **the application writes nothing to stdout** there (winston's Console transport is development-only), not because of initialisation timing; per-request `logger.http` lines are also dropped in production by level;
- there is **no `pre-push` hook, no secret scanner, no IDOR enforcement script and no `scripts/verify.sh`** — documented as mitigations for deferred CI, none of them exist;
- RAG on a non-pgvector engine did not become "unavailable"; it silently returned the most recent chunks.


### Changed

- **Repository restructured into a documented monorepo.** `docs/` now holds 135 as-built documents across ten categories, `MEMORY/` and `TASKS/` follow the wedding-saas layout, `deploy/` carries the compose stacks and Helm charts, and a Makefile drives development and deployment. Root markdown files were classified into `docs/` rather than deleted. — [record](./records/2026-09-10-monorepo-restructure-and-as-built-docs.md)
- **`docs/` is now as-built.** Every document is grounded in `backend/src` and `frontend/src` and names its source files, replacing a specification that described a system built differently.
- **`CLAUDE.md` and `AGENTS.md` rewritten.** The previous `CLAUDE.md` instructed engineers and agents to write strict TypeScript with no `any` — for a backend that is JavaScript.

- **First production deployment.** Running on a single host behind a Cloudflare tunnel. Nine defects were found doing it, **none of them reachable from a test** — an unanchored `.gitignore` pattern that excluded six committed source files from clean clones, an undocumented fourth required secret, and a proxy rule that broke browser login while the backend answered 200. All fixed in the repository, not only on the host. — [record](./records/2026-09-10-first-production-deployment.md)

### Added

- **ADR-029 through ADR-037** — nine decisions recording what was actually built: ORM-layer tenant isolation, the JavaScript backend, Socket.IO retained, compose-first deployment, password-primary authentication with OIDC both directions, database-backed sessions, the certificate 409, derived tenant `subdomain`, and the three-value tenant status.
- `deploy/compose/` — a base stack plus dev, staging, production and **vm** overlays, with an nginx configuration covering the five routes that fail confusingly when got wrong.
- `KMS_MASTER_KEY` as a documented fourth required secret — generated by `make secrets`, refused by `make check-env`.
- `deploy/helm/callibrator/` — an umbrella chart with backend and frontend subcharts, and **render-time guards** that refuse a missing `image.tag` and refuse `cron.enabled` with more than one replica.
- A `Makefile` whose `preflight` target **refuses** to deploy on `NODE_ENV != production`, `SEED_DEMO=true`, a wildcard CORS origin, a `:latest` tag, or an ACME URL still pointing at Let's Encrypt staging.
- `MEMORY/templates/` — change record, feature spec and phase summary.
- `docs/ARCHIVE/` — superseded root documents, kept for provenance and never authoritative.

### Fixed

- **The Device Calibrator brand is wired in.** The supplied `icon.svg` was a CorelDRAW sheet holding four variants on one artboard; they are cut into `frontend/public/brand/` and the mark is inlined by `components/brand/BrandIcon.tsx` so it adapts to both themes and sidesteps next/image's SVG rejection. It replaces the generic lucide `Shield` that stood in for a logo in the sidebar, the landing navigation and the auth panel. A tenant's own logo still wins where one is configured.
- **The activation and password-reset emails were broken in Outlook.** Both templates carry an Outlook-only (`[if mso]`) VML button that the vendor left pointing at its own site: the activation email showed a button labelled **"Reset Password"** linking to `viewstripo.email` instead of the activation link, and the OTP email showed that same button *instead of the code* — an Outlook recipient never saw their OTP. The activation button now uses the real link, and the OTP branch renders the code.
- **Interpolated URLs were entity-escaped.** Mustache's `{{ }}` escapes `/` to `&#x2F;`, so every URL rendered as `src="https:&#x2F;&#x2F;host&#x2F;…"`. Strict parsers decode it; email clients are inconsistent. URL placeholders now use `{{{ }}}`. (The certificate PDF was never affected — it has its own substitution that inserts the QR data URI raw, deliberately.)
- **Google Fonts `<link>` removed from all three templates.** It is ignored by most mail clients and discloses every open to a third party.
- **Outbound emails no longer hot-link a third party's logo.** All three templates hard-coded `https://fullfind.co` — 21 URL references, **plus the company name as readable footer text**, which a case-sensitive search for the domain missed entirely — from the boilerplate this project started from. Beyond carrying the wrong branding, it made every recipient's mail client fetch an asset from that domain, handing them the open events for every activation and password-reset email. Now resolved from `HOST_URL` and `MAIL_FROM`.
- **`/public` was 404 in every container.** `index.js` mounts `express.static(appPath("public"))`, and the backend Dockerfile never copied the directory — working from a source checkout, missing from the image.
- **A real default avatar for users with no photo.** The placeholder is the same SVG that sits in `backend/uploads/profile/`, committed to `frontend/public/` instead — in its original location it is gitignored, absent from deployed hosts, and shadowed by the uploads bind mount. Rendering it needed `unoptimized`: `next/image` answers **400 for SVG** unless `dangerouslyAllowSVG` is set, so the placeholder would have been a broken image again. That flag is deliberately **not** set — uploaded avatars are user-supplied and an SVG can carry script, so only our own asset bypasses the optimizer.
- **Avatars and tenant logos rendered as broken images.** `users.avatar_url` and `tenants.logo` default to `"default.svg"`, a sentinel the service layer already honours in six places — but the four URL builders did not, so they produced `/uploads/profile/default.svg`, which 404s: nothing ships that file, `backend/uploads/` is gitignored, and `/app/uploads` is a bind mount that would shadow it anyway. Now single-sourced as `DEFAULT_UPLOAD_PLACEHOLDER`; a user with no photo gets the initials block the UI already had. The public branding endpoint was affected too, so the broken logo showed **before sign-in**.
- **The frontend image could not be built.** `frontend/package.json` overrode `eslint` to an exact version while also declaring it a direct devDependency — fine at the workspace root, `EOVERRIDE` inside the container, so `npm install` succeeded locally and only the image build failed. Now npm's `"$eslint"` reference.
- **`npm test` did not run.** The backend scripts invoked `node node_modules/jest/bin/jest.js`, a hardcoded path that stops resolving once a workspace install hoists jest to the repo root; it failed with `MODULE_NOT_FOUND`, which looks nothing like a test failure and made `make verify` unusable. This is what had been hiding the true state of the coverage gate.
- **Five stale failures in `webauthn.service.test.ts`.** The credential stand-ins lacked `getClientExtensionResults()`, the expected payloads omitted two fields the implementation sends on purpose, and one asserted a `userHandle: null` shape the implementation never produces. Test scaffolding, not product bugs — the frontend suite is now green at 69 suites / 677 tests.
- `GET /menu-groups/menu-groups/admin` answered **500**. Express 5 leaves an absent body `undefined` rather than `{}`, and the handler — which serves two GET routes — read `req.body.roleId` unguarded. The sidebar was unaffected, so only the permissions-configuration screen was broken.

### Known open items

- ~~The backend unit-test coverage gate (100%) is currently failing.~~ **Verified passing 2026-09-11** — 289 suites, 5735 tests, 100% statements/branches/functions/lines.
- The `automate/` Playwright suite (71 browser tests) is **documented but not in this repository** — U-07.
- The live E2E suite has **never passed in one uninterrupted run** — every fix verified individually.
- `calibration_records` append-only is a **convention, not a constraint** (PR-2).
- Swagger and the enforced Joi validators disagree for the GDPR endpoints.
- The Helm charts render; **no cluster has been reachable** to validate them.

---

## 2026-07 — Full-stack integration audit

Full account: [`../docs/ARCHIVE/2026-07-fullstack-integration-audit.md`](../docs/ARCHIVE/2026-07-fullstack-integration-audit.md). 51 route modules audited against a running server; 24 defects found, 15 fixed and re-verified live.

### Fixed

- **Authentication, platform-wide** — every token was rejected 15 minutes after login. `verifyAccessToken` passed `maxAge: "15m"` while tokens are signed `expiresIn=1d`.
- **Certificates** — the list returned zero rows while rows existed. Four includes defaulted to INNER JOINs, and every draft has a null actor FK.
- **Certificates** — approval was unreachable: no `submit` transition existed, and approving a draft threw a plain `Error` that surfaced as a 500. Added `POST /:id/submit` and mapped invalid states to **409**. — ADR-035
- **Risks** — risks with no assignee were invisible: absent from lists, 404 on get, update and delete. Same INNER JOIN shape.
- **QMS and SOP** — lists rendered empty because rows were returned inside `data` rather than `data` plus a top-level `meta`.
- **QMS** — a bad enum on `PATCH /nc/:id` reached the database and 500ed; added a validator so it returns 400.
- **Tenants** — every create returned a 500 `notNull` violation. `subdomain` is now derived from `code`. — ADR-036
- **Tenant lifecycle** — suspend, resume and offboard all 500ed with `invalid enum value`. Status is three values; granular state moved to `tenant_settings`. — ADR-037
- **Data retention** — the nightly purge failed **every night** with `column "tenantId" does not exist`; the `sessions` model attribute is `tenant_id`.
- **Data retention** — legal hold always 500ed: a Joi schema was spread into a plain object, then `.validate` called on the result.
- **Workflows** — create, update and submit-action all 500ed: `db` was destructured from the models barrel, which exports `sequelize`.
- **Feature flags, tenant lifecycle, data retention** — several endpoints 400ed every request because path parameters were validated in the body.

### Added

- 51 live E2E specs at `backend/src/tests/e2e/modules/`, run against a running server.
- 51 frontend contract tests, one per service, asserting the exact path, method, payload and envelope unwrap.
- A flag-gated demo seeder (`SEED_DEMO=true`) — ~80 rows, idempotent, with teardown.

### Note

**3,863 tests passed while 13 endpoints were broken.** Frontend services had been written against endpoints that did not exist, with tests mocking the fabrication. That is why the live E2E layer exists.

---

## 2026-07 — Tenant isolation moved out of the database

### Changed

- **Row Level Security removed.** Isolation moved to global Sequelize hooks reading an `AsyncLocalStorage` context, **deny-by-default**, engine-agnostic. Migration `0012` added RLS; `0015` removed it. Both are kept. — ADR-029

Two reasons: RLS is PostgreSQL-only and the platform must also run on MySQL, and the policy carried a fail-open branch — `app.current_tenant = ''` matched **every row**.

### Changed

- **Realtime stays on Socket.IO.** A plain-WebSocket hub was trialled and reverted by decision. — ADR-031

---

## 2026-07 — Pluggable object storage

### Added

- Object storage behind one port with three drivers — `local`, `s3`, `nfs` — selectable globally and **overridable per tenant**, with tenant credentials encrypted at rest. Verified live against MinIO. Migration `0016` added `attachments.storageKey`.

Tenant-supplied S3 endpoints are SSRF-checked; operator-configured ones deliberately are not, because an internal host is a legitimate operator value.

---

## Earlier

The platform reached 33 modules, 72 models, 53 route modules and 342 test files before this changelog existed. That history is reconstructable from `MEMORY/DECISIONS.md`, the migration sequence in `backend/src/migrations/`, and [`../docs/BACKEND/10-MODULE-REFERENCE.md`](../docs/BACKEND/10-MODULE-REFERENCE.md).

**The gap is the point of the file.** Everything above had to be reconstructed by reading code and audit reports, which is exactly what a changelog exists to make unnecessary.
