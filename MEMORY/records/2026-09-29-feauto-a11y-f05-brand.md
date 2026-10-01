# axe in the browser suite, F-05 against the real backend, tenant brand contrast, zoom and reduced motion

**Cards:** F-05, F-12 (AUDIT-2026-09-FRONTEND) · **ADRs:** ADR-074 Amendment 1, ADR-090 Amendment 1 · **Agent:** frontend-automation ("feauto") · **Dates:** 2026-09-29 → 2026-09-30

## What changed

| Area | Files |
|---|---|
| Browser a11y suite (new) | `automate/a11y.browser.js`; `Makefile` (`test-browser` runs the smoke, then this) |
| Smoke kept working | `automate/smoke.browser.js`: signs in again before clean-up (a short access token outlived the run); identifier-first sign-in (ADR-098) handled; each submit targets its own form (`form:has(#username)`, `form:has(#password)`, `form:has(#mfa-code)`) because the public header's language switcher is a form with submit buttons earlier in the document |
| F-05 | `frontend/src/lib/authCookies.ts` (`auth_renewable`), `lib/sessionRouting.ts`, `proxy.ts`, `app/api/v1/[...path]/route.ts` |
| Brand colour | `frontend/src/lib/brandColor.ts` (new), `components/TenantBrandingProvider.tsx`, `app/globals.css` (brand rules), `app/dashboard/tenants/components/TenantFormFields.tsx` (preview, label association); `backend/src/validators/tenant.validator.ts` (comment only: form-only by decision) |
| Reduced motion | `frontend/src/app/globals.css`: last block ends every animation/transition under `reduce`; `animate-spin` exempt |
| Landing contrast | `TrustSection.tsx` marquee and `HowItWorksSection.tsx` numerals fixed, then **both files deleted by Phase 10** (ADR-098) during this work; superseded |
| Docs | `MEMORY/DECISIONS.md` (ADR-074 Am. 1, ADR-090 Am. 1, ADR-090 Open table), `docs/FRONTEND/03-API-CLIENT.md` (401 row), `docs/UI-UX/17-ACCESSIBILITY.md` (as-built notes: tables scroll in their container at 200%, the suite), `TASKS/AUDIT-2026-09-FRONTEND.md` (F-05 DONE, F-12 row), `TASKS/BACKLOG.md` (M-14, M-15, M-16) |

## Tests (named)

- `frontend/src/lib/brandColor.test.ts`: the surfaces match `globals.css`; a passing colour is kept exactly; 50 colours (a hue × lightness sweep plus extremes) meet the ADR-090 rule in both themes, checked independently of the module's loop; hue is kept; the light shade only darkens and the dark shade only lightens; invalid input returns null.
- `frontend/src/app/dashboard/tenants/components/__tests__/brandColor.adr090.test.tsx`: `applyBrandColor` sets the per-theme pair and never `--primary`, clears on invalid input, and removes a stale raw `--primary`. The preview says "adjusted for contrast" or "as chosen". The form's colour field is labelled and axe-clean.
- `backend/src/tests/validators/tenant.brandColor.adr090.test.ts`: create and update accept five low-contrast colours unchanged; `#fff`, `#ffff0000`, `ffff00`, `yellow` and `#gggggg` → 400.
- `frontend/src/app/api/v1/[...path]/route.refreshCookie.f05.test.ts`: `POST /auth/mfa/login` and `/auth/impersonate` write `auth_refresh` (on its own path) and `auth_renewable`, with neither token in the body. A sign-in without a refresh token writes neither. A session-only body updates only `auth_session`.
- `frontend/src/proxy.test.ts` (amended): an expired token with `auth_renewable` passes. **With `auth_refresh` alone it goes to `/login`.** The old test put the path-scoped cookie on a page request, which no browser does. A dead-session clear removes `auth_renewable` and `auth_refresh` with `Path=/api/v1/auth/refresh`.
- `frontend/src/lib/authCookies.test.ts` (amended): the written set and the cleared set include `auth_renewable`.

Results on the tree, 2026-09-30:

| Gate | Result |
|---|---|
| The suites above, plus `src/app/api/v1/**` and `src/api/**` (76 suites) | 736/736 pass |
| Full frontend `npx jest` | 256/259 suites; the 4 failing tests are other lanes' in-flight work: `MfaLoginForm.a141` and `verify/page` (Phase 10 rewrite), `menuHelpers.seedIcons.a118` (menu icon map) |
| `npm run typecheck` (TS 7, frontend) | 0 errors |
| `npx eslint` on every changed frontend file | clean |
| backend `npm test` on the two validator suites | 100/100 |
| backend `npx eslint` on both files | clean |
| backend `npm run ratchet` | passes |
| `next build` | green from a snapshot of the tree (below) |

## The local stack (how to reproduce, after P9-00)

A disposable stack, **everything in scratch**, names `callib-feauto-*`, ports 2546x:

```bash
docker run -d --name callib-feauto-pg    -e POSTGRES_PASSWORD=… -e POSTGRES_DB=callibrator -p 127.0.0.1:25461:5432 pgvector/pgvector:pg18
docker run -d --name callib-feauto-redis -p 127.0.0.1:25462:6379 redis:8.6-alpine
docker run -d --name callib-feauto-mq    -p 127.0.0.1:25463:5672 cloudamqp/lavinmq:latest
# backend: a copy of backend/ (not node_modules/log/uploads) with junctions to the repo's
# node_modules, its own .env (PORT=25460, DB/Redis/AMQP above, generated secrets, KMS_MASTER_KEY,
# NODE_ENV=production, FORCE_HTTPS=false, ALLOW_SEEDING=true, JWT_ACCESS_EXPIRED=60s for F-05
# or 15m for the suites), then:  node --import tsx index.js
curl http://127.0.0.1:25460/api/v1/migration/seeding
# ADR-099: the first super admin has a one-time password in <backend>/.bootstrap/superadmin-password;
# sign in with it once, then POST /auth/first-sign-in/password {token,newPassword}.
# frontend: a copy of frontend/ with tests removed, turbopack.root and outputFileTracingRoot set to a
# common ancestor of the copy and the repo (Turbopack refuses a node_modules junction outside its root),
#   NEXT_PUBLIC_API_BASE_URL=http://localhost:25460 next build
#   BACKEND_INTERNAL_URL=http://127.0.0.1:25460 next start -p 25464
E2E_OPERATOR_PASSWORD=… E2E_MFA_STATE_FILE=<scratch>/mfa-sys.json \
FRONTEND_URL=http://localhost:25464 BASE_URL=http://127.0.0.1:25460 make test-browser
```

**Why a snapshot and not the live tree.** Other lanes were editing the tree throughout. `next build` of the live tree failed at different moments on their in-flight files: a test file's types, `useUsers.ts`, and `certificatePdf.ts` caught mid-write with an unterminated string. The snapshot build sets `typescript.ignoreBuildErrors` **in the copy only**, because a foreign type error must not stop the stack. The real tree was type-checked separately and is at 0 errors. `E2E_MFA_STATE_FILE` is per stack: the default per-identifier file in the OS temp directory is shared with every other stack's `sys@mail.com`.

## F-05 — against the real backend, `JWT_ACCESS_EXPIRED=60s`

Script: scratch `f05.live.js`. A HEALTHCARE ADMIN signs in through the form, types into the device search, waits 70 s, then types one more character. Next it waits 70 s and loads `/dashboard/users`. Finally it rotates the browser's refresh token from outside (as a thief or another device would), waits 70 s, and loads a page.

| | Before the fix (build of the tree, 2026-09-29) | After (final build, 2026-09-30) |
|---|---|---|
| in-page action after expiry | 1 × 401 → 1 × `POST /auth/refresh` 200 → retry 200; text kept; no navigation | same |
| **page load after expiry** | **`/login?callbackUrl=/dashboard/users`**, signed out | stays on `/dashboard/users`; one refresh |
| revoked refresh token | `/login`, no bounce, **`auth_refresh` left behind** (the guard's clear missed its path) | `/login` once, no bounce, **no session cookie left**, the refused refresh tried once (401) |
| result | 6 checks failed | **16/16 pass** |

The browser a11y suite found the page-load defect first: every dashboard page after the first minute redirected to `/login` (run 1: 33/76). Cause: `auth_refresh` is scoped to `/api/v1/auth/refresh`, so a browser never sends it with a page request, and `hasUsableSession` never saw it. Reading the catch-all proxy then found the second defect: MFA and impersonation sign-ins had their refresh token stripped from the body and stored nowhere. Neither fix needed a backend change, so the Phase 9 lead was not messaged.

## Brand colour — the debate and the decision

See ADR-090 Amendment 1. In short: a save-time contrast rule cannot work, because no colour passes 4.5:1 on both the light card (`#ffffff`) and the dark card (`#1e293b`). So the colour is **derived per theme at render**. The form shows the shade each theme will use. The backend validator stays form-only, and a test pins that decision.

## 200% zoom and reduced motion

- **Reduced motion — fixed.** Before: under `reduce`, `/login` still ran `scaleIn` 400 ms, `fadeInDown` 500 ms and `fadeInUp` 600 ms × 4, and `/` ran `ping` 1000 ms, `fadeIn` 500 ms and four 500 ms nav transitions (suite run 1). After the global block: none on the six pages (runs 3 and 4).
- **200% zoom — no page scrolls sideways** at 683 × 450 CSS px on `/`, `/login`, `/dashboard`, devices, users and maintenance. Tables do **not** reflow to cards as `17-ACCESSIBILITY.md` describes: they scroll inside their own `overflow-x-auto` container (devices 692 px of content in 585 px, maintenance 593 in 585, users fits). WCAG 1.4.10 exempts data tables, so this is conformant. The doc now says so as-built.
- Filed as cards: **M-14** (the suite in CI), **M-15** (GSAP and other script-driven motion is invisible to the reduced-motion check), **M-16** (the screen-reader walk, still owed).

## Browser suite runs

Runs 1–4 (2026-09-29, the tree before Phase 10's public pages) took the suite from 33/76 to 78/80. Its own flakiness was fixed: wait for a visible `<h1>` in `<main>` instead of the app shell's spinner; wait for animations **after** the reveal scroll; wait for the create button; re-sign the admin for late API calls; expand minified 3-digit hex. The two remaining failures were in the brand check's own contrast parser (`#fff`), not the product.

### Final runs, 2026-09-30, on today's tree (backend and frontend snapshotted together)

Two changes from other lanes landed during these runs, and the suites were adapted to both: identifier-first sign-in (ADR-098), and administrator passwords that are now one-time (`POST /auth/first-sign-in/password`). The a11y suite also now **fails on WCAG findings and prints best-practice findings as WARN lines** (`A11Y_STRICT=1` makes those fail too). Phase 10's new public pages carry `region` best-practice findings on `/login` and `/register` (`.pub-link-quiet`, the language switcher), which belong to that lane.

| Run | Smoke (7 checks) | A11y (80 checks) |
|---|---|---|
| A 12:15 | 4/7: sign-in, MFA enrol, MFA sign-in and device list pass; **certificate PDF fails** ("certificate number not printed") | 79/80. The one failure was dark `/dashboard/sop` measuring a half-faded loading skeleton (`.animate-pulse`); the suite now waits for skeletons to clear |
| B 12:36 | 4/7, the same certificate failure | **80/80** |
| C 16:48 | 4/7, the same certificate failure | could not run: an API call timed out (machine load) |
| D 17:09 | could not run: 408 from the backend on the approver's password (machine load) | could not run: API timeout (machine load) |

**Not achieved: the suite green twice in a row.** The a11y suite was green once on the final tree (B, 80/80) and 79/80 once (A). Runs C and D never reached a page, because API calls timed out under machine load: logins took 12–30 s, and one earlier run lost its backend to an AMQP `Unexpected close` crash (`backend-crash-amqp.log` in scratch). **The smoke's certificate-PDF check fails in every run.** That is the certificate lane's in-flight work (`frontend/src/lib/certificatePdf.ts`: 366+/159− against HEAD, and the smoke's certificate checks added by that lane). No file of this lane is involved.

## Left open

- **The browser suite green twice in a row on a quiet machine**: owed. The a11y suite has one full green run on the final tree; the smoke's certificate check waits on the certificate lane.
- The **screen-reader walk** (M-16), the **suite in CI** (M-14), and **script-driven motion** (M-15).
- Best-practice `region` findings on Phase 10's `/login` and `/register` (WARN lines in the suite; the Phase 10 lane's).
- Anything else that renders the brand colour (an e-mail, a PDF) must reuse `brandColor.ts`. Nothing does today.
- Running `npm run ratchet` lowered `backend/.ts-ratchet.json`'s floor 966 → 965 on the shared tree, because another lane had removed a `.js` file. The file was left as the tool wrote it.

## Teardown

2026-09-30: containers `callib-feauto-pg`, `callib-feauto-redis` and `callib-feauto-mq` removed (`docker ps -a --filter name=feauto` shows none), the backend (:25460) and frontend (:25464) processes stopped, and the scratch `node_modules` junctions unlinked (the repo's `node_modules` were checked intact). Only logs and snapshots remain, in the session scratchpad. The VM was not touched.
