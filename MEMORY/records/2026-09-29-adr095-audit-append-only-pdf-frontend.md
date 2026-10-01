# 2026-09-29 — ADR-095: audit_logs append-only (Q-34), the Role guard (Q-35), key-rotation rehearsal (Q-36), and certificate PDFs rendered by the frontend (M-11)

**ADR:** [ADR-095](../DECISIONS.md) · **Cards:** Q-34, Q-35 and Q-36 **DONE**; M-11 **DONE** (ADR-078 D-1 closed) ·
**Tree:** HEAD `ce74932` plus the uncommitted Phase 9 work. Other agents were editing the tree at the same time
(the Phase 9 lead: P9-12 identity services and middlewares; P9-11: validators; P9-22: contracts; another agent:
ADR-094). ADR-093 and ADR-094 were taken by them, so this is ADR-095.

## What changed

| Area | Files |
|---|---|
| Q-34 migration | **new** `backend/src/migrations/0091-audit-logs-append-only.ts`, the first TypeScript migration. It is registered in `src/config/migrator.js` under the manifest name `0091-audit-logs-append-only.js` |
| Q-34 boot check | `src/utils/schemaVerify.util.ts` EXPECTED_OBJECTS gains `audit_logs_append_only` and `audit_logs_no_truncate`, making 10 control objects. The test `schemaVerify.util.p605` was updated |
| Q-34 tests | **new** `src/tests/migrations/0091-audit-logs-append-only.test.ts` (unit) and **new** `src/tests/services/auditLogAppendOnly.q34.live.test.ts` (PG 18, opt-in, `Q34_PG_LIVE_TEST=1`, `Q34_MODE=upgrade\|fresh`) |
| Q-35 | `src/models/role.model.ts`: the guard now reads `this.isSystem`. **New** `src/tests/models/roleSoftDelete.q35.test.ts` |
| Q-36 | `src/tests/services/keyRotation.s08.live.test.js`: it seeds and reads users' TOTP seeds, and expects the full report |
| M-11 backend | **new** `src/services/certificateDocument.service.ts`. Rewritten: `src/services/certificatePdf.service.js` (no renderer; `getStoredPdf`; verification publishes `document` and `integrity`) and `src/controllers/certificatePdf.controller.js` (`getDocument`; `generatePdf` removed). `src/routes/api/certificates.route.js`: `GET /:certificateId/document` added, `POST /:certificateId/pdf` removed. **Deleted** `src/templates/certificate.html`. `package.json`: `puppeteer` is now a devDependency; the root `package-lock.json` was synced, and its diff only flags that closure `dev` |
| M-11 image and config | `backend/Dockerfile`: no chromium, no fonts-liberation, no `PUPPETEER_EXECUTABLE_PATH`. `PUPPETEER_EXECUTABLE_PATH` was also removed from `deploy/compose/docker-compose.yml`, the three Helm values files, `templates/configmap.yaml` and `backend/.env.example`. Stale memory-limit comments are marked "not re-sized" |
| M-11 backend tests | **new** `certificateDocument.service.m11.test.ts`. Rewritten: `certificatePdf.service.test.js` and `certificatePdf.controller.test.js`. Updated: `certificates.lifecycle.twoTenant.test.ts` (the `@two-tenant` markers now name `GET /:certificateId/document` and `GET /:certificateId/pdf`), `certificateFrame.p708`, `certificates.route`, `denyPlatformAuthoring.a127`, `certificates.approve.a62`, `certificates.twoTenant.a145` and `email.templates`. The E2E spec `e2e/modules/certificates.e2e.test.js` now covers the document 200 and 404, the stored `/pdf` 404, the removed `POST /pdf` 404, and the verification `integrity` |
| M-11 frontend | `src/lib/certificatePdf.ts` (jsPDF, from the document), `src/api/services/calibration.service.ts` (`CertificateDocument`, `getCertificateDocument`), `CertificatesTable.tsx` (fetches `/document`; aria-label), `src/app/verify/[certificateNumber]/page.tsx` (download from `document`, both hashes, the stored PDF still framed) |
| M-11 frontend tests | **new** `lib/certificatePdf.test.ts` (a real jsPDF render), `lib/certificatePdf.download.test.ts`, `verify/[certificateNumber]/__tests__/page.m11.test.tsx`, `dashboard/calibration/components/__tests__/CertificatesTable.m11.test.tsx`, and a case in `calibration.service.test.ts` |
| Browser smoke | `automate/smoke.browser.js` has two new checks: the dashboard PDF and the public verification PDF, so 7 checks in all |
| Docs (deviation protocol) | `docs/API/08`, `docs/BACKEND/07`, `06`, `10` and `11`, `docs/DEVOPS/02` and `07`, `docs/ARCHITECTURE/08` and `docs/FRONTEND/07` are amended with ADR-095 |

## Evidence

### Q-34, audit_logs append-only

- **Unit:** `0091-audit-logs-append-only.test.ts` passes 10/10.
- **Live on `pgvector/pgvector:pg18` (PostgreSQL 18.6):** `auditLogAppendOnly.q34.live.test.ts` passes
  **7/7 with `Q34_MODE=upgrade`** and **7/7 with `Q34_MODE=fresh`**. The connecting owner is a superuser, as
  in compose.
  - **Fail-before, in the same run:** before 0091, `callibrator_app` DELETEs an audit row and rewrites its
    `action`, and the owner DELETEs one.
  - **After 0091, as `callibrator_app`:** DELETE, TRUNCATE and `UPDATE action` are refused with "permission
    denied". A non-mask ip or forged `changes` is refused by the trigger. INSERT works.
  - **After 0091, as the owner:** every DELETE, TRUNCATE (plain and CASCADE) and ten forging UPDATEs are
    refused, including under `session_replication_role = replica`, and the row is unchanged. The owner may
    mask but cannot un-mask.
  - **`dataRetention.maskPII` as `callibrator_app`:** masks 2 rows exactly and audits itself. A rerun masks
    0.
  - **`down` → `up` ×2** restores the control.
- **The image-booted database** (`psql`): `audit_logs_append_only|A`, `audit_logs_no_truncate|A`, and the
  grants `INSERT,SELECT` plus column UPDATE. `SET ROLE callibrator_app; DELETE …` gives "permission denied
  for table audit_logs"; the owner's DELETE is refused by the trigger with its HINT.
- **Boot log:** `[schema-verify] OK: 72 tables, 867 columns and 10 control objects`.

### Q-35, Q-36

- **Q-35:** `roleSoftDelete.q35.test.ts` passes 2/2 (1/2 before the fix: a SUPERADMIN role was marked
  deleted). The Phase 9 lead flipped its model-equality harness; its pre-fix twin fails on "model Role".
- **Q-36:** `DATA_PG_LIVE_TEST=1 … keyRotation.s08.live` on PostgreSQL 18.6 passes **5/5** (3/5 before).

### M-11, the backend renders no PDF

- **The first diagnosis (option b, before the owner's decision).** puppeteer loaded from a `node_modules`
  beside the pkg binary did work in the image. Chromium then died for the lack of a home directory for uid
  997, and with one the image rendered a real `%PDF-1.4` of 77,547 bytes. Rendering it also exposed the
  escaped-watermark bug (fixed with a test, then removed with the renderer).
- **Backend tests** (all at 100% coverage for the touched files):
  - `certificateDocument.service.m11.test.ts` 34/34, with v1 pinned to the original function over 6
    fixtures plus a fixed hex;
  - `certificatePdf.service.test.js` 34/34;
  - `certificatePdf.controller.test.js` 9/9;
  - `certificates.lifecycle.twoTenant.test.ts` + `twoTenantRoutes.guard`: 25/25, a cross-tenant 404 on
    `GET /:id/document` and `GET /:id/pdf`;
  - 14 affected suites together: 233/233.
- **Frontend tests:**
  - `lib/certificatePdf.test.ts` 14/14: a real jsPDF render read back, with every field, the v2 hash, the
    QR image and the watermarks;
  - `lib/certificatePdf.download.test.ts` 1/1;
  - `page.m11.test.tsx` 5/5;
  - `CertificatesTable.m11.test.tsx` 2/2;
  - `calibration.service.test.ts` including the new case.
- **Images.**
  - **Before:** the HEAD `ce74932` image with Chromium was **1.68 GB** (431 MB content).
  - **After:** **664 MB** (160 MB content), −60%. `chromium` is absent, there is no `PUPPETEER_*` variable,
    and `/app/src/templates` holds `account.html`, `otp.html` and `template.html` only.
  - The tree was being edited by four other agents while this ran. The image was built from a scratch
    snapshot of it that kept the `.js` half of 19 migration `.js`/`.ts` pairs another lane was converting
    at that moment, which `build:dist` refuses. `build:dist` then reported "298 JavaScript files copied,
    195 TypeScript files compiled", plus `@callibrator/contracts`.
  - The frontend image (340 MB) came from a snapshot with one in-flight file,
    `dashboard/users/hooks/useUsers.ts`, taken at HEAD: its 4-line in-flight edit did not type-check. With
    that, `next build` passed its type check and built `/verify/[certificateNumber]` and
    `/dashboard/calibration`.
- **Live stack:** both images, PG 18 + Redis 8.6 + RabbitMQ 3.13, hardened as compose. The boot applied 65
  migrations, `schema-verify OK … 10 control objects`, and queries ran as `callibrator_app`. After
  `GET /migration/seeding`:
  - `POST /certificates` → 201.
  - `GET /:id/document` → 200 with `integrity.scheme certificate-content-v2`, the hash, `legacyHash`, the
    HMAC and `signatureKeyId`, and `verifyUrl http://127.0.0.1:25301/verify/<number>`.
  - `GET /:id/pdf` → an enveloped 404 naming `/document`. `POST /:id/pdf` → 404.
  - submit → approve → sign all answer 200.
  - Public verify: `valid: true`, `document` present **without** the HMAC, and its v2 hash **equal** to the
    authenticated document's. An unknown id → 404.
- **Browser, CSP enforced** (`automate/smoke.browser.js`): **7/7**, 0 CSP violations and 0 page errors. The
  two new checks:
  - the dashboard renders the certificate PDF from `/document`: `CERT-…-0005.pdf`, 182,620 bytes, QR +
    number + v2 hash;
  - the signed-out verification page says "Certificate is valid" and renders the same PDF.
- **The saved verification-page PDF** starts `%PDF-1.3` and contains one embedded image (the QR).
  `pdftotext` shows every field, "DIGITALLY SIGNED - 2026-09-29", the verify URL and
  "Integrity (certificate-content-v2, SHA-256): 42c1ebeb…cfd7", which equals the API's v2 hash.
- **P9-00 E2E baseline against the new images** (after `seed-demo`), runs A and B: **52 of 53 suites, 395
  passed, 1 failed, 5 skipped** each.
  - `certificates.e2e` passes **12/12**: 8 baseline tests + 4 new (the document 200 with v2 integrity, the
    document 404, the stored `/pdf` enveloped 404, `POST /pdf` 404) + the verification `integrity`/`document`
    assertions.
  - The one failure is `ai.e2e` › "POST /ai/query … (200 answer, or 500 when AI unconfigured)": it received
    **409**. That is another lane's in-flight A-281 change (`ai.controller.js` answers 409 for an
    unconfigured provider, ADR-094). It is not caused by this change, and the spec is theirs to update.
- **Cleanup:** every `callib-fixes1-*` container, volume and image was removed. The VM was not touched.


## Left open

- **O-1:** `enterApplicationRole`'s boot self-check (`utils/dbRole.util.ts`) probes only
  `calibration_records`. Extending it to `audit_logs` (the role must have no DELETE or table-wide UPDATE)
  would make a missing REVOKE refuse the boot. 0091 and the schema check already hold the control.
- **O-2:** three live suites clean up with `DELETE FROM audit_logs` (`batchJob.w07`,
  `calibrationScheduler.w03`, `tenantHardDelete.w20`). They run on a `db.sync()` schema, so they are
  unaffected, but on a migrated database the trigger refuses their cleanup.
- **O-3:** A-285, found by the P9-12 record. `roles.service` still reads `role.is_system`, a sibling of
  Q-35 on a different path. It is not fixed here; it belongs to the identity-services lane.
- **O-4:** the Helm and compose memory limits sized for Chromium were not re-sized.
- **O-5:** non-Latin-1 names print as `?` in the rendered PDF (jsPDF standard fonts). A Unicode font can be
  embedded if a tenant needs it.
- **O-6:** after the live run, another lane landed ADR-101 (separation of duties: a certificate's author may
  not approve it). The smoke's approval therefore now runs as a second user, a HEALTHCARE ADMIN created for
  the run, who holds `certificate` write through `equipment`. That edit is syntax-checked but was **not**
  re-run live, because the images had been torn down and the shared tree no longer built. Separately,
  ADR-101 makes the owner control of `POST /:certificateId/approve` in
  `certificates.lifecycle.twoTenant.test.ts` fail: its fixture's owner is also the certificate's
  `createdBy`. That is ADR-101's to update.
- **O-7:** the final full backend run on the moving tree (≈20:00) had 56 failing suites, none of them in
  this lane: identity conversion (auth, sso, mfa, webauthn), P9-21 route-guard work, ADR-101 and A-253.
  The last run in which the tree was otherwise quiet was ≈17:15: 704/710 suites, with all 6 failures from
  other lanes (networkSecurity, audit.service, kanban and signingKeyWrap, all in flight). **Every file this
  change touches was at 100/100/100/100.** Frontend: 254/255 suites; the one failure,
  `menuHelpers.seedIcons.a118`, is another lane's.
