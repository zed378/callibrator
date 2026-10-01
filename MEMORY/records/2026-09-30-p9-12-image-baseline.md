# 2026-09-30 — P9-12: the P9-00 E2E baseline against a built image

**Card:** P9-12 (identity and access). **Agent:** the Phase 9 lead. **Purpose:** P9-12's DONE needs the live E2E suite, run against an image built from the converted tree.

## How the image was built

**Five build attempts failed first, none of them on P9-12 code:**
- **Twice, the pkg step's base-binary download failed.** The Dockerfile fetches an 80 MB `node-v26.5.1-linux-x64` from the pkg-fetch GitHub release at build time. pkg first reported "Network error during fetch"; later, on this loaded host, the download stalled until the timeout. Its from-source fallback is refused on Alpine. Recorded as **A-325** (the Dockerfile belongs to P7).
- **Once, `openapi:check` was red** while P9-25 was in flight.
- **Once, `build:dist` picked up a half-written `tenantHierarchy.service.ts`** from another lane's swap. This led to Amendment 18's atomic-swap rule.
- **Once, `build:dist` refused a `meteredBilling` `.js`/`.ts` pair.**

**The build that succeeded came from a frozen snapshot** of the Dockerfile's allow-list (root `package*.json`, `frontend/package.json`, `backend/`, `packages/contracts/`), taken in the scratchpad when no helper had a plant or a half-swap in place.
- **A trap the first attempts fell into:** `docker-compose.dev.yml` overrides the backend build context back to the live repository, so the first "snapshot" builds actually built the live tree. The scratch stack's dev overlay was changed too.
- **The pkg base binary was downloaded on the host** and checked against pkg-fetch's own pinned sha256 (`expected-shas.json`: `02b77b99…c9e436`, identical).
- **It was served to pkg through `PKG_CACHE_PATH`,** in the scratch copy of the Dockerfile only. That changes where pkg reads the binary from, not what it packages.
- **Inside the image, `build:dist`** copied 199 JavaScript files and compiled 348 TypeScript files, and pkg built the binary.

## The run

**The stack:**
- the scratch stack `p9/stack2` (compose project `callib-p912`, backend only, the e2e overlay);
- boot healthy in 35–45 s;
- `[schema-verify] OK: 74 tables, 920 columns and 13 control objects match the models`;
- seeded with `/migration/seeding` and `/seed-demo`.

**Credentials:** `E2E_OPERATOR_PASSWORD` was random, and `E2E_BOOTSTRAP_PASSWORD` was read from `/app/.bootstrap/superadmin-password`.
- A first attempt was void. Git Bash rewrote the container path, so the bootstrap password was never read; that tripped the login throttle, and the stack was recreated with `down -v`.
- Set `MSYS_NO_PATHCONV=1` for any `docker exec` path from Git Bash.

| Run | Suites failed | Tests failed / total |
|---|---|---|
| 1 | 7 | 50 / 433 |
| 2 (after the ADR-099 spec fix) | 5 | 7 / 433 |
| 3 | 3 | 5 / 433 |

## Every failure, attributed

**Run 1, `auth.e2e` (32) and `sop.e2e` (6):** "could not set a password (401)".
- **Cause:** P10-16 (ADR-099) made an administrator-set password one-time. The first sign-in answers a `password-change` token, which is spent at `POST /auth/first-sign-in/password`, not at `/auth/just-update-password`.
- **This is intended behaviour, so the specs were updated**, citing ADR-099: `backend/src/tests/e2e/auth.e2e.test.js` (createSigner) and `backend/src/tests/e2e/modules/sop.e2e.test.js` (the releaser).
- **Both pass in runs 2 and 3.**
- This was reproduced by hand first (`p9/repro-pw.js`, `repro2.js`).

**Stable in runs 2 and 3, all in new P10 specs that the earlier baseline C did not have:**
- **`p10-public-auth` (2):**
  - The SSO refusals are compared byte for byte, but on the dev stack `details` carries a stack trace whose line number differs between the two throw sites (sso.controller 728 vs 733).
  - It also expects `POST /auth/register` to be an absent route, and the route still exists (202). The spec is ahead of the code.
- **`p10-access-requests` (1):** the sixth request from one address got 202, not 429, so the per-address budget (ADR-100) is not applied on this stack.
- **`p10-verify-passkey` (2):** the per-address verdict budget (no 429 at the 61st), plus the ceremony case. Run 1 also showed 7 failures from the demo seed's approval workflow making a direct approve a 409 (ADR-101).

**Flaky, failing in runs 1 and 2 and passing in run 3:**
- `certificates.e2e`, verify: `toBeNull()` received `undefined`, around the ADR-107/Q-50 verify change;
- `ai.e2e`: a 409 outside [200, 500].

**None of these involves a P9-12 module** (jwt, session, webauthn, userPermission, roles, user, auth, apiKey, sso, scim, oidcProvider, oidcJwks). The P10 lanes own the three stable specs.

## Cleanup

- `down -v`, and the image `callib-p912-backend:p912` was deleted.
- The scratch `.env` and the operator-password file were deleted, and so was the seeded pkg binary.
- 0 containers and 0 volumes of `callib-p912` remain. The earlier scratch PG (`p9m-pg18`) and its volume are gone too.

## Not done

**The full coverage gate "on a quiet tree" was not achieved: the tree was never quiet.**
- At every run, other lanes' in-flight files held suites red.
- Every P9-12 file was at 100% in its own suites (records `2026-09-30-p9-12-batches-2-3.md`, `2026-09-30-a282-user-routes-a295.md`).
- Whether that counts toward DONE is the coordinator's call. It is stated here, not rounded up.
