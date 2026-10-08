# Feature Spec — P19-06 The IPM Report: an Issued Document of the Session — Report Number, Verification Token and Content Hash at Submit, a Data Document the Frontend Renders, Electronic Signatures of the Technician and the IPSRS, and a Public Verification Page

**Written:** 2026-10-08 — **before** implementation. **Everything in this spec is TARGET: nothing here is built.**
**Task:** P19-06 (Phase 19, Domain Design). Builds in **P20-04** (session columns, the signatures table), **P20-05** (the signatures trigger), **P21-04** (issuance in the submit, the document, the signatures, the public verification — backend), **P23-02** (the jsPDF renderer, the on-screen report, the verification page — frontend), P22-04 (the "Report" action on the IPM history), P24-02 (numbers and tokens of imported history); consumed by **P19-08** (offline draft preview), P22-09 (the UD-18 (b) handover package), P23-05 (side-by-side sign-off), P26 (UAT)
**Author:** software-architect agent, under the owner's standing delegation (decide by best practice, record it; owner decisions stay open with a recommendation)
**Card scope (verbatim):** *"IPM report spec: a **frontend renderer** fed by a hashed data document (ADR-126 § 8, ADR-095 §4 — **no stored PDF**), numbering, QR to `/verify`, e-signature and countersign."*
**Decision record:** **ADR-126 Amendment 2** (`MEMORY/DECISIONS.md`, written with this spec)
**Spec refs:** ADR-126 § 8 and Amendment 1 (the aggregate this document reads) · ADR-095 § 4 and Am. 1 (frontend-rendered PDF, data document, hash schemes, Noto Sans) · ADR-107 (snapshot at issue, scheme in the payload, no back-fill) · ADR-100 (the verification token, request budgets, configured links) · ADR-101 (separation of duties) · ADR-071 / ADR-090 (nonce CSP, one `<main>`/`<h1>`, contrast, named icon controls) · ADR-122 (palette, status tones) · ADR-131 (the `(public)` root layout — not built) · ADR-124 and Am. 1 – 2 (facility scope, the bound ceiling, `personDisplay`) · ADR-052 (`denyPlatformAuthoring`) · `MEMORY/specs/P19-02-ipm-session-aggregate.md` § 4, § 6, § 7, § 10, § 14, § 15 · `P19-01-inspection-catalogue.md` § 5, § 6, § 11 · `P19-03-device-extensions.md` § 4, § 6 · `P19-04-client-facilities.md` § 12 · `P19-05-calibration-dates.md` § 5 · `P18-03-facility-scope-permissions.md` § 5.2, § 6, § 8.3 (N-2, N-5), § 10.1, § 11 · `P18-01-02-role-matrix-and-grants.md` § 3 · `P18-04-two-tenant-two-facility-test-plan.md` A-10, A-11, C-03, C-09 · `docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md` FT-15, FT-71, FT-72, FT-104, PT-30, AM-21 · `docs/UPSTREAM/09-REPORT-LAYOUTS.md` § 1, § 2 (the layout, L-1 … L-8), § 7 · `02-FEATURES.md` F-58 … F-61, F-75 · `07-DATA-MINIMISATION.md` § 3 · `TASKS/PHASE-12-…` § 3 (UD-17 working decision 2026-10-08; UD-18 (b))
**Code read 2026-10-08 (working tree, read only):** `backend/src/models/certificate.model.ts` (the lifecycle, `type` ENUM incl. `maintenance`, paranoid, `certificate_number` globally unique, `verification_token`, `signed_snapshot`), `services/certificateDocument.service.ts` (`resolveVerifyUrl`, `personName`, the v1/v2/v3 payloads, `captureSignedSnapshot`), `services/certificate.service.ts` (`verifySignerCredentials`, `recordSignatureAuthFailure` — a wrong credential answers 401), `models/eSignatureRecord.model.ts` (`entityType`/`entityId`/`action approve|sign|revoke`/`authMethod password|mfa|sso`/`documentHash`), `routes/api/certificates.route.ts` (`requestBudget("certificateVerifyToken")` on the public verify), `middlewares/dynamicAccess.middleware.ts` (every mutating verb normalises to `write`), `constants/roleConstants.ts` (`esignature` write already seeded for `TECHNICIAN`, `HEALTHCARE TECHNICIAN`, `FACILITY MAINTENANCE`), `frontend/src/lib/certificatePdf.ts` (jsPDF + `qrcode` on demand, `pdfText` folding, Noto Sans LGC fetched on render, Blob download), `frontend/src/lib/securityHeaders.ts`, `frontend/src/api/client.ts` (`CREDENTIAL_ENDPOINTS` — a 401 elsewhere triggers the refresh), `frontend/src/api/typed.ts`, `frontend/src/i18n/config.ts` (the dashboard is `lang="en"`, other pages follow the locale, default `id`), `frontend/scripts/bundle-budget.mjs` + `bundle-budget.json` (`/verify/[certificateNumber]` ≤ 120 KB brotli).

> **Privacy.** No upstream data value appears here. Every example is synthetic ("Facility One", code `F-0001`, QR `TST000001`).

---

## 1. Problem

Upstream re-renders the IPM report from whatever rows exist today, publicly, by a guessable QR + date, with no number, no integrity mark, a typo in its title, an IPM date printed as the calibration date, an overall result that never prints, and a wet-signature line (`09` § 2, L-1 … L-8). ADR-126 § 8 decided the target in principle — a frontend renderer fed by a hashed data document, QR to `/verify`, nothing stored — and left to this card **whether the report rides the certificate pipeline**, how it is numbered, how the technician and the facility's IPSRS sign it (UD-17), and what the public verification shows. `09` § 2.5 and `02` F-58 proposed a certificate row `type: maintenance`; reading the code and the facility-scope specs shows that would break three decided rules (§ 2, G-R1).

Personas: the **provider technician** (signs the reports of the sessions it performed), the **facility technician** (bound HT; same, in its facility), the **IPSRS** (`FACILITY MAINTENANCE`, bound to the facility, or unbound in a self-served hospital — countersigns), the **facility's readers** (bound HA, RU, FM — read and download their facility's reports), the **tenant administrator** (reads all; voids through P19-02), **anyone holding the printed report** (scans the QR — no account), the **auditor** (renders any version on demand and checks it against the QR), the **PWA** (previews a draft offline — P19-08).

---

## 2. What Is Already Decided (not re-decided here) — and the Gaps Found

| Decision | Source |
|---|---|
| The report is rendered **in the browser** (jsPDF), from a data document of the API; no backend PDF, no stored report file, no batch job | ADR-126 § 8; ADR-095 § 4; owner rule 2026-10-07 |
| The document binds its printed fields by a hash; the QR resolves to a verification page that checks it | ADR-126 § 8; ADR-095 § 4; ADR-107 |
| A corrected session's report shows that it supersedes the earlier version, and the earlier one stays renderable | ADR-126 § 8 |
| The session is immutable after submit; its device, facility, room and performer are snapshotted at submit; the visit number is assigned at the chain's first submit | ADR-126 Am. 1 § 3, § 5; P19-02 § 4.1, § 6 |
| `GET /ipm/sessions/:sessionId/report-document` exists, gate `ipm` read, marked N-2, in A-10/C-03 | P19-02 § 10.2; P18-04 |
| The IPSRS (`FACILITY MAINTENANCE`) countersigns **electronically**, a **per-tenant setting**, **never the submitter** | UD-17 (working decision 2026-10-08) |
| Performer signature and IPSRS countersignature are N-5, gate `esignature` write + `denyPlatformAuthoring`; the countersigner may not be the submitter, 403 naming the rule; a provider technician cannot countersign for a facility | P18-03 § 8.3, § 11; P18-04 A-11, C-09 |
| A verification token is ≥ 192 random bits, base64url, stored in the clear (re-printable), never accepted from a body; links come from configuration, never from the request's host; public verification is budgeted per address | ADR-100 (A-293, A-289, A-291) |
| Printed text is drawn as text by jsPDF (no HTML); Noto Sans LGC fetched only when rendering; the page CSP is untouched by a render | ADR-095 § 4, Am. 1 O-5; `09` L-8 |
| Reports and every export of a bound user contain only its facility | ADR-124 § 9; FT-70 |

### Gaps and contradictions found — resolved by ADR-126 Amendment 2 (deviation protocol)

| # | What `docs/` says | What is true or missing | Resolution (§) |
|---|---|---|---|
| G-R1 | `09` § 1 D1, § 2.5 and `02` F-58 / F-59: the report is "a certificate row `type: maintenance` issued when the IPM session is submitted", downloaded through `GET /certificates/:id/pdf` | (a) **issuing a certificate is never a bound act** — the route-marker guard refuses any `certificate` action but read (P18-03 § 9 rule 3, ISO/IEC 17025 7.8), yet a bound HT's submit would issue one; (b) the certificate lifecycle (draft → pending → approved by **another** person → signed, ADR-101) has no counterpart in an IPM, which is a record **at submit** (ADR-126 § 3); (c) certificates are `paranoid` and their number is **globally** unique; (d) two rows for one fact, kept in step through every correction (revoke + reissue) and void; (e) `GET /certificates/:id/pdf` serves only files stored before ADR-095 | **The session is the issued record; the report is its document.** Number, token and content hash are columns of `inspection_sessions`, set in the submit transaction. No certificate row (§ 4) |
| G-R2 | `09` § 2.5: "report number" — no format; certificate numbers are `CERT-YYYYMMDD-<tenant code>-NNNN`, sequential per tenant per day | a per-tenant daily sequence printed on every facility's report tells each facility how many IPMs the provider did that day **across all its clients** (a small cross-facility disclosure, A2/A3 of `docs/SECURITY/15`) | `IPM-<facility code>-<YYYYMMDD>-<NNN>`, sequence **per tenant, facility and day** (tenant time zone), one number per **submitted session** (each correction is a new report version with its own number) (§ 5) |
| G-R3 | ADR-100: a bare number gets a **minimal** verdict (for QR codes printed before tokens existed) | no IPM report was ever printed without a token; a number-only verdict would be a new enumeration surface for a sequential number — the upstream S-06 class this group exists to close | the IPM verification **requires the token**; number + wrong/absent token = the same 404 as an unknown number; no minimal verdict (§ 9) |
| G-R4 | ADR-095 / ADR-107: the hash is recomputed at read, **not** persisted | an IPM report is signed by two people **after** submit; each signature must bind the exact content it attested, and a later code change in canonicalisation must be detectable, not silently re-hashed | `report_content_hash` is **stored at submit** (scheme `ipm-report-v1`) and recomputed at every read: a mismatch is reported (`integrity.state: "mismatch"`), logged as an error and alerted — never hidden. Each signature stores the hash it attested (§ 6, § 7) |
| G-R5 | `09` § 2.5 "Letterhead ⚖ design: confirm in P19-06"; P19-02 snapshots device, facility, room, performer — not the issuer | the issuer (the calibration company: name, address, contacts) is printed and mutable afterwards — the ADR-107 problem again | `issuer_snapshot` taken at submit (ADR-107's issuer fields); the **logo** is drawn from the tenant's live branding and is **not** hashed (stated on the page, as ADR-095 states for live names) (§ 4) |
| G-R6 | `02` F-61, P18-03 § 10.1: signatures through the `eSignature` module; `SignatureRecord`/`ESignatureRecord` on `FACILITY_READABLE` "UD-17 only" | `e_signature_records` is **provider-internal** under ADR-124 (P19-04 § 5: DENY for bound principals) and has no facility column — a bound IPSRS could neither write it nor read its own row without a scope bypass; its `entityType/entityId` polymorphism has no facility trigger | a facility-scoped, append-only **`inspection_session_signatures`** table with a signer snapshot is the Part 11 signature record of an IPM report; `e_signature_records` is **not** written for IPM; `SignatureRecord`/`ESignatureRecord` **stay off** `FACILITY_READABLE`; `/esignature/*` stays unmarked (§ 7) |
| G-R7 | P18-03 § 5.2: `esignature` in the bound ceiling = "UD-17" for HT·b and FM·b | UD-17 is decided (working decision) | **W** for bound `HEALTHCARE TECHNICIAN` and bound `FACILITY MAINTENANCE`; it reaches only the one marked route (N-5) — every other `/esignature/*` route stays unmarked → 403 for bound users. No grant changes: the three roles already hold `esignature` write in the seed (§ 8) |
| G-R8 | UD-17: "countersign … a per-tenant setting"; P18-01-02: IPSRS accounts "created only where a facility enables countersigning" | a provider tenant serves facilities with and without an IPSRS account | one tenant setting **`ipm.countersignEnabled`** (P19-02 § 4.3 named it): when on, the report offers the electronic countersignature and prints "awaiting countersignature" until it exists, **above a blank line that stays usable for a wet signature**; a facility without an IPSRS account simply keeps the wet line. The record is complete at submit either way — a countersignature never gates anything (§ 7.3) |
| G-R9 | `02` F-61: "technician signs **on submit**" | an offline submit is replayed from the outbox; a Part 11 signature needs the signer's credential at the moment of signing (§ 11.200), and the outbox must never hold a password (ADR-127 § 9) | the technician's signature is a **separate, online act after the submit is accepted** (password or MFA code re-entered); online, the capture screen chains it right after submit; offline captures appear in a "to sign" list once synced (§ 7.2; P19-08 § 12) |
| G-R10 | UD-18 (b): "the act of rendering is audited (no content)"; no route was designed for it | jsPDF runs in the browser — the server sees only the data read | a render fetches a **fresh** document with `?render=pdf` (or `print`); that read writes an `EXPORT` audit row before the document is sent (the ADR-114 precedent). A plain on-screen read is not audited. Stated honestly: the audited fact is "the document was served to be rendered", not "a PDF exists" (§ 10) |
| G-R11 | `certificatePdf.ts` holds the jsPDF primitives privately | a second renderer would copy them | the primitives (font loading, `pdfText`, QR, watermark, Blob download) move to `frontend/src/lib/pdf/` with **no change to the certificate PDF's output** (its byte-level tests stay green unchanged) (§ 12) |
| G-R12 | `client.ts` refreshes the session on any 401 outside `CREDENTIAL_ENDPOINTS` | `verifySignerCredentials` answers a wrong signing password with 401; on the signature route that would refresh, retry with the same wrong password, and on the second 401 **end the session** — and the PWA would purge its working set (P19-08) | the IPM signature path joins `CREDENTIAL_ENDPOINTS` (a 401 there is about the credential just sent) (§ 8.2) |

---

## 3. The Model at a Glance

```
inspection_sessions (P19-02)                         + P19-06 columns, written once, in the submit transaction
  report_number        IPM-F-0001-20261008-003      (per tenant, facility, local day)
  verification_token   24 random bytes, base64url    (global UNIQUE — random, no oracle)
  report_content_hash  sha256 hex, scheme ipm-report-v1
  issuer_snapshot      { name, address, city, … }    (ADR-107's issuer fields)
   ▲ (tenant_id, client_facility_id, session_id)  composite FK, ON UPDATE CASCADE
inspection_session_signatures (new, facility-scoped, append-only)
  kind performer | countersign   UNIQUE (session_id, kind)
  signer_id → users RESTRICT, signer_snapshot { name, role, organisation }
  meaning authorship | review, auth_method password | mfa, document_hash = report_content_hash at signing
```

**Aggregate.** The report is not an aggregate of its own: it is a **projection** of one submitted session (any version of a visit) plus that session's signatures. Invariants: a report exists only for a `submitted` or `voided` session (imported ones included); its number, token, hash and issuer never change; at most one performer signature and one countersignature per session; a signature attests exactly the stored hash; a countersignature follows the performer's and is never by the performer; a superseded or voided report can be rendered and verified, never signed.

**Domain events** (audit rows in the transaction; `emitForRow` socket events after commit): `IpmReportIssued` (inside `IpmSubmitted` — the number), `IpmReportSigned { sessionId, kind }`, `IpmReportRendered { sessionId, format }` (audit only).

---

## 4. Columns and the Signatures Table (TARGET; P20-04, P20-05)

Conventions as P19-02 § 4: camelCase attributes, every index/CHECK/unique/FK in the migration (ADR-100 Am. 3), `initModel` + `export =` alone, D-27 shapes for JSON columns, no blanket `try/catch`.

### 4.1 `inspection_sessions` gains (P20-04 — the same migration as the table)

| Column | Type | Null | Notes |
|---|---|---|---|
| `report_number` | varchar(48) | NULL | NN when `status IN ('submitted','voided')` (extends CHECK `inspection_sessions_issued_fields`); § 5; `UNIQUE (tenant_id, report_number) WHERE report_number IS NOT NULL` |
| `verification_token` | varchar(64) | NULL | NN when submitted/voided; 24 CSPRNG bytes base64url (ADR-100); **generated by the service at submit**, never from a body; `UNIQUE (verification_token) WHERE verification_token IS NOT NULL` — global, which is safe: it is random (no oracle, the reasoning of ADR-100) and lets the public verification resolve without a tenant |
| `report_content_hash` | char(64) | NULL | NN when submitted/voided; lower-case hex SHA-256 of the canonical payload (§ 6) |
| `report_hash_scheme` | varchar(32) | NULL | NN when submitted/voided; `ipm-report-v1` (the scheme lives in the row and in the payload, ADR-095's discipline) |
| `issuer_snapshot` | jsonb | NULL | NN when submitted/voided; `{ version: 1, name, email, phone, address, city, state, zipCode, country, website }` of the tenant at submit — the fields `captureSignedSnapshot` takes for a certificate's issuer (ADR-107); D-27 shape `InspectionSession.issuerSnapshot` (strict) |

All five are **set by the draft → submitted update** (the trigger of P19-02 § 5.1 admits any column change while `OLD.status = 'draft'`) and are **outside** the lifecycle list, so they can never change again — the P20-05 trigger needs no change; its live test gains "an UPDATE of `report_number`, `verification_token`, `report_content_hash` or `issuer_snapshot` of a submitted session is refused, for the owner too". `verification_token`, `report_hash_scheme` never appear in a **list** contract; the token appears only inside `verifyUrl` of the document (§ 9.4). `legacy_key` stays out of every contract (FT-104).

### 4.2 `inspection_session_signatures` (new; tenant- and facility-scoped; P20-04 table, P20-05 trigger)

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid PK | NN | |
| `tenant_id` | uuid → tenants RESTRICT | NN | hooks |
| `client_facility_id` | uuid | NN | the session's (`facility_insert_default('result')` — the branch P19-02 § 5.3 adds resolves any row by its `session_id`; P20-04 attaches it here too) |
| `session_id` | uuid | NN | composite FK `(tenant_id, client_facility_id, session_id)` → `inspection_sessions (tenant_id, client_facility_id, id)` ON UPDATE CASCADE ON DELETE RESTRICT |
| `kind` | ENUM `enum_inspection_session_signatures_kind` = `INSPECTION_SIGNATURE_KINDS` (`performer`, `countersign`) | NN | `UNIQUE (session_id, kind)` |
| `signer_id` | uuid → users RESTRICT | NN | the person (ADR-051 Q-16: a signer is never hard-deleted away) |
| `signer_snapshot` | jsonb `{ name, role, organisation }` | NN | taken at signing — the `performerSnapshot` shape and rule (P19-04 § 12: organisation = the tenant's name for an unbound signer, the facility's for a bound one); D-27 `InspectionSessionSignature.signerSnapshot`, strict — **no e-mail, phone or id** (FT-15) |
| `meaning` | ENUM `INSPECTION_SIGNATURE_MEANINGS` (`authorship`, `review`) | NN | CHECK `(kind = 'performer') = (meaning = 'authorship')` — Part 11 § 11.50 (b): the meaning is printed with the signature ("Performed and attested by" / "Reviewed by IPSRS") |
| `auth_method` | ENUM (`password`, `mfa`) | NN | the credential re-entered at signing (`verifySignerCredentials`; SSO accounts sign with an MFA code — the existing rule) |
| `document_hash` | char(64) | NN | the session's `report_content_hash` at signing; the service refuses to sign when the recomputed hash differs from the stored one (§ 7.4) |
| `signed_at` | timestamptz | NN, default now | the server's clock (A-241's open question about a trusted timestamp applies unchanged) |
| `ip_address`, `user_agent` | varchar(45), varchar(500) | NULL | as `e_signature_records`; masked by GDPR masking like audit rows (A-135 key lists gain the table) — never returned by any contract |
| `created_at` | timestamptz | NN | |

**Not paranoid, no `defaultScope`, no `updated_at`.** Indexes: `(tenant_id, client_facility_id, session_id)` (the FK), `(signer_id, signed_at DESC, id)` (a person's own signatures), `(tenant_id, kind, signed_at DESC, id)` (the "awaiting countersignature" list joins sessions instead — measured in P21-04).

**Trigger `inspection_session_signatures_append_only`** (P20-05; BEFORE INSERT / UPDATE / DELETE, statement TRUNCATE; ENABLE ALWAYS; every role):
- `DELETE`, `TRUNCATE` refused; `UPDATE` refused except a change of `client_facility_id` alone admitted by `facility_move_admits` for the session's device (the cascade of a device move — AM-6, the requirement of P19-04 § 5.4).
- `INSERT` refused unless the session (read `FOR SHARE`) is `submitted`, not superseded, has `legacy_key IS NULL`, and `NEW.document_hash = report_content_hash`; a `countersign` row refused unless a `performer` row exists and `NEW.signer_id` differs from the session's `submitted_by` and from the performer row's `signer_id`.
- The service's own 409/403 answer first (§ 7); the trigger is the floor for every other writer (the ETL, a script, the owner).

**Grants:** `callibrator_app` SELECT, INSERT (no UPDATE, DELETE, TRUNCATE) — the 0057 two layers. `schemaVerify` `EXPECTED_OBJECTS` lists the trigger. `facilityScopedModels.guard` (G-11): the model declares `clientFacilityId`. `associationForeignKeys.a148`: `signer_id` RESTRICT.

---

## 5. The Report Number (G-R2)

- **Format:** `IPM-<facility code>-<YYYYMMDD>-<NNN>` — e.g. `IPM-F-0001-20261008-003`. `<facility code>` is `client_facilities.code` at submit (`SELF` for a self-served hospital; the code is in `facility_snapshot` too); `<YYYYMMDD>` the **submit** date in the tenant time zone (`tenant.timeZone`, default `Asia/Jakarta`); `<NNN>` zero-padded to three digits, widening to four past 999 (never truncated).
- **Assignment:** in the submit transaction, after the device lock of P19-02 § 6 and before the hash: `pg_advisory_xact_lock(hashtextextended('ipm-report:' || tenant_id || ':' || code || ':' || day, 0))`, then `max(NNN) + 1` over the tenant's numbers with that prefix (an index-only read on `inspection_sessions_report_number_unique`). Two facilities never contend; two submits of one facility serialise for a few milliseconds.
- **Every submitted session gets one** — a root and each correction (a correction is a new version of the visit's report). A **discarded** draft never had one. A **void** keeps the number (the report becomes "voided").
- **Imported history** (P24-02): the ETL numbers each imported session with the same format from its `performed_at` date and its facility, in `performed_at` order, before any captured session can exist (cutover); it also generates the token and the hash and the issuer snapshot (the provider tenant at import). Imported reports are **not** signed (§ 7.1).
- **Why per facility:** a number printed on F1's report reveals only F1's own count that day. The tenant code is not in the number: the verification resolves by token (§ 9), and the facility code is unique only inside a tenant — the number is unique per tenant (the index), never globally (no global uniqueness oracle).

---

## 6. The Content Hash — Scheme `ipm-report-v1` (G-R4)

**What is bound:** every field the report prints that is fixed at submit. **What is not bound:** the session's later lifecycle (superseded, voided — a status change must not alter the hash of what was issued), signatures (they reference the hash), the tenant's logo (live branding), labels the renderer draws from i18n (the hash binds **codes**, and the language of a rendering never changes it), and the render time.

**Canonical payload** — one function `canonicalIpmReportPayload(input)` in **`packages/contracts/src/ipmReport.ts`** (pure, no I/O, used by the backend at submit and read, by the ETL, and by the verification page to recompute the hash in the browser), returning a JSON string with a **fixed key order** (not `JSON.stringify` of a JSONB value — PostgreSQL re-orders keys, ADR-107):

```
scheme ("ipm-report-v1"), reportNumber, sessionId, supersedesReportNumber | null,
issuer { name, email, phone, address, city, state, zipCode, country, website },
facility { id, name, code, kind, address }, device { name, manufacturer, model, serialNumber, qrCode,
deviceTypeId, deviceTypeName, lastCalibrationDate, nextCalibrationDate }, room, floor,
visitNumber, legacyVisitNumber | null, performedAt (ISO-8601 UTC, ms), submittedAt (UTC), timeZone,
checklist { templateVersionId, versionNumber, contentHash } | { imported: true },
results [ in (section order of INSPECTION_SECTIONS, sort_order, id) : { section, inputKind, label,
  templateItemId | null, adHoc, unit, symbol, setting, reference, limitText, outcome, cleanliness,
  measuredValue, measuredValue1, measuredValue2, textValue, rawValue, computedOutcome,
  outcomeSource, warnFlag, disagreementFlag } ],
inspectionOutcome, maintenanceOutcome, recommendation, notes,
performer { name, role, organisation }, capturedOffline, imported
```

- Decimals are the **exact strings** the model returns (ADR-125 Am. 2 § 2; P19-02 § 4.2) — never re-formatted numbers; `null` written as `null`, never omitted; strings NFC-normalised before hashing (a decomposed accent typed on a phone and its composed twin hash alike).
- `supersedesReportNumber` is the original's number for a correction — known at submit, so bound; the reverse link (`supersededBy…`) is lifecycle, not bound.
- `limitText` is the pinned template item's printed limit (P19-01 § 6.2), or the ad-hoc/imported `reference_text`.
- Hash = SHA-256 of the UTF-8 bytes, lower-case hex. The backend uses `node:crypto`; the browser `crypto.subtle.digest` (available on the verification page, a secure context).
- **Fixtures:** `packages/contracts/test/ipmReport.canonical.test.ts` pins the payload of six synthetic sessions (root, correction, imported, ad-hoc rows, decimals with trailing zeros, a non-Latin name) to fixed hex values written **by hand from the definition above**, not generated from the function (CLAUDE.md § Evidence: a test generated from the code verifies consistency, not correctness). A key reordering, a dropped field or a changed decimal form fails it.
- **A new scheme** (`ipm-report-v2`) is a new function beside v1, never an edit of v1; v1 stays for every report issued under it (ADR-095's rule for v1/v2).

**At read:** the service recomputes the hash from the stored row and compares it with `report_content_hash`: equal → `integrity.state: "match"`; different → `"mismatch"`, an `error` log naming the session id (no content), the metric `ipm_report_integrity_mismatch_total` (alert rule in the ADR-082 route), and the document still served with the state shown on screen and printed in the PDF footer — **never** a silent re-hash.

---

## 7. Signatures (UD-17; G-R6, G-R8, G-R9)

### 7.1 Who signs what

| Signature | Who | When | Not allowed |
|---|---|---|---|
| **Performer** (`kind performer`, meaning `authorship`) | the session's performer — `performed_by = created_by = submitted_by` (P19-02 CHECKs) — and only that person | after the submit is accepted, while the session is the **effective head** (submitted, not superseded, not voided); online | anyone else (403 `IPM_SIGNATURE_NOT_PERFORMER`); an imported session (409 `IPM_REPORT_IMPORTED`); a second time (409 `IPM_ALREADY_SIGNED`) |
| **IPSRS countersignature** (`kind countersign`, meaning `review`) | a `FACILITY MAINTENANCE` user **bound to the session's facility**, or an **unbound** `FACILITY MAINTENANCE` of a tenant whose session facility is its `is_self` facility (a self-served hospital's own IPSRS) | after the performer signed, while the session is the effective head, when `ipm.countersignEnabled` is on | the submitter/performer (403 `IPM_COUNTERSIGN_SOD` — ADR-101's rule); another role (403 `IPM_COUNTERSIGN_ROLE`); an unbound FM on a **client** facility — provider staff cannot countersign for a hospital (403 `IPM_COUNTERSIGN_FACILITY`); another facility's session (404 by the hooks); setting off (409 `IPM_COUNTERSIGN_DISABLED`); before the performer (409 `IPM_REPORT_NOT_SIGNED`); twice (409 `IPM_ALREADY_COUNTERSIGNED`) |

A **correction** is a new report version: it needs its own signatures; the superseded version keeps its signatures and prints "superseded". A **void** keeps the signatures and prints "voided". Signing a superseded or voided session → 409 `IPM_SUPERSEDED` / `IPM_VOIDED` (the P19-02 codes, with the head's report number in `data.headReportNumber` when the caller can read it).

### 7.2 The signing act (online only)

The client sends the credential **with** the request: `{ kind, authMethod: "password" | "mfa", authPayload, meaningAcknowledged: true }`. The service:
1. loads the session **in context** (404 identical to missing — another tenant, another facility for a bound caller) and locks it `FOR SHARE`;
2. checks § 7.1's rules in the order of the table, answering the first failure;
3. verifies the credential with `certificate.service#verifySignerCredentials` (moved to a shared `signerCredentials.service.ts` by P21-04 with no behaviour change; its failure audit row `recordSignatureAuthFailure` keeps its shape, `changes.operation = "SIGN_IPM_REPORT"`); a wrong credential → **401** "Invalid password for e-signature." (the existing answer) — the path is in the client's `CREDENTIAL_ENDPOINTS` (G-R12);
4. recomputes the hash (§ 6); a mismatch → **409** `IPM_REPORT_INTEGRITY` "This report failed its integrity check and cannot be signed. The operator has been alerted." (and the alert of § 6);
5. inserts the signature row with `document_hash = report_content_hash`, the signer snapshot, the method, address and agent, **and its audit row**, in one transaction;
6. after commit: `emitForRow(session, "ipm:signed", { sessionId, kind })` (AM-19 — the tenant room and the session facility's room only); on a **performer** signature with `ipm.countersignEnabled` on, an in-app notification "IPM report <number> awaits your countersignature" to `recipientsFor(session, "ipm-countersign")` — the facility's bound `FACILITY MAINTENANCE` users holding `esignature` write (AM-21; never another facility's users; the self facility's unbound FM in a self-served tenant).

**Offline:** signing never enters the outbox — a password or code is never stored on the phone (ADR-127 § 9). An offline capture, once synced and accepted, shows on the phone's "to sign" list and on the dashboard's IPM history with "Not yet signed by the technician" (P19-08 § 12). Online, the capture screen opens the signature dialog immediately after a successful submit (two requests, one gesture for the technician).

### 7.3 The countersignature setting (G-R8)

Tenant setting **`ipm.countersignEnabled`** (boolean, unset = `false`), written by a tenant administrator through the existing settings route (P21-04 adds the key with its reader); read by bound users through the reviewed `skipFacilityScope` of P18-03 § 10.2 (G-13). Effects:
- **off:** the report prints the upstream's two-column block — the technician's electronic signature (or "not yet signed") and an empty **"IPSRS"** line for a wet signature; the countersign route answers 409 `IPM_COUNTERSIGN_DISABLED`.
- **on:** the IPSRS column prints the electronic countersignature when it exists, else "Awaiting electronic countersignature" **above the same empty line**, so a facility without an IPSRS account can still sign on paper.
- Turning the setting **off** later never hides an existing countersignature; turning it on never makes an old report "incomplete" — no state depends on it. A report is a record from its submit (ADR-126 § 3); signatures are attestations added to it.

### 7.4 Integrity of a signature

A signature is **valid** on display when its `document_hash` equals the recomputed content hash and the session's stored hash (§ 6). The document shows `valid: true | false` per signature; a false one prints "signature does not match this content" and raises the § 6 alert. There is no revocation of an IPM signature: a wrong report is corrected (a new version, new signatures) or voided.

---

## 8. Gates, the Bound Ceiling and the Client (G-R7, G-R12)

### 8.1 Gates

| Route | Gate (`auth` first) | Marked (P18-03 § 8) | Notes |
|---|---|---|---|
| `GET /ipm/sessions/:sessionId/report-document` | `dynamicAccess("ipm", "read")`, `validate({ from: ["params", "query"] })` | ✔ N-2, kind `read`, every bound role | § 10 |
| `POST /ipm/sessions/:sessionId/signatures` | `denyApiKey`, `dynamicAccess("esignature", "write")`, `denyPlatformAuthoring`, `validate({ from: ["params", "body"] })`, `requestBudget("ipmSignature")` (10 per 15 min per user + address, the A-185 class — a credential is checked) | ✔ **N-5**, kind `write`, HT·b and FM·b | the service enforces § 7.1; `denyPlatformAuthoring` because a signature is Part 11 authorship (ADR-052) |
| `GET /ipm/verify/:reportNumber` (public) | **no `auth`**; `requestBudget("ipmVerifyToken")` (300 / 15 min per address, every request) and `requestBudget("ipmVerify")` (60 / 15 min per address, every answer that is not a verdict) — ADR-100's pair; `validate({ from: ["params", "query"] })` | — (public; `routeGateExemptions` entry `public` with the reason "IPM report verification by capability token, ADR-126 Am. 2") | § 9 |

### 8.2 The bound ceiling and the client

- **P18-03 § 5.2 amended:** `esignature` — bound `HEALTHCARE TECHNICIAN` **W**, bound `FACILITY MAINTENANCE` **W**, bound HA and RU none. The ceiling only permits; the marker decides the routes: N-5 is the **only** marked `esignature` route, so `/esignature/*` (key pairs, workflows, history, sign) stays 403 for bound users (G-10's default test covers it).
- **Grants:** none to add — `esignature` write is seeded today for `TECHNICIAN`, `HEALTHCARE TECHNICIAN`, `FACILITY MAINTENANCE`, the level-8 roles and `SUPERVISOR`/`ENGINEERING MANAGER` (`constants/roleConstants.ts`); the service's role rule (§ 7.1) narrows the countersignature to `FACILITY MAINTENANCE`.
- **`FACILITY_READABLE`:** no entry for `SignatureRecord`/`ESignatureRecord` (P18-03 § 10.1's "UD-17 only" row resolved: not needed). `InspectionSessionSignature` is facility-scoped by its own column.
- **Frontend `client.ts`:** `CREDENTIAL_ENDPOINTS` gains the pattern `/api/v1/ipm/sessions/<id>/signatures` (the list is path prefixes today; P23-02 adds a matcher for the one parametrised path, with `client.signature.p1906.test.ts`: a 401 there neither refreshes nor ends the session).

---

## 9. The Public Verification (G-R3)

### 9.1 The link

`verifyUrl = <IPM_VERIFY_BASE_URL>/<reportNumber>?t=<token>`, where `IPM_VERIFY_BASE_URL` (config, `config/env.ts`) defaults to `CERT_VERIFY_BASE_URL` + `/ipm` and, when neither is set, to the API form `<PUBLIC_BASE_URL>/api/v1/ipm/verify/<reportNumber>?token=<token>` — the `resolveVerifyUrl` rule (ADR-100: from configuration only, never from `Host`/`Origin`). The QR encodes exactly `verifyUrl`.

### 9.2 `GET /api/v1/ipm/verify/:reportNumber?token=`

- Parameters: `reportNumber` (pattern `^IPM-[A-Z0-9._-]{1,32}-\d{8}-\d{3,6}$`), `token` (base64url, 32 chars). A malformed value → the same 404 as below (shape errors carry no existence information, but one answer is simpler to test and to reason about).
- Lookup **by token** (`verification_token`, global unique) with `skipTenantScope` and `skipFacilityScope` (a reviewed entry on both lists, G-13, reason "public verification by capability token"); then a **constant-time** comparison of the stored `report_number` with the parameter. Absent token, unknown token, mismatched number → **404** `{ success: false, message: "No IPM report matches this link." }`, byte-identical in every case, counted against `ipmVerify`.
- Found → **200** with `ipmVerification` (§ 9.3). No session id, tenant id, user id, legacy key, client ref, work-order id, `side_effects`, `ip_address` or `user_agent` in it.
- Not audited per request (no principal; the request log has it), as the certificate verification.

### 9.3 The verdict (`ipmVerification`, contract `ipmReport.ts`)

`{ found: true, reportNumber, status: "issued" | "superseded" | "voided", supersededBy: { reportNumber, at } | null, voidedAt | null, issuedAt (submittedAt), issuer: { name }, facility: { name }, device: { name, manufacturer, model, serialNumber, qrCode }, visitNumber, performedAt, recommendation, signatures: [{ kind, name, role, organisation, meaning, signedAt, valid }], countersignEnabled, integrity: { scheme, hash, state }, document: IpmReportDocument }` — `document` is the same document the dashboard serves (§ 10.2) **without** `verifyUrl` (the holder already has it) and with `kind: "issued"`.

A void's reason is **not** returned (free text, possibly naming people); "voided on <date>" is. A superseded report names the superseding report's number and date — never its token (a holder of the old QR learns that a newer version exists and must obtain it from the facility).

### 9.4 The page `/verify/ipm/[reportNumber]` (frontend, P23-02)

- Public page; under ADR-131 it lives in `(public)`; until P10-18 builds the groups, under today's root layout like `/verify/[certificateNumber]`. One `<main>`, one `<h1>` ("IPM report verification" / "Verifikasi laporan IPM"), Indonesian first (the public locale), the warm public surface tokens (ADR-118), light and dark.
- Shows the verdict: a status band (issued / superseded / voided) through the status-tone registry (shape + icon + text, never colour alone — ADR-122), the identity block, the signatures with "valid"/"does not match", the scheme and hash, **and the hash recomputed in the browser** from `document` with `canonicalIpmReportPayload` + `crypto.subtle` ("Recomputed in your browser: matches") — a reader does not have to trust the server's `state` alone.
- "Download PDF" renders `document` with the same renderer as the dashboard (dynamic import; § 12), with the status watermark for superseded and voided.
- The token is read from `?t=`, sent to the API, and **never** written to the page's links, history entries or logs; the page sets `Referrer-Policy` as today (origin only).
- Bundle: a new `bundle-budget.json` entry `/verify/ipm/[reportNumber]` at **≤ 120 KB brotli** (the AC-7 figure of `/verify/*`), jsPDF, `qrcode` and the font never in first load.

---

## 10. The Data Document (FT-71) — `GET /ipm/sessions/:sessionId/report-document`

### 10.1 Who gets what

| Session | Caller in scope | Answer |
|---|---|---|
| `draft` | its creator | **200** `kind: "preview"`: no `reportNumber`, `verifyUrl`, `integrity` or signatures; `status: "draft"` (watermark "DRAFT — NOT A RECORD") |
| `draft` | anyone else in scope | **403** "Only the technician who started this IPM can preview it." (the draft-edit rule of P19-02 § 7.2) |
| `discarded` | anyone in scope | **409** `IPM_NOT_SUBMITTED` "A discarded draft has no report." |
| `submitted` / `voided` (incl. superseded, imported) | anyone with `ipm` read in scope | **200** `kind: "issued"` |
| any | another tenant, another facility (bound), unknown | **404**, identical (A-10, C-03) |

Query: `render` ∈ `pdf`, `print` (optional; § 10.3), `lang` ∈ `id`, `en` (optional; recorded in the audit row only — the document carries codes, not labels).

### 10.2 `IpmReportDocument` (strict contract in `@callibrator/contracts` `ipmReport.ts`; the response's `data`)

```
{ scheme: "ipm-report-v1", kind: "issued" | "preview",
  sessionId, reportNumber | null, verifyUrl | null,
  status: "draft" | "submitted" | "superseded" | "voided",
  lineage: { supersedesReportNumber | null, supersededByReportNumber | null, supersededAt | null, voidedAt | null },
  issuer: { name, email, phone, address, city, state, zipCode, country, website, logoUrl | null },
  facility, device, room, floor,                       // the snapshots (P19-02 § 4.1)
  visitNumber | null, legacyVisitNumber | null, performedAt, submittedAt | null, timeZone,
  checklist: { templateVersionId, versionNumber, deviceTypeName, contentHash } | { imported: true },
  sections: [{ section, items: [ …the result fields of § 6…, required ] }],   // INSPECTION_SECTIONS order
  inspectionOutcome, maintenanceOutcome, recommendation, notes,
  performer: { name, role, organisation },
  signatures: [{ kind, name, role, organisation, meaning, signedAt, authMethod, valid }],
  countersignEnabled: boolean,
  integrity: { scheme, hash, state: "match" | "mismatch" } | null,
  flags: { capturedOffline, imported },
  generatedAt }
```

- **Not in it** (contract test `ipmReport.contract.test.ts`, strict key sets at every level — FT-71): user ids (performer, submitter, signer, voider), e-mails or phones of **people**, `tenant_id`, `client_ref`, `legacy_key`, `legacy_id`, work-order ids, `side_effects`, `received_at`, `client_captured_at`, revision, signature `ip_address`/`user_agent`, the void reason (shown to signed-in readers through `GET /ipm/sessions/:id`, not printed). The issuer's e-mail and phone are the **company's** (letterhead), not a person's.
- `issuer.logoUrl`: the tenant's branding logo through the existing same-origin path (`/uploads/public/…` or the signed path the branding uses) — live, unhashed, stated in the footer "Logo shown as currently configured."
- `notes` and every free text are returned as text; the renderer never interprets them (S-07/L-8).
- The **preview** document is built by the same server function from the draft row; the PWA builds an identical preview **locally** from its outbox (P19-08 § 12) with the contracts' `buildIpmReportPreview` so both previews print the same.

### 10.3 Rendering is audited (G-R10)

A read with `render` writes, **before** the response is sent (the ADR-114 order), one audit row in its own transaction: `action EXPORT`, `resource_type InspectionSession`, `resource_id`, `client_facility_id` the session's, `changes { operation: "RENDER_IPM_REPORT", format, language, reportNumber | null, kind }` — no content. A failed audit write fails the read (500 with the error envelope; nothing rendered). Reads without `render` (the on-screen report, the history) are not audited. Public verification renders are not audited (no principal). The renderer **always** fetches a fresh document with `render` — it never renders a cached copy for download — so every downloaded PDF has its audit row. A client that bypasses this (a modified browser) gets nothing it could not read on screen; the limit is stated, not hidden.

---

## 11. The Layout (`09` § 2 kept, L-1 … L-8 fixed)

**Paper:** A4 **landscape**, margins 10 mm; Noto Sans LGC (ADR-095 Am. 1 O-5), Helvetica + Latin-1 folding as the fallback; the page fits the common session on **one page**; overflow breaks **between** sections, and the completeness section and "notes + signatures" are each kept together (moved whole to the next page when they would split).

| Block | Content | Fix |
|---|---|---|
| Header | left: "IPM — Inspection and Preventive Maintenance" / "Inspeksi dan Pemeliharaan Preventif" and the **device name in upper case**; right: the **issuer** block (logo, name, address, contacts) | L-6 (typo); the letterhead is data (G-R5) |
| Identity (bordered, 4 columns) | "Rumah Sakit" facility name · "Tanggal IPM" performed date (tenant zone, `d MMM yyyy`) · "Ruang"/"Lantai" room, floor · "No. Inventaris" QR · "Merk" · "S/N" · "Model/Tipe" · **"Tanggal Kalibrasi Terakhir"** `device.lastCalibrationDate` and **"Kalibrasi Berikutnya"** `nextCalibrationDate` ("—" when none) | **L-1** (the calibration date is the device's, from the snapshot, never the IPM date) |
| Report line | "No. Laporan" report number · "Visit ke" visit number zero-padded to 3 (`004`) — imported: "Visit ke (upstream): N" beside the recomputed one | L-5, G-S2 |
| Sections 1 – 5 | as `09` § 2.2 in its order and two-column grid: environment ‖ electrical supply; tools used ‖ other safety + physical (**condition from `outcome`, cleanliness from its own field**); electrical safety (value, unit, limit, **computed** pass/fail — "evaluated at import" on imported rows) ‖ function; completeness (full width, two sub-columns); performance table (item · Setting · Terukur 1 · Terukur 2 · Nilai Acuan · Kondisi, with a disagreement mark where the technician's outcome differs from the computed one) | L-3 |
| Battery | printed when the session has battery results (2024 sessions) | **L-4** |
| "Hasil Pemeriksaan" | the session's `inspectionOutcome` ("Baik" / "Tidak Baik", or "—" on an imported row without one) | **L-2** |
| Maintenance tasks ‖ Consumables | as `09` § 2.2 row 7 | |
| "Hasil Maintenance", "Rekomendasi Hasil Pekerjaan" | `maintenanceOutcome`; `recommendation` through the code → label map of `09` § 2.2 row 9 (`fit_for_use` "Alat Dapat Digunakan", `needs_calibration` "Alat Perlu Dikalibrasi", `not_fit_for_use` "Alat Tidak Dapat Digunakan", `needs_repair` "Alat Harus Diperbaiki") | |
| Notes | free text as text; "-" when absent | L-8 |
| Signatures (kept with notes) | two columns: **"Teknisi Pelaksana"** — "Signed electronically by <name> (<role>, <organisation>) on <date time, zone> — meaning: authorship — hash <first 12 hex>…", or "<performer name> — not yet signed electronically"; **"IPSRS"** — the countersignature the same way, or "Awaiting electronic countersignature" (setting on), always above an empty line for a wet signature | F-61 / UD-17 |
| Lineage band (when relevant) | "This report supersedes <number> (visit <n>)" · "Superseded by <number> on <date>" · "Voided on <date>" · "Imported from the previous system (SKP IPM); not signed electronically" | ADR-126 § 8 |
| Footer (every page) | report number · "Page x / y" · "Generated <date time> by <the reader's display name>" · QR (`verifyUrl`, 22 mm, bottom right, first page) · "Integrity (ipm-report-v1, SHA-256): <hash>" · on a mismatch "INTEGRITY CHECK FAILED" | L-7 |
| Watermark | "DRAFT — NOT A RECORD" (preview), "SUPERSEDED", "VOIDED" — diagonal, 15 % opacity; none on an issued effective report | |

**Language:** every fixed label comes from `i18n/messages/{id,en}.ts` namespace `ipmReport`; the reader chooses the language in the download dialog (default: the page's locale — Indonesian on the public verification page and the field app, English on the dashboard until Phase 11 decides its language). **Item labels, notes and snapshots print as captured** (the catalogue is single-language); dates in the chosen locale's format, in the tenant's time zone, with the zone named.

**File name:** `IPM_<reportNumber>_<performedDate>.pdf` (preview: `IPM_DRAFT_<device QR>_<date>.pdf`) — no person's name in it.

**Photos:** not printed (upstream parity: the report had none). The on-screen report lists the session's IPM evidence photos as thumbnails through the attachment API's signed links (AM-22, capped TTL), never embedded in the PDF and never as a permanent URL (FT-72).

---

## 12. Frontend (P23-02; P22-04 links to it)

| Piece | Where | Notes |
|---|---|---|
| Shared PDF primitives | `src/lib/pdf/{fonts,text,qr,watermark,download}.ts` | moved out of `certificatePdf.ts` (G-R11); `certificatePdf.test.ts`, `.unicode`, `.issuer.a303`, `.download` stay green **unchanged** — the proof the move changed nothing |
| Renderer | `src/lib/ipmReportPdf.ts` — `renderIpmReportPdf(doc, { language, readerName })` → `Blob` | loaded with `import()` only when the reader clicks "Download PDF"; jsPDF, `qrcode`, the font likewise; no `eval`, no injected script or style (ADR-071) |
| Canonical hash in the browser | `@callibrator/contracts` `canonicalIpmReportPayload` + `crypto.subtle` | the verification page only |
| On-screen report (accessible version) | `app/dashboard/ipm/sessions/[sessionId]/report/page.tsx` | semantic HTML: one `<main>`, one `<h1>` ("IPM report <number>"), `<article lang="id|en">` around the report body so a screen reader switches language; each section a `<section aria-labelledby>`; tables with `<caption>` and `<th scope>`; pass/fail/N-A through the **status-tone registry** (text + icon + tone; ADR-122); theme tokens only (`dashboardColours.p1101` guard); light and dark; actions "Download PDF", "Sign" (performer, when allowed), "Countersign" (IPSRS, when allowed) — buttons named after their object ("Download IPM report <number> as PDF"); the signature dialog is a labelled modal with focus trap, the password field `autocomplete="current-password"`, errors announced (`role="alert"`). **The PDF is not a tagged PDF** (jsPDF does not produce one); the on-screen report is the accessible version, and the download dialog says so |
| Signature dialog | `components/ipm/SignReportDialog.tsx` | meaning text shown before the credential ("By signing you attest that you performed this IPM and that this report is accurate" / the IPSRS review text), method choice password / MFA code, 401 shown inline (G-R12), 403/409 codes explained (§ 13) |
| Verification page | `app/verify/ipm/[reportNumber]/page.tsx` (+ `VerifyIpmContent.tsx`) | § 9.4 |
| API | `api/services/ipm.service.ts` through the **typed client** (`api/typed.ts`, paths generated from `openapi.json`) — no hand-written path | |

**Bundle:** the dashboard report page carries no jsPDF in first load (dynamic import; asserted by a `bundle-budget.json` entry `/dashboard/ipm/sessions/[sessionId]/report` set at the first build + 5 KB, the regression-ceiling rule of the budget file); `/` and every existing public route unchanged (the budget run is the proof); `/verify/ipm/[reportNumber]` ≤ 120 KB brotli.

---

## 13. Codes and Status Codes

Added to `IPM_CONFLICT_CODES` (`@callibrator/contracts`, P19-02 § 10.3): `IPM_ALREADY_SIGNED`, `IPM_ALREADY_COUNTERSIGNED`, `IPM_REPORT_NOT_SIGNED`, `IPM_COUNTERSIGN_DISABLED`, `IPM_REPORT_IMPORTED`, `IPM_REPORT_INTEGRITY` (409s); a new `IPM_SIGNATURE_REFUSALS` for the 403s: `IPM_SIGNATURE_NOT_PERFORMER`, `IPM_COUNTERSIGN_SOD`, `IPM_COUNTERSIGN_ROLE`, `IPM_COUNTERSIGN_FACILITY` — each with its explanation in `data.code`/message, so the dialog and the PWA say why.

400 validation (body shape, unknown `kind`, missing credential) · 401 wrong signing credential (the existing answer, on a credential endpoint) · 403 own-scope rule (§ 7.1, each named) · **404** another tenant's or facility's session, or a verification link that matches nothing · **409** a state that forbids the act (§ 7.1, § 10.1) · 429 the request budgets (with `Retry-After`).

---

## 14. Audit Events

Every row inside its transaction (the render row in its own, before sending); `client_facility_id` stamped from the session.

| Act | `action` | `changes.operation` | `changes` also carries |
|---|---|---|---|
| issuance (inside the submit of P19-02 § 14) | `APPROVE` (the submit's row) | `SUBMIT_IPM` / `SUBMIT_IPM_CORRECTION` | **+ `reportNumber`, `reportHash`, `hashScheme`** |
| performer signature | `APPROVE` | `SIGN_IPM_REPORT` | `kind`, `reportNumber`, `documentHash`, `authMethod` — never the credential |
| countersignature | `APPROVE` | `COUNTERSIGN_IPM_REPORT` | same |
| failed signing credential | `LOGIN` (the existing `recordSignatureAuthFailure` row) | `SIGN_IPM_REPORT` | method, outcome |
| render for download / print | `EXPORT` | `RENDER_IPM_REPORT` | `format`, `language`, `reportNumber`, `kind` |
| integrity mismatch (detected at read) | — (an error log + metric, not an audit row: nothing was done by a person) | | |

---

## 15. Security (P17-06 cross-reference)

- **FT-71** (provider-internal fields in the document): the strict contract and its key-set test (§ 10.2).
- **FT-15** (snapshot content): the signer snapshot has the performer snapshot's three keys only.
- **FT-72** (photos by permanent URL): no photo in the PDF; on-screen thumbnails through capped signed links.
- **S-06 / S-07 / L-8:** no public route without the 192-bit token; one identical 404; per-address budgets; text drawn as text.
- **Enumeration:** the number is sequential per facility and day and reveals only the facility's own count; the verification resolves by the random token; the 404 is identical for a wrong number, a wrong token and nothing.
- **Separation of duties:** the countersigner is never the performer/submitter (service 403 + trigger); a provider technician never countersigns for a client facility.
- **Part 11:** each signature carries the signer's printed name, date/time and meaning (§ 11.50), is linked to its record by the content hash so it cannot be copied to another record (§ 11.70), and needs a re-entered credential (§ 11.200 (a)); an offline submit is attributable through the audited submit, and its e-signature follows online.
- **Scope:** the signature route and the document are in context (hooks, marker); a bound FM of F2 cannot reach F1's session (404); the public verification is the one reviewed `skipTenantScope`/`skipFacilityScope` read of this card, keyed by the token only.
- **P17-06 should list:** "a report printed, then its session voided — the paper still circulates" (mitigation: the QR shows "voided" to anyone who scans it); "a verification token forwarded by a facility to a third party" (accepted: the token holder holds the paper's content anyway — the ADR-100 reasoning).

---

## 16. Test Plan — Mapped to P18-04 and the G-Rows

**Contracts (`packages/contracts/test/`, 100 % gate):** `ipmReport.canonical.test.ts` (§ 6 — hand-written expected hex for six fixtures; key order independent of input order; NFC; decimals as strings; `null` never omitted); `ipmReport.contract.test.ts` (FT-71: strict key sets of `IpmReportDocument`, `ipmVerification`, the signature body; no id/e-mail/legacy key); `ipmReport.preview.test.ts` (`buildIpmReportPreview` from a draft equals the server's preview of the same draft — fixture shared with the backend test).

**Backend (memoryDb = the real models and hooks):**
- `ipmReportIssue.p2104.test.ts` — the submit writes number, token, hash, scheme and issuer snapshot in its transaction; per-facility daily sequence (two facilities the same day both get `-001`; two submits of one facility get `-001`, `-002`); a correction gets its own number with `supersedesReportNumber` bound; a failed submit leaves no number consumed in a visible row; the token is never taken from the body (a supplied `verificationToken` is a 400 by the strict contract).
- `ipmReportDocument.p2104.test.ts` — § 10.1 row by row; the integrity `match`; a stored hash altered in the test database (as the owner, bypassing nothing but the service) → `mismatch`, error logged, metric incremented, document still served; `render=pdf` writes one `EXPORT` row before the body and a forced audit failure answers 500 with nothing sent.
- `ipmSignatures.p2104.test.ts` — § 7.1 row by row, each 403/409 asserting its **code and explanation**; the performer signs once; the countersign needs the setting and the performer's signature; SoD 403 `IPM_COUNTERSIGN_SOD` with the submitter as an FM (a self-served tenant's unbound FM who performed the IPM); an unbound FM on a client facility → 403 `IPM_COUNTERSIGN_FACILITY`; a wrong password → 401 with the failure audit row and **no** signature; a superseded session → 409 with `headReportNumber`; audit inside the transaction (forced failure after the audit write leaves neither row).
- `ipmSignatures.twoTenant.test.ts` — **A-11**: a T2 principal on T1's session → 404=, nothing written, `@two-tenant` marker.
- `ipmSignatures.twoFacility.test.ts` + `ipmCountersign.sod.test.ts` — **C-09**: HT1 performer on F2's session 404=; FM1 countersigning F2's session 404=; FM1 countersigning HT1's own submission where FM1 is also the submitter → 403 naming the rule; positive controls (HT1 signs its F1 session; FM1 countersigns it); `@two-facility` markers.
- `ipmReportDocument.twoTenant/twoFacility` — A-10 / C-03 rows already listed by P19-02 (the report-document route), extended with the `render` audit row stamped with F1.
- `ipmVerify.public.test.ts` — right token → full verdict; wrong token, absent token, unknown number, malformed number → **byte-identical** 404; no id, tenant id, legacy key or token in the verdict; superseded → the newer number but not its token; voided → no reason; both budgets counted (the failure budget only on non-verdicts — ADR-100's "decided after the lookup"); a verdict read for a bound facility's session needs no principal (and the reviewed skip is on G-13's list).
- `ipmSignatureNotify.twoFacility.test.ts` (G-21 / AM-21) — the "awaits countersignature" notification reaches F1's FM only.
- `socket.ipmSigned.test.ts` (G-19) — `ipm:signed` reaches the tenant room and F1's room only.
- Guards: `twoTenantRoutes.guard`, `twoFacilityRoutes.guard` (G-08), `facilityAccessibleRoutes.guard` (G-09: N-5 is the only marked `esignature` route), `routePermissionGuard.p604` (the public verify on the exemption list with its reason), `routeGateExemptions` review, `skipFacilityScope.guard` (G-13: the verify lookup), `facilityScopedModels.guard` (G-11), `stateUnions.p905` (`INSPECTION_SIGNATURE_KINDS`, `INSPECTION_SIGNATURE_MEANINGS` equal to their ENUMs), D-26, D-27 (`issuerSnapshot`, `signerSnapshot`), `modelIndexColumns.am3`, `associationForeignKeys.a148`, `includeRequired.d12` (signature → signer include LEFT, never needed — the snapshot prints).

**PostgreSQL 18, as `callibrator_app` and as the owner (P20-04/05 live tests):** `inspectionSignatures.p2005.live.test.ts` — insert refused on a draft, a superseded, a voided and an imported session; a countersign before a performer row refused; a countersign by the submitter refused; a `document_hash` different from the session's refused; UPDATE and DELETE and TRUNCATE refused for both roles; the device move cascades `client_facility_id` through sessions, results **and signatures** under `callibrator.facility_move` and is refused without it; grants read back (no UPDATE/DELETE for the app role); `inspectionImmutable.p2005.live` extended: the five report columns of a submitted session refused for the owner; on an upgrade boot (`upgradeBoot.am3.live`).

**Frontend (jest, P23-02):** `lib/pdf/*.test.ts` (moved primitives; the certificate tests unchanged); `ipmReportPdf.test.ts` — a **golden text test**: synthetic documents → jsPDF → text read back (the certificate test's method): section order, labels in `id` and `en`, the four recommendation labels, L-1 (calibration date from the snapshot, never the IPM date), L-2 (outcome printed), L-3 (cleanliness from its own field), L-4 (battery printed when present), the visit padded, the imported band, the watermark per status, the footer's number, page count and hash, the QR present (image object) and encoding `verifyUrl` (decoded in the test), a non-Latin name through Noto Sans and its fold under Helvetica; `ipmReportPage.test.tsx` (one `<main>`/`<h1>`, `lang` on the article, table headers, status tones with text, the Sign button only for the performer, the Countersign button only for an FM with the setting on); `SignReportDialog.test.tsx` (401 inline without a redirect — `client.signature.p1906.test.ts`; each 403/409 code's explanation); `verifyIpm.page.test.tsx` (verdict states; the browser-recomputed hash matches the fixture; the token never in a rendered link); `api.typed` paths compile against the generated schema.

**Browser suites (P23-02, on the compose stack):** `a11y.browser.js` gains the report page and the verification page (axe, **light and dark**); `responsive.browser.js` gains both at 360, 768, 1280; the CSP smoke gains a PDF download from the report page and from the verification page with **0 violations**; `automate/smoke.browser.js` gains "submit → sign → countersign → download → scan the QR's URL → verify page says issued and recomputes the hash".

**Live (P21-10, P23-02):** an API smoke of the three routes on a running stack; an E2E spec: capture and submit (number `…-001`), performer signs, IPSRS (bound FM) countersigns, the submitter-as-FM refused, the verification by token, a correction (new number, the old one "superseded" on its verification), a void by an administrator ("voided"); the golden PDF compared side by side with the upstream layout in **P23-05** (dry-run data on a throwaway stack).

**Privacy:** synthetic fixtures only.

---

## 17. Threat-Model Rows and AM-n Adopted Here

| Row | Here |
|---|---|
| FT-71 | adopted: the strict document contract and its key-set test (§ 10.2, § 16) — `docs/SECURITY/15` FT-71's proof column now names `ipmReport.contract.test.ts` |
| FT-15 | adopted for signer snapshots (§ 4.2) |
| FT-72 | adopted: no photo in the PDF, signed thumbnails on screen (§ 11) |
| AM-19, AM-21 | adopted: `emitForRow` for `ipm:signed`; `recipientsFor(session, "ipm-countersign")` (§ 7.2) |
| AM-22 | consumed: thumbnails through the capped signed links |
| AM-6 | adopted: the signatures trigger admits `client_facility_id` only under a device move (§ 4.2) |
| PT-30 (S-06, S-07) | the public verification and the renderer are in its scope |

## 18. Traps Checked

| Trap | Here |
|---|---|
| optional include without `required: false` / `defaultScope` include | signatures and sessions have no `defaultScope`; the document reads snapshots, never an include of `User` (A-90) |
| a global uniqueness oracle | `report_number` unique **per tenant**; the only global unique is the random token (no oracle, ADR-100) |
| a path parameter the validator never sees | `validate(schema, { from: ["params", "query"] })` on the document and the verification, `["params", "body"]` on the signature |
| `schema.validate` passed to Express | `validate()` only |
| a model index on a migration-added column | all indexes in P20-04 |
| named export beside `export =` | the model `export =` alone; contracts named exports |
| blanket `try/catch` in a migration | none |
| `tenantId` from a body | never; the token never from a body either |
| a 409 reported as 500 | every state refusal has its code; an unforeseen trigger refusal maps to 409 (P19-02 § 5.1) |

## 19. Decisions Made Here (recorded as ADR-126 Amendment 2)

1. The session is the issued record; the report is its document — **no certificate row** (G-R1).
2. `IPM-<facility code>-<YYYYMMDD>-<NNN>`, per tenant, facility and day; one number per submitted session (G-R2).
3. The verification requires the token; one identical 404; no minimal verdict (G-R3).
4. Scheme `ipm-report-v1`, canonical payload in contracts, **stored** at submit and recomputed at every read; a mismatch is shown, logged and alerted (G-R4).
5. `issuer_snapshot` at submit; the logo live and unhashed (G-R5).
6. `inspection_session_signatures`, facility-scoped and append-only; `e_signature_records` not written for IPM; no `FACILITY_READABLE` entry for signature tables (G-R6).
7. Bound HT and bound FM get `esignature` **W** in the ceiling, reaching only N-5 (G-R7).
8. `ipm.countersignEnabled` per tenant; the wet-signature line always printable; nothing gated by a signature (G-R8).
9. The performer's signature is a separate online act after the submit; never in the outbox (G-R9).
10. Rendering is audited through the `render` read, before the document is sent (G-R10).
11. The jsPDF primitives are shared under `lib/pdf/` with the certificate PDF unchanged (G-R11).
12. The signature route is a credential endpoint for the client (G-R12).

**For the owner / SME (none blocks the build):** whether a facility should be able to **require** the countersignature before the report is shown to its own staff (recommended no — the record exists at submit; a pending countersignature is printed, not hidden); whether the report should print the technician's **employee number** (recommended no — not in the upstream layout, and not needed for attribution, which the signature and the audit trail carry).
