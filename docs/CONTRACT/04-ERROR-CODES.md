# 04 — Error Codes: the Catalogue and Its Conventions (TARGET)

> **TARGET — nothing here is built.** As built (2026-10-08): errors carry a prose `message`. A machine
> `code` exists only where a client had to react to a gate. `response.util.ts#error` adds it as a
> **top-level** field through `extra` (`PASSWORD_CHANGE_REQUIRED`, `MFA_ENROLMENT_REQUIRED`,
> `auth.middleware.ts`). The frontend maps status + code to messages in `frontend/src/i18n/apiErrors.ts`.

---

## 1. Why Codes

The owner's rule (ADR-136): **stable machine error `code`s beside the message**, so that web and
mobile translate them, and so that a port in any language answers the same `code` even when its
`message` is worded differently. A client **MUST** branch on `code`, never on `message` text.

## 2. Where the Code Lives

```json
{ "success": false, "status": 409, "message": "This IPM was submitted on 2026-10-03 and cannot be edited — submit a correction.",
  "code": "IPM_NOT_DRAFT", "data": null }
```

- **Top-level `code`**, a sibling of `message`, on **every** error response (B-ENV-2). This is the
  as-built position. `MEMORY/specs/P19-02` § 10.4 and `P19-08` § 9.5 wrote `data.code`. The contract
  reads those as this top-level field: the specs' intent (a machine code the PWA keys on) is kept, the
  position is the as-built one, and `data` stays `null` on errors (`docs/BACKEND/12` § 9). Recorded in
  ADR-136 (deviation); the spec owners align their text.
- Optional structured context the client needs in order to act lives in `data` **only when the code's
  catalogue entry declares it** (e.g. `IPM_DRAFT_EXISTS` → `data: { draftId }`;
  `APP_UPDATE_REQUIRED` → `data: { platform, minVersion }`). Otherwise `data` is `null`.
- A 400 validation error has `code: VALIDATION_FAILED` plus `errors[]`, each with its own `code`
  (`REQUIRED`, `TOO_LONG`, `NOT_A_UUID`, `OUT_OF_RANGE`, `INVALID_ENUM` … B-ENV-3).

## 3. The Registry: `contracts/errors/codes.yaml`

```yaml
IPM_NOT_DRAFT:
  status: 409
  area: ipm
  since: "1.4.0"
  meaning: The session is not a draft; only a correction can change it.
  data: null
  messages:                          # the default client text; i18n keys are generated from these
    id: "IPM ini sudah dikirim pada {submittedAt} dan tidak bisa diubah — ajukan koreksi."
    en: "This IPM was submitted on {submittedAt} and cannot be edited — submit a correction."
  params: [submittedAt]              # values the client may interpolate, sent in data when listed
  operations: ["POST /ipm/sessions/{sessionId}/submit", "PATCH /ipm/sessions/{sessionId}"]
```

- Every `code` an operation can answer is listed on that operation's error responses
  (`x-error-codes: [...]`). Spectral fails on a code that is used but not registered, or registered
  but used nowhere (except reserved codes). The conformance suite fails on a response whose `code` the
  operation does not list.
- `packages/i18n` **generates** its `apiErrors.<CODE>` keys from the registry (`id` and `en` required).
- `messages` are the **clients'** text. A backend's `message` may differ in wording (it is for logs and
  for clients without the key). Clients show their own translation when they know the code.

## 4. Naming and Stability

| Rule | |
|---|---|
| Format | `UPPER_SNAKE_CASE`, ASCII, ≤ 48 chars, prefixed by area when not generic (`IPM_`, `CERTIFICATE_`, `FACILITY_`, `IDEMPOTENCY_`, `AUTH_`) |
| Meaning, not cause | `CERTIFICATE_NOT_SUBMITTED`, not `CERT_STATE_ERR_3` |
| Stability | **a code is never renamed or removed within v1**. A code can be deprecated (`deprecated: true`, `replacedBy`), but it is still sent until v2 |
| One status per code | a code always comes with the same HTTP status |
| No oracle | a code **MUST NOT** distinguish what B-STATUS-2 makes indistinguishable: not-found, deleted and not-yours are all `NOT_FOUND`. Uniqueness conflicts a facility-bound user can trigger are per facility (ADR-124 security analysis) |
| Generic codes | `VALIDATION_FAILED`, `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT` (avoid; prefer a specific one), `GONE`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `RATE_LIMITED`, `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE` |

## 5. Codes Already Decided Elsewhere (to be registered in Phase 32)

| Source | Codes |
|---|---|
| As built (gates) | `PASSWORD_CHANGE_REQUIRED`, `MFA_ENROLMENT_REQUIRED` |
| Scope loss (P19-08 § 9.5, ADR-127 Am. 1) | `ACCOUNT_INACTIVE`, `TENANT_SUSPENDED`, `TENANT_DELETED`, `FACILITY_INACTIVE`, `FACILITY_ENDED`, `FACILITY_BINDING_PENDING` |
| Facility gate (ADR-124 Am. 2 § 8) | `FACILITY_ROUTE_REFUSED`, `FACILITY_UNRESOLVED` |
| IPM (P19-02, `IPM_CONFLICT_CODES` in `@callibrator/contracts`) | `IPM_DRAFT_EXISTS`, `IPM_REVISION_CONFLICT`, `IPM_NOT_DRAFT`, `IPM_VOIDED`, `IPM_SUPERSEDED`, `IPM_ORIGINAL_NOT_EFFECTIVE`, `IPM_DEVICE_RETIRED`, `IPM_DEVICE_INACTIVE`, `IPM_FACILITY_ENDED`, `IPM_NO_CHECKLIST`, `IPM_VERSION_RETIRED` |
| Idempotency (ADR-126 Am. 1) | `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_IN_FLIGHT`, `IDEMPOTENCY_SCOPE_CHANGED` |
| Backend for mobile (`docs/MOBILE/20` § 13a, ADR-134) | `APP_UPDATE_REQUIRED`, `SESSION_REVOKED`, `REFRESH_RACE`, `NATIVE_BROWSER_REFUSED`, `NATIVE_CLIENT_REQUIRED`, `TENANT_CODE_REQUIRED`, `INVALID_CREDENTIALS`, `SSO_EXCHANGE_FAILED`, `SESSION_EXPIRED_ABSOLUTE`, `TENANT_NOT_FOUND` (the uniform answer of both public tenant lookups) |
| Devices (P19-03, ADR-132) | the QR and serial conflicts of the P19-03 spec (exact names fixed there) |

Each existing module's prose errors get codes **module by module** in Phase 32. The inventory comes from
the as-built `error(…)` / `forbidden(…)` / `conflict(…)` call sites, and each module's change is
additive (a new `code` field on existing responses).

## 6. Client Rules

- Show the client's translation for a known `code` (with `params` from `data`). Otherwise show the
  server's `message`. Otherwise show a generic text for the status.
- `code`s that change the session (`SESSION_REVOKED`, scope-loss codes, `APP_UPDATE_REQUIRED`,
  `PASSWORD_CHANGE_REQUIRED`, `MFA_ENROLMENT_REQUIRED`) are handled once, in `packages/api-client`'s
  classifier (`docs/SHARED/03`), never per screen.
- An unknown code is not an error in the client: it falls back to the message (B-VER-1, additive).
