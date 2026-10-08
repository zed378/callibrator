# Test Plan — P18-04 Two-Tenant and Two-Facility: Every New `:id` Route and Every Cross-Facility Case, With Its Expected Answer and the Test That Proves It

**Written:** 2026-10-08 — **before** implementation. **Every test named here is TARGET** unless marked *existing*. Nothing was run for this plan.
**Task:** P18-04 (Phase 18). **Input:** the `@2f` rows and guards of [`P18-03-facility-scope-permissions.md`](./P18-03-facility-scope-permissions.md) § 8, § 15; the routes of [`P19-01-inspection-catalogue.md`](./P19-01-inspection-catalogue.md) § 8.2 and [`P19-04-client-facilities.md`](./P19-04-client-facilities.md) § 13.1, § 17; the gate rows G-01 … G-31 and cases PT-01 … PT-33 of [`docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md`](../../docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md) § 11 – § 12 (referenced, not copied); the route files read 2026-10-08 (`backend/src/routes/api/*.route.ts`, mount points in `backend/index.ts`) and the existing `@two-tenant` markers under `backend/src/tests`.
**Consumed by:** P21-09 (builds `twoFacilitySuite`, `twoFacilityRoutes.guard`, the route default), each Phase 21 route card (adds its rows' tests), P17-07 (penetration test), P26 (UAT entry), the **pre-invitation gate** (`docs/SECURITY/15` § 11: this plan executed is one of its conditions).
**Card DoD:** *"test plan reviewed before Phase 21 starts"* — P21-09's first step is that review; a route whose path changes in a later spec updates its row here in the same change (§ 8).

> **Privacy.** Synthetic fixtures only: tenants T1/T2, facilities SELF, F1, F2 (T1) and F3 (T2), names like "Facility One", codes `F-0001`, `contact@example.test`.

---

## 1. Expected Answers — the Vocabulary of This Plan

| Code | Meaning | Asserted how |
|---|---|---|
| **404=** | another tenant's or another facility's row answers **404 with a body identical to a random UUID's** (request id aside); **nothing is written** (row counts and the touched row compared before/after); a **positive control** (the same call on an own-scope row) succeeds in the same test | `fixtures/twoTenantSuite.ts` (*existing*: compares against `MISSING_ID`) / `fixtures/twoFacilitySuite.ts` + `probeCrossFacility` in `fixtures/routeClient.ts` (P21-09, P19-04 spec § 17 G-07) |
| **absent** | a list never contains the other scope's rows, with every filter, sort and paging parameter; `meta.total` equals the own-scope count; a foreign `clientFacilityId` filter returns an **empty** list, not an error | list assertions in the same suite |
| **403-route** | a bound principal on an **unmarked** route: **403 `FACILITY_ROUTE_REFUSED`**, decided before any parameter is read — identical for a valid id, another facility's id and a malformed id (G-10, AM-12). Not an existence oracle because it is id-independent | `routes/facilityRouteDefault.test.ts` (one sweep over the mounted table) |
| **403-self** | a `selfParam` route (P18-03 S-7) called by a bound principal with any id but its own: **403**, id-independent | `routes/userSelf.facility.test.ts` |
| **forced** | a create/write by a bound principal lands in **its own** facility whatever the body says; a body naming another facility's parent (device, session) is **404=** | per-route write cases |
| **200-global** | global content (ADR-125 catalogue) — the same answer and `ETag` for every principal; no facility rows exist | `ipmCatalogue.twoFacility.test.ts` |

**Markers.** `@two-tenant api/<file>.route.ts <METHOD> <path>` (*existing* format, `guards/twoTenantRoutes.guard.test.ts`) and **`@two-facility api/<file>.route.ts <METHOD> <path>`** (new, read by `guards/twoFacilityRoutes.guard.test.ts`, P21-09). A test file carrying either marker must assert a 404 (the existing guard's rule, kept for the new one).

**Principals** (`fixtures/twoFacilitySuite.ts`, P19-04 spec § 17 G-07): in T1 — unbound `CALIBRATOR ADMIN` (CA) and `TECHNICIAN` (T); bound in F1 — `HEALTHCARE ADMIN` (HA1), `ROOM USER` (RU1), `HEALTHCARE TECHNICIAN` (HT1), `FACILITY MAINTENANCE` (FM1); bound in F2 — `HEALTHCARE ADMIN` (HA2); a bound user with an unresolvable facility (BX); in T2 — an admin and a bound F3 user (the tenant regression). Rows in SELF, F1 and F2 for every facility-scoped model the route reads.

---

## 2. Part A — New `:id` Routes and Their **Two-Tenant** 404 (a T2 principal against T1's row)

Every new route with a path parameter is either covered by an `@two-tenant` test asserting **404=** or on the reviewed allow-list of `twoTenantRoutes.guard` with a kind. Paths marked ‡ are **provisional** — fixed by the spec named, which updates this row (§ 8).

| # | Route (mount `/api/v1`) | Built by | Expected for T2 | Test (marker) / allow-list kind |
|---|---|---|---|---|
| A-01 | `GET /device-types/:deviceTypeId` | P21-01 | 200-global | allow-list `not-tenant-owned` (ADR-125) |
| A-02 | `PATCH /device-types/:deviceTypeId`, `POST …/:deviceTypeId/retire`, `…/reactivate` | P21-01 | 403 (super admin only) | allow-list `platform`; `inspectionCatalogueGlobal.guard` |
| A-03 | `GET /ipm/template-versions/:versionId` | P21-01 | 200-global for `published`/`retired`; **404** for a draft/discarded id to every non-operator | allow-list `not-tenant-owned`; `ipmTemplateVersions.read.test.ts` |
| A-04 | `POST /ipm/templates/:templateId/{retire,reactivate,versions}`; `PUT /ipm/template-versions/:versionId/items`; `PATCH /ipm/template-versions/:versionId`; `POST …/:versionId/{publish,discard}`; `GET`/`PATCH /ipm/item-definitions/:itemDefinitionId`, `POST …/retire` | P21-01 | 403 | allow-list `platform` |
| A-05 | `GET /ipm/template-proposals/:proposalId`, `POST …/:proposalId/withdraw` | P21-01 | **404=** | `routes/ipmTemplateProposals.twoTenant.test.ts` (`@two-tenant` × 2) |
| A-06 | `POST /admin/ipm/template-proposals/:proposalId/{accept,reject}` | P21-01 | 403 (admin router) | allow-list `platform` |
| A-07 | `GET`, `PATCH`, `DELETE /client-facilities/:clientFacilityId`; `POST …/:clientFacilityId/status`; `GET …/:clientFacilityId/users` | P21-09 | **404=** | `routes/clientFacilities.twoTenant.test.ts` (× 5) |
| A-08 | `PUT /users/:userId/client-facility` (bind / unbind / move a user) | P21-09 | **404=** (another tenant's user, or a facility id of another tenant in the body) | `routes/userBinding.twoTenant.test.ts` |
| A-09 | `POST /calibration-devices/:calibrationDeviceId/move`, `GET …/:calibrationDeviceId/moves` | P21-09 | **404=** (also: a target facility of another tenant in the body) | `routes/deviceMove.twoTenant.test.ts` (× 2) |
| A-10 | IPM sessions (paths fixed by the P19-02 spec § 10.2, 2026-10-08): `GET /ipm/sessions/:sessionId`; `PATCH /ipm/sessions/:sessionId` (draft header); `PUT …/:sessionId/results`; `POST …/:sessionId/{submit,discard,corrections,void}`; `GET …/:sessionId/report-document` (P19-06's); `GET /calibration-devices/:calibrationDeviceId/ipm-sessions` | P21-03 | **404=** | `routes/ipmSessions.twoTenant.test.ts` (× 10) |
| A-11 | IPM report signatures (path fixed by the P19-06 spec § 8, 2026-10-08): `POST /ipm/sessions/:sessionId/signatures` (`kind` performer / countersign) | P21-04 | **404=** | `routes/ipmSignatures.twoTenant.test.ts` |
| A-12 | QR lookup (path fixed by the P19-03 spec § 8.2, 2026-10-08; registered before `/:calibrationDeviceId`): `GET /calibration-devices/by-qr/:qrCode` | P21-02 | **404=** — another tenant's QR is indistinguishable from an unknown one (QR unique per tenant) | `routes/deviceQrLookup.twoTenant.test.ts` |
| A-13 | device photos (fixed by the P19-03 spec § 7.2): `POST /calibration-devices/:calibrationDeviceId/photos`, `DELETE …/photos/:attachmentId` | P21-02 | **404=** | `routes/devicePhotos.twoTenant.test.ts` (× 2) |
| A-14 | quick calibration-date entry (fixed by the P19-05 spec § 7.2): `POST /calibration-devices/:calibrationDeviceId/calibration-dates` | P21-05 | **404=** | `routes/calibrationDates.twoTenant.test.ts` |
| A-15 | public-page token administration ‡ (P19-07): `POST`, `DELETE /calibration-devices/:calibrationDeviceId/public-token` | P21-08 | **404=** | `routes/publicDeviceToken.twoTenant.test.ts` (× 2) |
| A-16 | public device page ‡ (P19-07): `GET /public/devices/:token` | P21-08 | unknown, revoked and another tenant's token all the **same** 404, rate-limited | allow-list `capability-token`; `routes/publicDevice.token.test.ts`; PT-31 |

**Existing `:id` routes** keep their *existing* two-tenant tests unchanged (G-31): `calibrationDevices.twoTenant.test.js`, `calibrationRecords.twoTenant.test.ts`, `certificates.lifecycle.twoTenant.test.ts`, `certificates.twoTenant.a145.test.js`, `attachments.twoTenant.test.ts`, `attachmentSigned.a365.test.ts`, `maintenance.twoTenant.test.js`, `warehouse.twoTenant.test.js`, `notifications.twoTenant.test.js`, `gdpr.twoTenant.test.ts`, `gdpr.exportDownload.a360.test.ts`, `user.twoTenant.test.ts`, `webauthnCredentials.twoTenant.test.ts`.

---

## 3. Part B — Existing Routes Marked Facility-Accessible: the **Two-Facility** Cases

Each row: a bound F1 principal (HA1 unless stated) uses F2's id. **Every row also runs the positive control** (its own F1 row) and the **unbound control** (CA and T reach both F1 and F2 rows — FT-39, a marker must not break provider staff).

| # | P18-03 row | Route | Cross-facility case | Expected | Test file (`@two-facility` markers) |
|---|---|---|---|---|---|
| B-01 | A-1 | `GET /calibration-devices/:calibrationDeviceId` | F2's device | **404=** | `routes/calibrationDevices.twoFacility.test.ts` |
| B-02 | A-1 | `GET /calibration-devices` | list, every filter/sort/page; `?clientFacilityId=F2` | **absent**; foreign filter → empty | same file |
| B-03 | A-3 | `PUT /calibration-devices/:calibrationDeviceId` (HT1, UD-4 (b)) | F2's device; own device with `clientFacilityId: F2`, QR, status in the body | **404=**; body fields **refused 400** by the bound contract (row unchanged) | same file |
| B-04 | A-2 | `POST /calibration-devices` (HT1) | body `clientFacilityId: F2` / `client_facility_id` / header `x-facility-id` | **forced** (lands in F1) or 400 strict contract; never in F2 (PT-02) | same file |
| B-05 | A-4 | `GET /calibration-records/:calibrationRecordId` | F2's record | **404=** | `routes/calibrationRecords.twoFacility.test.ts` |
| B-06 | A-4 | `GET /calibration-records` | list | **absent** | same file |
| B-07 | A-6 | `GET /attachments/:id`, `GET /attachments/:id/download`, `POST /attachments/:id/signed-url` | an attachment of an F2 device | **404=** × 3; no URL minted | `routes/attachments.twoFacility.test.ts` |
| B-08 | A-6 | `GET /attachments` | list with `resourceType`/`resourceId` of an F2 device | **absent** | same file |
| B-09 | A-5 | `POST /attachments` (HT1) | `resource_type=device`, `resource_id` = F2's device | **404=**; nothing stored (storage and row counts) | same file; and `routes/attachmentsUpload.bound.test.ts` (G-P6: `generic`/`ticket`/`post` → 403) |
| B-10 | — | `GET /attachments/:id/signed` (redemption, no principal) | a token minted for F1's attachment after the row moved to F2 / the issuer re-bound / F1 ended | **404** (v3 token, G-23) | allow-list `capability-token` in `twoFacilityRoutes.guard`; `routes/attachmentSigned.twoFacility.test.ts`, `services/attachmentSigned.replay.test.ts` |
| B-11 | A-7 | `GET /certificates/:certificateId`, `…/document`, `…/pdf` | F2's certificate | **404=** × 3 | `routes/certificates.twoFacility.test.ts` |
| B-12 | A-7 | `GET /certificates` | list | **absent** | same file |
| B-13 | A-8 | `GET /maintenance/:orderId` | F2's work order | **404=** | `routes/maintenance.twoFacility.test.ts` |
| B-14 | A-8 | `GET /maintenance` | list; vendor and assignee includes | **absent**; vendor/assignee `null` for bound (deny per include, AM-5) and **the order still listed** (LEFT include) | same file |
| B-15 | A-9 | `GET /warehouses`, `GET /warehouses/:warehouseId` (marked by the P19-03 spec § 6.4, ADR-132; `GET /warehouses/:warehouseId/locations` stays **unmarked** → 403-route) | F2's room; a provider store | **404=** for F2's room and for any store; the list holds F1's rooms only — lands with P20-02 / P21-02 | `routes/warehouse.twoFacility.test.ts` |
| B-16 | A-10 | `GET /dashboard/metrics` | figures with F2 rows present | only F1's figures — **only if marked** (OQ-8: with G-20 green); else **403-route** | `services/dashboardCache.twoFacility.test.ts`, `routes/dashboard.twoFacility.test.ts` |
| B-17 | S-2 | `POST /sessions/mine/:id/revoke` | HA2's session; RU1's session (same facility, other user) | **404=** both (own-user rule) | `routes/ownSessions.facility.test.ts` |
| B-18 | S-3 | `PATCH`, `DELETE /webauthn/credentials/:id` | HA2's credential | **404=** (per-user ownership; the table has no tenant column, C-9) | `routes/webauthnCredentials.twoFacility.test.ts` |
| B-19 | S-4 | `GET /gdpr/exports/:exportId/download`, `GET /gdpr/erasure/:requestId` | HA2's export / request | **404=** × 2 | `routes/gdprSelf.facility.test.ts` |
| B-20 | S-4 | `POST /gdpr/export` (HA1) | HA1's own export | **complete** — contains HA1's own rows from facility-scoped tables (the reviewed `skipFacilityScope` of P18-03 § 10.2), nothing of HA2 | same file |
| B-21 | S-5 | `PATCH /notifications/:notificationId/read`, `DELETE /notifications/:notificationId` | HA2's notification; a tenant broadcast with no user | **404=** × 2 | `routes/notification.facility.test.ts` |
| B-22 | S-5 | `GET /notifications`, `PATCH /read-all`, `DELETE /all`, `DELETE /bulk` | — | only HA1's own; bulk ids of HA2 ignored (count unchanged for HA2) | same file |
| B-23 | S-7 | `PATCH /users/:userId/profile`, `POST`/`DELETE /users/:userId/avatar` | HA2's id, RU1's id, a random id | **403-self**, identical × 3; own id → 200 with no `clientFacilityId`, `roleId`, `tenantId`, `status` accepted (PT-08) | `routes/userSelf.facility.test.ts` |

---

## 4. Part C — Target Routes Marked Facility-Accessible (Phase 21)

| # | P18-03 row | Route ‡ | Principal | Cross-facility case | Expected | Test file |
|---|---|---|---|---|---|---|
| C-01 | N-1 | `GET /ipm/templates/published`, `GET /device-types/:deviceTypeId`, `GET /ipm/template-versions/:versionId` | HA1, HT1 | — (global) | **200-global**, same `ETag` as CA | `routes/ipmCatalogue.twoFacility.test.ts`; exempt in `twoFacilityRoutes.guard`, reason "global (ADR-125)" |
| C-02 | N-11 | proposals list / `:proposalId` / create / withdraw | HA1 | any | **403-route** (unmarked) and zero rows from the model (hooks DENY) | same file |
| C-03 | N-2 | `GET /ipm/sessions/:sessionId`, `GET …/:sessionId/report-document` (paths fixed by P19-02 § 10.2) | all bound F1 | F2's session | **404=** | `routes/ipmSessions.twoFacility.test.ts` |
| C-04 | N-2 | `GET /calibration-devices/:calibrationDeviceId/ipm-sessions`, `GET /ipm/sessions` | all bound F1 | F2's device; list | **404=**; **absent** | same file |
| C-05 | N-3 | `POST /ipm/sessions` (create draft) | HT1 | body names F2's device by id; a `clientRef` used by another user | **404=**; nothing written; `clientRef` unique per creator (P19-02 § 9.3), so no collision across users | same file |
| C-06 | N-3 | `PATCH /ipm/sessions/:sessionId`, `PUT …/:sessionId/results`, `POST …/:sessionId/{submit,discard,corrections}` | HT1 | F2's session (draft or submitted) | **404=** × 5; F2 row unchanged | same file |
| C-07 | N-3 | the same on **another F1 user's** draft | HT1 | own facility, other creator | **403** (creator rule, ADR-126 § 3) — not a facility case, asserted here for completeness | same file |
| C-08 | N-4 | `POST /ipm/sessions/:sessionId/void` | HA1, HT1 | any id | **403-route** (unmarked; `rbac` tenant-admin, refused by G-09) | `routes/ipmVoid.bound.test.ts` (G-P7) |
| C-09 | N-5 | `POST /ipm/sessions/:sessionId/signatures` | HT1 (performer), FM1 (countersign) | F2's session; FM1 countersigning HT1's **own** submission as HT1 | **404=**; the submitter cannot countersign → **403** `IPM_COUNTERSIGN_SOD` naming the rule (UD-17 working decision; P19-06 § 7.1); an unbound FM on a client facility → 403 `IPM_COUNTERSIGN_FACILITY` | `routes/ipmSignatures.twoFacility.test.ts`, `routes/ipmCountersign.sod.test.ts` (P21-04) |
| C-10 | N-6 | `POST /calibration-devices/:calibrationDeviceId/photos`, `DELETE …/photos/:attachmentId` (P19-03 § 7.2) | HT1 | F2's device / photo | **404=** × 2; nothing stored | `routes/devicePhotos.twoFacility.test.ts` |
| C-11 | **N-13 (added here)** | `GET /calibration-devices/by-qr/:qrCode` (P19-03 § 8.2) | HT1, RU1 | F2's QR; another tenant's QR; a deleted device's QR | **404=** identical to an unknown QR (PT-31) | `routes/deviceQrLookup.twoFacility.test.ts` |
| C-12 | N-8 | technician activity list | all bound F1 | provider technicians' work in F2 | **absent**; performer shown only through the snapshot (FT-60) | `routes/technicianActivity.twoFacility.test.ts` |
| C-13 | N-9 | `GET /ipm/due` (P19-02 § 10.2) and the device list's `ipmDue` / `calibrationDue` filters; condition widgets (P21-07) | all bound F1 | F2 devices due | **absent**; counts = F1 only; cache key per facility (G-20) | `routes/ipmDue.twoFacility.test.ts` |
| C-14 | N-7, N-10, N-12 | client facilities, quick calibration date, public page | bound | any | **403-route** for N-7/N-10; N-12 is public (A-16) | G-10 sweep |
| C-15 | S-8 | `GET /client-facilities/mine` | bound F1; unbound CA; BX | — | F1's row only; `null` for CA; BX refused at authentication (`FACILITY_UNRESOLVED`) | `routes/clientFacility.twoFacility.test.ts` |

**Gap found and closed here (N-13):** P18-03 § 8.3 lists no **QR lookup** route, yet field capture starts by scanning a sticker (F-23, ADR-127 § 6) and the threat model's PT-31 tests "a signed-in F1 technician resolving F2's legacy QR → 404". The lookup must be **marked** (read, all bound roles) or the bound technician cannot start a capture. Recorded in the P18-03 spec § 8.3 as row N-13 (2026-10-08).

---

## 5. Part D — Unmarked Routes, Administration and Moves (bound → 403; other tenant → 404)

One sweep (`routes/facilityRouteDefault.test.ts`, G-10) proves **403-route** for every unmarked mounted route as HA1; these rows are listed because a mistake on them is the escalation path (FT-37, PT-07) and each also has its own two-tenant case:

| # | Route | Bound F1 (HA1) | T2 principal | Test |
|---|---|---|---|---|
| D-01 | `PUT /users/:userId/client-facility` | **403-route** (and G-09 refuses a planted marker) | **404=** | G-10 sweep; `userBinding.twoTenant.test.ts`; `userBinding.selfBind.test.ts` |
| D-02 | `POST /calibration-devices/:calibrationDeviceId/move`, `GET …/moves` | **403-route** | **404=** | G-10; `deviceMove.twoTenant.test.ts` |
| D-03 | every `/client-facilities/:clientFacilityId` route | **403-route** | **404=** | G-10; `clientFacilities.twoTenant.test.ts` |
| D-04 | device `DELETE`, `restore`, `reinstate`, `bulk-import` | **403-route** (HT1 holds `calibration` W after UD-4 (b) — the marker, not the grant, refuses) | *existing* tests | G-10 |
| D-05 | every calibration-record write; every certificate write and `GET /certificates/stats` | **403-route** | *existing* | G-10 |
| D-06 | `/reports/*`, `/search`, `/ai/*`, `/calibration-scheduler/*`, `/predictive-maintenance/*`, `/iot/*` (authenticated) | **403-route** (PT-10) | *existing* | G-10 |
| D-07 | users, roles, user permissions, menu-group administration, sessions administration (`GET /sessions/:id`, `DELETE /sessions/:id`, `POST /sessions/:id/revoke`, `POST /sessions/user/:userId/revoke-all`), tenants, backups, API keys, webhooks, storage, billing, audit, data retention, GDPR administration, feature flags, custom domains, network security, OIDC, SCIM | **403-route**, identical for valid and invalid ids (PT-07) | *existing* | G-10 |

---

## 6. Part E — Cross-Facility Cases Outside the Route Table

Kept in the threat model's gate matrix (`docs/SECURITY/15` § 11) — referenced here so the plan is complete; each row's expected answer:

| Case | Expected | Gate row / test |
|---|---|---|
| Hooks: bound + no facility; provider-internal models; includes both join types; hookless statics; bulk destroy; facility column changed | zero rows / DENY / predicate on every include / scoped `sum`·`count` / refused | G-01 … G-06 (`utils/tenantScope.facility*.test.ts`) |
| Raw SQL reachable by a bound principal | binds the context's facility; no `IS NULL OR` | G-14 |
| Socket rooms and emitters; re-check after a move | F1 events only; joins of F2 rooms refused; disconnect ≤ 60 s after a move | G-19 (`config/socket.facilityRooms.test.ts`, `socket.facilityRecheck.test.ts`) |
| Dashboard cache | no figure shared across facilities | G-20 |
| Reminders and digests | F1 users get F1 rows only, e-mail bodies included | G-21 |
| Export page reads and the PWA working set | F1 rows only, a foreign filter → empty | G-22 (`routes/exportReads.twoFacility.test.ts`) |
| Signed links: issue, replay after a move, TTL | issue in context; replay → 404; TTL capped | G-23 |
| People shown on rows (performer, author, assignee) | snapshot or redacting projection; own rows visible to own staff | G-24 |
| Idempotent replay after a scope change; `client_ref` of another user | not served from the stored response; 409 naming nothing | G-26 (`idempotencyKeys.scopeChange.test.ts`, `clientRef.twoFacility.test.ts`) |
| PWA purge on refusal codes, shared profile, scope change | purged; one user per profile | G-27 (frontend) |
| The import put rows in the right facility | RC-F1 … RC-F5 | G-30 (P25) |
| Tenant dimension unchanged for unbound principals | every *existing* tenant suite green; the self-served regression (a tenant with only its self facility behaves as today) | G-31 |
| Live chain on a running stack | bound F1 / F2 users and a provider technician: lists, details, exports, photos, sockets, a binding change and a facility `ended` while signed in, a device move watched by both | G-28 (live E2E, P21-10 / P22-10 / P26-02) |

---

## 7. Part F — The Guards That Keep This Plan Complete

| Guard | Fails when | Reviewed exemptions it carries |
|---|---|---|
| `guards/twoTenantRoutes.guard.test.ts` (*existing*) | a new `:id` route has no `@two-tenant` marker and is not on `NOT_TENANT_ADDRESSED` | new entries: A-01, A-03 `not-tenant-owned` (ADR-125); A-02, A-04, A-06 `platform`; A-16 `capability-token` |
| `guards/twoFacilityRoutes.guard.test.ts` (P21-09, G-08) | a **marked** route with a path parameter has no `@two-facility` marker in a file asserting 404 | `global` (C-01: N-1 catalogue reads, ADR-125); `capability-token` (B-10 signed redemption); `self-param` (B-23: covered by `userSelf.facility.test.ts`, which asserts 403-self — the guard accepts a `selfParam` entry with that test named) |
| `guards/facilityAccessibleRoutes.guard.test.ts` (G-09) | a marker on an administrative route (P18-03 § 9) — planted on `POST /api-keys`, `PATCH /users/edit`, a backup route, `POST /certificates/:id/approve`, `PUT /users/:userId/client-facility`, `POST /calibration-devices/:id/move`, `POST /ipm/sessions/:id/void` | — |
| `routes/facilityRouteDefault.test.ts` (G-10) | an unmarked mounted route answers a bound principal with anything but 403-route, or differently for valid/invalid ids | — |
| `guards/boundCeilingRoutes.guard.test.ts` (G-P3) | a marked route's (slug, action) lies outside the bound ceilings, or a ceiling (slug, W) has no marked write route | — |

**Fail-before evidence** for both route guards and G-10 is recorded by P21-09 (a planted unmarked `:id` route; a planted marker without a test).

---

## 8. Keeping the Plan True

- Rows marked ‡ carry **provisional** paths (**2026-10-08:** A-10, A-12, A-13, A-14, B-15, C-03, C-05, C-06, C-10, C-11, C-13 fixed by the P19-02, P19-03 and P19-05 specs; A-11 and C-09 by the P19-06 spec; A-15, A-16 still wait on P19-07). The spec card that fixes a path (P19-02 → A-10/C-03 … C-09; P19-03 → A-12, A-13, B-15, C-10, C-11; P19-05 → A-14; P19-06 → A-11; P19-07 → A-15, A-16) **edits its rows here in the same change**. Between the two, the guards (§ 7) are the backstop: a route added without its test fails the build whatever this file says.
- A new marked route (P18-03 § 8, reviewed list) adds a Part B/C row here; a new `:id` route adds a Part A row.
- **Executed** means each named test exists, ran and passed on a quiet tree, named with its run in the building card's record — and, for the pre-invitation gate, in the record that opens it (`docs/SECURITY/15` § 11). An assertion that it passed is not evidence.

## 9. Counts (2026-10-08)

| Part | Rows | Of which `404=` cases | Notes |
|---|---:|---:|---|
| A — new `:id` routes, two-tenant | 16 | 10 rows (≈ 28 route × method pairs) | 6 rows allow-listed (`not-tenant-owned` 2, `platform` 3, `capability-token` 1) |
| B — existing marked routes, two-facility | 23 | 15 | plus absent-list, forced-write, 403-self and complete-export cases |
| C — target marked routes, two-facility | 15 | 8 | one gap closed (N-13 QR lookup) |
| D — unmarked: bound 403 + tenant 404 | 7 | 3 | the rest by the G-10 sweep |
| E — outside the route table | 13 | — | gate rows G-01 … G-31 |
| F — guards | 5 | — | |

## 10. Out of Scope

The penetration test itself (P17-07: PT-01 … PT-33 on a production-mode stack); the reconciliation queries (P25); per-route functional tests (each card's own).
