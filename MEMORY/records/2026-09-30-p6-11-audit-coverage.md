# 2026-09-30 — P6-11: the fifteen unaudited services, and a guard that keeps it so

**Task:** P6-11 (TASKS/PHASE-6-CORRECTNESS-AND-COMPLIANCE.md), spec addendum to
`MEMORY/specs/A-41-audit-inside-transaction.md` · **Scope decision:** ADR-109 §2 (working decision:
all 15 are in scope; the owner has not yet confirmed it) · **No new ADR.** The pattern is A-41's
(`logAction(entry, { transaction })`, re-thrown inside a transaction) and A-282's (`auditPrincipal`).

## What the 2026-09-28 inventory said, and what the code says today

Of the fifteen services the addendum listed as writing no audit row:

| Service | State found on 2026-09-30 | Done here |
|---|---|---|
| `vendor`, `risk`, `supplierScorecard`, `finance` | already audited in the write's transaction (A-278, ADR-094) | nothing — verified, `crudAudit.a278.test.ts` |
| `apiKey` | create/revoke audited (A-278) | nothing. `verifyApiKey` (lastUsedAt stamp) is allow-listed as an authentication step |
| `oidcProvider` | client register/rotate/delete, decisions audited | nothing |
| `webauthn` | register/rename/revoke/disable audited through `auth.service#auditCredentialChange` | nothing (P10 lane owns the file). `verifyLogin` (signature counter) allow-listed |
| `kanban` | **none of 23 writes** | all 23 audited |
| `ticket` | **none** | create, update, assign, delete, comment |
| `content` (CMS) | **none** | post and category create/update/delete |
| `featureFlag` | **none** | set/reset/initialize, as A-165 records a platform act on a tenant: a PLATFORM row + a tenant row |
| `warehouse` | **none** | warehouse and storage-location create/update/delete; `deleteWarehouse` now soft-deletes INSIDE its transaction (it used to save outside it) |
| `meteredBilling` | **none** | usage-alert create/delete. `trackUsage` (metering counters), `enforceQuotas` and `resetUsage` (no production caller) allow-listed |
| `notification` | none | **allow-listed, not audited** — see "Decided here" |
| `ai` | none | **allow-listed, not audited** — `ingestDocument` rebuilds a derived RAG index, only from the `backfillEmbeddings` CLI |

Every new row: `tenantId` from the row's tenant (never the body), actor from
`auditPrincipal(req)`: a user as a user, an API key as `system:api-key` with `changes.apiKeyId`
(A-282). Where the service is called without a principal, the service's own `user` is used.
`action`/`resourceType`/`resourceId`/`changes: { operation, before?, after? }`. Free text is never
recorded: not card or ticket descriptions, not comment bodies, not post bodies (`bodyChanged` /
`descriptionChanged` flags record that one changed). The fields are the ones existing rows already
carry. `logAction`'s D-27 redaction still applies.

Files: `services/{kanban,ticket}.service.js`, `services/{content,featureFlag,warehouse,meteredBilling}.service.ts`
and their six controllers, which pass `auditPrincipal(req)` as a trailing argument.

## Decided here (accepted by the main session 2026-09-30, ADR-109 §2 Amendment; the owner may still overturn)

- **`notification.service` is allow-listed, not audited.** A notification row is a derived message:
  W-04 already writes it beside its caller's own audit row, in the caller's transaction. Read, hide
  and delete are the user's own inbox state. One audit row per "mark as read" in the append-only
  `audit_logs` (0091) would be noise, not attribution. If the owner wants inbox deletions audited, it
  is one `logAction` in `removeForUser`.
- **`ai.ingestDocument` is allow-listed.** The chunks are derived from a source document, rebuilt
  idempotently, and written only by a CLI.
- **`featureFlag.initializeTenantFlags` without an actor writes no row.** The one caller without one
  is the development-only demo seeder (`migration.service`), which audits none of the demo data it
  creates. The route passes the principal and is audited.
- **`kanban.migrateCards` records the selection, not every moved id.** That means the explicit
  `cardIds`, or `{ allNotDone, fromSprintId }`, with the count. Reading every moved card would be an
  unbounded `findAll` (D-24 caught the first version).

## The guard (fails on a new unaudited mutation)

`src/tests/guards/auditCoverage.p611.test.ts` extends `auditInTransaction.p611.test.js`, which
checks only that every `logAction` call passes a transaction. The new guard checks every **exported
entry point** of every `services/` module. It follows same-file helpers transitively. A writing
entry point (create/update/destroy/save/upsert/…, or raw INSERT/UPDATE/DELETE) must reach
`logAction` (or `auditCredentialChange` / `recordAccountLock`), or it must be on `ALLOWED`, keyed
`services/<file>#<fn>` with its reason. A stale entry fails too. Its limits are stated in the
header: it reads source, and it does not follow a helper in another file.
`attachment.service#softDeleteForResource` is deliberately **not** accepted as an audit call. It
audits the attachments, not the parent, and it let kanban's deleteProject/deleteCard pass the first
draft while writing no row of their own.

### Found by the guard outside the fifteen (all closed on 2026-09-30: phase 2 below, and stock by the services helper)

These write with no audit row and are not in the decided set. Each is on `ALLOWED` as `KNOWN GAP`,
so the build stays green and a fix must take its entry off:

- `auth.registerUser` (self-registration creates a user)
- `billing.getSubscription` (a read that lazily creates a subscription)
- `sso.provisionUser`
- GDPR consent, restriction, preferences and DSAR (`gdpr` ×6)
- SCIM **groups** (×4; SCIM users are audited)
- `sop.createDocument`
- `stock.deleteStock` / `createOpname` / `updateOpnameStatus`: the services helper is taking these
  under A-321 and was told to take its entries off
- `storage/config` set/clear tenant config
- `workflow.startWorkflow`

Infrastructure entries (sessions, MFA/OTP codes, Redis revocation, ClamAV, seeders, webhook
outbox, storage migration, backup sweep) carry the A-41 addendum's "infrastructure" reason.

## Evidence

- **Behaviour (memoryDb, REAL routers/gates/validators/controllers/services/audit service/models):**
  `src/tests/routes/auditCoverage.p611.test.ts`, 90 tests over 45 routes. Each route commits exactly
  the expected rows (one; two for a feature flag) in the SAME transaction as the entity write, naming
  the principal. With `logAction` forced to write its row and then throw, the route commits neither
  the row nor the entity write (and the row WAS written, in the rolled-back transaction).
- **Fail-before:** in a scratch copy of `backend/` with exactly this lane's service edits reversed
  (the edit scripts' replacement pairs applied backwards; controllers kept), the two new suites
  fail 93 of 98. The behaviour suite fails on "Expected length: 1, Received length: 0" and the forced
  rollback answers 201. The guard lists 45 unaudited entry points (kanban ×21, ticket ×5, content ×6,
  featureFlag ×3, warehouse ×6, meteredBilling ×2), and kanban shows 2 audited where 23 are expected.
  With the edits, 98/98 pass.
- **Live, PostgreSQL 18 (pgvector:pg18), AS `callibrator_app`:** `src/tests/services/auditRollback.p611.live.test.ts`
  ran 4/4 green on a scratch container (`p611-pg18`, removed by name afterwards). Schema built by
  `runSchemaSetup`; the role is asserted non-superuser. Warehouse (TS, unmanaged tx) and kanban (JS,
  managed tx) each commit their row. An API key's row is `actor_type=system`,
  `actor_name=system:api-key`, `user_id NULL`: the users FK and 0033's CHECK accept it. A forced
  rollback after the row leaves neither the entity nor the row. Skipped unless `P611_PG_LIVE_TEST=1`
  (run line in its header).
- **Unit suites updated** (audit mock, `{ transaction }` arguments, P6-11 blocks): `kanban.service`
  (115), `ticket.service` (54), `content.service` + `content.sanitize.a298` (89),
  `featureFlag.service` ×2 (40), `warehouse.service` (55), `meteredBilling.newmethods` (42), the six
  controller suites (84).
- Affected set: `npm test -- "kanban|ticket|content|featureFlag|warehouse|meteredBilling|auditCoverage|auditInTransaction|p611|stock"`
  gave 50 suites, 1,167 tests, all passing (before stock's in-flight change).
- `npx eslint` on every changed file: 0 errors (pre-existing warnings only). `npm run typecheck`:
  none in these files. `npm run ratchet`: passes (no new `.js`).

### Gates red on the shared tree, NOT from this change (named, at the time of the run)

- `npm run test:coverage -- --ci`: 6 suites and 19 tests failed; 14,497 passed. Global coverage was
  99.94 / 99.42 / 99.66 / 99.95; **every file changed here is at 100%** except the A-277 line
  `kanban.service.js:195`, which other suites cover. The failures: `stock.service.test.js`,
  `stock.controller.test.js` and `stock.deleteInTransaction.a321.test.ts` (A-321 in flight, services
  helper); `__tests__/reporting.service.test.js` (CSV quoting, A-319 lane);
  `swaggerValidatorAlignment.p608` (`PATCH /api/v1/roles/:id`); `unboundedFindAll.d24`, now only
  `customDomains.service.ts` (the F-19 lane). The kanban entry was mine and is fixed.
- `npm run typecheck`: `pathParams.a273.test.ts`, `session.revoke.n01.test.ts`,
  `certificateDocument.snapshot.q50.test.ts` and `models/session.model.ts` (`underscoredAll`).
- `npm run build:dist`: `models/session.model.ts`, `services/signingKeyWrap.service.ts` (unused
  `tenantId`).

## Coordination

The P9 lead and both helpers were messaged before any edit. None of these files was in flight
except `webauthn.service.ts` (P10 lane), which already audited everything, so it was not touched.
Handed over: stock (A-321), meteredBilling's quota suspension (A-322) and ticket's search (A-320)
to the services helper, told which `ALLOWED` entries to remove. Another lane edited
`warehouse.service.ts`'s header after this change (A-320); the audit code is intact.

## Phase 2 (same day): the gaps outside the fifteen

The main session put the guard's known gaps in scope too (ADR-109 §2 Amendment). Stock stayed with
the services helper (A-321 audited `deleteStock` and A-322 audited the `enforceQuotas` suspension,
and it removed their entries). This lane did the rest, one row per mutation, in the mutation's
transaction, with the actor from `auditPrincipal(req)`:

| Entry point | Row | Never recorded |
|---|---|---|
| `gdpr` `recordConsent` / `withdrawConsent` (and `updateConsent`, per purpose) | `ConsentRecord` CREATE / UPDATE, `GDPR_CONSENT_GRANT` / `_WITHDRAW`, purpose, version, `subjectId` | the IP stays on the consent record; nothing personal |
| `gdpr.createDsar` (and `restrictProcessing`) | `DsarRequest` CREATE, `GDPR_DSAR_CREATE`, type, `hasDetails` | the free-text reason/details |
| `gdpr.updatePrivacyPreferences` | `User` UPDATE, `GDPR_PRIVACY_PREFERENCES`, the preference **keys** | the preference values |
| `scim` create/update/patch/delete **Group** | `ScimGroup`, `system:scim` with `apiKeyId`, before/after `{displayName, roleId}`, members added, patch operations | — |
| `sop.createDocument` | `SopDocument` CREATE, `SOP_CREATE`, number/title/version/status | — |
| `storage/config` set / clear (both routes, through `storageSettings`) | `TenantStorageConfig` UPDATE, `STORAGE_CONFIG_SET` / `_CLEAR`, changed keys, secret-free before/after, `credentialsSet: ["accessKeyId", …]` | any key or secret; clearing nothing writes no row |
| `auth.registerUser` | `User` CREATE, `USER_SELF_REGISTER`, the new account as its own actor, under PLATFORM when it has no tenant (as the LOGIN row) | email, username |
| `sso.provisionUser` | `User` CREATE, `SSO_JIT_PROVISION`, the provisioned account as actor, request IP/UA | email |
| `billing.getSubscription` | it **does** write (the first read creates the basic subscription): `Subscription` CREATE, `SUBSCRIPTION_DEFAULT_CREATE`, naming the reader | — |
| `workflow.startWorkflow` | **reclassified, not audited**: every caller (certificate create/resubmit, stock transfer) runs it inside its own transaction and records `workflowInstanceId` in its own row. A guard test pins that | — |

`setTenantConfig`'s upsert, credentials row and audit row now share one transaction; they used to
be three autocommits. The guard's blind spot here: `storageSettings.service` reached the writer
through another file and was never flagged. That is now covered at the writer.

**Guard fixes** (reported by the services helper when `workflow.service.ts` and `iot.service.ts`
converted): `export = new X()` and `export = x` of `const x = new X(...)` are read as class
instances, and method heads whose parameters continue on the next line (with TS modifiers) are
recognised. There are bite tests for both. Sixteen `ALLOWED` entries are removed. What remains
outside infrastructure: only the accepted judgements.

**Evidence (phase 2):**
- New P6-11 blocks in `gdpr.newmethods` (6), `sop.service` (2), `storage.config` (3),
  `scim.groups.tenantOwned.a38` (2, through the real SCIM router), `billing.service` (3),
  `auth.activationBinding.a191` (4, on the audit-ledger fixture), and `sso.service` (3), plus
  the guard's 3 new tests.
- **Fail-before:** on a scratch copy with this phase's service edits reversed (script pairs applied
  backwards), `-t "P6-11"` over those suites fails 20 of 28. The 8 that pass are the "writes
  nothing" controls. With the edits, 28/28 pass.
- Updated for the new argument or transaction: `gdpr.controller`, `sop.controller`,
  `storage.controller`, `storageSettings.service`, `scim.controller`, `billing.controller`,
  `auth.controller`, `sso.oidcRoundTrip.a68`, and `auth.tokenPurpose.a59` (its fake transaction
  now stubs the registration row).
- Suites: auth/sso/register 1,694 pass; gdpr 189; sop+storage 329; scim 266; billing 281.
- `npm run typecheck` clean, `npm run load:check -- --src` OK, `npm run build:dist` green,
  ratchet passes, eslint 0 errors on every changed file.
- `npm run test:coverage -- --ci` (final run): **every file changed in either phase is at 100%**
  (the first run found three branches, in `gdpr` createDsar's null details, `scim#deleteGroup` with
  no actor and `auth.controller`'s bare request, and tests were added). 14,550 pass. 32 tests in 9
  suites fail, none in these files: `tenant.service.ts` (63.8% branches) and
  `tenant.service.coverage`, `tenantLifecycle.w01`, `tenantSettings.allowList.a176` (a tenant
  conversion in flight), `clamAv.service`, migrations `0067` and `0086`, `reporting.service` (A-319
  CSV), `swaggerValidatorAlignment.p608`, and `sso.refusalTiming.a292` (a 60 ms timing test that
  passes in isolation).

## Open

- The owner confirms ADR-109 §2 and its Amendment (the scope, the three judgements, the phase-2
  set).
- None left on the guard's KNOWN GAP list. The services helper audited `stock#createOpname` and
  `#updateOpnameStatus` in their transactions (fail-before test `stock.opnameAudit.p611.test.ts`,
  3/3) and removed both entries.
- A deletion from a user's own notification inbox leaves no audit trace. That is the accepted
  judgement (a).
