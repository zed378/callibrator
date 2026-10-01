# DAST — Live black/grey-box security probe of a local throwaway stack

**Date:** 2026-09-29 · **Agent:** DAST probe · **Scope:** AUTHORISED, LOCAL ONLY (never the VM)
**Result:** No new confirmed vulnerabilities. One pre-existing, already-tracked SSRF surface reconfirmed (A-176). No cards added.

## Stack under test

- Built from `git archive HEAD` (`ce74932`, Phase-9 batch 9) — the working tree was mid-conversion
  (dual `.js`/`.ts` for `globalSanitizer`, `notFound`, `requestTimeout`, `validateUuid` middlewares)
  and `build:dist` refuses it, exactly as P9-00 documents. HEAD is collision-free and builds.
- Compose project `callib-dast`, backend on `127.0.0.1:26100`, datastores unpublished, clamav/frontend/nginx
  omitted. **Named** Docker volumes (a Postgres bind-mount onto the Windows FS hangs on initdb fsync — the
  classic Windows/Docker trap; the first attempt sat "unhealthy" 14 min at post-bootstrap init).
- **Run in production mode.** The committed `docker-compose.dev.yml` forces `NODE_ENV=development`, which
  turns CORS into reflect-all (dev default) and relaxes error output — so a probe against it produces false
  positives. Recreated the backend with `NODE_ENV=production` (data survived in the named volumes).
- Seeded base + demo (`/migration/seeding`, `/migration/seed-demo`).

## Principals created (harness in scratchpad `dast/`)

- **Operator** `sys@mail.com` — MFA enrolled via the real API. otplib 13 is ESM-only and won't `require()`
  under CJS, so the harness implements RFC-6238 TOTP with `crypto` (SHA1/6/30, identical to otplib defaults).
  Login for an MFA-enrolled account returns `data.mfaRequired` + an `mfa` purpose token → `/auth/mfa/login`.
- **Two tenants** A (`DASTA` `b96878d2…`) and B (`DASTB` `494451e5…`), each with a **tenant admin**
  (CALIBRATOR_ADMIN, lvl 8), **technician** (lvl 5), **read-only** (USER, lvl 1), and an **API key**
  (scope `equipment:read`). Notes for future harnesses: user create is `POST /users/create` (`/create`, not `/`);
  for a super-admin the created tenant comes from the **body** `tenantId` (userService line ~804:
  `actorIsSuperAdmin ? tenantId : actorTenantId`), NOT the `X-Tenant-ID` header; username regex is
  `^[a-zA-Z0-9]+$` (no `_`); admin-created users carry a temp password (ADR-059) → login then
  `/auth/just-update-password` then re-login; API keys minted as operator with `X-Tenant-ID` (super-admin
  bypasses the `api_keys` plan gate + rbac); scope resources are MENU_SLUGS (`equipment`, `calibration`, …),
  device routes gate on `calibration` (so an `equipment:read` key is correctly 403 on `/calibration-devices`).
- Access tokens are 15 min; the harness re-authenticates every principal per run (`lib.sessions()`).

## What was probed and found CLEAN (all live unless noted)

- **JWT tampering** — `alg:none`, payload-tamper w/ kept sig, HS256 forge with `""`/`secret`/`changeme`/kid,
  RS256 alg-confusion, sid-swap: **all 401**.
- **Login throttle (ADR-059)** — confirmed working; 5 wrong on one identifier paused the pair and then refused
  even the correct operator password with 429 (as designed; it locked me out ~15 min mid-probe).
- **Forgot-password oracle** — identical 200 "If the account exists…" for known and unknown.
- **Password-check budget (ADR-072)** — `/auth/pass-is-valid` wrong ×4 → 200 `valid:false`, 5th → 429, session
  then revoked (subsequent authed call 401). Exactly as specified.
- **Tenant isolation** — A vs B on calibration-devices: GET/DELETE of B's id → **404**; A's list excludes B;
  `X-Tenant-ID: B` header on a non-operator is **ignored** (still scoped to A); audit `?tenantId=B` → 404;
  GDPR export download URL 404 to unauth and to tenant B. The global hooks (ADR-048) are the mechanism.
- **Mass assignment** — create with body `tenantId:B`/`isSystem:true`/`id:…` lands in A, ignored; `roA` cannot
  raise own `roleId` via `/users/edit` (403); tenant admin cannot set `status`/`maxUsers` (403) nor a
  super-admin roleId (blocked at validation, no row created).
- **Authorization matrix** — read-only USER denied all writes (403); technician denied user/tenant create,
  `/api-keys`, `/roles` (403); API-key scope enforced (`equipment:read` → attachments 200; calibration r/w,
  users, audit, key-minting all 403/404); API key cross-tenant returns no foreign rows.
- **Input handling** — global search + AI/pgvector raw SQL are bound-parameter & tenant-scoped; no
  user-controlled sort/order column anywhere; path traversal on `/attachments/:id/signed` and `/uploads` blocked
  (UUID validation / route-not-found). Attachment signed URLs: HMAC(secret, `id.exp`), timingSafeEqual, tokens
  only issuable via tenant-scoped code — sound.
- **Open redirect** — SSO handoff/refusal redirects build the target from server `FRONTEND_URL` + a code/error
  param only; IdP `redirect_uri` is fixed server-side (A-68).
- **Headers/transport (production)** — CSP `default-src 'self'; frame-ancestors 'none'; object-src 'none'`,
  HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, no `X-Powered-By`; CORS rejects a
  foreign origin (no ACAO). Backend returns the token in the body (BFF owns the cookie), as designed.

## Reconfirmed OPEN (already tracked — no new card)

- **SSRF via tenant-set URLs the server calls** — `oidcJwks.discover` does `axios.get(<oidc_authority>/.well-known/openid-configuration)`
  and `ai.service` does `axios.post(<ai_base_url>/…)` with **no** SSRF guard and default redirect-following,
  unlike webhooks/S3 which use `ssrf.util`. This is exactly the open note on **A-176** ("`ai_base_url` /
  `oidc_authority` are tenant-chosen URLs the server calls (SSRF surface, pre-existing)"). Left as-is; it also
  sits in the security-fixes agent's OIDC territory.

## Non-security observations (not filed)

- A rejected CORS preflight in production returns **500** (`callback(new Error("Not allowed by CORS"))`) rather
  than a clean 403. No security impact (still blocked, no ACAO).
- Tenant admin creating a SUPER_ADMIN user is blocked but surfaces a generic 400 "An unexpected error occurred"
  (a masked validation throw) instead of a clean 403/400. Control holds; cosmetic.

## Teardown

`docker compose -p callib-dast down -v`, image removed. All harness artefacts under scratchpad `dast/`.
